// DOM HUD controller.
import { fontForLang, loadFont, loadedFont, textWidth, layoutPopup } from './fontmetrics.js';
import { endSoundName } from './endsound.js';
import { taskGoalLines } from './goals.js';
import { extraT } from './i18n_extra.js';

const TABS = [
  ['inventory', 'ИНВЕНТАРЬ'],
  ['buildings', 'СТРОЕНИЯ'],
  ['seeds', 'СЕМЕНА'],
  ['trees', 'ДЕРЕВЬЯ'],
  ['workers', 'РАБОТНИКИ'],
];

// длительности состояний окна конца уровня, мс (таблица flt_1009AF78 оригинала, индекс = состояние)
const COMPLETE_MS = [0, 0, 800, 300, 2000, 300, 800, 800, 300, 800, 800];

const SPADE_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g transform="rotate(35 32 32)">' +
  '<rect x="29" y="2" width="6" height="30" rx="3" fill="#b9793a" stroke="#6b3f17" stroke-width="1.5"/>' +
  '<rect x="24" y="2" width="16" height="6" rx="3" fill="#c98a45" stroke="#6b3f17" stroke-width="1.5"/>' +
  '<path d="M23 30h18l-1 14c-1 8-5 14-8 16-3-2-7-8-8-16z" fill="#c9d3dc" stroke="#4a5866" stroke-width="2" stroke-linejoin="round"/>' +
  '<path d="M27 33h4l-1 14c-.5 4-1.500 7-3 9z" fill="#fff" opacity=".55"/></g></svg>');

export class UI {
  constructor(assets, audio) {
    this.assets = assets;
    this.audio = audio;
    this.world = null;
    this.messages = [];
    this.msgVisible = false;
    this.activeTab = 'inventory';
    this.hintTimer = null;

    this.el = {
      hud: document.getElementById('hud'),
      money: document.getElementById('money'),
      timefill: document.getElementById('timefill'),
      task_text: document.getElementById('task_text'),
      upcenter: document.getElementById('upcenter'),
      taskfill: document.getElementById('taskfill'),
      toolslots: document.getElementById('toolslots'),
      shop_tabs: document.getElementById('shop_tabs'),
      shop_items: document.getElementById('shop_items'),
      hint: document.getElementById('hint'),
      msgbox: document.getElementById('msgbox'),
      msg_text: document.getElementById('msg_text'),
      msg_ok: document.getElementById('msg_ok'),
      endbox: document.getElementById('endbox'),
      end_title: document.getElementById('end_title'),
      end_stats: document.getElementById('end_stats'),
      end_next: document.getElementById('end_next'),
    };

    this.el.msg_ok.addEventListener('click', () => this.nextMessage());
    this.el.end_next.addEventListener('click', () => this.onEndNext());
  }

  // Доска заданий (sub_100259AC): раз в 40 мс окно upmenu_center сдвигается на 1 px к -14·(число строк) от
  // стартового положения y=-98, а заливка task_bar догоняет долю выполненных целей шагом 0.02 (уменьшается сразу).
  tickTaskPanel() {
    if (!this.el.upcenter) return;
    const tgt = this.taskTarget || 0;
    if (this.taskOff === undefined) this.taskOff = 0;
    if (this.taskOff < tgt) this.taskOff++;
    else if (this.taskOff > tgt) this.taskOff--;
    const f = this.taskFrac || 0;
    this.taskShown = this.taskShown === undefined || f <= this.taskShown ? f : Math.min(f, this.taskShown + 0.02);
    this.el.upcenter.style.top = `${-98 + this.taskOff}px`;
    this.el.taskfill.style.width = `${352 * this.taskShown}px`;
  }

  tickMoney() {
    this.tickTaskPanel();
    if (this.moneyShown === undefined || this.moneyShown === this.moneyTarget || this.moneyTarget === undefined) return;
    let d = Math.trunc((this.moneyTarget - this.moneyShown) / 2);
    if (d === 0) d = this.moneyTarget > this.moneyShown ? 1 : -1;
    this.moneyShown += d;
    this.el.money.textContent = this.moneyShown;
  }

