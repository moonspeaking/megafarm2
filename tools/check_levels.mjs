#!/usr/bin/env node
// Валидатор скриптов уровней части 2 (задача 1).
// Для каждого assets/scripts/level1..24.txt (+ _entry, _dialogue — их сливает src/data.js)
// проверяет то, что видно игре (тот же парсер src/dsl.js и src/data.js, DOM не нужен):
//   - у уровня есть @scenario, события и действие "victory";
//   - объекты из "add to field"/"add bed"/"add to shop"/"delete from shop"/
//     "spawn object"/"set upgrade"/"add particles" существуют в assets/scripts/objects/;
//   - "add dialogue" ссылается на @simple_dialogue из levelN_dialogue.txt,
//     тексты кадров диалогов и "show message" есть в rus-паке, лица face_*.tga
//     находятся в manifest.json;
//   - условия (@condition): "enabled/disabled by event" и список событий без типа
//     ссылаются на существующие события/шаблоны (@pattern) уровня, объектные типы
//     (sow/harvest/kill/sell/place/…) — на существующие объекты;
//   - "add event from pattern" ссылается на существующий @pattern;
//   - звуки "play sound"/"play loop music" есть в manifest.json;
//   - текстуры задействованных объектов (texpicture/texhighlight/texmask/texture_name)
//     разрешаются через src/assets.js c env уровня;
//   - координаты расстановки в границах level_size (fence_*/decor_* ставятся и
//     за пределами поля — это предупреждение, не ошибка).
// Все встреченные типы @action/@condition пишутся в docs/part2-script-types.md
// (тип → сколько раз → понимает ли sim.js) — это список для задач 4–6.
// Вывод: таблица «уровень → проблемы», код возврата != 0 при проблемах.
// Запуск: node tools/check_levels.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../src/assets.js';
import { Assets } from '../src/assets.js';
import { loadData } from '../src/data.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Скрипты грузятся через fetch; подменяем чтением с диска (как smoke_levels.mjs).
globalThis.fetch = async (url) => {
  const rel = String(url).replace(/[?#].*$/, '').replace(/^https?:\/\/[^/]+/, '');
  const abs = rel.startsWith('/') ? rel : path.join(ROOT, rel);
  try {
    const text = await fs.readFile(abs, 'utf8');
    return { ok: true, text: async () => text, json: async () => JSON.parse(text) };
  } catch {
    return { ok: false, text: async () => '', json: async () => { throw new Error('not found: ' + rel); } };
  }
};

// Типы действий, которые понимает sim.js (runAction) — задача 4 (группа A, инфраструктура).
// Остальные встреченные типы попадают в docs/part2-script-types.md — задачи 5–6.
const SIM_ACTIONS = new Map([
  ['add dialogue', 'да (задача 6: ui.js showDialogue, очередь кадров simple_dialogue)'],
  ['add guard waypoint', 'да (задача 5: sim_people.js, патруль охраны по тэгу)'],
  ['clear guard waypoints', 'да (задача 5: sim_people.js)'],
  ['reset guards', 'да (задача 5: sim_people.js)'],
  ['visual effect', 'частично (задача 5: счётчик effect_*, без отдельной анимации)'],
  ['effect show', 'частично (задача 5: счётчик effect_*, без отдельной анимации)'],
  ['house ready', 'частично (задача 5: счётчик effect_*, подсветки нет)'],
  ['distract bees', 'частично (задача 5: флаг world.beesDistracted)'],
  ['play loop music', 'частично (задача 5: hooks.playMusic, если есть)'],
  ['victory', 'да'],
  ['defeat', 'да'],
  ['show help', 'да'],
  ['show message', 'да'],
  ['add money', 'да'],
  ['set money', 'да'],
  ['add to shop', 'да'],
  ['delete from shop', 'да (задача 4)'],
  ['add to field', 'да (задача 4: data "obj x y [arg]", arg — no_fruits / апгрейд дома / тэг персонажа / near_hero)'],
  ['add bed', 'да (задача 4: data "x y w h [plant]"; счётчик dig_bed не растёт — это расстановка, не работа героини)'],
  ['add field', 'да (в части 2 не встречается, вместо него "add bed")'],
  ['add particles', 'да (формат data совпадает)'],
  ['add notify', 'да'],
  ['set task', 'да'],
  ['add task', 'да'],
  ['enable condition', 'да'],
  ['disable condition', 'да'],
  ['allow action', 'да (задача 4: "dig|plant|weed|harvest|water|fertilize|sell|switch|fix 0|1", начальное состояние — #bool cant_* уровня)'],
  ['set plant thirst', 'да (задача 4: свойство уровня plant_thirst_growth)'],
  ['set plant growth', 'да (задача 4: свойство уровня plant_growth)'],
  ['set fruit growth', 'да (задача 4: свойство уровня plant_fruit_growth)'],
  ['set plant health', 'да (задача 4: свойство plant_starting_health + здоровье живых растений; семантика оригинала не восстановлена — open-questions)'],
  ['set upgrade', 'да (задача 4: уровень хранится на объекте, счётчик upgraded_<имя>_<уровень>; визуал/эффекты — задача 5)'],
  ['upgrade house', 'да (задача 4, как set upgrade)'],
  ['upgrade factory', 'да (задача 4, как set upgrade; поведение фабрик — задача 5)'],
  ['overload generator', 'да (задача 4: генератор становится broken)'],
  ['fix generator', 'да (задача 4: счётчик fixed_generator)'],
  ['kill all people', 'да (все Worker кроме bee/lightbug)'],
  ['water all', 'да (задача 4)'],
  ['start rain', 'да (sim_rain.js: CRain из IDA — фазы, сила, радуга, молнии, звук)'],
  ['set sun', 'да (sim_sun.js: угол солнца, цвет, затемнение; IDA)'],
  ['start morning', 'да (sim_sun.js: угол солнца, цвет, затемнение; IDA)'],
  ['start day', 'да (sim_sun.js: угол солнца, цвет, затемнение; IDA)'],
  ['start evening', 'да (sim_sun.js: угол солнца, цвет, затемнение; IDA)'],
  ['start night', 'да (sim_sun.js: угол солнца, цвет, затемнение; IDA)'],
  ['start moon', 'да (sim_sun.js: угол солнца, цвет, затемнение; IDA)'],
  ['spawn object', 'да (задача 4: предмет появляется у respawn, подбор даёт "take from respawn")'],
  ['play sound', 'да (задача 4)'],
  ['center view', 'да (Renderer.centerOnObject: камера едет к ближайшему объекту, 1 px/мс; IDA)'],
  ['open shop tab', 'частично (задача 4: вызов hooks.openShopTab; вкладки магазина — задача 2/6)'],
  ['add event from pattern', 'да (задача 4: @pattern создаёт событие в рантайме)'],
  ['set hero pos', 'да (задача 4)'],
  ['(без типа)', 'да (задача 4: data — имя диалога → hooks.showDialogue, иначе событие помечается выполненным)'],
]);
const TEXT_ACTIONS = new Set(['show message', 'add notify', 'add task', 'set task']);

// Семейства условий, в которых имя объекта зашито в type ("sell house_cow", "upgraded house_pig 2").
const OBJ_COND_SINGLE = new Set(['sow', 'harvest', 'kill', 'sell', 'place', 'take', 'steal', 'refuel', 'feed', 'buy']);
const OBJ_COND_FULL = new Set(['fruit ready', 'store deny', 'transported']);
const OBJ_COND_UPGRADED = 'upgraded';

const CMP = /^[<>=!]=?\s*-?\d+/; // порог в data условия: ">=4", "<100", "=0", "<=20000"

// Имена шаблонов частиц из particle_scripts.txt (@ParticleTemplate { #string name "…" }).
let particleNames = new Set();

// Статистика по типам для docs/part2-script-types.md.
const typeStats = { action: new Map(), condition: new Map() }; // type -> { count, levels:Set, sample }

function collectProps(node, names, out) {
  for (const [k, v] of Object.entries(node.props || {})) {
    if (names.includes(k) && typeof v === 'string' && v) out.push({ prop: k, value: v });
  }
  for (const c of node.children || []) collectProps(c, names, out);
}

/** События/шаблоны уровня: [{ node, kind: 'event'|'pattern' }] — по порядку в сценарии. */
function scenarioBlocks(lvl) {
  const sc = (lvl.children || []).find((c) => c.type === 'scenario');
  if (!sc) return { sc: null, blocks: [] };
  const blocks = [];
  for (const c of sc.children) {
    if (c.type === 'event' || c.type === 'pattern') blocks.push({ node: c, kind: c.type });
  }
  return { sc, blocks };
}

function blockName(b) { return b.node.props.name || '(без имени)'; }

function noteType(kind, type, level, sample) {
  const map = typeStats[kind];
  if (!map.has(type)) map.set(type, { count: 0, levels: new Set(), sample });
  const st = map.get(type);
  st.count++;
  st.levels.add(level);
}

function checkLevel(db, assets, n) {
  const problems = [];   // объективные ошибки
  const warnings = [];   // подозрительное, но не заведомая ошибка
  const stats = { actions: 0, conds: 0, events: 0, objects: 0, textures: 0, texts: 0, dialogues: 0 };
  const lvl = db.levels.get(n);
  if (!lvl) { problems.push('уровень не загрузился'); return { problems, warnings, stats }; }

  const env = lvl.props.level_env || 'grass';
  const size = lvl.props.level_size || [24, 16];
  const { sc, blocks } = scenarioBlocks(lvl);
  if (!sc) { problems.push('нет блока @scenario'); return { problems, warnings, stats }; }
  if (!blocks.length) problems.push('в сценарии нет ни одного @event');
  stats.events = blocks.length;

  const blockNames = new Set(blocks.map(blockName));
  const dialogues = lvl.dialogues || new Map();
  stats.dialogues = dialogues.size;

  // Уровень считается «непроходимым», если нигде нет действия victory.
  const allActions = blocks.flatMap((b) => b.node.children.filter((c) => c.type === 'action'));
  if (!allActions.some((a) => a.props.type === 'victory')) problems.push('нет действия "victory" — уровень непроходим');

  // Объекты, задействованные уровнем, — для проверки их текстур.
  const usedObjects = new Set();

  const needObject = (where, name) => {
    if (!name) { problems.push(`${where}: не указан объект`); return; }
    if (!db.objects.has(name)) { problems.push(`${where}: объекта нет в objects/: "${name}"`); return; }
    usedObjects.add(name);
  };

  for (const b of blocks) {
    const bWhere = `@${b.kind} "${blockName(b)}"`;
    for (const a of b.node.children.filter((c) => c.type === 'action')) {
      const type = a.props.type;
      const data = a.props.data;
      const where = `${bWhere}: "${type ?? '(без типа)'}"`;
      stats.actions++;
      noteType('action', type ?? '(без типа)', n, data != null ? String(data) : '');

      if (!type) {
        // Особый случай (level11 @event "l11_export"): действие без типа с data — именем
        // диалога показывает его, иначе помечает событие выполненным.
        const name = String(data || '').trim();
        if (dialogues.has(name) || blockNames.has(name)) continue;
        problems.push(`${where}: "${name}" — ни диалога, ни события с таким именем в уровне`);
        continue;
      }

      if (!SIM_ACTIONS.has(type)) {
        warnings.push(`${where}: неизвестный тип действия (sim.js его молча игнорирует)`);
      }

      switch (type) {
        case 'add to field': {
          // часть 2: data = "obj x y" (координаты внутри data, #point coords нет)
          const parts = String(data || '').split(/\s+/);
          needObject(where, parts[0]);
          const x = parseFloat(parts[1]), y = parseFloat(parts[2]);
          if (parts.length < 3 || Number.isNaN(x) || Number.isNaN(y)) {
            problems.push(`${where}: data не "obj x y": "${data}"`);
          } else if (x < 0 || y < 0 || x >= size[0] || y >= size[1]) {
            warnings.push(`${where}: "${parts[0]}" вне поля (${x}, ${y} при ${size[0]}x${size[1]}) — заборы/декор так и ставятся`);
          }
          break;
        }
        case 'add bed': {
          // data = "x y w h [plant]" — готовые грядки default placement
          const parts = String(data || '').split(/\s+/);
          const x = parseFloat(parts[0]), y = parseFloat(parts[1]);
          const w = parseFloat(parts[2]), h = parseFloat(parts[3]);
          if (parts.length < 4 || [x, y, w, h].some(Number.isNaN)) {
            problems.push(`${where}: data не "x y w h [plant]": "${data}"`);
            break;
          }
          if (x < 0 || y < 0 || x + w - 1 >= size[0] || y + h - 1 >= size[1]) {
            warnings.push(`${where}: грядка ${w}x${h} от ${x}, ${y} выходит за поле ${size[0]}x${size[1]}`);
          }
          const plant = parts[4];
          if (plant && plant !== 'none') needObject(where, plant);
          break;
        }
        case 'add to shop':
        case 'delete from shop':
        case 'spawn object':
        case 'house ready':
          needObject(where, String(data || '').trim());
          break;
        case 'set upgrade': {
          // "house_sheep 0 0" / "upgrade factory_sweeties 0"
          needObject(where, String(data || '').split(/\s+/)[0]);
          break;
        }
        case 'upgrade house':
        case 'upgrade factory': {
          needObject(where, String(data || '').split(/\s+/)[0]);
          break;
        }
        case 'add money':
        case 'set money':
          if (!/^-?\d+$/.test(String(data || '').trim())) problems.push(`${where}: data не число: "${data}"`);
          break;
        case 'add dialogue': {
          const name = String(data || '').trim();
          if (!dialogues.has(name)) {
            // Особый случай оригинала (level6): "l6_build_beehive_1" — имя диалога,
            // которого нет; есть диалог "l6_build_beehive" и текст-фраза "l6_build_beehive_1".
            // Порт по умолчанию: показываем диалог, чьё имя = имя без хвоста "_N" (см. open-questions.md).
            const base = name.replace(/_\d+$/, '');
            if (base !== name && dialogues.has(base)) {
              warnings.push(`${where}: диалога "${name}" нет, есть "${base}" (особенность оригинала, fallback на него)`);
            } else {
              problems.push(`${where}: диалога "${name}" нет в level${n}_dialogue.txt`);
            }
          }
          break;
        }
        case 'add particles': {
          const parts = String(data || '').split(/\s+/).filter(Boolean);
          needObject(where, parts[0]);
          if (parts[1] && !particleNames.has(parts[1])) warnings.push(`${where}: шаблона частиц "${parts[1]}" нет в particle_scripts.txt`);
          break;
        }
        case 'play sound':
        case 'play loop music': {
          if (!assets.manifest.sounds[String(data || '').toLowerCase()]) {
            warnings.push(`${where}: звука "${data}" нет в manifest.json`);
          }
          break;
        }
        case 'show message':
          if (!data || !data.trim()) problems.push(`${where}: пустой data — нечего показать`);
          else if (!db.texts.has(data)) problems.push(`${where}: текста нет в rus-паке: "${data}"`);
          else stats.texts++;
          break;
        case 'add event from pattern':
          if (!blockNames.has(String(data || '').trim())) problems.push(`${where}: шаблона "@pattern ${data}" нет в уровне`);
          break;
        default:
          // center view / set sun / allow action / … — поведение для задач 4–6
          break;
      }
    }

    for (const cond of b.node.children.filter((c) => c.type === 'condition')) {
      const type = cond.props.type;
      const data = cond.props.data;
      const where = `${bWhere}: условие "${type ?? '(без типа)'}"`;
      stats.conds++;
      noteType('condition', type ?? '(без типа)', n, data != null ? String(data) : '');

      if (!type) {
        // Особый случай (level11): условие без типа — «все перечисленные события выполнены».
        for (const name of String(data || '').split(',').map((s) => s.trim()).filter(Boolean)) {
          if (!blockNames.has(name)) problems.push(`${where}: события "${name}" нет в уровне`);
        }
        continue;
      }

      if (type === 'enabled by event' || type === 'disabled by event') {
        // data может быть и списком через запятую: "l6_sell_dahlia, l6_sell_sunflower"
        for (const name of String(data || '').split(',').map((s) => s.trim()).filter(Boolean)) {
          if (!blockNames.has(name)) problems.push(`${where}: события "${name}" нет в уровне`);
        }
        continue;
      }
      if (/^end dialogue\b/.test(type)) {
        // "end dialogue l12_pilot_1" — имя диалога зашито в тип
        const name = type.replace(/^end dialogue\s*/, '') || String(data || '').trim();
        if (!dialogues.has(name)) problems.push(`${where}: диалога "${name}" нет в level${n}_dialogue.txt`);
        continue;
      }

      // объектные семейства
      let obj = null;
      const words = String(type).split(/\s+/);
      if (OBJ_COND_SINGLE.has(words[0]) && words[1] && words[1] !== 'from') obj = words[1];
      else if (words[0] === OBJ_COND_UPGRADED && words[1]) obj = words[1];
      else if (OBJ_COND_FULL.has(`${words[0]} ${words[1]}`) && words[2]) obj = words[2];
      if (obj) {
        if (!db.objects.has(obj)) problems.push(`${where}: объекта нет в objects/: "${obj}"`);
        else usedObjects.add(obj);
      }

      if (data != null && !CMP.test(String(data).trim()) && !obj) {
        warnings.push(`${where}: data "${data}" не порог ">=N"`);
      }
      // остальные типы условий sim.js вычисляет как сравнение счётчика
      // (задача 4: имя типа пробелами → подчёркивания, порог — из data; отдельные
      // счётчики — arrested, jobless workers, transported… — наполнятся в задачах 5–6).
    }
  }

  // Действия/условия вне @event/@pattern (на уровне сценария): проверяем как безусловные.
  const bare = sc.children.filter((c) => c.type === 'action' || c.type === 'condition');
  for (const c of bare) {
    warnings.push(`действие/условие "${c.props.type ?? '(без типа)'}" прямо в @scenario (вне @event) — в части 1 так жили безусловные действия`);
  }

  // Диалоги уровня: тексты и лица.
  for (const [name, d] of dialogues) {
    for (const frame of d.children.filter((c) => c.type === 'simple_dialogue_frame')) {
      const text = frame.props.text;
      if (text) {
        stats.texts++;
        if (!db.texts.has(text)) problems.push(`диалог "${name}": текста нет в rus-паке: "${text}"`);
      }
      for (const side of ['left_picture', 'right_picture']) {
        const face = frame.props[side];
        if (face && !assets.resolve(face, env)) problems.push(`диалог "${name}": лицо ${side} "${face}" не найдено в manifest.json`);
      }
    }
  }

  // Текстовые ключи text_key/title_key (на будущее).
  for (const node of [lvl, sc, ...blocks.map((b) => b.node)]) {
    const found = [];
    collectProps(node, ['text_key', 'title_key'], found);
    for (const { prop, value } of found) {
      if (!db.texts.has(value)) problems.push(`${prop} отсутствует в rus-паке: "${value}"`);
    }
  }

  // Текстуры всех задействованных объектов — тем же резолвером, что и рендер.
  const TEX_PROPS = ['texpicture_name', 'texhighlight_name', 'texmask_name', 'texture_name'];
  // tga, которых нет даже в оригинальных data/textures — это не пробел конвертации:
  //   боксы (fivebox/tenbox/multibox) рисуются движком из атласа pictures/others/multibox1..10.jpg;
  //   патенты patent_for_*.tga отсутствуют в оригинале целиком (есть только иконки магазина).
  const KNOWN_MISSING = /^(fivebox|tenbox|multibox|patent_for_.+)\.tga$/;
  const seen = new Set();
  for (const name of [...usedObjects].sort()) {
    const def = db.objects.get(name);
    stats.objects++;
    const refs = [];
    collectProps(def, TEX_PROPS, refs);
    for (const { prop, value } of refs) {
      const key = prop + ':' + value;
      if (seen.has(key)) continue;
      seen.add(key);
      stats.textures++;
      if (KNOWN_MISSING.test(String(value).toLowerCase())) {
        warnings.push(`объект ${name}: текстура ${prop} "${value}" отсутствует и в оригинальных data/textures (рисуется движком, см. KNOWN_MISSING)`);
      } else if (!assets.resolve(value, env)) {
        problems.push(`объект ${name}: текстура ${prop} "${value}" не найдена в manifest.json (env ${env})`);
      }
    }
  }

  return { problems, warnings, stats };
}

/** docs/part2-script-types.md: тип → сколько раз → в каких уровнях → понимает ли sim.js. */
async function writeTypeDoc(levels) {
  const line = (kind, type, st) => {
    const sim = kind === 'action'
      ? (SIM_ACTIONS.has(type) ? SIM_ACTIONS.get(type) : '**нет** (sim.js молча игнорирует)')
      : 'да (задача 4): счётчик из типа условия + порог data; "enabled/disabled by event" — флаги событий; "end dialogue *" — задача 6 (диалоги)';
    const lv = st.levels.size === levels
      ? 'все 24'
      : [...st.levels].sort((a, b) => a - b).join(', ');
    return `| \`${type}\` | ${st.count} | ${lv} | ${sim} |`;
  };

  const out = [];
  out.push('<!-- Файл генерируется tools/check_levels.mjs (задача 1) — не править руками. -->');
  out.push('');
  out.push('# Типы действий и условий уровней части 2');
  out.push('');
  out.push(`Полный список значений \`#string type\` из \`@action\`/\`@condition\` всех уровней \`assets/scripts/level1..24.txt\``);
  out.push(`(+ \`_entry\`; сливает их \`src/data.js\`). «sim.js» — текущее состояние движка порта:`);
  out.push('`да` — действие выполняется уже сейчас, `нет` — кандидат для задач 4–6 (симуляция и сценарии).');
  out.push('');
  for (const [kind, title] of [['action', 'Действия (@action)'], ['condition', 'Условия (@condition)']]) {
    const map = typeStats[kind];
    const entries = [...map.entries()].sort((a, b) => b[1].count - a[1].count);
    out.push(`## ${title} — ${entries.length} типов, ${entries.reduce((s, [, st]) => s + st.count, 0)} вхождений`);
    out.push('');
    out.push('| тип | сколько раз | уровни | понимает sim.js |');
    out.push('|-----|------------|--------|-----------------|');
    for (const [type, st] of entries) out.push(line(kind, type, st));
    out.push('');
  }
  out.push('## Особые узлы сценариев части 2');
  out.push('');
  out.push('| узел | смысл |');
  out.push('|------|-------|');
  out.push('| `@event` | группа условий + действий; действия выполняются, когда истинны все условия события (без условий — сразу; так живёт `default placement` из `_entry`) |');
  out.push('| `@pattern` | именованный шаблон события; в рантайме создаётся действием `add event from pattern` (перезапускаемые цепочки: дождь L15, время суток L19, охрана L3) |');
  out.push('| `#bool player_task` на `@event` | событие показывается игроку как задание (панель задач) |');
  out.push('| `@action` без `type` | data — имя диалога (показать диалог) или события (пометить выполненным); level11 `l11_export` (точная семантика оригинала неизвестна, см. open-questions.md) |');
  out.push('| `@condition` без `type` | истинно, когда выполнены все перечисленные через запятую события (data; level11) |');
  out.push('');
  out.push('Расстановка поля: события из `levelN_entry.txt` (\`default placement\`) вставляются в сценарий');
  out.push('на место ссылки `[levelN_entry]` — первыми, как в оригинале. Данные `add to field` — `obj x y`');
  out.push('(координаты внутри data, в части 1 было `#point coords`), `add bed` — `x y w h [plant]`.');
  out.push('');
  await fs.writeFile(path.join(ROOT, 'docs/part2-script-types.md'), out.join('\n') + '\n');
}

async function main() {
  const manifest = await loadManifest();
  const db = await loadData(manifest);
  const assets = new Assets(manifest);

  // шаблоны частиц
  const ptext = await fs.readFile(path.join(ROOT, 'assets/scripts/particle_scripts.txt'), 'utf8').catch(() => null);
  if (ptext) {
    const { parseScript } = await import('../src/dsl.js');
    for (const root of parseScript(ptext)) {
      for (const c of root.children || []) if (c.props.name) particleNames.add(c.props.name);
      if (root.props.name) particleNames.add(root.props.name);
    }
  }

  const LEVELS = db.levelNumbers();
  const rows = [];
  for (const n of LEVELS) {
    const { problems, warnings, stats } = checkLevel(db, assets, n);
    rows.push({ n, problems, warnings, stats });
  }
  const total = (k) => rows.reduce((s, r) => s + r.stats[k], 0);

  await writeTypeDoc(LEVELS.length);

  // таблица «уровень → проблемы»
  console.log('уровень | проблемы');
  console.log('--------|---------');
  for (const r of rows) {
    const p = r.problems.length ? `${r.problems.length}` : '—';
    const w = r.warnings.length ? ` (+${r.warnings.length} пред.)` : '';
    console.log(`уровень ${String(r.n).padEnd(2)} | ${p}${w}${r.problems[0] ? `: ${r.problems[0]}${r.problems.length > 1 ? ' …' : ''}` : ''}`);
  }

  // детали
  for (const r of rows) {
    if (!r.problems.length && !r.warnings.length) continue;
    console.log(`\n--- уровень ${r.n} ---`);
    const print = (list, marker) => {
      for (const p of [...new Set(list)]) {
        const k = list.filter((x) => x === p).length;
        console.log(`  ${marker} ${p}${k > 1 ? `  (×${k})` : ''}`);
      }
    };
    print(r.problems, '!');
    print(r.warnings, '~');
  }

  const bad = rows.filter((r) => r.problems.length);
  const warned = rows.filter((r) => r.warnings.length);
  console.log(`\nпроверено: событий ${total('events')}, действий ${total('actions')} (текстов ${total('texts')}),` +
    ` условий ${total('conds')}, диалогов ${total('dialogues')}, объектов ${total('objects')} (ссылок на текстуры ${total('textures')})`);
  console.log(`итог: ${rows.length - bad.length}/${rows.length} уровней без проблем` +
    `${bad.length ? `, с проблемами: ${bad.map((r) => r.n).join(', ')}` : ''}` +
    `${warned.length ? `; предупреждения: ${warned.map((r) => r.n).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((err) => { console.error(err && err.stack || err); process.exit(2); });
