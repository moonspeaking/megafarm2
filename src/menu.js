// Main menu, pause menu, the level select screen (interfaces/levelmenu.txt, part 2)
// and the other front-end screens.  Window sizes and positions are the original ones;
// coordinates there are centre based, y up.  All screens use the 1024x768 canvas of part 2,
// levelmenu is built on the 1024x768 canvas of part 2 (see stageSize/fitStage).

import { LANGUAGES } from './settings.js';
import { LEVELS, formatTime } from './progress.js';
import { playerKey, loadSave, clearSave } from './savegame.js';
import { EXTRA, setExtraLang } from './i18n_extra.js';

const W = 1024, H = 768;     // часть 2: все экраны (menu/credits/levelmenu.txt) — холст 1024x768
const LMW = W, LMH = H;

export class Menu {
  constructor({ root, assets, db, audio, settings, progress, hooks }) {
    this.progress = progress;
    this.root = root;
    this.assets = assets;
    this.db = db;
    this.audio = audio;
    this.settings = settings;
    this.hooks = hooks; // { startLevel, resume, quit, restart, saveAndQuit, isInGame, currentLevel, setLanguage }
    this.screen = 'main';
    this.inGame = false;
    this.eyeTimer = null;
    // язык запасных текстов порта (sim.js берёт их из i18n_extra.js без настроек)
    setExtraLang(this.settings.get('lang'));
    this.settings.onChange((name) => { if (name === 'lang') setExtraLang(this.settings.get('lang')); });
    // экраны строются в логическом холсте фиксированного размера (часть 1 — 800x600,
    // levelmenu части 2 — 1024x768) и масштабируются под фактическую панель
    window.addEventListener('resize', () => this.fitStage());
    this.build();
  }

  // ------------------------------------------------------------ helpers

  /** Задать логический размер сцены (пиксели оригинала) для текущего экрана. */
  stageSize(w, h) {
    this.stageW = w;
    this.stageH = h;
    this.stage.style.width = `${w}px`;
    this.stage.style.height = `${h}px`;
    this.fitStage();
  }

  /** Вписать сцену в панель (панель = #menu, растянут на весь #game). */
  fitStage() {
    const w = this.stageW || W, h = this.stageH || H;
    const pw = this.root.clientWidth || W, ph = this.root.clientHeight || H;
    const k = Math.min(pw / w, ph / h);
    this.stage.style.transform = `translate(-50%, -50%) scale(${k})`;
  }

  tx(key, fallback) {
    const v = this.db.t(key, '\u0000');
    if (v !== '\u0000') return v;
    const lang = this.settings.get('lang');
    const extra = EXTRA[lang] || EXTRA.eng;
    return extra[key] !== undefined ? extra[key] : (fallback !== undefined ? fallback : key);
  }

  /** Имя уровня: levelmenu.txt берёт ключи levelN_name (есть в обоих пиках);
   *  если ключа нет — запасное имя по языку (i18n_extra.js). */
  levelName(n) {
    const v = this.db.t(`level${n}_name`, '\u0000');
    if (v !== '\u0000') return v;
    return this.tx('level_name_fallback', 'Level %d').replace('%d', n);
  }

  tex(name) {
    const key = this.assets.resolve(name);
    return key ? this.assets.manifest.textures[key] : '';
  }

  click() { this.audio.play('clickmenu', 0.5); }