  bind(world, hooks) {
    this.moneyShown = null; this.moneyTarget = undefined;
    this.taskOff = 0; this.taskTarget = 0; this.taskFrac = 0; this.taskShown = 0; this.taskKey = '';
    clearInterval(this.moneyTimer);
    this.moneyTimer = setInterval(() => this.tickMoney(), 40);
    this.world = world;
    this.hooks = hooks;
    this.clearDialogues();
    this.el.hud.classList.remove('hidden');
    this.buildTabs();
    const ln = document.getElementById('level_name');
    if (ln) ln.textContent = world.db.t(`level${world.levelNum}_name`, '') || extraT('level_name_fallback', 'Уровень %d').replace('%d', world.levelNum);
    this.updateShop();
    this.updateHud();
    this.updateTasks();
    this.updateTools();
  }

  unbind() {
    clearInterval(this.moneyTimer);
    this.clearDialogues();
    this.world = null;
    this.el.hud.classList.add('hidden');
  }

  // ------------------------------------------------------------- messages

  showMessage(text) {
    this.messages.push(text);
    this.pumpMessages();
  }

  pumpMessages() {
    if (this.msgVisible || !this.messages.length) return;
    this.msgVisible = true;
    this.el.msg_text.textContent = this.messages.shift();
    this.el.msgbox.classList.remove('hidden');
    this.audio.play('clickmenu', 0.4);
  }

  nextMessage() {
    this.el.msgbox.classList.add('hidden');
    this.msgVisible = false;
    if (this.messages.length) this.pumpMessages();
  }

  notify(text) {
    if (!text) return;
    const el = this.el.hint;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  // ------------------------------------------------------------- dialogues
  // @simple_dialogue (levelN_dialogue.txt): кадры с лицами слева/справа, текстом по ключу и временем показа.
  // Очередь: следующий диалог ждёт конца текущего; клик по облаку — следующий кадр, по значку — пропуск.
  showDialogue(name) {
    const w = this.world;
    const node = w && (w.level.dialogues.get(name) || w.db.dialogues.get(name));
    const frames = node ? node.children.filter((c) => c.type === 'simple_dialogue_frame') : [];
    if (!frames.length) { if (w) w.endedDialogues.add(name); return; } // нет диалога — считаем законченным, чтобы сценарий не завис
    (this.dlQueue ||= []).push({ name, frames });
    if (!this.dlActive) this.nextDialogue();
  }

  nextDialogue() {
    const d = document.getElementById('dialogue');
    if (!this.dlBound) {
      this.dlBound = true;
      d.addEventListener('click', (e) => { if (e.target.id === 'dl_skip') this.dlFrames = []; this.nextFrame(); });
    }
    const next = (this.dlQueue || []).shift() || null;
    this.dlFrames = next && next.frames;
    this.dlName = next && next.name;
    this.dlActive = !!next;
    if (this.dlActive) { d.classList.remove('hidden'); this.nextFrame(); } else d.classList.add('hidden');
  }

  nextFrame() {
    clearTimeout(this.dlTimer);
    this.audio.stopVoice();
    const d = document.getElementById('dialogue');
    const f = this.dlFrames && this.dlFrames.shift();
    if (!f) {
      // диалог закончен: условие сценария "end dialogue <имя>"
      if (this.dlName && this.world) this.world.endedDialogues.add(this.dlName);
      this.dlName = null; this.dlActive = false; this.nextDialogue(); return;
    }
    const p = f.props, w = this.world;
    const face = (side, name) => {
      const box = d.querySelector('.dl_' + side), img = box.querySelector('img');
      const key = name && this.assets.resolve(String(name).replace(/\.tga$/i, ''));
      const path = key && this.assets.manifest.textures[key];
      if (path) { img.src = path; box.classList.remove('off'); } else box.classList.add('off');
    };
    face('left', p.left_picture); face('right', p.right_picture);
    d.querySelector('.dl_arrow_l').style.visibility = p.left_arrow && p.left_picture ? 'visible' : 'hidden';
    d.querySelector('.dl_arrow_r').style.visibility = p.right_arrow && p.right_picture ? 'visible' : 'hidden';
    document.getElementById('dl_text').textContent = w ? w.db.t(p.text, p.text) : '';
    const ms = Math.max(2000, Number(p.time) || 8000);
    this.dlTimer = setTimeout(() => this.nextFrame(), ms);
    // озвучка реплики: звук = ключ текста; кадр не сменяется, пока голос не договорил
    const voice = this.audio.playVoice(p.text);
    if (voice) {
      const t0 = performance.now();
      voice.addEventListener('loadedmetadata', () => {
        const need = voice.duration * 1000 + 500;
        if (this.audio.voice === voice && need > ms) { clearTimeout(this.dlTimer); this.dlTimer = setTimeout(() => this.nextFrame(), need - (performance.now() - t0)); }
      });
    }
  }

  clearDialogues() {
    clearTimeout(this.dlTimer);
    if (this.audio) this.audio.stopVoice();
    this.dlQueue = []; this.dlFrames = null; this.dlActive = false;
    const d = document.getElementById('dialogue'); if (d) d.classList.add('hidden');
  }

  // ----------------------------------------------------------------- hud

  updateHud() {
    const w = this.world;
    if (!w) return;
    const now = performance.now();
    if (now - (this._lastHud || 0) < 200) return;
    this._lastHud = now;
    this.moneyTarget = w.money; // показываемые деньги плавно догоняют настоящие (sub_100259AC: раз в 40 мс шаг = разность/2)
    if (this.moneyShown === undefined || this.moneyShown === null) { this.moneyShown = w.money; this.el.money.textContent = w.money; }
    this.updateTasks(); // прогресс целей (сам разбор дешёвый, DOM меняется только при изменении)
    // the bar shows the time that is left, like the original
    const left = Math.max(0, 100 - (w.time / w.levelTime) * 100);
    this.el.timefill.style.width = left + '%';
  }

  updateTasks() {
    const w = this.world;
    if (!w) return;
    const box = this.el.task_text;
    // как в оригинале (upmenu_form.task1..4): цели текущего задания с прогрессом, а не название задания
    const lines = taskGoalLines(w);
    if (lines.length) {
      this.taskTarget = 14 * lines.length;
      const gkey = lines.map((l) => l.text).join('|');
      if (gkey !== this.taskKey) { this.taskKey = gkey; this.taskShown = 0; } // новое задание: заливка с нуля (sub_1002EE54)
      this.taskFrac = lines.filter((l) => l.cur >= l.target).length / lines.length;
      const sig = lines.map((l) => `${l.text}|${l.cur}|${l.target}`).join('\n');
      if (box.dataset.sig === sig) return;
      box.dataset.sig = sig;
      box.className = 'goals';
      box.replaceChildren(...lines.map((l, i) => {
        const row = document.createElement('div');
        row.className = 'goal';
        row.style.top = `${89 - 14 * i}px`; // task1 — нижняя строка, следующие выше (task1..7: y = 32, 46, 60 …)
        row.textContent = `${l.text}: ${l.cur}/${l.target}`; // формат оригинала "%s: %i/%i"
        return row;
      }));
      return;
    }
    // целей нет (например, всё выполнено или у задания только временные условия): название задания
    box.dataset.sig = '';
    box.className = 'single';
    // задание выполнено (цели исчезли с доски): полоса дозаполняется до конца, доска остаётся до следующего задания
    this.taskFrac = this.taskKey ? 1 : 0;
    const active = [...w.tasks].reverse().find((t) => t.state === 'active');
    if (active) box.textContent = w.db.t(active.key, active.key);
    else if (w.tasks.length) box.textContent = w.db.t(w.tasks[w.tasks.length - 1].key, '');
    else box.textContent = '';
    this.taskTarget = box.textContent ? 14 : 0;
  }

  // ---------------------------------------------------------------- shop

  buildTabs() {
    const w = this.world;
    if (!w) return;
    const host = this.el.shop_tabs;
    host.innerHTML = '';
    // shop_form/shop_menu (menuhost_scripts.txt): a horizontal CPopupMenu 800x32, margin 32, six `tab_button`s
    // of fixed height 32. Every tab is as wide as its caption (CTextElement autosize: sum of glyph advances
    // of the language's bitmap font * font_size 12); the caps (16 px) lie outside the body, so neighbouring
    // tabs touch. The row is laid out by layoutPopup (centred, shifted right by margin/2).
    const fontName = fontForLang(w.db.lang);
    const table = loadedFont(fontName);
    if (!table) loadFont(fontName).then(() => { if (this.world === w) this.buildTabs(); }).catch(() => {});
    const labels = TABS.map(([key, label]) => w.db.t(key + '_form', label));
    const bodies = labels.map((s) => (table ? textWidth(table, s, 12) : s.length * 8.5));
    const lay = layoutPopup(bodies, 32, 1024);
    TABS.forEach(([key], i) => {
      if (lay.overflow >= 0 && i >= lay.overflow) return; // the original disables tabs that do not fit
      const active = key === this.activeTab;
      const b = document.createElement('button');
      b.className = 'tab' + (active ? ' active' : '');
      b.style.left = `${512 + lay.xs[i] - bodies[i] / 2 - 16}px`;
      b.style.width = `${bodies[i] + 32}px`;
      b.innerHTML = '<i class="tl"></i><i class="tc"></i><i class="tr"></i><span></span>';
      const label = b.querySelector('span');
      label.textContent = labels[i];
      b.addEventListener('click', () => {
        this.activeTab = key;
        this.buildTabs();
        this.updateShop();
        this.audio.play('clickmenu', 0.4);
      });
      host.appendChild(b);
      // our web font is narrower than the bitmap one: stretch the caption to the width the original has
      const natural = label.offsetWidth;
      if (natural > 0 && bodies[i] > 0) {
        const k = Math.max(0.7, Math.min(1.4, bodies[i] / natural));
        label.style.setProperty('--k', k.toFixed(3));
      }
    });
  }

  updateShop() {
    const w = this.world;
    if (!w) return;
    this.buildTabs();
    const el = this.el.shop_items;
    el.innerHTML = '';
    const list = w.shop[this.activeTab] || [];
    if (this.activeTab === 'inventory') this.addSpadeButton(el, w);
    for (const name of list) {
      const def = w.db.objects.get(name);
      if (!def) continue;
      const div = document.createElement('div');
      const carried = w.pending || w.hero.held;
      const inHand = !!(carried && carried.name === name);
      div.className = 'shop_item' + (w.money < (def.props.price || 0) && !inHand ? ' cant' : '') + (inHand ? ' active' : '');
      const img = document.createElement('img');
      // sub_439500: the button picture is the plain `<item name>.tga` (no environment variant, e.g. house_chicken)
      const tex = this.assets.resolve(name, null) || this.assets.resolve(def.props.texpicture_name, null);
      if (tex) img.src = this.assets.manifest.textures[tex];
      div.appendChild(img);
      const price = document.createElement('div');
      price.className = 'price';
      price.textContent = def.props.price || 0;
      div.appendChild(price);
      div.title = w.db.t(name + '_shop_hint', w.db.t(name, name)) + ' — ' + (def.props.price || 0);
      div.addEventListener('click', () => {
        if (w.deselectShopItem(name)) { this.updateShop(); return; }
        if (w.money < (def.props.price || 0)) {
          w.hooks.notify(w.db.t('notify_no_more_money', 'Не хватает денег!'));
          return;
        }
        w.buy(name);
        this.updateShop();
      });
      el.appendChild(div);
    }
  }

  /** Кнопка лопаты в инвентаре: режим «один клик копает»; повторное нажатие возвращает обычный режим. */
  addSpadeButton(el, w) {
    const div = document.createElement('div');
    div.className = 'shop_item spade' + (w.digMode ? ' active' : '');
    const img = document.createElement('img');
    // в оригинале лопаты в инвентаре нет (кнопка — идея порта), текстуры тоже: рисуем значок сами (SVG 64x64)
    img.src = SPADE_ICON;
    div.appendChild(img);
    div.title = extraT('spade_dig');
    div.addEventListener('click', () => { w.toggleDigMode(); this.updateShop(); });
    el.appendChild(div);
  }

  // ---------------------------------------------------------------- tools

  updateTools() {
    // The original panel has no tool slots: the spade is the hero's default tool and whatever he holds is
    // visible on the hero himself. The container stays empty.
    if (this.el.toolslots) this.el.toolslots.innerHTML = '';
  }

  addSlot(el, texName, label, active, onClick, badge) {
    const div = document.createElement('div');
    div.className = 'slot' + (active ? ' active' : '');
    div.title = label;
    const tex = this.assets.resolve(texName, this.world ? this.world.env : null);
    if (tex) {
      const img = document.createElement('img');
      img.src = this.assets.manifest.textures[tex];
      div.appendChild(img);
    } else {
      div.textContent = label;
    }
    if (badge) {
      const b = document.createElement('div');
      b.className = 'badge';
      b.textContent = badge;
      div.appendChild(b);
    }
    div.addEventListener('click', onClick);
    el.appendChild(div);
  }

  // ------------------------------------------------------------------ end

  showEnd(result, stats) {
    const w = this.world;
    const t = (k, d) => w.db.t(k, d);
    const won = result === 'victory';
    this.el.end_next.textContent = t('ok', 'ОК');
    this.el.endbox.classList.remove('hidden');
    if (won) {
      this.startComplete(stats);
    } else {
      this.stopComplete();
      this.el.end_title.textContent = '💀 ' + t('level_not_finished', 'Уровень не пройден');
      this.el.end_stats.textContent = '';
    }
    // orig. sub_42F2B0: выбор звука — см. src/endsound.js (громкость 0.7, как было)
    this.audio.play(endSoundName(won, stats.trophies), 0.7);
  }

  // Окно «Уровень пройден» — конечный автомат оригинала (sub_10057694 / sub_100574FC / sub_1005730F):
  // состояния 1..10, длительности COMPLETE_MS[состояние]; 0 — всё показано, ждём «ОК».
  startComplete(stats) {
    const w = this.world;
    const t = (k, d) => w.db.t(k, d);
    const clock = (sec) => {
      if (sec === 359999) return '--:--:--';
      const p = (v) => String(v).padStart(2, '0');
      return `${p(Math.floor(sec / 3600))}:${p(Math.floor((sec % 3600) / 60))}:${p(sec % 60)}`;
    };
    const line = (key, def, sec) => `${t(key, extraT(key) || def)}: ${clock(sec)}`;
    this.stopComplete();
    const c = {
      state: 1, dur: 0, t: 0,
      elapsed: Math.round(stats.time),
      trophy: Math.round(w.levelTime),
      record: stats.prevRecord > 0 ? stats.prevRecord : 359999,
      line,
    };
    this.el.end_title.textContent = '';
    const box = this.el.end_stats;
    box.textContent = '';
    box.style.whiteSpace = 'normal';
    const mk = (cls, text, size) => {
      const d = document.createElement('div');
      d.className = 'end_line ' + cls;
      d.textContent = text;
      d.style.visibility = 'hidden';
      if (size) d.style.fontSize = size + 'px';
      return d;
    };
    c.els = {
      caption: mk('end_caption', t('level_complete', 'Уровень пройден!'), 18),
      your: mk('', line('your_time', 'Ваше время', 0)),
      trophy: mk('', line('trophy_time', 'Золотое время', c.trophy)),
      gotTrophy: mk('end_good', t('got_trophy', 'Вы получили трофей!'), 14),
      recordT: mk('', line('record_time', 'Рекорд', c.record)),
      gotRecord: mk('end_good', t('got_record', 'Новый рекорд уровня!'), 14),
    };
    c.els.caption.style.visibility = 'visible';
    for (const k of ['caption', 'your', 'trophy', 'gotTrophy', 'recordT', 'gotRecord']) box.appendChild(c.els[k]);
    c.last = performance.now();
    c.timer = setInterval(() => this.tickComplete(), 16);
    this.complete = c;
  }

  stopComplete() {
    if (this.complete && this.complete.timer) clearInterval(this.complete.timer);
    this.complete = null;
  }

  tickComplete() {
    const c = this.complete;
    if (!c) return;
    const now = performance.now();
    const dt = now - c.last;
    c.last = now;
    if (c.state === 0) { this.stopComplete(); return; }
    c.t += dt;
    const pulse = (el, base) => { el.style.fontSize = (base + Math.sin(Math.PI * Math.min(1, c.t / c.dur)) * 1.5) + 'px'; };
    if (c.state === 4) c.els.your.textContent = c.line('your_time', 'Ваше время', Math.floor(c.t / c.dur * c.elapsed));
    else if (c.state === 2) pulse(c.els.caption, 18);
    else if (c.state === 7) pulse(c.els.gotTrophy, 14);
    else if (c.state === 10) pulse(c.els.gotRecord, 14);
    if (c.dur <= c.t) this.advanceComplete();
  }

  advanceComplete() {
    const c = this.complete;
    const show = (e) => { e.style.visibility = 'visible'; };
    c.t = 0;
    switch (c.state) {
      case 1: c.state = 2; break;
      case 2: c.state = 3; break;
      case 3: c.state = 4; show(c.els.your); break;
      case 4: c.state = 5; break;
      case 5:
        c.els.your.textContent = c.line('your_time', 'Ваше время', c.elapsed);
        c.state = 6; show(c.els.trophy); break;
      case 6:
        if (c.elapsed > c.trophy) c.state = 8;
        else { c.state = 7; show(c.els.gotTrophy); }
        break;
      case 7: c.state = 8; break;
      case 8: c.state = 9; show(c.els.recordT); break;
      case 9:
        if (c.elapsed < c.record) { c.state = 10; show(c.els.gotRecord); } else c.state = 0;
        break;
      default: c.state = 0;
    }
    c.dur = COMPLETE_MS[c.state] || 0;
  }

  /** Клик «ОК» во время анимации (сообщение 28, sub_100573F7): показать итог сразу. Возвращает true, если анимация шла. */
  skipComplete() {
    const c = this.complete;
    if (!c || c.state === 0) return false;
    const show = (e) => { e.style.visibility = 'visible'; };
    c.els.your.textContent = c.line('your_time', 'Ваше время', c.elapsed);
    for (const k of ['your', 'trophy', 'recordT']) show(c.els[k]);
    if (c.elapsed <= c.trophy) show(c.els.gotTrophy);
    if (c.elapsed < c.record) show(c.els.gotRecord);
    for (const k of ['caption', 'gotTrophy', 'gotRecord']) c.els[k].style.fontSize = (k === 'caption' ? 18 : 14) + 'px';
    c.state = 0;
    this.stopComplete();
    return true;
  }

  onEndNext() {
    if (this.skipComplete()) return;
    this.stopComplete();
    this.el.endbox.classList.add('hidden');
    if (this.onEnd) this.onEnd();
  }

  showMenu() { if (this.menu) this.menu.show(); }

  hideMenu() { if (this.menu) this.menu.hide(); }
}

// ---------------------------------------------------------- error panel

/**
 * Компактная панель ошибки игрового цикла (Задача 18): «Ошибка: <текст>» + «В меню».
 * Одна на экран; если панель уже есть — повторных показов не будет.
 */
export function showErrorPanel(container, text, onQuit) {
  if (document.getElementById('errpanel')) return;
  const box = document.createElement('div');
  box.id = 'errpanel';
  box.className = 'mwin errpanel';
  const msg = document.createElement('div');
  msg.className = 'err_text';
  msg.textContent = String(text).split('\n')[0].slice(0, 160); // стек остаётся только в консоли
  const btn = document.createElement('button');
  btn.className = 'pill err_quit';
  btn.textContent = 'В меню';
  btn.addEventListener('click', () => {
    box.remove();
    if (onQuit) onQuit();
  });
  box.appendChild(msg);
  box.appendChild(btn);
  container.appendChild(box);
}