  el(tag, cls, parent, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  /** Window with the original frame. (cx, cy) is the centre in original coordinates. */
  win(parent, cx, cy, w, h, cls) {
    const e = this.el('div', 'mwin ' + (cls || ''), parent);
    // the scripts give the inner size; the 16px frame is added around it
    e.style.left = `${W / 2 + cx - w / 2 - 8}px`;
    e.style.top = `${H / 2 - cy - h / 2 - 8}px`;
    e.style.width = `${w + 16}px`;
    e.style.height = `${h + 16}px`;
    return e;
  }

  /** Popup list: plain outlined text lines with a highlight under the cursor. */
  popup(parent, items) {
    const list = this.el('div', 'popup', parent);
    for (const [label, fn] of items) {
      const it = this.el('div', 'popup_item otext', list, label);
      it.addEventListener('mouseenter', () => this.audio.play('selectmenu', 0.3));
      it.addEventListener('click', () => { this.click(); fn(); });
    }
    return list;
  }

  pill(parent, label, fn, cls) {
    const b = this.el('button', 'pill otext ' + (cls || ''), parent, label);
    b.addEventListener('click', () => { this.click(); fn(); });
    return b;
  }

  /** Иконная кнопка @bitbtn из guihost_scripts.txt: 64x64, стрелка arrow_right.tga.
   *  В оригинале в позиции 355,-255 (нижний правый угол) — выход из титров и из трофеев. */
  bitbtn(parent, fn) {
    const b = this.el('div', 'bitbtn', parent);
    b.style.backgroundImage = `url('${this.tex('arrow_right.png')}')`;
    b.addEventListener('click', () => { this.click(); fn(); });
    return b;
  }

  // -------------------------------------------------------------- build

  build() {
    const root = this.root;
    root.classList.add('menu_root');
    root.innerHTML = '';
    this.stage = this.el('div', 'menu_stage', root);
    this.scene = this.el('div', 'menu_scene', this.stage);
    this.buildArt();
    this.panel = this.el('div', 'menu_panel', this.stage);
    this.render();
  }

  /** One swaying sprite; delta_rotate is the swing amplitude and rotate_speed its angular speed. */
  sprite(parent, [name, x, y, w, h, px, py, amp, speed, phase], keyed) {
    const e = this.el('div', 'sway', parent);
    const left = W / 2 + x - w / 2, top = H / 2 - y - h / 2;
    Object.assign(e.style, {
      left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px`,
      backgroundImage: `url('${this.tex(name)}')`,
      transformOrigin: `${W / 2 + px - left}px ${H / 2 - py - top}px`,
      animationDuration: `${(2 * Math.PI / speed).toFixed(2)}s`,
      animationDelay: `-${phase}s`,
      '--amp': `${amp}deg`,
    });
    return e;
  }

  /** Сцена главного меню (interfaces/menu.txt): фон 1024x768, глаза героини (sprite_eyes), рука (sprite_hand), версия. */
  buildArt() {
    const s = this.scene;
    const back = this.el('div', 'menu_back', s);
    back.style.backgroundImage = `url('${this.tex('menu_background.png')}')`;
    // координаты скрипта — центр спрайта от центра экрана, y вверх
    const at = (e, x, y, w, h) => Object.assign(e.style, {
      left: `${W / 2 + x - w / 2}px`, top: `${H / 2 - y - h / 2}px`, width: `${w}px`, height: `${h}px`,
    });
    this.eyes = this.el('div', 'eyes', s);
    at(this.eyes, -342, 59, 64, 32);
    this.eyes.style.backgroundImage = `url('${this.tex('eyes.png')}')`;
    const hand = this.el('div', 'hand', s);
    at(hand, -274, -84, 32, 32);
    hand.style.backgroundImage = `url('${this.tex('hand_marta.png')}')`;
    const ver = this.el('div', 'menu_version otext', s, 'v 1.2.0.852');
    ver.style.left = `${W / 2 + 495 - 64}px`;
    ver.style.top = `${H / 2 + 370 - 16}px`;
  }

  startEyes() {
    clearInterval(this.eyeTimer);
    let frame = 0;
    this.eyeTimer = setInterval(() => {
      if (!this.eyes || this.root.classList.contains('hidden')) return;
      if (frame === 0 && Math.random() > 0.015) return; // open eyes for ~4 s, then one blink
      frame = (frame + 1) % 13;
      this.eyes.style.backgroundPositionX = `${-frame * 64}px`;
    }, 62);
  }

  show() {
    this.inGame = !!this.hooks.isInGame();
    this.screen = this.inGame ? 'ingame' : 'main';
    this.root.classList.remove('hidden');
    this.root.classList.toggle('ingame', this.inGame);
    this.render();
    this.startEyes();
    this.audio.playMusic(this.inGame ? 'music_mix' : 'music_menu');
  }

  /** Back from a finished level: trophy announcement, otherwise the level menu with the next level selected. */
  afterLevel(num, won, res) {
    this.inGame = false;
    this.newTrophies = res ? [...res.newTrophies] : [];
    this.pendingSelect = won ? Math.min(num + 1, LEVELS) : num;
    this.screen = 'levelmenu';
    this.root.classList.remove('hidden', 'ingame');
    const finale = won && num === LEVELS && !this.newTrophies.length;
    this.render();
    this.startEyes();
    if (finale) this.hooks.playComics(LEVELS, () => {});
  }

  hide() {
    this.root.classList.add('hidden');
    clearInterval(this.eyeTimer);
  }

  go(screen) {
    if (screen !== 'name') this.nameMode = 'select';
    this.screen = screen;
    this.render();
  }

  back() { this.go(this.inGame ? 'ingame' : 'main'); }

  render() {
    const p = this.panel;
    p.innerHTML = '';
    this.stageSize(W, H);
    this.root.classList.toggle('fullscreen_page', ['levelmenu', 'credits'].includes(this.screen));
    switch (this.screen) {
      case 'options': if (!this.inGame) this.renderSign(p, false); this.renderOptions(p); break;
      case 'language': if (!this.inGame) this.renderSign(p, false); this.renderLanguage(p); break;
      case 'volume': if (!this.inGame) this.renderSign(p, false); this.renderVolume(p); break;
      case 'help': this.renderHelp(p); break;
      case 'levelmenu': this.renderLevelmenu(p); break;
      case 'credits': this.renderCredits(p); break;
      case 'ingame': this.renderIngame(p); break;
      case 'name': this.renderMain(p); this.renderName(p); break;
      case 'exit': this.renderMain(p); this.renderConfirm(p, this.tx('question_exit_game'), () => this.quitApp(), () => this.go('main')); break;
      default: this.renderMain(p);
    }
  }

  // --------------------------------------------------------------- main

  /** Деревянная табличка с приветствием: в оригинале она остаётся и в подменю (настройки, язык, громкость). */
  renderSign(p, interactive) {
    // name.tga (256x64) с приветствием и book.tga (256x64) «сменить игрока» — центры (-356,-210) и (-346,-287)
    const sign = this.el('div', 'sign', p);
    const plate = this.el('div', 'sign_plate', sign);
    this.el('div', 'sign_h otext', plate, this.tx('welcome_message'));
    this.el('div', 'sign_n otext', plate, this.profileLabel(this.settings.get('player') || 'default'));
    const book = this.el('div', 'sign_book', sign);
    if (interactive) {
      this.el('div', 'sign_c otext', book, this.tx('change_player_label'));
      sign.addEventListener('mouseenter', () => sign.classList.add('hl'));
      sign.addEventListener('mouseleave', () => sign.classList.remove('hl'));
      sign.addEventListener('click', () => { this.click(); this.go('name'); });
    } else {
      sign.style.cursor = 'default';
      sign.style.pointerEvents = 'none';
    }
  }

  renderMain(p) {
    this.renderSign(p, true);

    const w = this.win(p, 342, 170, 220, 290); // main_menu: pos (342,170)
    const items = [
      [this.tx('start'), () => this.go('levelmenu')],
      [this.tx('options'), () => this.go('options')],
      [this.tx('help'), () => this.go('help')],
      [this.tx('credits'), () => this.go('credits')],
      [this.tx('exit'), () => this.go('exit')],
    ];
    // пункт «трофеи» части 1 убран: в части 2 нет interfaces/trophyroom,
    // трофеи (trophy1..25) показаны прямо в levelmenu
    this.popup(w, items);
  }

  renderIngame(p) {
    // меню паузы оригинала (menuhost_scripts.txt, main_menu_form 220x200): restart, exitgame, options, continue
    const w = this.win(p, 0, 0, 220, 200);
    this.popup(w, [
      [this.tx('restart'), () => this.confirm(this.tx('question_replay_game'), () => this.hooks.restart())],
      // «Закончить/Quit» спрашивает question_saveandexit_game («Сохранить игру перед выходом?»): да — сохранить и выйти,
      // нет — выйти без сохранения (в оригинале есть текст этого вопроса; полный разбор веток не восстановлен)
      [this.tx('exitgame'), () => this.confirm3(this.tx('question_saveandexit_game'),
        () => this.hooks.saveAndQuit(), () => this.hooks.quit())],
      [this.tx('options'), () => this.go('options')],
      [this.tx('continue'), () => this.hooks.resume()],
    ]);
  }

  /** Вопрос с тремя кнопками: «Да», «Нет» и «Отмена» (возврат в меню паузы). */
  confirm3(text, yes, no) {
    const p = this.panel;
    const shade = this.el('div', 'shade', p);
    const w = this.win(shade, 0, 0, 380, 150);
    this.el('div', 'msg_line otext', w, text);
    const row = this.el('div', 'btn_row', w);
    this.pill(row, this.tx('yes'), () => { this.render(); yes(); });
    this.pill(row, this.tx('no'), () => { this.render(); no(); });
    this.pill(row, this.tx('cancel'), () => this.render());
  }

  confirm(text, yes, no) {
    this.renderConfirm(this.panel, text, () => { this.render(); yes(); }, () => { this.render(); if (no) no(); });
  }

  renderConfirm(p, text, yes, no) {
    const shade = this.el('div', 'shade', p);
    const w = this.win(shade, 0, 0, 340, 150);
    this.el('div', 'msg_line otext', w, text);
    const row = this.el('div', 'btn_row', w);
    this.pill(row, this.tx('yes'), yes);
    this.pill(row, this.tx('no'), no);
  }

  // ------------------------------------------------------------ profiles

  /** Все известные профили: список настроек плюс профили с сохранённым прогрессом. */
  profileNames() {
    const names = [...new Set([...this.settings.profiles(), ...this.progress.profiles()])];
    const cur = this.settings.get('player') || 'default';
    if (!names.includes(cur)) names.unshift(cur);
    return names;
  }

  /** Внутренний 'default' показывается как обычное имя игрока. */
  profileLabel(name) { return name === 'default' ? this.tx('player') : name; }

  /** Смена/создание/удаление профиля: оригинальные profiles_window и
   *  delete_profile_window (menuhost_scripts.txt: pos -230,0, size 220x270). */
  renderName(p) {
    const shade = this.el('div', 'shade', p);
    const w = this.win(shade, -230, 0, 220, 270);
    const mode = this.nameMode || 'select';
    const names = this.profileNames();
    const items = [];
    if (mode === 'delete') {
      for (const n of names) items.push([this.profileLabel(n), () => this.confirmDeleteProfile(n)]);
      items.push([this.tx('back'), () => { this.nameMode = 'select'; this.render(); }]);
    } else {
      for (const n of names) items.push([this.profileLabel(n), () => { this.settings.set('player', n); this.render(); }]);
      items.push([this.tx('new_profile'), () => { this.nameMode = 'create'; this.render(); }]);
      items.push([this.tx('delete_profile'), () => { this.nameMode = 'delete'; this.render(); }]);
      items.push([this.tx('back'), () => { this.nameMode = 'select'; this.go('main'); }]);
    }
    const list = this.popup(w, items);
    list.classList.add('profiles');
    if (mode === 'select') {
      const cur = this.settings.get('player') || 'default';
      [...list.children].forEach((c, i) => { if (names[i] === cur) c.classList.add('sel'); });
    } else if (mode === 'create') {
      this.renderEnterName(shade);
    }
  }

  /** Оригинальное enter_name_window (400x150, modal, шрифт 24): ввод имени нового игрока. */
  renderEnterName(shade) {
    const w = this.win(shade, 0, 0, 400, 150);
    this.el('div', 'msg_line otext big', w, this.tx('text_enter_name'));
    const input = this.el('input', 'name_input', w);
    input.maxLength = 16;
    setTimeout(() => input.focus(), 0);
    const ok = () => {
      const name = input.value.trim();
      if (!name) return;
      this.settings.addProfile(name);
      this.settings.set('player', name);
      this.nameMode = 'select';
      this.render();
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') ok(); });
    const row = this.el('div', 'btn_row', w);
    this.pill(row, this.tx('cancel'), () => { this.nameMode = 'select'; this.render(); });
    this.pill(row, this.tx('ok'), ok);
  }

  confirmDeleteProfile(name) {
    this.confirm(this.tx('question_delete_profile').split('%s').join(this.profileLabel(name)), () => this.deleteProfile(name));
  }

  /** Удалить профиль: его прогресс и его сохранение игры (сейв хранится по playerKey). */
  deleteProfile(name) {
    this.progress.removeProfile(name);
    clearSave(playerKey(this.settings, name));
    this.settings.removeProfile(name);
    this.nameMode = 'select';
    this.render();
  }

  quitApp() {
    window.close();
    this.go('main');
    const t = this.el('div', 'toast otext', this.panel, this.tx('exit_web'));
    setTimeout(() => t.remove(), 3000);
  }

  // ------------------------------------------------------------ options

  renderOptions(p) {
    const st = this.settings;
    const w = this.win(p, this.inGame ? 0 : 230, this.inGame ? 0 : 100, 240, this.inGame ? 240 : 260);
    const fs = !!document.fullscreenElement;
    this.popup(w, [
      [fs ? this.tx('windowed') : this.tx('fullscreen'), () => {
        if (fs) document.exitFullscreen?.().catch(() => {});
        else document.documentElement.requestFullscreen?.().catch(() => {});
        // метка и настройка обновляются по событию fullscreenchange (см. main.js)
      }],
      [this.tx('set_volume'), () => this.go('volume')],
      [st.get('cursor') ? this.tx('cursor_off') : this.tx('cursor_on'), () => { st.set('cursor', !st.get('cursor')); this.render(); }],
      [this.tx('language'), () => this.go('language')],
      [this.tx('back'), () => this.back()],
    ]);
  }

  renderLanguage(p) {
    const st = this.settings;
    const w = this.win(p, 230, 0, 220, 570);
    const items = [];
    for (const code of LANGUAGES) {
      if (!this.assets.manifest.scripts[code]) continue;
      items.push([this.db.t('lang_' + code, code), async () => {
        await this.hooks.setLanguage(code);
        this.render();
      }]);
    }
    items.push([this.tx('back'), () => this.go('options')]);
    const list = this.popup(w, items);
    [...list.children].forEach((c, i) => { if (i < items.length - 1 && LANGUAGES.filter((l) => this.assets.manifest.scripts[l])[i] === st.get('lang')) c.classList.add('sel'); });
  }

  slider(parent, label, key, ky) {
    const st = this.settings;
    this.el('div', 'vol_label otext', parent, label);
    const track = this.el('div', 'slider', parent);
    track.style.top = `${ky}px`;
    const knob = this.el('div', 'knob', track);
    const set = (v) => { knob.style.left = `calc(${v * 100}% - 16px)`; };
    set(st.get(key));
    const move = (e) => {
      const r = track.getBoundingClientRect();
      const v = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      set(v); st.set(key, v);
    };
    track.addEventListener('pointerdown', (e) => {
      track.setPointerCapture(e.pointerId);
      move(e);
      const up = () => { track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); this.audio.play('clickmenu', 0.5); };
      track.addEventListener('pointermove', move);
      track.addEventListener('pointerup', up);
    });
  }

  // volume_window (290x240): сначала громкость звуков (заголовок в 0,90, шкала 0,50),
  // затем музыка (0,0 и 0,-40), снизу кнопка ok.
  renderVolume(p) {
    const w = this.win(p, 0, 0, 290, 240, 'vol');
    this.el('div', 'vol_label otext', w, this.tx('sound_volume')).style.top = '28px';
    this.slider(w, '', 'sfx', 56);
    this.el('div', 'vol_label otext', w, this.tx('music_volume')).style.top = '98px';
    this.slider(w, '', 'music', 126);
    const b = this.pill(w, this.tx('ok'), () => this.go('options'), 'abs_bottom');
    void b;
  }

  // --------------------------------------------------------------- help

  renderHelp(p) {
    const w = this.win(p, 0, 0, 600, 500, 'help');
    const pic = (name, cx, cy, pw, ph) => {
      const e = this.el('div', 'help_pic', w);
      Object.assign(e.style, {
        left: `${300 + cx - pw / 2 - 16}px`, top: `${250 - cy - ph / 2 - 16}px`,
        width: `${pw}px`, height: `${ph}px`, backgroundImage: `url('${this.tex(name)}')`,
      });
    };
    const text = (key, cy) => {
      const e = this.el('div', 'help_text otext', w);
      e.style.top = `${250 - cy - 16 - 16}px`;
      e.innerHTML = '';
      this.tx(key).split('^').forEach((line, i) => { if (i) e.appendChild(document.createElement('br')); e.appendChild(document.createTextNode(line)); });
    };
    pic('keyhelper2.png', -112, 180, 256, 128);
    pic('keyhelper.png', 176, 180, 128, 128);
    text('control_help_1', 80);
    pic('help2.png', -160, -30, 256, 128);
    pic('help1.png', 80, -30, 64, 128);
    pic('help3.png', 208, -30, 128, 128);
    text('control_help_2', -120);
    this.pill(w, this.tx('ok'), () => this.back(), 'abs_bottom');
  }

  // -------------------------------------------------------------- credits

  async renderCredits(p) {
    const page = this.el('div', 'page credits', p);
    page.style.backgroundImage = `url('${this.tex('credits_back.jpg')}')`;
    const scroll = this.el('div', 'credits_scroll', this.el('div', 'credits_wrap', page));
    const lang = this.settings.get('lang');
    const path = this.assets.manifest.scripts['credits_' + lang] || this.assets.manifest.scripts.credits_rus;
    let text = '';
    try { text = await (await fetch(path)).text(); } catch (e) { /* ignore */ }
    if (this.screen !== 'credits') return;
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('<<') && !l.startsWith('>>') && !l.startsWith('@') && l !== '{' && l !== '}');
    for (const l of lines) {
      if (l.startsWith('_')) this.el('div', 'c_head otext', scroll, l.slice(1));
      else this.el('div', 'c_line otext', scroll, l);
    }
    const dur = Math.max(30, lines.length * 1.4);
    scroll.style.animationDuration = `${dur}s`;
    // края как в credits.txt: up_gag сверху (0,320) и down_gag снизу (0,-320), по 1024x128
    const fadeTop = this.el('div', 'credits_fade', page);
    fadeTop.style.top = '0';
    fadeTop.style.backgroundImage = `url('${this.tex('up_gag.png')}')`;
    const fadeBottom = this.el('div', 'credits_fade', page);
    fadeBottom.style.bottom = '0';
    fadeBottom.style.backgroundImage = `url('${this.tex('down_gag.png')}')`;
    // credits_back: @button_right 355,-255, 64x64
    this.bitbtn(page, () => this.go('main'));
    this.audio.playMusic('music_credits');
  }

  // ----------------------------------------------------------- levelmenu

  // Трофеи interfaces/levelmenu.txt: [№, центр x, центр y, ширина, высота] —
  // координаты центра экрана 1024x768, y вверх. trophy25 — большой приз за всю игру.
  static LM_TROPHIES = [
    [1, -107, 297.5, 192, 128], [2, 279.5, -16.5, 64, 64], [3, 164.5, 300, 128, 64],
    [4, 287.5, 233.5, 128, 128], [5, 458.5, 282, 128, 192], [6, 407.5, -53.5, 128, 192],
    [7, -158, 204, 128, 64], [8, 433, -221, 192, 128], [9, 310, -272.5, 224, 192],
    [10, 87, 229.5, 64, 128], [11, -31, 200, 128, 128], [12, 187.5, 143, 128, 128],
    [13, -251.5, 322, 64, 128], [14, -188, -247, 128, 128], [15, -417, -79, 128, 320],
    [16, -188, 95.5, 128, 128], [17, -310.5, 1, 128, 320], [18, 256.5, 304.5, 64, 64],
    [19, 481, -96.5, 128, 192], [20, -343.5, -195, 128, 128], [21, 279, 147.5, 64, 64],
    [22, -213, -165, 128, 128], [23, 231.5, -172, 128, 128], [24, 261.5, 60.5, 64, 128],
    [25, 21, 8, 384, 320],
  ];

  // Подсказки @simple_hint того же скрипта: [№, x, y] — x центр текста, y его верх (y вверх).
  static LM_HINTS = [
    [1, 57, 187], [2, 137, 78], [3, 124, 210], [4, 216, 134], [5, 325, 171],
    [6, 261, -188], [7, -154, 92], [8, 340, -124], [9, 356, -130], [10, 239, 143],
    [11, -166, 108], [12, 78, 250], [13, -254, 197], [14, -92, -155], [15, -242, -54],
    [16, -73, 204], [17, -108, 78], [18, 163, 217], [19, 271, -72], [20, -191, -105],
    [21, 189, 204], [22, -160, -141], [23, 316, -70], [24, 160, 183], [25, 244, 189],
  ];

  /** Спрайт trophyN: нарезка атласа levelmenu/trophies.jpg по @image из imagehost_scripts.txt.
   *  Возвращает { image, pos, size } — background-image/-position/-size, k — вписывание в box px. */
  lmTrophy(i, box) {
    const img = this.db.images.get('trophy' + i);
    if (!img) return null;
    const [x0, y0, x1, y1] = img.props.rect;
    const key = this.assets.resolve(img.props.texture);
    const k = box ? Math.min(box / (x1 - x0), box / (y1 - y0)) : 1;
    return {
      image: key ? this.assets.manifest.textures[key] : '',
      pos: `${-x0 * k}px ${-y0 * k}px`,
      size: `${1024 * k}px ${1024 * k}px`,
      w: x1 - x0, h: y1 - y0,
    };
  }

  /** Лучший результат уровня среди всех профилей: { name, time } или null. */
  bestOf(n) {
    let best = null;
    for (const [name, prof] of Object.entries(this.progress.data)) {
      const r = prof.levels && prof.levels[n];
      if (r && (!best || r.time < best.time)) best = { name, time: r.time };
    }
    return best;
  }

  /** Первый запуск уровня: комикс, затем старт; если есть сейв этого уровня — вопрос о загрузке. */
  begin(n) {
    const player = playerKey(this.settings);
    const save = loadSave(player);
    const start = (restored) => {
      if (!this.progress.comicsSeen(n)) {
        this.progress.markComics(n);
        this.hooks.playComics(n - 1, () => this.hooks.startLevel(n, restored));
      } else this.hooks.startLevel(n, restored);
    };
    if (save && save.level === n) {
      // «нет» начинает уровень заново: новый прогон заменяет старый сейв
      this.confirm(this.tx('question_load_game'), () => start(true), () => {
        clearSave(player);
        start(false);
      });
    } else start(false);
  }

  /**
   * Экран выбора уровня по interfaces/levelmenu.txt: комната с монитором (на нём —
   * название/описание/рекорды выбранного уровня), трофеи trophy1..25 на полках,
   * старт/назад/комиксы и лента уровней на нижней полке (downbar_levels).
   * Позиции иконок уровней в скрипте не заданы (@levelselector содержит только список
   * level1..24) — см. docs/open-questions.md; по умолчанию лента на нижней полке
   * с прокруткой стрелками (gui/levelmenu_left.png: две стрелки — обычная и нажатая).
   */
  renderLevelmenu(p) {
    const page = this.el('div', 'page levelmenu', p);
    const s = this.el('div', 'lmenu_scene', page);
    const cx = (x) => 512 + x;   // центр экрана -> левый верх, y вверх
    const cy = (y) => 384 - y;

    const bg = this.el('div', 'lmenu_back', s);
    bg.style.backgroundImage = `url('${this.tex('levelmenu/levelmenu_back')}')`;

    // --- трофеи: показываются только заработанные, пульсируют, подсказка по наведению
    const earned = this.progress.trophies();
    const hint = this.el('div', 'trophy_hint otext', s);
    hint.style.display = 'none';
    for (const [i, x, y, w, h] of Menu.LM_TROPHIES) {
      if (!earned.includes(i)) continue;
      const t = this.lmTrophy(i);
      if (!t || !t.image) continue;
      const e = this.el('div', 'lm_trophy', s);
      Object.assign(e.style, {
        left: `${cx(x) - w / 2}px`, top: `${cy(y) - h / 2}px`, width: `${w}px`, height: `${h}px`,
        backgroundImage: `url('${t.image}')`, backgroundPosition: t.pos,
      });
      const hp = Menu.LM_HINTS.find((q) => q[0] === i);
      e.addEventListener('mouseenter', () => {
        hint.textContent = this.tx('trophy_hint' + i);
        hint.style.width = '256px';
        hint.style.left = `${cx(hp[1]) - 128}px`;
        hint.style.top = `${cy(hp[2])}px`;
        hint.style.display = 'block';
      });
      e.addEventListener('mouseleave', () => { hint.style.display = 'none'; });
    }

    // --- монитор: наложение экрана + строки информации о выбранном уровне
    const mon = this.el('div', 'lm_monitor', s);
    mon.style.backgroundImage = `url('${this.tex('levelmenu/levelmenu_monitor')}')`;
    // @text screen_*: pos (центр x, верх y), ширина 235, цвет 251,229,129
    const lmText = (cyY, fontSize) => {
      const e = this.el('div', 'lm_text otext', s);
      Object.assign(e.style, {
        left: `${cx(10.5) - 117.5}px`, top: `${cy(cyY)}px`, width: '235px',
        fontSize: `${fontSize}px`, lineHeight: 1.15,
      });
      return e;
    };
    const nameEl = lmText(-122, 20);
    const descEl = lmText(-147, 12);
    const timeEl = lmText(-172, 14);
    const bestEl = lmText(-196, 14);
    const winnerEl = lmText(-220, 14);
    const info = (n) => {
      nameEl.textContent = this.levelName(n);
      const desc = this.db.t(`level${n}_description`, '');
      descEl.textContent = desc;
      descEl.style.display = desc ? 'block' : 'none';
      const rec = this.progress.level(n);
      if (rec) {
        timeEl.textContent = `${this.db.t('level_time', 'Time')}: ${formatTime(rec.time)}`;
        const best = this.bestOf(n);
        if (best) {
          bestEl.style.display = 'block';
          winnerEl.style.display = 'block';
          bestEl.textContent = `${this.db.t('best_time', 'Best')}: ${formatTime(best.time)}`;
          winnerEl.textContent = this.profileLabel(best.name);
        } else {
          bestEl.style.display = 'none';
          winnerEl.style.display = 'none';
        }
      } else {
        timeEl.textContent = this.db.t('level_not_finished', '');
        bestEl.style.display = 'none';
        winnerEl.style.display = 'none';
      }
    };

    // --- старт/назад/комиксы (позиции из levelmenu.txt)
    const startBtn = this.el('div', 'lm_start otext', s, this.db.t('start_game', 'Старт'));
    Object.assign(startBtn.style, { left: `${cx(10) - 80}px`, top: `${cy(-285) - 20}px` });
    startBtn.addEventListener('click', () => { this.click(); this.begin(this.selected); });
    const bitbtn = (bcx, texture, fn) => {
      // @buttonex_back / @buttonex_camera: 64x64, button_back.tga / button_camera.tga
      const b = this.el('div', 'lm_bitbtn', s);
      b.style.left = `${cx(bcx) - 32}px`;
      b.style.top = `${cy(-265) - 32}px`;
      b.style.backgroundImage = `url('${this.tex(texture)}')`;
      b.addEventListener('click', () => { this.click(); fn(); });
      return b;
    };
    bitbtn(-430, 'button_back.png', () => this.go('main'));
    bitbtn(430, 'button_camera.png', () => this.hooks.playComics(this.selected - 1, () => this.audio.playMusic('music_levelmenu')));

    // --- лента уровней на нижней полке
    const bar = this.el('div', 'lm_bar', s);
    const scroller = this.el('div', 'lm_scroller', bar);
    const row = this.el('div', 'lm_row', scroller);
    const arrow = this.el('div', 'lm_arrow', row);   // указатель над выбранным уровнем
    const items = new Map();
    const mark = (el, n) => {
      el.classList.toggle('locked', !this.progress.unlocked(n));
      el.classList.toggle('done', this.progress.done(n));
      el.classList.toggle('gold', this.progress.gold(n));
    };
    const PITCH = 68; // иконка 64px + зазор 4px
    for (const n of this.db.levelNumbers()) {
      const it = this.el('div', 'lm_item', row);
      const ic = this.el('div', 'lm_icon', it);
      ic.style.backgroundImage = `url('${this.tex(`icons/levels/level${n}_icon`)}')`;
      this.el('div', 'lm_lock', it);
      this.el('div', 'lm_star', it);
      this.el('div', 'lm_sel', it);
      mark(it, n);
      it.addEventListener('mouseenter', () => {
        if (it.classList.contains('locked')) return;
        this.audio.play('selectmenu', 0.3);
      });
      it.addEventListener('click', () => { if (it.classList.contains('locked')) return; this.click(); select(n); });
      it.addEventListener('dblclick', () => { if (!it.classList.contains('locked')) this.begin(n); });
      items.set(n, it);
    }
    let scroll = 0;
    const maxScroll = () => Math.max(0, row.offsetWidth - scroller.clientWidth);
    const setScroll = (v) => {
      scroll = Math.max(0, Math.min(maxScroll(), v));
      row.style.transform = `translateX(${-scroll}px)`;
    };
    // стрелки прокрутки (levelmenu_left/right.png: 32x64 обычная + нажатая под ней)
    const nav = (right) => {
      const b = this.el('div', 'lm_nav', bar);
      b.style.backgroundImage = `url('${this.tex(right ? 'gui/levelmenu_right.png' : 'gui/levelmenu_left.png')}')`;
      b.addEventListener('click', () => { this.click(); setScroll(scroll + (right ? 1 : -1) * 4 * PITCH); });
      return b;
    };
    nav(false).style.left = '140px';
    nav(true).style.right = '140px';
    scroller.addEventListener('wheel', (e) => {
      e.preventDefault();
      setScroll(scroll + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY));
    }, { passive: false });

    const select = (n, instant) => {
      if (!this.progress.unlocked(n)) return;
      this.selected = n;
      this.settings.set('level', n);
      for (const [k, it] of items) it.classList.toggle('sel', k === n);
      const it = items.get(n);
      if (it) {
        arrow.style.left = `${it.offsetLeft + 16}px`;
        if (!instant) setScroll(it.offsetLeft + 32 - scroller.clientWidth / 2);
      }
      info(n);
    };

    const init = this.pendingSelect || this.progress.current();
    this.pendingSelect = null;
    select(this.progress.unlocked(init) ? init : 1, true);
    setScroll(items.get(this.selected) ? items.get(this.selected).offsetLeft + 32 - scroller.clientWidth / 2 : 0);

    // трофеи, выигранные в только что пройденном уровне, — по одному в окне
    this.announceTrophies(page);
    this.audio.playMusic('music_levelmenu');
  }

  /** Анонс трофеев (как в trophyroom.txt части 1): окно 512x512, слева картинка трофея,
   *  справа текст trophy_hintN, снизу ok — по одному за раз. */
  announceTrophies(page) {
    const queue = [...(this.newTrophies || [])];
    this.newTrophies = [];
    const next = () => {
      const i = queue.shift();
      if (i === undefined) return;
      const t = this.lmTrophy(i, 256);
      const shade = this.el('div', 'shade', page);
      const w = this.win(shade, 0, 0, 512, 512);
      this.el('div', 'msg_line otext big', w, this.tx('trophy_announce_header'));
      const pic = this.el('div', 'announce_pic', w);
      if (t) Object.assign(pic.style, {
        backgroundImage: `url('${t.image}')`, backgroundPosition: t.pos, backgroundSize: t.size,
      });
      this.el('div', 'msg_line otext', w, this.tx('trophy_hint' + i)).classList.add('announce_text');
      this.pill(w, this.tx('ok'), () => { shade.remove(); next(); }, 'abs_bottom');
    };
    next();
  }
}
