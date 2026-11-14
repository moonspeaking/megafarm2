// World simulation for Farm Craft.

import { initBees, serializeBees, restoreBees, updateBeehive } from './sim_bees.js';
import { startRain, updateRain } from './sim_rain.js';
import { initSun, setSun, startPhase, updateSun, serializeSun, restoreSun, isWorkable } from './sim_sun.js';
import { feedFactory, updateFactories, setFactoryPhase } from './sim_factory.js';
import { addGuardWaypoint, clearGuardWaypoints, resetGuards, disableGuards, distractBees, updatePeople, lightbugsFollow } from './sim_people.js';
import { PERSON_NAMES, ABILITY_NAMES, cantProp, boxCapacity, updateInfra } from './sim_infra.js';
import { extraT } from './i18n_extra.js'; // запасные тексты уведомлений по языку

// sound after `pay_shop` / when a carried object is put down (sub_416670)
const PUT_SOUNDS = { house: 'house_place', hangar: 'house_place', tree: 'tree_place', sprinkler: 'put_sprinkler',
  box: 'put_box', seed: 'put_bag', fertilizer: 'put_bag', watercan: 'put_watercan' };
// sound when the hero picks a lying item up
const TAKE_SOUNDS = { box: 'take_box', seed: 'take_bag', fertilizer: 'take_bag', watercan: 'take_watercan' };
export const TILE = 64;
const QUEUE_MAX = 256; // CMover: очередь точек до 256
const PATH_STALL_TIME = 4; // с без приближения к цели — считаем, что актёр кружит у недостижимой точки
const TAKE_PUT_TIME = 0.5; // sub_4031F0: состояния «взять»/«положить» длятся 500 мс (как animation_time take_*/put_*)
export const BOX_CAPACITY = 4;
export const MAX_HEALTH = 100;
// счётчики-состояния (значение «сейчас»), а не накопители событий: время, деньги, рубильники, здоровье растений, работники
const ABSOLUTE_COUNTER = /^(time|game_time|money|switches_on|all_switches_on|sick_plants|maxhealth_plant_.+|unpaid_workers|jobless_workers)$/;

const DIR_NAMES = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];

let nextId = 1;

export class World {
  constructor(db, assets, levelNum, hooks) {
    this.db = db;
    this.assets = assets;
    this.hooks = hooks; // { showMessage, notify, showEnd, updateHud, updateShop, updateTasks, showHelp }
    this.levelNum = levelNum;
    this.level = db.levels.get(levelNum);

    const size = this.level.props.level_size || [24, 16];
    this.gridW = size[0];
    this.gridH = size[1];
    this.env = this.level.props.level_env || 'grass';
    this.worldW = this.gridW * TILE;
    this.worldH = this.gridH * TILE;
    this.levelTime = this.level.props.level_time || 300;

    this.cells = [];
    for (let i = 0; i < this.gridW * this.gridH; i++) {
      this.cells.push({ x: i % this.gridW, y: Math.floor(i / this.gridW), dug: false, wet: 0, fert: 0, plant: null, occupant: null, blocked: false });
    }
    // The outer 2 cells (128 px) are the grass border of the field (CGameField): nobody can go or build there.
    for (const c of this.cells) {
      if (c.x < 2 || c.y < 2 || c.x >= this.gridW - 2 || c.y >= this.gridH - 2) {
        let b = false;
        Object.defineProperty(c, 'blocked', { get: () => true, set: (v) => { b = v; }, enumerable: true });
        void b;
      }
    }

    this.objects = [];
    this.hero = {
      id: 0, kind: 'hero', name: 'hero',
      x: this.worldW / 2, y: this.worldH / 2,
      speed: 300, path: [], task: null, act: null,
      facing: 0, moving: false, held: { kind: 'spade' },
    };
    this.money = 0;
    this.pending = null;   // a purchase attached to the cursor: { kind, def, name, unpaid, ... }
    this.time = 0;
    this.ambientT = 0; // фон уровня (sub_415420): первый звук через ~1 с, дальше через 6–12 с (трава) / 20–25 с
    this.counters = {};
    this.dugCount = 0;
    this.shop = { inventory: [], buildings: [], seeds: [], sprouts: [], trees: [], workers: [] };
    this.tasks = [];
    this.digMode = false;  // режим лопаты (кнопка в инвентаре): одиночный клик по свободной земле копает
    // Действия героини, которыми управляют #bool cant_* уровня и действие `allow action` (часть 2):
    // копать, сеять, полоть (сорняки), собирать, поливать, удобрять, продавать, щёлкать рубильники, чинить генератор.
    this.allowed = {};
    for (const a of ABILITY_NAMES) this.allowed[a] = !this.level.props[cantProp(a)];
    this.queue = [];       // очередь целей кликов (галочки), см. click()
    this.current = null;   // цель, которую героиня выполняет сейчас
    this.lastClick = null;
    this.particles = [];
    this.over = null;
    this.hintObjs = new Set();
    // Погода/время суток (часть 2, действие `start rain`/`set sun`/`start morning|…`): состояние хранится,
    // отрисовка неба/света и звуки дождя — задача 6/7 (render.js правится параллельно задачей 2).
    this.rain = null;      // активный дождь (sim_rain.js): { name, p, t, phase, strength, … }
    this.dayPhase = null;  // последняя фаза дня (для сейва/условий); освещение — this.sun (sim_sun.js)
    initSun(this);

    this.setupScenario();
  }

  // ------------------------------------------------------------------ setup

  setupScenario() {
    const lvl = this.level;
    this.conds = new Map();
    const sc = lvl.children.find((c) => c.type === 'scenario');
    // named conditions can live at level level or inside the scenario block (часть 1)
    const condSources = [...lvl.children, ...(sc ? sc.children : [])];
    for (const c of condSources) {
      if (c.exprs && c.exprs.length && c.type !== 'action' && c.type !== 'condition') {
        this.conds.set(c.type, { exprs: c.exprs, enabled: true });
      }
    }
    // Часть 2 (задача 4): сценарий — это @event-группы (условия события + действия) и @pattern-шаблоны.
    // Событие без условий выполняется сразу (так живёт "default placement" из _entry); с условиями —
    // когда истинны все его условия. Условия события типизированы: "enabled by event" (флаг события),
    // "end dialogue X" (задача 6), иначе — сравнение счётчика (имя типа пробелами → подчёркивания).
    this.events = [];
    this.patterns = new Map();       // @pattern-шаблоны: создаются действием "add event from pattern"
    this.dynamicEvents = [];         // имена созданных из шаблонов событий (для сейва)
    this.firedEvents = new Set();    // события уже выполнены (условие "enabled by event")
    this.endedDialogues = new Set(); // законченные диалоги — наполняется задачей 6 (ui.js)
    this.pendingActions = [];        // действия с #float delay (мс): { a, left }
    this.actions = [];               // плоский список всех действий сценария (порядок — для сейва)
    if (sc) {
      for (const node of sc.children) {
        if (node.type === 'pattern' && node.props.name) this.patterns.set(node.props.name, node);
      }
      for (const node of sc.children) {
        if (node.type === 'action') this.addBareAction(node);
        else if (node.type === 'event') this.addEventNode(node);
      }
    }
  }

  /** Действие прямо в @scenario (часть 1: безусловные действия, условия — именованные exprs). */
  addBareAction(node) {
    const condNode = node.children.find((c) => c.type === 'condition');
    const a = {
      type: node.props.type, data: node.props.data, coords: node.props.coords,
      delay: node.props.delay || 0, timer: 0, fired: false,
    };
    this.actions.push(a);
    this.events.push({
      name: null, playerTask: false, fired: false,
      conds: [{ named: true, names: condNode ? condNode.exprs : [] }],
      actions: [a],
    });
  }

  /** @event-группа части 2 (и @pattern, превращаемый действием "add event from pattern" в событие). */
  addEventNode(node, dynamic) {
    const aList = [];
    const conds = [];
    for (const c of node.children) {
      if (c.type === 'action') {
        const a = {
          type: c.props.type, data: c.props.data, coords: c.props.coords,
          delay: c.props.delay || 0, timer: 0, fired: false, dynamic: !!dynamic,
        };
        this.actions.push(a);
        aList.push(a);
      } else if (c.type === 'condition') {
        conds.push({ named: false, type: c.props.type, data: c.props.data, exprs: c.exprs });
      }
    }
    this.events.push({ name: node.props.name || null, playerTask: !!node.props.player_task, fired: false, conds, actions: aList, dynamic: !!dynamic, armTime: this.time * 1000 });
  }

  start() {
    // unconditional actions fire immediately (initial field setup)
    this.updateScenario(0);
  }

  // ------------------------------------------------------------ savegame

  /** Plain-data snapshot of everything that defines the world (see docs/original-notes.md). */
  serialize() {
    const idx = new Map();
    this.objects.forEach((o, k) => idx.set(o, k));
    const ref = (o) => (o ? (idx.has(o) ? idx.get(o) : null) : null);
    const cells = [];
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      if (c.dug || c.wet || c.fert || c.plant || c.occupant) {
        cells.push({
          i, dug: c.dug ? 1 : 0, wet: c.wet || 0, fert: c.fert || 0,
          plant: ref(c.plant), occ: ref(c.occupant),
        });
      }
    }
    return {
      version: 1,
      level: this.levelNum,
      money: this.money, time: this.time, dugCount: this.dugCount,
      counters: { ...this.counters },
      allowed: { ...this.allowed },
      firedEvents: [...this.firedEvents],
      endedDialogues: [...this.endedDialogues],
      dynamicEvents: [...this.dynamicEvents],
      rain: this.rain ? { ...this.rain, bolts: [] } : null,
      sepia: !!this.sepia, heroHidden: !!this.hero.hidden,
      dayPhase: this.dayPhase,
      sun: serializeSun(this),
      hintObjs: this.objects.filter((o) => this.hintObjs.has(o.id)).map((o) => idx.get(o)),
      shop: {
        inventory: [...this.shop.inventory], buildings: [...this.shop.buildings],
        seeds: [...this.shop.seeds], sprouts: [...this.shop.sprouts],
        trees: [...this.shop.trees], workers: [...this.shop.workers],
      },
      tasks: this.tasks.map((t) => ({ key: t.key, state: t.state })),
      conds: [...this.conds].map(([name, c]) => ({ name, enabled: c.enabled })),
      events: this.events.map((e) => ({ name: e.name, fired: e.fired, base: e.base || null, armTime: e.armTime || 0 })),
      actions: this.actions.map((a) => ({ fired: a.fired, timer: a.timer })),
      cells, objects: this.objects.map((o) => this.serializeObj(o, idx)),
      hero: { x: this.hero.x, y: this.hero.y, facing: this.hero.facing, held: this.serializeHeld() },
    };
  }

  serializeObj(o, idx) {
    const d = { name: o.name, cell: { ...o.cell }, x: o.x, y: o.y };
    const copy = (keys) => { for (const k of keys) if (o[k] !== undefined) d[k] = o[k]; };
    if (o.kind === 'plant') {
      copy(['dry', 'growth', 'fruitPhase', 'fruitProg', 'ready', 'fruits', 'fertTicks', 'fertMax', 'weakFert', 'tickT', 'stage', 'stageT', 'thirsty', 'health', 'dead', 'removeT', 'spoil']);
    } else if (o.kind === 'tree') {
      copy(['progress', 'ready', 'fruits']);
    } else if (o.kind === 'house') {
      copy(['feed', 'progress', 'ready']);
      if (o.bees) d.bees = serializeBees(o, idx);
    } else if (o.kind === 'sprinkler') {
      copy(['timer', 'workT']);
    } else if (o.kind === 'worker') {
      copy(['state', 'workLeft', 'think', 'question', 'questioned', 'facing', 'speed', 'tag', 'wpIdx', 'caught', 'disabled', 'home', 'route', 'follow', 'nearPiece']);
      d.box = { type: o.box.type, count: o.box.count };
    } else {
      copy(['charges', 'count', 'type', 'upgrade', 'broken', 'fixed', 'on', 'entered', 'noFruits', 'fuel', 'prog', 'tag', 'fromRespawn', 'destructable', 'leaving', 'shown']);
    }
    return d;
  }

  serializeHeld() {
    const h = this.hero.held;
    if (!h || h.kind === 'spade') return { kind: 'spade' };
    const d = { kind: h.kind, name: h.name || '' };
    for (const k of ['charges', 'count', 'type', 'moved']) if (h[k] !== undefined) d[k] = h[k];
    if (h.saved) d.saved = h.saved;
    return d;
  }

  /** Apply a serialize() snapshot onto a freshly constructed world of the same level. */
  restore(data) {
    if (!data || data.version !== 1) throw new Error('savegame: unsupported version');
    this.money = data.money;
    this.time = data.time;
    this.dugCount = data.dugCount || 0;
    this.counters = { ...data.counters };
    this.tasks = (data.tasks || []).map((t) => ({ key: t.key, state: t.state }));
    this.shop = {
      inventory: [...(data.shop.inventory || [])], buildings: [...(data.shop.buildings || [])],
      seeds: [...(data.shop.seeds || [])], sprouts: [...(data.shop.sprouts || [])],
      trees: [...(data.shop.trees || [])], workers: [...(data.shop.workers || [])],
    };
    // scenario flags are applied before start(): fired events/actions stay fired
    this.allowed = { ...this.allowed, ...(data.allowed || {}) };
    this.firedEvents = new Set(data.firedEvents || []);
    this.endedDialogues = new Set(data.endedDialogues || []);
    this.rain = data.rain || null;
    this.dayPhase = data.dayPhase || null;
    restoreSun(this, data.sun);
    this.sepia = !!data.sepia; this.hero.hidden = !!data.heroHidden;
    this.pendingActions = [];
    // события, созданные из @pattern при свежем старте этого мира, убираем — их список
    // восстанавливается из сейва (порядок и количество совпадают с сохранёнными)
    this.events = this.events.filter((e) => !e.dynamic);
    this.actions = this.actions.filter((a) => !a.dynamic);
    this.dynamicEvents = [];
    for (const name of data.dynamicEvents || []) {
      const node = this.patterns.get(name);
      if (node) {
        this.addEventNode(node, true);
        this.dynamicEvents.push(name);
      }
    }
    for (const c of data.conds || []) {
      if (this.conds.has(c.name)) this.conds.get(c.name).enabled = c.enabled;
    }
    (data.events || []).forEach((s, i) => {
      const ev = this.events[i]; // порядок событий при восстановлении совпадает с порядком при сохранении
      if (ev) { ev.fired = !!s.fired; ev.base = s.base || null; ev.armTime = s.armTime || 0; }
    });
    (data.actions || []).forEach((s, i) => {
      const a = this.actions[i];
      if (a) {
        a.fired = !!s.fired;
        a.timer = s.timer || 0;
        // отложенное действие, не успевшее выполниться до сейва: продолжить отсчёт
        if (!a.fired && a.delay > 0) {
          const ev = this.events.find((e) => e.fired && e.actions.includes(a));
          if (ev) this.pendingActions.push({ a, left: a.delay });
        }
      }
    });
    // spawn in save order so indices align with saved references
    const spawned = (data.objects || []).map((d) => {
      const def = this.db.objects.get(d.name);
      if (!def) return null; // unknown object: skipped, references become null
      const o = def.type === 'worker'
        ? this.spawnWorker(d.name, d.cell.x, d.cell.y)
        : this.spawn(d.name, d.cell.x, d.cell.y);
      if (o) { o.x = d.x; o.y = d.y; }
      return o;
    });
    (data.objects || []).forEach((d, i) => {
      const o = spawned[i];
      if (o) this.restoreObj(o, d, spawned);
    });
    for (const e of data.cells || []) {
      const c = this.cells[e.i];
      if (!c) continue;
      c.dug = !!e.dug; c.wet = e.wet || 0; c.fert = e.fert || 0;
      c.plant = e.plant != null && spawned[e.plant] && spawned[e.plant].kind === 'plant' ? spawned[e.plant] : null;
      c.occupant = e.occ != null && spawned[e.occ] && spawned[e.occ].kind !== 'plant' ? spawned[e.occ] : null;
    }
    const h = data.hero || {};
    this.hero.x = h.x; this.hero.y = h.y; this.hero.facing = h.facing || 0;
    this.hero.task = null; this.hero.path = []; this.hero.act = null;
    this.clearQueue();
    this.hero.held = this.restoreHeld(h.held);
    this.hintObjs = new Set((data.hintObjs || [])
      .filter((i) => spawned[i]).map((i) => spawned[i].id));
    this.particles = [];
  }

  restoreObj(o, d, list) {
    const num = (keys) => { for (const k of keys) if (d[k] !== undefined) o[k] = d[k]; };
    if (o.kind === 'plant') {
      num(['dry', 'growth', 'fruitPhase', 'fruitProg', 'ready', 'fruits', 'fertTicks', 'fertMax', 'weakFert', 'tickT', 'stage', 'stageT', 'thirsty', 'health', 'dead', 'removeT', 'spoil']);
    } else if (o.kind === 'tree') {
      num(['progress', 'ready', 'fruits']);
    } else if (o.kind === 'house') {
      num(['feed', 'progress', 'ready']);
      if (d.bees && o.bees) restoreBees(o, d, list);
    } else if (o.kind === 'sprinkler') {
      o.timer = d.timer != null ? d.timer : Math.random() * 2;
      if (d.workT !== undefined) o.workT = d.workT;
    } else if (o.kind === 'worker') {
      num(['state', 'workLeft', 'think', 'question', 'questioned', 'facing', 'speed', 'tag', 'wpIdx', 'caught', 'disabled', 'home', 'route', 'follow', 'nearPiece']);
      o.box = { type: d.box && d.box.type, count: d.box ? d.box.count : 0 };
      o.goal = null; o.act = null; o.path = []; o.moving = false;
    } else {
      num(['charges', 'count', 'type', 'upgrade', 'broken', 'fixed', 'on', 'entered', 'noFruits', 'fuel', 'prog', 'tag', 'fromRespawn', 'destructable', 'leaving', 'shown']);
    }
  }

  restoreHeld(h) {
    if (!h || h.kind === 'spade') return { kind: 'spade' };
    const def = this.db.objects.get(h.name);
    if (!def) return { kind: 'spade' };
    const held = { kind: h.kind, def, name: h.name };
    for (const k of ['charges', 'count', 'type', 'moved']) if (h[k] !== undefined) held[k] = h[k];
    if (h.saved) held.saved = h.saved;
    return held;
  }

  // ------------------------------------------------------------- counters

  bump(name) { this.counters[name] = (this.counters[name] || 0) + 1; }

  counter(name) {
    // условие "game time" (sub_10018EC9/sub_100190C9): счётчик в миллисекундах от старта уровня, порог из скрипта тоже в мс
    // (">=420000" = 7 минут; ">=100" на уровне 3 = «сразу»). Раньше порт сравнивал секунды и такие события не срабатывали.
    if (name === 'time' || name === 'game_time') return this.time * 1000; // "time" для события — см. condCounter
    if (name === 'money') return this.money;
    if (name === 'fields_dug' || name === 'dig_bed') return this.dugCount;
    if (name === 'unpaid_workers') return this.objects.filter((o) => o.kind === 'worker' && o.def.props.work_time > 0 && o.state === 'idle').length;
    if (name === 'jobless_workers') return this.objects.filter((o) => o.kind === 'worker' && o.def.props.work_time > 0 && o.state === 'work' && o.question).length;
    if (name === 'switches_on' || name === 'all_switches_on') {
      let on = 0, total = 0;
      for (const o of this.objects) {
        if (o.kind !== 'switch') continue;
        total++;
        if (o.on) on++;
      }
      return name === 'switches_on' ? on : (total > 0 && on === total ? 1 : 0);
    }
    if (name === 'sick_plants') {
      let n = 0;
      for (const o of this.objects) if (o.kind === 'plant' && !o.dead && o.health <= 10) n++;
      return n;
    }
    if (name.startsWith('maxhealth_plant_')) {
      const type = 'plant_' + name.slice('maxhealth_plant_'.length);
      let n = 0;
      for (const o of this.objects) {
        if (o.kind === 'plant' && o.name === type && !o.dead && o.health >= MAX_HEALTH - 0.01) n++;
      }
      return n;
    }
    return this.counters[name] || 0;
  }

  evalExpr(expr) {
    const m = /^\s*([A-Za-z_]\w*)\s*(>=|<=|==|!=|>|<)\s*(-?[\d.]+)\s*$/.exec(expr);
    if (!m) return true;
    const val = this.counter(m[1]);
    const target = parseFloat(m[3]);
    switch (m[2]) {
      case '>=': return val >= target;
      case '<=': return val <= target;
      case '==': return val === target;
      case '!=': return val !== target;
      case '>': return val > target;
      case '<': return val < target;
    }
    return true;
  }

  condTrue(name) {
    const c = this.conds.get(name);
    if (!c) return false;
    if (!c.enabled) return false;
    return c.exprs.every((e) => this.evalExpr(e));
  }

  // ------------------------------------------------------------- scenario

  updateScenario(dt) {
    // отложенные действия (оригинал: delay в миллисекундах)
    for (const p of this.pendingActions) p.left -= dt * 1000;
    const due = this.pendingActions.filter((p) => p.left <= 0);
    this.pendingActions = this.pendingActions.filter((p) => p.left > 0);
    for (const p of due) {
      if (!p.a.fired) { p.a.fired = true; this.runAction(p.a); }
    }
    // события, созданные действиями этого прохода (шаблоны), обрабатываются со следующего кадра — защита от бесконечной рекурсии
    const passEnd = this.events.length;
    for (let ei = 0; ei < passEnd; ei++) {
      const ev = this.events[ei];
      if (ev.fired) continue;
      // счётчики условий события считают только то, что случилось после того, как событие включено (sub_1001901C: у события
      // с "enabled by event" флаг +32 = 0, пока не включат; счётчик условия +56 стартует с 0) — снимаем базу в этот момент
      if (!ev.base && this.eventEnabled(ev)) ev.base = this.counterSnapshot();
      if (!ev.base) continue;
      if (!ev.conds.length || ev.conds.every((c) => this.evalCond(c, ev))) {
        ev.fired = true;
        if (ev.name) this.firedEvents.add(ev.name);
        for (const a of ev.actions) {
          if (a.delay > 0) this.pendingActions.push({ a, left: a.delay });
          else { a.fired = true; this.runAction(a); }
        }
      }
    }
  }

  /** Событие включено: все его условия "enabled by event" выполнены (у остальных событий — сразу). */
  eventEnabled(ev) {
    return ev.conds.every((c) => c.named || c.type !== 'enabled by event'
      || String(c.data || '').split(',').map((s) => s.trim()).filter(Boolean).every((n) => this.firedEvents.has(n)));
  }

  /** Снимок накопительных счётчиков (для событий: условие считает разницу с моментом включения). */
  counterSnapshot() {
    return { ...this.counters, dig_bed: this.dugCount, fields_dug: this.dugCount };
  }

  /** Значение счётчика для условия события: накопительные — относительно включения события, состояния — как есть. */
  condCounter(ev, name) {
    // "time" — время (мс) с момента создания события (sub_100190C9: уровневое время − +36), "game time" — от старта уровня
    if (name === 'time' && ev) return this.time * 1000 - (ev.armTime || 0);
    const v = this.counter(name);
    if (!ev || !ev.base || ABSOLUTE_COUNTER.test(name)) return v;
    return v - (ev.base[name] || 0);
  }

  /** Условие события части 2 (@condition с #string type + #string data — порог счётчика). */
  evalCond(c, ev) {
    if (c.named) return c.names.every((n) => this.condTrue(n));
    const type = c.type, data = c.data;
    if (!type) {
      // без типа (level11): истинно, когда выполнены все перечисленные через запятую события
      return String(data || '').split(',').map((s) => s.trim()).filter(Boolean)
        .every((n) => this.firedEvents.has(n));
    }
    if (type === 'enabled by event') {
      return String(data || '').split(',').map((s) => s.trim()).filter(Boolean)
        .every((n) => this.firedEvents.has(n));
    }
    if (type === 'disabled by event') {
      return !String(data || '').split(',').map((s) => s.trim()).filter(Boolean)
        .some((n) => this.firedEvents.has(n));
    }
    if (/^end dialogue\b/.test(type)) {
      // "end dialogue l12_pilot_1" — имя диалога зашито в тип (показ диалогов — задача 6)
      const name = type.replace(/^end dialogue\s*/, '') || String(data || '').trim();
      return this.endedDialogues.has(name);
    }
    // всё остальное — счётчик: имя типа с подчёркиваниями вместо пробелов + порог из data
    return this.evalThreshold(this.condCounter(ev, String(type).replace(/\s+/g, '_')), data);
  }

  /** Порог условия: data ">=4", "< 100", "=0" (пустой порог — «хотя бы раз»). */
  evalThreshold(val, data) {
    const m = /^\s*(>=|<=|==|!=|>|<|=)\s*(-?[\d.]+)\s*$/.exec(String(data == null ? '' : data));
    if (!m) return val > 0;
    const target = parseFloat(m[2]);
    switch (m[1]) {
      case '>=': return val >= target;
      case '<=': return val <= target;
      case '==': case '=': return val === target;
      case '!=': return val !== target;
      case '>': return val > target;
      case '<': return val < target;
    }
    return true;
  }

  runAction(a) {
    switch (a.type) {
      case 'show message':
        this.hooks.showMessage(this.db.t(a.data, a.data));
        break;
      case 'add to field': {
        // часть 2: data = "obj x y [arg]" — координаты внутри data (в части 1 был #point coords).
        // arg: "no_fruits" — дерево без плодов; число — начальный апгрейд дома/фабрики;
        // строка-тэг — экземпляр персонажа (guard, lightbug); "near_hero" — у героини.
        const p = parseFieldAdd(a.data);
        if (p) this.spawnFieldObject(p);
        else if (a.coords) this.spawn(a.data, a.coords[0], a.coords[1]);
        break;
      }
      case 'add bed': {
        // "x y w h [plant]": сетка готовых грядок (CSquare), опционально с растением.
        // Скриптовая расстановка не считается работой героини: dugCount/счётчики не трогаем.
        const parts = String(a.data || '').split(/\s+/);
        const x = parseInt(parts[0], 10), y = parseInt(parts[1], 10);
        const w = parseInt(parts[2], 10) || 1, h = parseInt(parts[3], 10) || 1;
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const cx = x + dx, cy = y + dy;
            const cell = this.cell(cx, cy);
            if (!cell || cell.dug || cell.occupant || cell.plant) continue;
            cell.dug = true;
            cell.wet = 1;
            if (parts[4] && parts[4] !== 'none') this.spawn(parts[4], cx, cy);
          }
        }
        break;
      }
      case 'spawn object': {
        // часть 2: предмет появляется в точке respawn (объект @obstacle "respawn" на поле),
        // подбор его героиней считается условием "take from respawn"; без respawn — у героини.
        const name = String(a.data || '').trim();
        const rp = this.objects.find((o) => o.name === 'respawn');
        let cell = rp ? this.freeCellNear(Math.floor(rp.x / TILE), Math.floor(rp.y / TILE)) : null;
        if (!cell) {
          const hc = this.cellAt(this.hero.x, this.hero.y);
          cell = (hc && !hc.blocked && !hc.occupant && !hc.plant) ? hc : this.freeCellNear(hc ? hc.x : 2, hc ? hc.y : 2);
        }
        if (cell) {
          const o = this.spawn(name, cell.x, cell.y);
          if (o) o.fromRespawn = true;
        }
        break;
      }
      case 'add field': {
        // "plant_pumpkin 4 3" -> name, cols, rows; "none 4 3" (level0) -> сетка вскопанных грядок без растений
        const parts = String(a.data || '').split(/\s+/);
        const cols = parseInt(parts[1], 10) || 1;
        const rows = parseInt(parts[2], 10) || 1;
        if (a.coords) {
          for (let dy = 0; dy < rows; dy++) {
            for (let dx = 0; dx < cols; dx++) {
              if (parts[0] === 'none') this.addReadyBed(a.coords[0] + dx, a.coords[1] + dy);
              else this.spawn(parts[0], a.coords[0] + dx, a.coords[1] + dy);
            }
          }
        }
        break;
      }
      case 'add money':
        this.money += parseInt(a.data, 10) || 0;
        break;
      case 'set money':
        this.money = parseInt(a.data, 10) || 0;
        break;
      case 'add to shop':
        this.addToShop(a.data);
        break;
      case 'delete shop':
      case 'delete from shop': // название действия в части 2
        this.removeFromShop(a.data);
        break;
      case 'allow action': {
        // "dig 1" / "plant 0" — разрешить/запретить действие героини (уровни задают #bool cant_*)
        const parts = String(a.data || '').split(/\s+/);
        if (parts[0] in this.allowed) this.allowed[parts[0]] = parts[1] !== '0';
        break;
      }
      case 'set plant thirst':
        // скорость набора сухости — свойство уровня plant_thirst_growth (L2: 0 → 15 → 0, L22: 50 → 0.15)
        this.level.props.plant_thirst_growth = parseFloat(a.data) || 0;
        break;
      case 'set plant growth':
        this.level.props.plant_growth = parseFloat(a.data) || 0;
        break;
      case 'set fruit growth':
        this.level.props.plant_fruit_growth = parseFloat(a.data) || 0;
        break;
      case 'set plant health':
        // свойство уровня (для новых растений) + все живые растения сразу (задача 6 сценария
        // «удобрите больные растения»); точная семантика оригинала не восстановлена — open-questions
        this.level.props.plant_starting_health = parseFloat(a.data) || 0;
        for (const o of this.objects) {
          if (o.kind === 'plant' && !o.dead) o.health = parseFloat(a.data) || 0;
        }
        break;
      case 'overload generator': {
        // "big_generator" / "generator": генератор выходит из строя (чинится кликом при allowed.fix)
        for (const o of this.objects) {
          if (o.kind === 'generator' && (o.name === a.data || !a.data)) o.broken = true;
        }
        break;
      }
      case 'fix generator': {
        for (const o of this.objects) {
          if (o.kind === 'generator' && (o.name === a.data || !a.data) && o.broken) {
            o.broken = false;
            o.fixed = true;
            this.bump('fixed_generator');
          }
        }
        break;
      }
      case 'kill all people': {
        // оригинал (sub_1001B41C): удаляются все объекты класса Worker, кроме летающих (пчёлы и светлячки,
        // флаг +9792 ставится при создании их AI); героиня (класс Hero) не затрагивается
        for (const o of this.objects.slice()) {
          if (o.kind === 'worker' && o.name !== 'bee' && o.name !== 'lightbug') {
            if (o.goal && o.goal.obj) o.goal.obj.claim = null;
            this.removeObject(o);
          }
        }
        break;
      }
      case 'water all':
        for (const o of this.objects) {
          if (o.kind !== 'plant' || o.dead) continue;
          this.waterPlant(o);
          this.waterDrops(o.x, o.y);
        }
        break;
      case 'start rain':
        startRain(this, String(a.data || '').trim() || 'rain');
        break;
      case 'set sun': {
        // "A T": угол солнца и время перехода в мс (sim_sun.js)
        const parts = String(a.data || '').split(/\s+/);
        setSun(this, parseFloat(parts[0]), parseFloat(parts[1]) || 0);
        this.dayPhase = { phase: 'sun', level: parseFloat(parts[0]) || 0, ms: parseFloat(parts[1]) || 0 };
        break;
      }
      case 'start morning':
      case 'start day':
      case 'start evening':
      case 'start night':
      case 'start moon': {
        const phase = String(a.type).replace(/^start /, '');
        startPhase(this, phase, parseFloat(a.data) || 0);
        this.dayPhase = { phase, ms: parseFloat(a.data) || 0 };
        break;
      }
      case 'set upgrade': {
        // "house_sheep 0 1": объект, прежний уровень, новый уровень (фабрики: "factory_sausage 2")
        const parts = String(a.data || '').split(/\s+/);
        this.applyUpgrade(parts[0], parseInt(parts[2] != null ? parts[2] : parts[1], 10));
        break;
      }
      case 'upgrade house':
      case 'upgrade factory': {
        const parts = String(a.data || '').split(/\s+/);
        this.applyUpgrade(parts[0], parseInt(parts[1], 10));
        break;
      }
      case 'add event from pattern': {
        // @pattern-шаблон создаёт живое событие (перезапускаемые цепочки: дождь L15, охрана L3)
        const node = this.patterns.get(String(a.data || '').trim());
        if (node) {
          this.addEventNode(node, true);
          this.dynamicEvents.push(node.props.name);
        }
        break;
      }
      case 'set hero pos': {
        const parts = String(a.data || '').split(/\s+/);
        const x = parseFloat(parts[0]), y = parseFloat(parts[1]);
        if (!Number.isNaN(x) && !Number.isNaN(y)) {
          this.hero.x = x * TILE + TILE / 2;
          this.hero.y = y * TILE + TILE / 2;
          this.hero.path = [];
          this.hero.task = null;
        }
        break;
      }
      case 'center view':
        // камера на объект по имени (отрисовка/камера — render.js, правится задачей 2)
        if (this.hooks.centerView) this.hooks.centerView(String(a.data || '').trim());
        break;
      case 'play sound':
        this.hooks.playSound(String(a.data || '').replace(/\.ogg$/i, ''));
        break;
      case 'open shop tab':
        if (this.hooks.openShopTab) this.hooks.openShopTab(String(a.data || '').replace(/_tab$/, ''));
        break;
      case 'set task':
      case 'add task':
        this.addTask(a.data, a.type === 'set task');
        break;
      case 'enable condition':
        if (this.conds.has(a.data)) this.conds.get(a.data).enabled = true;
        break;
      case 'disable condition':
        if (this.conds.has(a.data)) this.conds.get(a.data).enabled = false;
        break;
      case 'add dialogue': {
        // диалоги показываются задачей 6 (ui.js); порт передаёт имя (с fallback для опечатки
        // level6 "l6_build_beehive_1" → "l6_build_beehive", см. open-questions.md)
        const dl = this.level.dialogues;
        let name = String(a.data || '').trim();
        if (dl && !dl.has(name)) {
          const base = name.replace(/_\d+$/, '');
          if (base !== name && dl.has(base)) name = base;
        }
        if (this.hooks.showDialogue) this.hooks.showDialogue(name);
        break;
      }
      case 'add particles':
        this.hintObject(a.data);
        break;
      case 'show help':
        this.hooks.showHelp && this.hooks.showHelp();
        break;
      case 'add notify':
        this.hooks.notify(this.db.t(a.data, a.data));
        break;
      case 'victory':
        this.finish('victory');
        break;
      case 'defeat':
        this.finish('defeat');
        break;
      case 'add guard waypoint': addGuardWaypoint(this, a.data); break;
      case 'clear guard waypoints': clearGuardWaypoints(this, a.data); break;
      case 'reset guards': resetGuards(this); break;
      case 'disable guards': disableGuards(this); break;
      case 'visual effect': {
        // sub_1001B41C: "sepia" — сепия на весь экран; "start truck" — машина уезжает (флаг +560), героиня скрыта (+192)
        const kind = String(a.data || '').trim();
        if (kind === 'sepia') this.sepia = true;
        else if (kind === 'start truck') {
          for (const o of this.objects) if (o.kind === 'truck') o.leaving = true;
          this.hero.hidden = true;
        }
        this.bump('effect_visual_effect');
        break;
      }
      case 'effect show': {
        // sub_1001B41C: у первого Obstacle с таким именем включается флаг показа (+561) — появление эффекта декора
        const o = this.objects.find((x) => x.kind === 'obstacle' && x.name === String(a.data || '').trim());
        if (o) o.shown = true;
        this.bump('effect_effect_show');
        break;
      }
      case 'house ready': // надпись «READY» над домами (sub_1001B41C)
        for (const o of this.objects) if (o.kind === 'house') this.moneyPopup(o.x, o.y - 90, 'READY');
        break;
      case 'distract bees': distractBees(this); break;
      case 'play loop music':
      case 'play loop embient':
        if (this.hooks.playLoop) this.hooks.playLoop(a.type.endsWith('music') ? 'music' : 'ambient', String(a.data || '').trim());
        break;
      case 'stop loop music':
      case 'stop loop embient':
        if (this.hooks.stopLoop) this.hooks.stopLoop(a.type.endsWith('music') ? 'music' : 'ambient');
        break;
      default:
        if (!a.type) {
          // действие без типа (level11 l11_export): data — имя диалога (показ — задача 6)
          // или имя события (пометить выполненным)
          const name = String(a.data || '').trim();
          if (this.level.dialogues && this.level.dialogues.has(name)) {
            if (this.hooks.showDialogue) this.hooks.showDialogue(name);
          } else if (name) {
            this.firedEvents.add(name);
          }
        }
        break;
    }
    this.hooks.updateHud();
  }

  /** Начальный/скриптовый апгрейд дома или фабрики: уровень хранится на объекте,
   * счётчик — для условий "upgraded house_sheep 1" (визуал/эффекты — задача 5/7). */
  applyUpgrade(name, level) {
    if (!name || !Number.isFinite(level)) return;
    for (const o of this.objects) {
      if (o.name !== name) continue;
      if (o.kind === 'factory') setFactoryPhase(this, o, level); // фаза фабрики (sub_10032E69): <0 игнорируется
      else o.upgrade = level;
    }
    if (level >= 0) this.bump('upgraded_' + name + '_' + level);
  }

  /** Расстановка объекта из data "obj x y [arg]" (часть 2). */
  spawnFieldObject(p) {
    const cx = p.x, cy = p.y;
    if (p.arg === 'near_hero') {
      const hc = this.cellAt(this.hero.x, this.hero.y);
      const cell = (hc && !hc.blocked && !hc.occupant && !hc.plant) ? hc : this.freeCellNear(hc ? hc.x : 2, hc ? hc.y : 2);
      if (cell) this.spawn(p.name, cell.x, cell.y);
      return;
    }
    const o = this.spawn(p.name, cx, cy);
    if (!o) return;
    if (p.arg === 'no_fruits' && o.kind === 'tree') o.noFruits = true;
    else if (p.arg && /^-?\d+$/.test(p.arg) && (o.def.type === 'house' || o.def.type === 'factory')) o.upgrade = parseInt(p.arg, 10);
    else if (p.arg) o.tag = p.arg;
  }

  addToShop(name) {
    const def = this.db.objects.get(name);
    if (!def) return;
    // sub_4178C0: the item goes into the menu named after its type_goods (`<type_goods>_menu`); types without such a
    // menu (plants = placed plants, personal = hero/waterboy) are never shown in the shop.
    const cat = ['inventory', 'buildings', 'seeds', 'sprouts', 'trees', 'workers'].includes(def.props.type_goods)
      ? def.props.type_goods : null;
    if (!cat) return;
    const list = this.shop[cat];
    if (!list.includes(name)) {
      list.push(name);
      const note = this.db.t('notify_add_shop_' + name, '');
      if (note && note !== 'notify_add_shop_' + name) this.hooks.notify(note);
      this.hooks.updateShop();
    }
  }

  removeFromShop(name) {
    for (const cat of Object.keys(this.shop)) {
      const i = this.shop[cat].indexOf(name);
      if (i >= 0) this.shop[cat].splice(i, 1);
    }
    this.hooks.updateShop();
  }

  addTask(key, setCurrent) {
    let task = this.tasks.find((t) => t.key === key);
    if (!task) {
      // previous active task becomes done
      for (const t of this.tasks) if (t.state === 'active') t.state = 'done';
      task = { key, state: 'active' };
      this.tasks.push(task);
    }
    if (setCurrent) task.state = 'active';
    this.hooks.updateTasks();
  }

  hintObject(data) {
    // "pumpkin item_hint 20"
    const name = String(data || '').split(/\s+/)[0];
    const obj = this.objects.find((o) => o.name === name);
    if (obj) this.hintObjs.add(obj.id);
  }

  finish(result) {
    if (this.over) return;
    this.over = result;
    if (result === 'victory') this.hooks.playSound('victory');
    this.hooks.showEnd(result, {
      time: Math.round(this.time),
      money: this.money,
    });
  }

  // ------------------------------------------------------------- spawning

  spawn(name, cx, cy) {
    const def = this.db.objects.get(name);
    if (!def) return null;
    if (name === 'hero') {
      this.hero.x = cx * TILE + TILE / 2;
      this.hero.y = cy * TILE + TILE / 2;
      return this.hero;
    }
    // работник создаётся полноценным spawnWorker (состояние, ящик, «?»), иначе клик по нему роняет workerPick
    if (def.type === 'worker') return this.spawnWorker(name, cx, cy);
    const x = cx * TILE + TILE / 2;
    const y = cy * TILE + TILE / 2;
    const kind = kindOf(def);
    const obj = {
      id: nextId++, kind, def, name,
      cell: { x: cx, y: cy }, x, y,
      size: def.props.size || [64, 64],
      state: {},
    };
    if (kind === 'plant') {
      // Model recovered from the original executable (see docs/original-notes.md):
      // all meters are 0..100 and advance once per second (a "tick").
      const L = this.level.props;
      obj.dry = 0;            // 0 = freshly watered, 100 = bone dry
      obj.growth = 0;         // seedling -> mature
      obj.fruitPhase = false; // mature and producing
      obj.fruitProg = 0;      // progress of the next fruit
      obj.ready = false;
      obj.fruits = 0;         // 0/1: a plant yields one fruit per cycle
      obj.fertTicks = 0;      // remaining fertilizer ticks
      obj.fertMax = 0;
      obj.weakFert = false;
      obj.tickT = 0;
      obj.stage = 0;          // sprite stage 0..4
      obj.stageT = 0;
      obj.thirsty = false;
      obj.maxHealth = MAX_HEALTH;
      obj.health = (def.props.start_health || 100) / 100 * (L.plant_starting_health !== undefined ? L.plant_starting_health : 50);
      obj.dead = false;
    }
    if (kind === 'tree') {
      obj.fruits = 0;
      obj.ready = false;
      obj.progress = 0;
    }
    if (kind === 'sprinkler') {
      obj.timer = Math.random() * 2;
      obj.workT = 0;
    }
    if (kind === 'house' && (def.type === 'beehive' || name === 'beehive')) initBees(obj, x, y, def);
    if (kind === 'house') {
      obj.feed = 0;        // seconds of food left
      obj.progress = 0;    // production progress, seconds
      obj.ready = 0;       // finished goods waiting to be collected
    }
    if (kind === 'generator') {
      obj.broken = false;  // перегружен/сломан (действие "overload generator", чинится кликом при allowed.fix)
      obj.fixed = false;
    }
    if (kind === 'switch') obj.on = false;       // рубильник части 2: включается кликом (условие "switches on")
    if (kind === 'marker') obj.entered = false;  // условие "enter marker"
    if (kind === 'obstacle' && def.props.destructable) obj.destructable = true;
    if (['item', 'seed', 'watercan', 'fertilizer', 'box'].includes(kind)) {
      if (def.type === 'watercan') obj.charges = def.props.max_watering || 6;
      if (def.type === 'fertilizer') obj.charges = def.props.max_fert_count || 6;
      if (def.type === 'seed') obj.count = def.props.max_seed_count || 12;
      if (def.type === 'box' || def.type === 'multibox') obj.count = 0;
    }
    this.objects.push(obj);
    this.updateBlocking(obj, true);
    const cell = this.cell(cx, cy);
    if (cell) {
      if (kind === 'plant') { cell.plant = obj; cell.dug = true; }   // растение, созданное сценарием, стоит на готовой грядке
      else cell.occupant = obj;
    }
    return obj;
  }

  /** "add field none W H" (level0 «добавили грядки»): готовая вскопанная клетка (CSquare) без растения.
   * Грядка без растения рисуется полностью мокрой, поэтому wet = 1 (docs/original-notes.md, Beds). */
  addReadyBed(cx, cy) {
    const c = this.cell(cx, cy);
    if (!c || c.dug || c.blocked || c.occupant || c.plant) return;
    c.dug = true;
    c.wet = 1;
  }

  /** Move the hero to the nearest free cell if a new object blocks his cell. */
  unstickHero() {
    const h = this.hero;
    const cx = Math.floor(h.x / TILE), cy = Math.floor(h.y / TILE);
    const c = this.cell(cx, cy);
    if (c && !c.blocked) return;
    // search outwards for the nearest free cell
    for (let r = 1; r < 12; r++) {
      let best = null, bd = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const n = this.cell(cx + dx, cy + dy);
          if (!n || n.blocked) continue;
          const d = dx * dx + dy * dy * 0.5 + (dy > 0 ? -0.5 : 0); // prefer below
          if (d < bd) { bd = d; best = n; }
        }
      }
      if (best) {
        h.x = best.x * TILE + TILE / 2;
        h.y = best.y * TILE + TILE / 2;
        h.path = [];
        return;
      }
    }
  }

  hangarAccepts(hangar, held) {
    return this.hangarTakes(hangar, held.type);
  }

  /** Часть 2: ангар принимает конкретные объекты (@accept_goods_list: plant_tomato, tree_apple, house_pig…),
   * часть 1 — категории (#string accept_goods "vegetables herb …"). */
  hangarTakes(hangar, type) {
    const list = hangar.def.children.find((c) => c.type === 'accept_goods_list');
    if (list) {
      const t = 'plant_' + type;
      return list.exprs.some((n) => n === t || n === type);
    }
    const pd = this.db.objects.get('plant_' + type);
    const goodType = (pd && pd.props.type_fruit) || (this.db.objects.get(type) || {}).props?.type_fruit || '';
    return String(hangar.def.props.accept_goods || '').split(/\s+/).includes(goodType);
  }

  /** Часть 2: чем кормят животное — @accept_feed_list (plant_carrot, plant_corn…); часть 1 — категория type_feed. */
  feedAccepts(house, type) {
    const list = house.def.children.find((c) => c.type === 'accept_feed_list');
    if (list) return list.exprs.includes('plant_' + type);
    const pd = this.db.objects.get('plant_' + type);
    return !!pd && pd.props.type_fruit === house.def.props.type_feed;
  }

  /** Уровень апгрейда дома (часть 2): 0 — не отремонтирован (не производит), 1..3 — время time_complete_N. */
  houseLevel(o) {
    return o.upgrade === undefined || o.upgrade === null ? 1 : o.upgrade;
  }

  goodCost(type) {
    const pd = this.db.objects.get('plant_' + type);
    if (pd) return pd.props.cost_fruit || 20;
    const hd = this.db.objects.get(type);
    return (hd && (hd.props.cost_good || hd.props.cost_fruit)) || 20;
  }

  /** Cells covered by a solid object's footprint (same test as blocking). */
  footprint(def, x, y) {
    const out = [];
    if (!def.props.solid) return out;
    const bc = def.props.base_center || [0, 0];
    const bx = x + bc[0], by = y - bc[1];
    const r = def.props.base_radius || [24, 12];
    const c0 = Math.max(0, Math.floor((bx - r[0]) / TILE));
    const c1 = Math.min(this.gridW - 1, Math.floor((bx + r[0]) / TILE));
    const r0 = Math.max(0, Math.floor((by - r[1]) / TILE));
    const r1 = Math.min(this.gridH - 1, Math.floor((by + r[1]) / TILE));
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const dx = (cx * TILE + TILE / 2 - bx) / r[0];
        const dy = (cy * TILE + TILE / 2 - by) / r[1];
        if (dx * dx + dy * dy <= 1.2) out.push(this.cell(cx, cy));
      }
    }
    return out;
  }

  /** Свободная расстановка: переносимые предметы (ящик, пакет, лейка) без `solid` можно класть в любую точку. */
  freeSpot(held, x, y) {
    if (!held || !held.def || held.def.props.solid) return false;
    if (!this.walkable(x, y)) return false;
    const c = this.cellAt(x, y);
    if (!c || c.blocked || c.plant) return false;
    for (const o of this.objects) {
      if (o.kind === 'plant') continue;
      if (Math.abs(o.x - x) < 28 && Math.abs(o.y - y) < 22) return false;
    }
    return true;
  }

  canPlace(held, cx, cy) {
    if (!held.def || !held.def.props.solid) return true;
    const x = cx * TILE + TILE / 2, y = cy * TILE + TILE / 2;
    const bc = held.def.props.base_center || [0, 0];
    const bx = x + bc[0], by = y - bc[1];
    const r = held.def.props.base_radius || [24, 12];
    if (bx - r[0] < 0 || bx + r[0] > this.worldW || by - r[1] < 0 || by + r[1] > this.worldH) return false;
    for (const c of this.footprint(held.def, x, y)) {
      if (c.blocked || c.occupant || c.plant || c.dug) return false;
    }
    return true;
  }

  updateBlocking(obj, add) {
    const solid = obj.def.props.solid;
    if (!solid) return;
    const base = basePoint(obj);
    const r = obj.def.props.base_radius || [24, 12];
    const c0 = Math.max(0, Math.floor((base[0] - r[0]) / TILE));
    const c1 = Math.min(this.gridW - 1, Math.floor((base[0] + r[0]) / TILE));
    const r0 = Math.max(0, Math.floor((base[1] - r[1]) / TILE));
    const r1 = Math.min(this.gridH - 1, Math.floor((base[1] + r[1]) / TILE));
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const cell = this.cell(cx, cy);
        if (!cell) continue;
        // ellipse test
        const px = cx * TILE + TILE / 2;
        const py = cy * TILE + TILE / 2;
        const dx = (px - base[0]) / r[0];
        const dy = (py - base[1]) / r[1];
        if (dx * dx + dy * dy <= 1.2) cell.blocked = add ? true : false;
      }
    }
  }

  cell(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= this.gridW || cy >= this.gridH) return null;
    return this.cells[cy * this.gridW + cx];
  }

  // ------------------------------------------------------------- update

  update(dt) {
    if (this.over) { this.updateHero(dt); return; }
    this.time += dt;
    this.updateScenario(dt);
    this.updateAmbient(dt);
    this.updateHouses(dt);
    this.updateTrees(dt);
    this.updateSprinklers(dt);
    this.updateWorkers(dt);
    this.updatePlants(dt);
    this.updateHero(dt);
    this.updateParticles(dt);
    updateRain(this, dt);      // дождь и молнии (до солнца: дождь двигает его цель)
    updateSun(this, dt);       // солнце и освещение
    updateFactories(this, dt); // фабрики части 2
    updatePeople(this, dt); // охрана части 2: патруль и арест
    updateInfra(this, dt); // маркеры ("enter marker") и прочая инфраструктура части 2
    this.hooks.updateHud();
  }

  /** Level ambient (orig. sub_415420): grass birds1..4 every 6-12 s, swamp1 / desert1 every 20-25 s. Not saved. */
  updateAmbient(dt) {
    this.ambientT += dt;
    if (this.ambientT <= 1) return;
    if (this.env === 'grass') {
      this.ambientT = -(6 + 6 * Math.random());
      this.hooks.playSound('birds' + (1 + Math.floor(Math.random() * 4)));
    } else if (this.env === 'swamp' || this.env === 'desert') {
      this.ambientT = -(20 + 5 * Math.random());
      this.hooks.playSound(this.env === 'swamp' ? 'swamp1' : 'desert1');
    } else {
      this.ambientT = -20; // неизвестное окружение: не проверять каждый кадр
    }
  }

  updatePlants(dt) {
    for (const o of this.objects.slice()) {
      if (o.kind === 'plant' && o.dead) {
        o.removeT -= dt;
        if (o.removeT <= 0) this.removeObject(o);
        continue;
      }
      if (o.kind !== 'plant') continue;
      o.stageT += dt;
      o.tickT += dt;
      while (o.tickT >= 1 && !o.dead) {
        o.tickT -= 1;
        this.plantTick(o);
      }
      // wet soil dries out visually
      const cell = this.cell(o.cell.x, o.cell.y);
      if (cell) cell.wet = Math.max(0, 1 - o.dry / 100);
    }
  }

  /** One second of plant life; formulas follow the original game's update. */
  plantTick(o) {
    const L = this.level.props;
    const p = o.def.props;
    const num = (v, d) => (v !== undefined ? v : d);
    const minHealth = num(L.plant_minimal_health, 0);

    o.dry = Math.min(100, o.dry + p.thirsty / 100 * num(L.plant_thirst_growth, 0.5));
    const wasThirsty = o.thirsty;
    o.thirsty = o.dry >= 66;
    if (o.thirsty && !wasThirsty) this.bump('thirsty_plants');

    if (!o.fruitPhase) {
      o.growth += p.growth / 100 * num(L.plant_growth, 10) * (100 - o.dry) / 100;
      if (o.growth > 100) { o.growth = 100; o.fruitPhase = true; }
    } else {
      if (o.ready) o.spoil = Math.min(100, (o.spoil || 0) + 25);
      if (!o.ready) {
        o.fruitProg += p.harvest / 100 * num(L.plant_fruit_growth, 10) * o.health / 100;
        if (o.fruitProg > 100) {
          o.fruitProg = 100;
          o.ready = true;
          o.fruits = 1;
          this.bump('fruits_ready');
          this.bump('fruit_ready_' + o.name); // условие части 2 "fruit ready plant_dahlia"
          this.emitParticles('fruit_ready', o.x, o.y - 32, 50); // original: sub_409B00(x, y + 32, 50, "fruit_ready")
          this.hooks.playSound('ready_plant');
        }
      }
      if (o.fertTicks > 0) {
        const gain = p.shit_strength / 100 * num(L.plant_fertilizer_strength, 1);
        // a weak fertilizer only helps plants that are already ailing
        if (o.health < 60 || !o.weakFert) o.health = Math.min(100, o.health + gain);
        o.fertTicks--;
      }
    }

    if (o.dry >= 100) {
      o.health = Math.max(minHealth, o.health - p.thirst_death / 100 * num(L.health_reduction_when_thirsty, 0.25));
      if (o.health <= 0) {
        o.dead = true;
        o.removeT = 6;
        o.fruits = 0;
        this.cell(o.cell.x, o.cell.y).plant = null;
        this.counters['dead_' + o.name] = (this.counters['dead_' + o.name] || 0) + 1;
        this.hooks.playSound('plant_death');
        this.hooks.notify(this.db.t('notify_plant_died', extraT('notify_plant_died')));
        return;
      }
    }

    // sprite stage thresholds from the original
    let stage = o.stage;
    if (o.ready) stage = 4;
    else if (o.fruitPhase && o.fruitProg > 50) stage = 3;
    else if (o.growth > 90) stage = 2;
    else if (o.growth > 10) stage = 1;
    else stage = 0;
    if (stage !== o.stage) { o.stage = stage; o.stageT = 0; }
  }

  // Пчёлы улья (updateBeehive, поиск целей, (де)сериализация) вынесены в src/sim_bees.js.

  updateHouses(dt) {
    for (const o of this.objects) {
      if (o.kind !== 'house') continue;
      if (o.name === 'beehive' || o.def.type === 'beehive') { updateBeehive(this, o, dt); continue; }
      const p = o.def.props;
      // часть 2: дом производит только после ремонта/апгрейда (0 — не работает, 1..3 — time_complete_N)
      const lvl = this.houseLevel(o);
      const needsFeed = !!p.type_feed || o.def.children.some((c) => c.type === 'accept_feed_list');
      const maxGood = p.max_count_good || 1;
      if (lvl < 1) continue;
      // food bar drains continuously while the animals are fed
      if (needsFeed && o.feed > 0) {
        const eating = o.feed > 0;
        o.feed = Math.max(0, o.feed - dt);
        if (!eating) continue;
      }
      if (o.ready >= maxGood) continue;
      if (needsFeed && o.feed <= 0 && !o.fedThisTick) {
        // (food ran out during this very step: nothing more to produce)
      }
      if (needsFeed && o.feed <= 0) continue;
      o.progress += dt;
      if (o.progress >= (p['time_complete_' + lvl] || p.time_complete || 60)) {
        o.progress = 0;
        o.ready = Math.min(maxGood, o.ready + 1);
        this.bump('goods_ready');
        this.hooks.playSound('ready_' + houseSound(o.name));
        this.sparkle(o.x, o.y - 80, '#fff2a0');
        this.hooks.updateHud();
      }
    }
  }

  // -------------------------------------------------------------- health

  /** 1..3 hearts shown above a plant (hearts appear below 60 health). */
  hearts(plant) {
    return plant.health <= 33 ? 1 : plant.health <= 66 ? 2 : 3;
  }

  /** Apply a fertilizer item: health is added over the following ticks. */
  fertilizePlant(plant, weak) {
    const L = this.level.props;
    const p = plant.def.props;
    plant.fertTicks = Math.floor(p.shit_time / 100 * (L.plant_fertilizer_time !== undefined ? L.plant_fertilizer_time : 10));
    plant.fertMax = plant.fertTicks;
    plant.weakFert = !!weak;
    this.bump('plants_fertilized'); // условие части 2 "plants fertilized" (героиня и помощник)
  }

  waterPlant(plant) {
    plant.dry = 0;
    plant.thirsty = false;
    const cell = this.cell(plant.cell.x, plant.cell.y);
    if (cell) cell.wet = 1;
  }

  /** The fruit was picked: reset the cycle and exhaust the plant. */
  pickPlant(plant) {
    const L = this.level.props;
    const p = plant.def.props;
    plant.ready = false;
    plant.fruits = 0;
    plant.fruitProg = 0;
    plant.spoil = 0;
    this.bump('harvest_' + plant.name); // условие части 2 "harvest plant_tomato" (героиня и работник)
    if (p.complete_harvest === true) {
      plant.growth = 0;
      plant.fruitPhase = false;
    }
    const minHealth = L.plant_minimal_health !== undefined ? L.plant_minimal_health : 0;
    plant.health = Math.max(minHealth, plant.health - p.harvest_damage / 100 * (L.health_reduction_after_harvest !== undefined ? L.health_reduction_after_harvest : 2));
    plant.stage = p.complete_harvest === true ? 0 : 3; plant.stageT = 0;
  }

  // -------------------------------------------------------------- tools

  /** Tools of part 2 (destructor / bulldozer / constructor) and the part-1 crane. Returns true when the click was consumed. */
  useTool(tool, obj, cell) {
    if (!obj && !cell) return false;
    const pay = (price) => {
      if (this.money < price) {
        this.hooks.notify(this.db.t('notify_no_more_money', 'Не хватает денег!'));
        return false;
      }
      this.money -= price;
      return true;
    };
    if (tool.kind === 'destructor') {
      // часть 2: «уничтожает ненужные растения и грядки» (rus.txt destructor_shop_hint)
      if (obj && obj.kind === 'plant') {
        if (!pay(tool.def.props.price || 5)) return true;
        this.removeObject(obj);
        // orig. 0x41A170: the explosion counts as a dead plant for the scenario counter
        this.bump('dead_' + obj.name);
        this.dust(obj.cell.x, obj.cell.y);
        this.hooks.playSound('killplant');
        this.hooks.updateHud();
        return true;
      }
      // грядка без растения выкапывается обратно в землю
      if (!obj && cell && cell.dug && !cell.plant && !cell.occupant && !cell.blocked) {
        if (!pay(tool.def.props.price || 5)) return true;
        cell.dug = false;
        cell.wet = 0;
        this.dust(cell.x, cell.y);
        this.hooks.playSound('killplant');
        this.hooks.updateHud();
        return true;
      }
      return false;
    }
    if (tool.kind === 'bulldozer') {
      // «С его помощью можно убирать большие препятствия» (rus.txt): decor_* с #bool destructable
      if (obj && obj.kind === 'obstacle' && obj.destructable) {
        if (!pay(tool.def.props.price || 100)) return true;
        this.removeObject(obj);
        this.dust(obj.cell.x, obj.cell.y);
        // условия части 2 "kill decor_bog": убитый декор + общий счётчик смерти
        this.bump('kill_' + obj.name);
        this.bump('dead_' + obj.name);
        this.hooks.playSound('bulldozer');
        this.hooks.updateHud();
        return true;
      }
      return false;
    }
    if (tool.kind === 'constructor') {
      // «Заказ на вскапывание поля» (rus.txt): клик по свободной земле мгновенно копает её за деньги
      if (!cell || cell.dug || cell.blocked || cell.occupant || cell.plant) return false;
      if (!pay(tool.def.props.price || 100)) return true;
      cell.dug = true;
      cell.wet = 1;
      this.dust(cell.x, cell.y);
      this.hooks.playSound('dig');
      this.hooks.updateHud();
      return true;
    }
    if (tool.kind !== 'transporter') return false;
    if (!obj || !['house', 'tree', 'sprinkler', 'hangar', 'waterpump', 'factory'].includes(obj.kind)) return false;
    if (!pay(tool.def.props.price || 10)) return true;
    const saved = {};
    for (const k of ['feed', 'progress', 'ready', 'fruits', 'fruitT', 'workT', 'timer']) {
      if (obj[k] !== undefined) saved[k] = obj[k];
    }
    this.removeObject(obj);
    this.hero.held = { kind: obj.kind, def: obj.def, name: obj.name, moved: true, saved };
    this.hooks.playSound('transporter'); // orig. sub_416670: the crane plays transporter.ogg
    this.hooks.updateHud();
    return true;
  }

  // ------------------------------------------------------------- workers

  spawnWorker(name, cx, cy) {
    const def = this.db.objects.get(name);
    const wk = {
      id: nextId++, kind: 'worker', def, name,
      cell: { x: cx, y: cy },
      x: cx * TILE + TILE / 2, y: cy * TILE + TILE / 2,
      size: def.props.size || [128, 256],
      state: 'idle',        // idle (waiting for pay) | work | pay
      // сценарные персонажи части 2 (#int work_time -1: guard/manager/looser/lightbug) работают бессрочно
      workLeft: def.props.work_time > 0 ? def.props.work_time : Infinity,
      think: 0,
      path: [], goal: null, act: null,
      facing: 0, moving: false, question: false, questioned: false,
      speed: def.props.speed || 300,
      box: { type: null, count: 0 },
    };
    this.objects.push(wk);
    return wk;
  }

  workerClicked(wk) {
    if (wk.state === 'work') return;
    // сценарные персонажи части 2 не нанимаются (поведение охраны/менеджера — задача 5)
    if (PERSON_NAMES.includes(wk.name) || wk.def.props.work_time <= 0) return;
    const pay = wk.def.props.pay || 100;
    if (this.money < pay) {
      this.hooks.notify(this.db.t('notify_no_more_money', 'Не хватает денег!'));
      return;
    }
    this.money -= pay;
    wk.state = 'work';
    wk.workLeft = wk.def.props.work_time > 0 ? wk.def.props.work_time : Infinity;
    wk.think = 0;
    wk.question = false;
    wk.questioned = false; // новый цикл работы: счётчик «?» может сработать снова
    this.hooks.playSound('pay');
    this.moneyPopup(wk.x, wk.y - 140, '-' + pay);
    this.hooks.updateHud();
  }

  updateWorkers(dt) {
    for (const wk of this.objects) {
      if (wk.kind !== 'worker') continue;
      if (wk.state !== 'work') { wk.moving = false; continue; }
      wk.workLeft -= dt;
      if (wk.workLeft <= 0) {
        this.workerStop(wk);
        continue;
      }
      this.workerAI(wk, dt);
    }
  }

  workerStop(wk) {
    if (wk.goal && wk.goal.obj) wk.goal.obj.claim = null;
    wk.goal = null; wk.act = null; wk.path = []; wk.moving = false;
    wk.state = 'pay'; wk.question = false; wk.questioned = false;
    // счётчик сценария: работник закончил смену и ждёт оплаты
    this.counters.worker_coin = (this.counters.worker_coin || 0) + 1;
    // звук <имя>_wait есть не у всех работников (bee_wait в оригинале отсутствует)
    const wait = wk.name + '_wait';
    if (!this.assets || this.assets.sound(wait + '.ogg')) this.hooks.playSound(wait);
    this.hooks.notify(this.db.t('notify_worker_pay', extraT('notify_worker_pay')));
  }

  workerAI(wk, dt) {
    if (wk.act) {
      wk.act.t += dt;
      if (wk.act.t >= wk.act.dur) {
        const done = wk.act.done;
        wk.act = null;
        if (done) done();
      }
      return;
    }
    if (wk.path.length) {
      this.moveActor(wk, dt, wk.goal && (wk.goal.obj || wk.goal.plant));
      return;
    }
    wk.moving = false;
    wk.think -= dt;
    if (!wk.goal) {
      if (wk.think > 0) return;
      wk.goal = this.workerPick(wk);
      wk.question = !wk.goal;
      if (wk.question && !wk.questioned) {
        wk.questioned = true; // впервые за цикл работнику нечего делать
        this.counters.worker_question = (this.counters.worker_question || 0) + 1;
      }
      if (!wk.goal) { wk.think = 1; return; }
    }
    const pt = workerGoalPoint(wk.goal);
    if (!wk.goal.walked && Math.hypot(pt.x - wk.x, pt.y - wk.y) > 36) {
      wk.goal.walked = true; // after the path ends we act from wherever we stand
      if (!this.workerWalk(wk, pt)) {
        if (wk.goal.obj) wk.goal.obj.claim = null;
        wk.goal = null;
        wk.think = 1;
      }
      return;
    }
    this.workerPerform(wk);
  }

  workerWalk(wk, pt) {
    // the same free movement as the hero's: one waypoint, obstacles are avoided on the way
    if (!this.walkable(pt.x, pt.y)) return false;
    wk.path = [{ x: pt.x, y: pt.y }];
    return true;
  }

  workerPick(wk) {
    const near = (list) => {
      let best = null, bd = Infinity;
      for (const o of list) {
        const d = Math.hypot(o.x - wk.x, o.y - wk.y);
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    };
    if (wk.name === 'helper') {
      // original CHelperAI: plants that are not being fertilised and have health <= 60,
      // scored by (health + 40) / 100 * distance (sicker and closer first)
      let best = null, bs = Infinity;
      for (const o of this.objects) {
        if (o.kind !== 'plant' || o.dead || o.claim || o.fertTicks > 0 || o.health > 60 || !isWorkable(this, o)) continue;
        const score = (o.health + 40) / 100 * Math.hypot(o.x - wk.x, o.y - wk.y);
        if (score < bs) { bs = score; best = o; }
      }
      if (!best) return null;
      best.claim = wk.id;
      return { kind: 'tend', obj: best };
    }
    if (wk.name === 'harvester') {
      const box = wk.box;
      const typeOf = (o) => (o.kind === 'plant' ? plantName(o) : o.name);
      const ripe = this.objects.filter((o) =>
        (o.kind === 'plant' || o.kind === 'tree') && !o.dead && !o.claim && o.fruits > 0 && isWorkable(this, o));
      if (box.count >= BOX_CAPACITY) {
        // only a full box is delivered, to the nearest hangar that takes this kind of goods
        const hangars = this.objects.filter((o) => o.kind === 'hangar' && this.hangarTakes(o, box.type));
        const h = near(hangars);
        return h ? { kind: 'sell', obj: h } : null;
      }
      let wanted = box.count ? box.type : null;
      if (!wanted) {
        // an empty box: go for the fruit that is ripe in the largest quantity
        const tally = new Map();
        for (const o of ripe) tally.set(typeOf(o), (tally.get(typeOf(o)) || 0) + 1);
        let top = 0;
        for (const [t, n] of tally) if (n > top) { top = n; wanted = t; }
      }
      if (wanted) {
        const t = near(ripe.filter((o) => typeOf(o) === wanted));
        if (t) { t.claim = wk.id; return { kind: 'harvest', obj: t }; }
      }
      // nothing of this kind left anywhere: the half-filled box is dropped
      if (box.count) {
        const exists = this.objects.some((o) => (o.kind === 'plant' || o.kind === 'tree') && !o.dead && typeOf(o) === box.type);
        if (!exists) { box.count = 0; box.type = null; }
      }
    }
    return null;
  }

  workerPerform(wk) {
    const g = wk.goal;
    const face = (o) => { wk.facing = dirIndex(o.x - wk.x, o.y - wk.y); };
    if (g.kind === 'tend') {
      const pl = g.obj;
      face(pl);
      wk.act = { name: 'helper_work', t: 0, dur: 1.2, done: () => {
        pl.claim = null; wk.goal = null;
        if (pl.dead) return;
        // the helper carries a weak fertilizer
        this.fertilizePlant(pl, true);
        this.sparkle(pl.x, pl.y - 20, '#b6f58a');
        this.hooks.playSound('fertilizer');
      } };
    } else if (g.kind === 'harvest') {
      const src = g.obj;
      face(src);
      wk.act = { name: 'harvester_harvest1', t: 0, dur: 0.75, done: () => {
        src.claim = null; wk.goal = null;
        if (src.fruits > 0) {
          if (src.kind === 'plant') { this.pickPlant(src); wk.box.count++; }
          else { src.ready = false; src.fruits = 0; src.progress = 0; wk.box.count = Math.min(BOX_CAPACITY, wk.box.count + BOX_CAPACITY); }
          wk.box.type = src.kind === 'plant' ? plantName(src) : src.name;
          this.sparkle(src.x, src.y - 40, '#ffd75e');
          this.hooks.playSound(src.kind === 'tree' ? 'harvest_tree' : 'harvest_plant');
        }
      } };
    } else if (g.kind === 'sell') {
      const hangar = g.obj;
      wk.act = { name: 'harvester_empty', t: 0, dur: 1.5, done: () => {
        wk.goal = null;
        const b = wk.box;
        if (!b.count) return;
        const total = b.count * this.goodCost(b.type);
        this.money += total;
        const key = isPlantType(this, b.type) ? 'sell_plant_' + b.type : 'sell_' + b.type;
        this.counters[key] = (this.counters[key] || 0) + 1;
        this.moneyPopup(hangar.x, hangar.y - 60, '+' + total);
        this.hooks.playSound('profit');
        b.count = 0; b.type = null;
        this.hooks.updateHud();
      } };
    }
  }

  updateTrees(dt) {
    const L = this.level.props;
    const growth = L.plant_fruit_growth !== undefined ? L.plant_fruit_growth : 10;
    for (const o of this.objects) {
      if (o.kind !== 'tree' || o.ready || o.noFruits) continue; // "no_fruits" в расстановке — декоративное дерево
      const p = o.def.props;
      // original: every second progress += harvest / 100 * plant_fruit_growth (percent)
      o.progress = (o.progress || 0) + dt * (p.harvest || 30) / 100 * growth;
      if (o.progress >= 100) {
        o.progress = 100;
        o.ready = true;
        o.fruits = 1;
        this.sparkle(o.x, o.y - 100, '#ffe9a8');
        this.hooks.playSound('ready_tree');
        this.hooks.updateHud();
      }
    }
  }

  updateSprinklers(dt) {
    for (const o of this.objects) {
      if (o.kind !== 'sprinkler') continue;
      const p = o.def.props;
      if (o.workT > 0) o.workT -= dt;
      o.timer -= dt;
      if (o.timer > 0) continue;
      o.timer = (p.sprinkle_frequency || 2000) / 1000;
      const strength = p.sprinkle_strength !== undefined ? p.sprinkle_strength : 3;
      const rx = (p.sprinkle_radius ? p.sprinkle_radius[0] : 4) * TILE;
      const ry = (p.sprinkle_radius ? p.sprinkle_radius[1] : 2) * TILE;
      let watered = 0;
      for (const pl of this.objects) {
        if (pl.kind !== 'plant' || pl.dead) continue;
        const dx = (pl.x - o.x) / rx, dy = (pl.y - o.y) / ry;
        if (dx * dx + dy * dy > 1) continue;
        // original: dryness drops by `sprinkle_strength` every `sprinkle_frequency` ms
        if (pl.dry > 0) {
          pl.dry = Math.max(0, pl.dry - strength);
          pl.thirsty = pl.dry >= 66;
          this.waterDrops(pl.x, pl.y);
          watered++;
        }
      }
      if (watered) {
        o.workT = 2.5;
        this.hooks.playSound('watering_sfx');
      }
    }
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      p.t += dt;
      if (p.kind === 'fx') { stepFx(p, dt * 1000); continue; }
      if (p.vy !== undefined) { p.y += p.vy * dt; p.vy += 60 * dt; }
    }
    this.particles = this.particles.filter((p) => (p.kind === 'fx' ? !p.dead : p.t < p.life));
  }

  /**
   * Particle template of particle_scripts.txt, spawned like the original sub_409B00:
   * every value is `base + random(-scatter, scatter)`, times are in milliseconds, y points up
   * in the original (gravity/offset are flipped here).
   */
  emitParticles(name, x, y, count) {
    const tpl = this.db.objects.get(name);
    if (!tpl) return;
    const P = tpl.props;
    const sc = (a) => (Math.random() * 2 - 1) * (a || 0);
    const rect = (v, d) => (Array.isArray(v) ? v : d);
    const col = rect(P.color, [255, 255, 255, 255]);
    const colSc = rect(P.color_scatter, [0, 0, 0, 0]);
    const cs = rect(P.color_speed, [0, 0, 0, 0]);
    const csSc = rect(P.color_speed_scatter, [0, 0, 0, 0]);
    const grav = rect(P.gravity, [0, 0]);
    const clamp255 = (v) => Math.max(0, Math.min(255, v));
    for (let i = 0; i < count && this.particles.length < 512; i++) {
      // position: a random point at radius pos_scatter around (x, y)
      const r = sc(P.pos_scatter), th = (Math.random() * 2 - 1) * Math.PI;
      const ox = -r * Math.sin(th), oy = r * Math.cos(th);
      let dx, dy;
      if (P.start_dir === undefined || P.start_dir === -1) {
        const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a);
      } else {
        const a = (P.start_dir + sc(P.dir_scatter)) * Math.PI / 180; dx = Math.cos(a); dy = -Math.sin(a);
      }
      const speed = (P.start_speed || 0) + sc(P.speed_scatter);
      this.particles.push({
        kind: 'fx', tex: P.texture, frame: P.texture_num || 0, blend: !!P.blending,
        x: x + ox, y: y - oy, vx: dx * speed, vy: dy * speed, gx: grav[0], gy: -grav[1],
        size: (P.start_size || 0) + sc(P.size_scatter), dsize: (P.size_speed || 0) + sc(P.size_speed_scatter),
        angle: (P.start_angle || 0) + sc(P.angle_scatter), dangle: (P.angle_speed || 0) + sc(P.angle_speed_scatter),
        c: [0, 1, 2, 3].map((k) => clamp255(col[k] + Math.trunc(sc(colSc[k])))),
        dc: [0, 1, 2, 3].map((k) => cs[k] + sc(csSc[k])),
        t: 0, dead: false,
      });
    }
  }

  // --------------------------------------------------------------- hero

  updateHero(dt) {
    const h = this.hero;
    // action animation in progress
    if (h.act) {
      h.act.t += dt;
      if (h.act.t >= h.act.dur) {
        const done = h.act.onDone;
        h.act = null;
        if (done) done();
      }
      return;
    }
    // free movement towards the waypoint (see moveActor)
    if (h.path.length) {
      const r = this.moveActor(h, dt, h.task && h.task.object);
      if (h.gaveUp) {
        h.gaveUp = false;
        h.task = null; h.path = []; h.moving = false;
        this.hooks.notify(this.db.t('notify_you_cant_gowhere', 'Вы не можете туда пройти!'));
        return;
      }
      if (r === 'arrived' && !h.path.length && h.task) this.arriveTask();
      return;
    }
    h.moving = false;
    if (h.task) this.arriveTask();
    else if (this.queue.length) this.nextQueued();
    else this.current = null;
  }

  /**
   * Movement of the hero and of the workers (CMover `sub_403C00`): no grid path-finding. The actor walks straight to
   * its waypoint at `speed * 0.00105` px/ms horizontally and **half** of that vertically (the heading is the
   * normalised direction to the target, only the y component of the step is halved). A step that would make the
   * actor's ellipse overlap the base ellipse (`base_center`/`base_radius`) of a solid object is rotated in 5 degree
   * steps to one side until it is free, so the actor slides round obstacles. A dock zone of the object it is walking
   * to may be entered. The heading used for the animation is refreshed every 100 ms.
   */
  moveActor(a, dt, target) {
    const t = a.path[0];
    const ms = dt * 1000;
    // предохранитель: если за PATH_STALL_TIME секунд расстояние до точки не стало меньше рекорда, актёр ходит по кругу
    // у недостижимой цели — отказываемся от хода (героиня сообщает, что туда не пройти)
    const dToTarget = Math.hypot(t.x - a.x, t.y - a.y);
    if (a.pathTarget !== t) { a.pathTarget = t; a.pathBest = dToTarget; a.pathStall = 0; }
    else if (dToTarget < a.pathBest - 1) { a.pathBest = dToTarget; a.pathStall = 0; }
    else a.pathStall += dt;
    if (a.pathStall > PATH_STALL_TIME) {
      a.pathTarget = null; a.pathStall = 0; a.path.shift(); a.moving = false; a.stuck = 0; a.avoid = 0; a.gaveUp = true;
      return 'arrived';
    }
    const S = (a.speed || 300) * 0.00105;
    let dx = t.x - a.x, dy = t.y - a.y;
    const dist = Math.hypot(dx, dy);
    let nx = dist ? dx / dist : 0, ny = dist ? dy / dist : 0;
    a.dirVec = [nx, ny];
    if (Math.hypot(nx * S * ms, ny * S * 0.5 * ms) >= dist) {
      a.x = t.x; a.y = t.y;
      a.path.shift();
      a.moving = a.path.length > 0;
      a.stuck = 0; a.avoid = 0;
      return 'arrived';
    }
    const rA = [2, 2];
    const blockers = this.solidObstacles(a, t, target);
    const hits = (x, y) => blockers.find((o) => ellipseHit(x, y, rA, o.c[0], o.c[1], o.r, o.dock, t));
    let sx = nx * S * ms, sy = ny * S * 0.5 * ms;
    const first = hits(a.x + sx, a.y + sy);
    if (first) {
      if (!a.avoid) {
        // turn away from the obstacle's side (sub_403C00: side picked on the first contact)
        const cross = nx * (first.c[1] - a.y) - ny * (first.c[0] - a.x);
        a.side = cross > 0 ? -1 : 1;
      }
      a.avoid = 2;
      let free = false;
      for (let i = 0; i < 72; i++) {
        const ang = a.side * 5 * Math.PI / 180;
        const c = Math.cos(ang), s2 = Math.sin(ang);
        [nx, ny] = [nx * c - ny * s2, nx * s2 + ny * c];
        sx = nx * S * ms; sy = ny * S * 0.5 * ms;
        if (!hits(a.x + sx, a.y + sy)) { free = true; break; }
      }
      a.dirVec = [nx, ny];
      if (!free) {
        a.stuck = (a.stuck || 0) + dt;
        a.moving = false;
        if (a.stuck > 0.6) { a.path.shift(); a.stuck = 0; a.avoid = 0; return 'arrived'; }
        return 'moving';
      }
    } else if (a.avoid > 0) a.avoid--;
    a.stuck = 0;
    a.x += sx; a.y += sy;
    a.moving = true;
    a.dirT = (a.dirT === undefined ? 0 : a.dirT) - ms;
    if (a.dirT <= 0) {
      a.dirT = 100;
      a.facing = dirIndex(a.dirVec[0], a.dirVec[1]);
    }
    return 'moving';
  }

  /** Base ellipses of the solid objects that can block `a` (not the object it is working on). */
  solidObstacles(a, t, target) {
    const out = [];
    for (const o of this.objects) {
      if (o === a || o === target || !o.def || !o.def.props.solid || !o.def.props.base_radius) continue;
      const bp = basePoint(o);
      const dc = o.def.props.dock_center, dr = o.def.props.dock_radius;
      out.push({
        c: bp, r: o.def.props.base_radius,
        dock: dc && dr ? { c: [o.x + dc[0], o.y - dc[1]], r: dr } : null,
      });
    }
    return out;
  }

  arriveTask() {
    const h = this.hero;
    const task = h.task;
    if (!task) return;
    const point = taskPoint(task);
    const dist = Math.hypot(point.x - h.x, point.y - h.y);
    if (dist > 110) {
      // not close enough: re-path (но не бесконечно: недостижимая цель не должна гонять героиню по кругу)
      task.repath = (task.repath || 0) + 1;
      if (task.repath > 3) {
        h.task = null; h.moving = false;
        this.hooks.notify(this.db.t('notify_you_cant_gowhere', 'Вы не можете туда пройти!'));
        return;
      }
      this.walkToPoint(point.x, point.y, task);
      return;
    }
    h.task = null;
    this.performTask(task);
  }

  performTask(task) {
    const h = this.hero;
    const anim = (name, dur, onDone) => {
      const def = this.db.animations.get(name);
      h.act = {
        name, t: 0,
        dur: dur || (def && def.props.animation_time) || 0.8,
        onDone,
      };
    };
    switch (task.kind) {
      case 'dig': {
        const cell = this.cell(task.cell.x, task.cell.y);
        if (!this.allowed.dig) return;
        if (!cell || cell.dug || cell.blocked || cell.occupant) return;
        // звук копания (≈2.7 с) идёт вместе с анимацией и обрывается, когда грядка готова
        this.assets && this.hooks.playSound('dig');
        anim('hero_dug', 1.5, () => {
          cell.dug = true;
          cell.wet = 1;
          this.dugCount++;
          this.dust(task.cell.x, task.cell.y);
          this.hooks.stopSound && this.hooks.stopSound('dig');
        });
        break;
      }
      case 'sow': {
        const cell = this.cell(task.cell.x, task.cell.y);
        const held = h.held;
        if (!this.allowed.plant) return;
        if (!cell || !cell.dug || cell.plant || cell.occupant) return;
        if (!held || held.kind !== 'seed' || held.count <= 0) return;
        anim('hero_sow1', 1.0, () => {
          // часть 2: пакеты называются seed_carrot (в части 1 — просто carrot)
          const plantName = 'plant_' + String(held.name || '').replace(/^seed_/, '');
          const plant = this.spawn(plantName, task.cell.x, task.cell.y);
          if (plant) {
            this.cell(task.cell.x, task.cell.y).plant = plant;
            this.counters['sow_' + held.name] = (this.counters['sow_' + held.name] || 0) + 1;
            held.count--;
            if (held.count <= 0) h.held = { kind: 'spade' };
            this.hooks.playSound('sow');
          }
        });
        break;
      }
      case 'water': {
        const plant = task.plant;
        const held = h.held;
        if (!plant || plant.dead) return;
        if (!held || held.kind !== 'watercan' || held.charges <= 0) {
          this.hooks.notify(this.db.t('notify_can_empty', extraT('notify_can_empty')));
          return;
        }
        // sub_41C140: the small can (orange) uses hero_water2, the big one (blue) hero_water1
        // orig. sub_4031F0 (hero state 7, inferred): the hero's watering plays watercan.ogg when the action starts;
        // watering_sfx is the sprinkler's own name_sfx
        this.hooks.playSound('watercan');
        anim(held.name === 'big_watercan' ? 'hero_water1' : 'hero_water2', 1.0, () => {
          held.charges--;
          this.waterPlant(plant);
          this.counters.plants_watered = (this.counters.plants_watered || 0) + 1;
          this.waterDrops(plant.x, plant.y);
        });
        break;
      }
      case 'fertilize': {
        const plant = task.plant;
        const held = h.held;
        if (!plant || plant.dead) return;
        if (!held || held.kind !== 'fertilizer' || held.charges <= 0) return;
        anim('hero_use1', 1.0, () => {
          if (plant.dead) return;
          held.charges--;
          this.fertilizePlant(plant, !!(held.def && held.def.props.weak_fertilizer));
          this.sparkle(plant.x, plant.y - 20, '#b6f58a');
          if (held.charges <= 0) h.held = { kind: 'spade' };
          this.hooks.playSound('fert_spreader');
          this.hooks.updateHud();
        });
        break;
      }
      case 'harvest': {
        const plant = task.plant;
        const held = h.held;
        if (!this.allowed.harvest) return;
        if (!plant || plant.dead || !plant.fruits) return;
        if (!held || held.kind !== 'box') {
          this.hooks.notify(this.db.t('notify_need_box', extraT('notify_need_box')));
          return;
        }
        const cap = boxCapacity(held.def);
        if (held.count >= cap) {
          this.hooks.notify(this.db.t('notify_box_full', 'Ящик полон, пора нести его в ангар!'));
          return;
        }
        if (held.count > 0 && held.type !== plantName(plant)) {
          this.hooks.notify(this.db.t('notify_only_for_this_type', 'В этом ящике другой товар!'));
          return;
        }
        anim('hero_harvest1', 1.0, () => {
          this.pickPlant(plant);
          held.count = (held.count || 0) + 1;
          held.type = plantName(plant);
          this.sparkle(plant.x, plant.y - 20, '#ffd75e');
          this.hooks.playSound('harvest_plant');
          if (held.count >= boxCapacity(held.def)) {
            this.hooks.notify(this.db.t('notify_box_full', 'Ящик полон, пора нести его в ангар!'));
          }
        });
        break;
      }
      case 'weed': {
        // прополка: героиня выдёргивает сорняк (plant_bur, plant_nettle) — условия "kill plant_bur"
        const plant = task.plant;
        if (!plant || plant.dead || !plant.def.props.weed) return;
        if (!this.allowed.weed) return;
        // действие «прополка» (маска 0x2000, sub_100039B4) в оригинале идёт тем же путём, что и копание (маска 8):
        // звук dig.ogg и та же длительность состояния; анимация — копание (hero_dug), killplant — звук инструмента destructor
        this.hooks.playSound('dig');
        anim('hero_dug', 1.5, () => {
          this.hooks.stopSound && this.hooks.stopSound('dig');
          if (plant.dead) return;
          this.removeObject(plant);
          this.bump('kill_' + plant.name);
          this.bump('dead_' + plant.name);
          this.dust(plant.cell.x, plant.cell.y);
          this.hooks.updateHud();
        });
        break;
      }
      case 'fix_generator': {
        // починка сломанного генератора кликом (задача 6 сценария разрешает действием "fix 1")
        const gen = task.object;
        if (!gen || gen.kind !== 'generator' || !gen.broken) return;
        if (!this.allowed.fix) return;
        anim('hero_use1', 1.0, () => {
          if (!gen.broken) return;
          gen.broken = false;
          gen.fixed = true;
          this.bump('fixed_generator'); // условие "fixed generator" (уровень 12)
          this.sparkle(gen.x, gen.y - 40, '#ffe9a8');
          this.hooks.updateHud();
        });
        break;
      }
      case 'fill': {
        const held = h.held;
        if (!held || held.kind !== 'watercan') return;
        this.hooks.playSound('waterpump'); // orig. sub_4031F0 (hero state 11, inferred): filling at the pump
        anim('hero_fill_watercan', 1.0, () => {
          held.charges = held.def.props.max_watering || 6;
        });
        break;
      }
      case 'steal': {
        const held = h.held;
        if (!held || held.kind === 'spade') return;
        if (held.kind === 'box' && !held.count) { this.hooks.notify(this.db.t('notify_box_empty', extraT('notify_box_empty'))); return; }
        const name = held.kind === 'box' ? (isPlantType(this, held.type) ? 'plant_' + held.type : held.type) : held.name;
        anim('hero_put_box1', 1.0, () => {
          this.bump('steal_' + name);
          h.held = { kind: 'spade' };
          this.hooks.playSound('put_box');
          this.hooks.updateHud();
        });
        break;
      }
      case 'feed': {
        const f = task.object, held = h.held;
        if (!held || held.kind !== 'box') return;
        if (held.count < boxCapacity(held.def)) {
          this.hooks.notify(this.db.t('notify_box_nomore_full', 'Этот ящик ещё не заполнен полностью!'));
          return;
        }
        const why = feedFactory(this, f, held);
        if (why) {
          this.hooks.notify(this.db.t(why, extraT(why)));
          return;
        }
        anim('hero_put_box1', 1.5, () => {
          h.held = { kind: 'spade' };
          this.hooks.playSound('put_box');
          this.hooks.updateHud();
        });
        break;
      }
      case 'sell': {
        const hangar = task.object;
        const held = h.held;
        if (!held || held.kind !== 'box') return;
        if (!this.allowed.sell) {
          this.hooks.notify(this.db.t('notify_cant_sell', extraT('notify_cant_sell', 'Продажа запрещена!')));
          return;
        }
        if (!held.count) {
          this.hooks.notify(this.db.t('notify_box_empty', extraT('notify_box_empty')));
          return;
        }
        if (!this.hangarAccepts(hangar, held)) {
          this.hooks.notify(this.db.t('notify_hangar_not_accept', extraT('notify_hangar_not_accept')));
          return;
        }
        if (held.count < boxCapacity(held.def)) {
          this.hooks.notify(this.db.t('notify_box_nomore_full', 'Этот ящик ещё не заполнен полностью!'));
          return;
        }
        anim('hero_put_box1', 1.5, () => {
          const cost = this.goodCost(held.type);
          const total = held.count * cost;
          this.money += total;
          const key = isPlantType(this, held.type) ? 'sell_plant_' + held.type : 'sell_' + held.type;
          this.counters[key] = (this.counters[key] || 0) + 1;
          this.moneyPopup(hangar.x, hangar.y - 60, '+' + total);
          h.held = { kind: 'spade' };
          this.hooks.playSound('profit');
          this.hooks.updateHud();
        });
        break;
      }
      case 'pick': {
        const tree = task.object;
        const held = h.held;
        if (!tree || !tree.ready) return;
        if (!held || held.kind !== 'box') {
          this.hooks.notify(this.db.t('notify_need_box', extraT('notify_need_box')));
          return;
        }
        const cap = boxCapacity(held.def);
        if (held.count >= cap) {
          this.hooks.notify(this.db.t('notify_box_full', 'Ящик полон, пора нести его в ангар!'));
          return;
        }
        if (held.count > 0 && held.type !== tree.name) {
          this.hooks.notify(this.db.t('notify_only_for_this_type', 'В этом ящике другой товар!'));
          return;
        }
        anim('hero_harvest1', 1.0, () => {
          if (!tree.ready) return;
          tree.ready = false;
          tree.fruits = 0;
          tree.progress = 0;
          // дерево отдаёт полный ящик (4 предмета), ёмкость бокса ограничивает сверху
          held.count = Math.min(cap, (held.count || 0) + BOX_CAPACITY);
          held.type = tree.name;
          this.bump('harvest_' + tree.name); // условие части 2 "harvest plant_tomato" — и для деревьев
          this.sparkle(tree.x, tree.y - 90, '#ffd75e');
          this.hooks.playSound('harvest_tree');
          this.hooks.notify(this.db.t('notify_box_full', 'Ящик полон, пора нести его в ангар!'));
          this.hooks.updateHud();
        });
        break;
      }
      case 'feed': {
        const house = task.object;
        const held = h.held;
        if (!house || !held || held.kind !== 'box') return;
        const p = house.def.props;
        if (held.count < boxCapacity(held.def)) {
          this.hooks.notify(this.db.t('notify_box_nomore_full', 'Этот ящик ещё не заполнен полностью!'));
          return;
        }
        anim('hero_put_box1', 0.5, () => {
          // the whole box of fodder is handed over and the food bar is refilled
          h.held = { kind: 'spade' };
          house.feed = p.time_feed || 60;
          this.bump('house_fed');
          this.bump('feed_' + house.name); // условие части 2 "feed house_sheep"
          this.hooks.playSound('feed_' + houseSound(house.name));
          this.sparkle(house.x, house.y - 60, '#9be36b');
          this.hooks.updateHud();
        });
        break;
      }
      case 'collect': {
        const house = task.object;
        const held = h.held;
        if (!house || !house.ready) return;
        if (!held || held.kind !== 'box') {
          this.hooks.notify(this.db.t('notify_need_box', extraT('notify_need_box')));
          return;
        }
        const cap = boxCapacity(held.def);
        if (held.count >= cap) {
          this.hooks.notify(this.db.t('notify_box_full', 'Ящик полон, пора нести его в ангар!'));
          return;
        }
        if (held.count > 0 && held.type !== house.name) {
          this.hooks.notify(this.db.t('notify_only_for_this_type', 'В этом ящике другой товар!'));
          return;
        }
        anim('hero_harvest1', 1.0, () => {
          if (!house.ready) return;
          house.ready--;
          if (house.def.type === 'beehive' || house.name === 'beehive') house.progress = 0;
          // a finished batch fills a whole box (4 items), like the original
          if (held.count < BOX_CAPACITY) held.count = Math.min(BOX_CAPACITY, (held.count || 0) + BOX_CAPACITY);
          held.type = house.name;
          this.sparkle(house.x, house.y - 80, '#ffd75e');
          this.hooks.playSound('harvest_' + houseSound(house.name));
          if (held.count >= cap) {
            this.hooks.notify(this.db.t('notify_box_full', 'Ящик полон, пора нести его в ангар!'));
          }
          this.hooks.updateHud();
        });
        break;
      }
      case 'pickup': {
        const obj = task.object;
        if (!obj) return;
        // small can -> take_watercan2, big can -> take_watercan1 (sub_41C140)
        const takeAnim = { box: 'hero_take_box1', seed: 'hero_take_seed', fertilizer: 'hero_take_seed', watercan: obj.name === 'big_watercan' ? 'hero_take_watercan1' : 'hero_take_watercan2' }[obj.kind] || 'hero_take_box1';
        anim(takeAnim, TAKE_PUT_TIME, () => {
          // swap with currently held item
          const held = h.held;
          if (held && held.kind !== 'spade') {
            this.dropHeldAt(obj.cell.x, obj.cell.y);
          }
          h.held = {
            kind: obj.kind, def: obj.def, name: obj.name,
            charges: obj.charges, count: obj.count, type: obj.type,
          };
          this.removeObject(obj);
          // условия части 2 "take map_piece" / "take mobilephone" / …: подбор предмета героиней
          this.bump('take_' + obj.name);
          lightbugsFollow(this, obj);
          if (obj.fromRespawn) this.bump('take_from_respawn');
          this.hooks.playSound(TAKE_SOUNDS[obj.kind] || 'clickmenu');
        });
        // в кадрах анимации «взять» предмет уже нарисован на земле у героини: настоящий объект на время действия скрыт
        if (h.act) h.act.hide = obj;
        break;
      }
      case 'place': {
        const cell = this.cell(task.cell.x, task.cell.y);
        const held = h.held;
        const pt = task.pt && this.freeSpot(held, task.pt.x, task.pt.y) ? task.pt : null;
        const ok = pt || (cell && !cell.blocked && !cell.occupant && !cell.plant && this.canPlace(held, task.cell.x, task.cell.y));
        if (!cell || !ok) {
          this.hooks.notify(this.db.t('notify_you_cant_place', 'Вы не можете поставить сюда объект!'));
          return;
        }
        const putAnim = { box: 'hero_put_box1', seed: 'hero_put_seed', fertilizer: 'hero_put_seed', watercan: held.name === 'big_watercan' ? 'hero_put_watercan1' : 'hero_put_watercan2' }[held.kind] || 'hero_put_box1';
        anim(putAnim, TAKE_PUT_TIME, () => this.finishPlace(held, task.cell.x, task.cell.y, pt));
        break;
      }
      case 'move':
      default:
        break;
    }
  }

  /** Put the carried object on cell (cx, cy): spawn it, reset the hand, count the placement. */
  finishPlace(held, cx, cy, pt) {
    const h = this.hero;
    const cell0 = this.cell(cx, cy);
    const prevOcc = cell0 ? cell0.occupant : null;
    const obj = this.spawn(held.name, cx, cy);
    if (!obj) return;
    if (pt) {
      // свободная расстановка: предмет ложится ровно туда, куда указали, а не в центр клетки
      obj.x = pt.x; obj.y = pt.y;
      const pc = this.cellAt(pt.x, pt.y);
      if (pc && pc !== cell0) {
        if (cell0 && cell0.occupant === obj) cell0.occupant = prevOcc;
        obj.cell = { x: pc.x, y: pc.y };
        if (!pc.occupant) pc.occupant = obj;
      } else if (prevOcc && cell0) cell0.occupant = prevOcc;
    }
    obj.charges = held.charges;
    obj.count = held.count;
    obj.type = held.type;
    h.held = { kind: 'spade' };
    this.unstickHero();
    this.hooks.playSound(PUT_SOUNDS[held.kind] || 'clickmenu');
    if (held.saved) Object.assign(obj, held.saved);
    if (!held.moved) {
      const key = 'place_' + held.name;
      this.counters[key] = (this.counters[key] || 0) + 1;
    }
    this.hooks.updateHud();
  }

  /** A carried sprinkler is put down right on the clicked cell: the hero does not have to walk there. */
  placeSprinklerAt(cell) {
    const held = this.hero.held;
    if (cell.blocked || cell.occupant || cell.plant || !this.canPlace(held, cell.x, cell.y)) {
      this.hooks.notify(this.db.t('notify_you_cant_place', 'Вы не можете поставить сюда объект!'));
      return;
    }
    this.finishPlace(held, cell.x, cell.y);
  }

  dropHeldAt(cx, cy) {
    const h = this.hero;
    const held = h.held;
    if (!held || held.kind === 'spade') return;
    const cell = this.freeCellNear(cx, cy);
    if (!cell) return;
    const obj = this.spawn(held.name, cell.x, cell.y);
    if (obj) {
      obj.charges = held.charges;
      obj.count = held.count;
      obj.type = held.type;
    }
  }

  freeCellNear(cx, cy) {
    for (let r = 0; r < 4; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const c = this.cell(cx + dx, cy + dy);
          if (c && !c.blocked && !c.occupant && !c.plant) return { x: cx + dx, y: cy + dy };
        }
      }
    }
    return null;
  }

  removeObject(obj) {
    const i = this.objects.indexOf(obj);
    if (i >= 0) this.objects.splice(i, 1);
    this.updateBlocking(obj, false);
    const cell = this.cell(obj.cell.x, obj.cell.y);
    if (cell) {
      if (cell.occupant === obj) cell.occupant = null;
      if (cell.plant === obj) cell.plant = null;
    }
    this.hintObjs.delete(obj.id);
  }

  // ------------------------------------------------------------- input

  cellAt(wx, wy) {
    return this.cell(Math.floor(wx / TILE), Math.floor(wy / TILE));
  }

  objectAt(wx, wy) {
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i];
      if (o.kind === 'plant') {
        // клетка 64x64 плюс видимая картинка растения (frame_size со сдвигом delta_pos: репейник 81x73 выше клетки)
        const p = o.def.props, fs = p.frame_size || [32, 32], d = p.delta_pos || [0, 0];
        const top = Math.min(o.y - 32, o.y - d[1] - fs[1] / 2);
        if (Math.abs(wx - o.x) < Math.max(32, fs[0] / 2) && wy > top && wy < o.y + 32) return o;
        continue;
      }
      if (o.kind === 'worker') {
        if (Math.abs(wx - o.x) < 30 && wy > o.y - 130 && wy < o.y + 10) return o;
        continue;
      }
      if (o.kind === 'sprinkler') {
        // the 128x128 sprite is mostly spray: only the body (idle frame: x 40..82, y 49..86 of 128, a bit generous)
        // counts as "the sprinkler", the original tests the picture mask
        const ex = (wx - (o.x - 3)) / 30, ey = (wy - (o.y + 3.5)) / 26;
        if (ex * ex + ey * ey <= 1) return o;
        continue;
      }
      const s = o.size;
      if (Math.abs(wx - o.x) < s[0] / 2 && wy > o.y - s[1] * 0.7 && wy < o.y + s[1] * 0.3) return o;
      // нижняя часть твёрдого здания (его основание, base_radius) — тоже само здание: клик туда не «земля»,
      // иначе героиня шла бы к точке внутри здания и бесконечно его огибала
      const br = o.def && o.def.props.solid && o.def.props.base_radius;
      if (br) {
        const bp = basePoint(o);
        if (((wx - bp[0]) / br[0]) ** 2 + ((wy - bp[1]) / br[1]) ** 2 <= 1) return o;
      }
    }
    return null;
  }

  heroAt(wx, wy) {
    // «клик по героине»: гасится только вне клетки с грядкой/растением (задача 27, см. click)
    return Math.abs(wx - this.hero.x) < 40 && wy > this.hero.y - 120 && wy < this.hero.y + 30;
  }

  /**
   * Клик по полю. Покупка/инструмент/работник/разбрызгиватель обрабатываются сразу, всё остальное (ход героини и
   * действия над объектами и клетками) — очередь: каждый клик добавляет цель с галочкой (оригинал: CMover хранит
   * до 256 точек, `flag.tga` — галочка: простой ход и действия над объектами, `flag1.tga` — кольцо: двойной клик по
   * земле, героиня копает), героиня выполняет их по порядку. Что именно делать с целью, решается в момент выполнения (можно кликнуть по дереву, ещё не взяв ящик).
   */
  click(wx, wy, isDouble) {
    if (this.over) return;
    const h = this.hero;
    const obj = this.objectAt(wx, wy);
    const cell = this.cellAt(wx, wy);
    // клик по героине (вне клетки с грядкой/растением, см. задачу 27): сбросить очередь и остановить ход
    const bedHere = cell && (cell.dug || cell.plant);
    if (!obj && !bedHere && !isDouble && this.heroAt(wx, wy)) {
      this.clearQueue();
      // с ящиком/пакетом/лейкой в руках клик по героине кладёт предмет у её ног (для тех, кому неудобен двойной клик)
      if (!h.act && h.held && ['box', 'seed', 'watercan', 'fertilizer'].includes(h.held.kind)) {
        const hc = this.cellAt(h.x, h.y);
        const free = hc && !hc.blocked && !hc.occupant && !hc.plant ? hc : (hc ? this.freeCellNear(hc.x, hc.y) : null);
        if (free) { this.setTask({ kind: 'place', cell: { x: free.x, y: free.y }, pt: free === hc ? { x: h.x, y: h.y + 6 } : null }); return; }
      }
      if (!h.act) { h.task = null; h.path = []; h.moving = false; }
      return;
    }

    if (this.pending) {
      if (cell) this.placePending(cell);
      return;
    }

    const heldTool = h.held && ['transporter', 'destructor', 'bulldozer', 'constructor'].includes(h.held.kind);
    if (heldTool && this.useTool(h.held, obj, cell)) return;
    if (obj && obj.kind === 'worker') { this.workerClicked(obj); return; }
    if (!obj && cell && h.held && h.held.kind === 'sprinkler') { this.placeSprinklerAt(cell); return; }
    if (!obj && !cell) return;

    // режим лопаты: одиночный клик по свободной земле равен двойному (копать); с предметом в руках работает как обычно
    if (this.digMode && !isDouble && !obj && (!h.held || h.held.kind === 'spade')
      && !cell.dug && !cell.blocked && !cell.occupant && !cell.plant) isDouble = true;

    // двойной клик заменяет только что поставленный первый клик на том же месте (ход + действие не дублируются)
    const last = this.lastClick;
    if (isDouble && last && Math.abs(last.wx - wx) < 20 && Math.abs(last.wy - wy) < 20) {
      const qi = this.queue.indexOf(last);
      if (qi >= 0) this.queue.splice(qi, 1);
      else if (this.current === last && !h.act) { h.task = null; h.path = []; h.moving = false; this.current = null; }
    }
    if (this.queue.length >= QUEUE_MAX) return;
    const entry = {
      wx, wy, isDouble: !!isDouble, objId: obj ? obj.id : null,
      // кольцо — двойной клик по свободной земле (героиня копает/ставит), всё остальное, в т.ч. простой ход — галочка
      ring: !obj && !!isDouble && !!cell && !cell.dug && !cell.blocked && !cell.occupant && !cell.plant,
    };
    this.lastClick = entry;
    this.queue.push(entry);
    if (this.heroIdle()) this.nextQueued();
  }

  /** Кнопка лопаты в инвентаре: включает/выключает режим «один клик копает». */
  toggleDigMode() {
    this.digMode = !this.digMode;
    this.hooks.updateShop();
    return this.digMode;
  }

  heroIdle() {
    const h = this.hero;
    return !h.act && !h.path.length && !h.task;
  }

  clearQueue() {
    this.queue = [];
    this.current = null;
    this.lastClick = null;
  }

  /** Берёт из очереди первую цель, которая даёт героине работу (цели без результата, например «нужен ящик», пропускаются). */
  nextQueued() {
    while (this.queue.length) {
      const e = this.queue.shift();
      const obj = (e.objId != null ? this.objects.find((o) => o.id === e.objId) : null) || this.objectAt(e.wx, e.wy);
      const cell = obj && obj.cell ? this.cell(obj.cell.x, obj.cell.y) || this.cellAt(e.wx, e.wy) : this.cellAt(e.wx, e.wy);
      this.current = e;
      this.runClick(obj || null, cell, e.isDouble, { x: e.wx, y: e.wy });
      if (!this.heroIdle()) return;
      this.current = null;
    }
  }

  /** Галочки/кольца для отрисовки: текущая цель (пока героиня занята) и всё, что ждёт в очереди. */
  queueMarks() {
    const marks = [];
    const add = (e) => {
      const obj = e.objId != null ? this.objects.find((o) => o.id === e.objId) : null;
      if (obj) {
        // у крупных зданий o.y — центр квадратной текстуры (256x256), а само здание занимает её нижнюю часть: галочку ставим
        // на центр основания (base_center), у мелких предметов — над самим предметом
        const solid = obj.def && obj.def.props.solid && obj.def.props.base_center;
        const [bx, by] = solid ? basePoint(obj) : [obj.x, obj.y];
        marks.push({ x: bx, y: by, lift: 0, type: 'check', obj: true, key: 'o' + obj.id });
      }
      else {
        const c = this.cellAt(e.wx, e.wy);
        const x = c ? c.x * TILE + TILE / 2 : e.wx, y = c ? c.y * TILE + TILE / 2 : e.wy;
        marks.push({ x, y, type: e.ring ? 'ring' : 'check', key: 'c' + Math.round(x) + ',' + Math.round(y) });
      }
    };
    if (this.current && !this.heroIdle()) add(this.current);
    for (const e of this.queue) add(e);
    return marks;
  }

  /** Решает, что делать героине с целью клика (бывшее тело click(), без немедленных действий). */
  runClick(obj, cell, isDouble, pt) {
    const h = this.hero;
    const heldTool = h.held && ['transporter', 'destructor', 'bulldozer', 'constructor'].includes(h.held.kind);
    if (obj) {
      switch (obj.kind) {
        case 'item':
        case 'seed':
        case 'watercan':
        case 'box':
        case 'fertilizer':
          this.setTask({ kind: 'pickup', object: obj });
          return;
        case 'switch': {
          // рубильник части 2: включается кликом (условия "switches on" / "all switches on");
          // обратное переключение в скриптах не встречается — рубильник остаётся включённым
          if (this.allowed.switch && !obj.on) obj.on = true;
          return;
        }
        case 'generator': {
          // сломанный генератор чинится кликом ("fix 1" разрешает, #bool cant_generator_fix запрещает)
          if (obj.broken && this.allowed.fix) {
            this.setTask({ kind: 'fix_generator', object: obj });
          } else {
            this.walkToCell(obj.cell.x, obj.cell.y);
          }
          return;
        }
        case 'obstacle':
          this.walkToCell(obj.cell.x, obj.cell.y);
          return;
        case 'waterpump':
          if (h.held && h.held.kind === 'watercan') {
            this.setTask({ kind: 'fill', object: obj });
          } else {
            this.hooks.notify(this.db.t('notify_need_can', extraT('notify_need_can')));
          }
          return;
        case 'tree': {
          const held = h.held;
          const isBox = held && held.kind === 'box';
          if (obj.fruits > 0 && isBox && (!held.count || held.type === obj.name)) {
            this.setTask({ kind: 'pick', object: obj });
          } else if (obj.fruits > 0 && !isBox) {
            this.hooks.notify(this.db.t('notify_need_box', extraT('notify_need_box')));
          } else if (obj.fruits > 0) {
            this.hooks.notify(this.db.t('notify_only_for_this_type', 'В этом ящике другой товар!'));
          } else {
            const pt = taskPoint({ object: obj });
            this.hero.task = null;
            this.walkToPoint(pt.x, pt.y, null);
          }
          return;
        }
        case 'house': {
          // клик по животному/улью: name_sfx из скрипта объекта (у улья его нет — bees_sfx)
          const sfx = String(obj.def.props.name_sfx || (obj.def.type === 'beehive' || obj.name === 'beehive' ? 'bees_sfx.ogg' : ''))
            .replace(/\.ogg$/i, '');
          if (sfx) this.hooks.playSound(sfx);
          const p = obj.def.props;
          const held = h.held;
          const isBox = held && held.kind === 'box';
          const sameGood = isBox && (!held.count || held.type === obj.name);
          if (obj.ready > 0 && sameGood) {
            this.setTask({ kind: 'collect', object: obj });
          } else if (needsFeed && isBox && held.count > 0) {
            if (this.feedAccepts(obj, held.type)) {
              this.setTask({ kind: 'feed', object: obj });
            } else {
              this.hooks.notify(this.db.t('notify_cant_feed_' + obj.name, 'Это животное так не накормить!'));
            }
          } else if (obj.ready > 0 && !isBox) {
            this.hooks.notify(this.db.t('notify_need_box', extraT('notify_need_box')));
          } else if (obj.ready > 0) {
            this.hooks.notify(this.db.t('notify_only_for_this_type', 'В этом ящике другой товар!'));
          } else {
            const pt = taskPoint({ object: obj });
            this.hero.task = null;
            this.walkToPoint(pt.x, pt.y, null);
          }
          return;
        }
        case 'truck':
          // sub_10046948: предмет/ящик в руках, отданный машине = событие "steal <имя>" (у ящика — имя товара)
          if (h.held && h.held.kind !== 'spade') this.setTask({ kind: 'steal', object: obj });
          return;
        case 'factory':
          if (h.held && h.held.kind === 'box') this.setTask({ kind: 'feed', object: obj });
          else this.hooks.notify(this.db.t('notify_need_box', extraT('notify_need_box')));
          return;
        case 'hangar':
          if (h.held && h.held.kind === 'box') {
            if (!this.allowed.sell) {
              // уровень запрещает продажу (#bool cant_sell, L22: магазин закрыт)
              this.hooks.notify(this.db.t('notify_cant_sell', extraT('notify_cant_sell', 'Продажа запрещена!')));
              return;
            }
            this.setTask({ kind: 'sell', object: obj });
          } else {
            this.hooks.notify(this.db.t('notify_need_box', extraT('notify_need_box')));
          }
          return;
        case 'plant': {
          if (obj.dead) { this.walkToCell(obj.cell.x, obj.cell.y); return; }
          const held = h.held;
          if (held && held.kind === 'watercan' && held.charges > 0 && this.allowed.water) {
            this.setTask({ kind: 'water', plant: obj });
          } else if (held && held.kind === 'fertilizer' && held.charges > 0 && this.allowed.fertilize) {
            this.setTask({ kind: 'fertilize', plant: obj });
          } else if (obj.fruits > 0 && this.allowed.harvest) {
            this.setTask({ kind: 'harvest', plant: obj });
          } else if (obj.def.props.weed && this.allowed.weed && (!held || held.kind === 'spade')) {
            this.setTask({ kind: 'weed', plant: obj }); // прополка сорняка (plant_bur/plant_nettle)
          } else {
            this.walkToCell(obj.cell.x, obj.cell.y);
          }
          return;
        }
        default:
          this.walkToCell(obj.cell.x, obj.cell.y);
          return;
      }
    }

    if (!cell) return;

    if (h.held && h.held.kind === 'sprinkler') {
      this.placeSprinklerAt(cell);
      return;
    }

    if (isDouble) {
      const held = h.held;
      if (held && held.kind !== 'spade' && !heldTool) {
        this.setTask({ kind: 'place', cell: { x: cell.x, y: cell.y }, pt: pt || null });
      } else if (!cell.dug && !cell.blocked && !cell.occupant && this.allowed.dig) {
        this.setTask({ kind: 'dig', cell: { x: cell.x, y: cell.y } });
      } else {
        this.walkToCell(cell.x, cell.y);
      }
      return;
    }

    // single click
    const held = h.held;
    if (held && held.kind === 'seed' && cell.dug && !cell.plant && !cell.occupant && this.allowed.plant) {
      this.setTask({ kind: 'sow', cell: { x: cell.x, y: cell.y } });
      return;
    }
    if (cell.plant && !cell.plant.dead) {
      const plant = cell.plant;
      if (held && held.kind === 'watercan' && held.charges > 0 && this.allowed.water) {
        this.setTask({ kind: 'water', plant });
        return;
      }
      if (held && held.kind === 'fertilizer' && held.charges > 0 && this.allowed.fertilize) {
        this.setTask({ kind: 'fertilize', plant });
        return;
      }
      if (plant.fruits > 0 && this.allowed.harvest) {
        this.setTask({ kind: 'harvest', plant });
        return;
      }
      if (plant.def.props.weed && this.allowed.weed && (!held || held.kind === 'spade')) {
        this.setTask({ kind: 'weed', plant });
        return;
      }
    }
    this.walkToCell(cell.x, cell.y);
  }

  rightClick() {
    if (this.pending) { this.pending = null; this.hooks.updateShop(); return; }
    this.clearQueue();
    this.hero.task = null;
    this.hero.path = [];
  }

  setTask(task) {
    const h = this.hero;
    h.task = task;
    const point = taskPoint(task);
    this.walkToPoint(point.x, point.y, task);
  }

  walkToCell(cx, cy) {
    this.hero.task = null;
    this.walkToPoint(cx * TILE + TILE / 2, cy * TILE + TILE / 2, null);
  }

  /** True when (x, y) lies inside the area the hero may walk in (the field without its 128 px border). */
  walkable(x, y) {
    return x >= 2 * TILE && x <= this.worldW - 2 * TILE && y >= 2 * TILE && y <= this.worldH - 2 * TILE;
  }

  walkToPoint(wx, wy, task) {
    const h = this.hero;
    // sub_402A40: the target must lie inside the field rectangle, otherwise "you cannot go there"
    if (!this.walkable(wx, wy)) {
      h.task = null;
      this.hooks.notify(this.db.t('notify_you_cant_gowhere', 'Вы не можете туда пройти!'));
      return;
    }
    if (!task) {
      const p = this.pushOutOfSolids(wx, wy);
      wx = p.x; wy = p.y;
    }
    h.path = [{ x: wx, y: wy }];
    h.task = task;
  }

  /** Точка внутри основания твёрдого объекта недостижима (актёр огибал бы её вечно): сдвигаем на границу эллипса. */
  pushOutOfSolids(x, y) {
    const rA = 2; // радиус актёра (как в moveActor)
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const o of this.solidObstacles(this.hero, null, null)) {
        const dx = x - o.c[0], dy = y - o.c[1];
        const u = Math.sqrt((dx / (o.r[0] + rA)) ** 2 + (dy / (o.r[1] + rA)) ** 2);
        if (u >= 1) continue;
        if (o.dock && Math.hypot(x - o.dock.c[0], y - o.dock.c[1]) <= o.dock.r[0] + rA) continue; // зона стыковки доступна
        if (u < 1e-6) { y = o.c[1] + o.r[1] + rA + 2; moved = true; continue; }
        x = o.c[0] + dx / u * 1.03;
        y = o.c[1] + dy / u * 1.03;
        moved = true;
      }
      if (!moved) break;
    }
    return { x, y };
  }

  // ----------------------------------------------------------- particles

  sparkle(x, y, color) {
    this.particles.push({ kind: 'sparkle', x, y, t: 0, life: 0.6, color });
  }

  dust(cx, cy) {
    for (let i = 0; i < 6; i++) {
      this.particles.push({
        kind: 'dust',
        x: cx * TILE + TILE / 2 + (Math.random() - 0.5) * 40,
        y: cy * TILE + TILE / 2 + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 40,
        vy: -30 - Math.random() * 30,
        t: 0, life: 0.6,
      });
    }
  }

  waterDrops(x, y) {
    for (let i = 0; i < 10; i++) {
      this.particles.push({
        kind: 'drop',
        x: x + (Math.random() - 0.5) * 50,
        y: y - 30 - Math.random() * 20,
        vx: (Math.random() - 0.5) * 20,
        vy: 40 + Math.random() * 40,
        t: 0, life: 0.5,
      });
    }
  }

  moneyPopup(x, y, text) {
    this.particles.push({ kind: 'text', x, y, vy: -30, t: 0, life: 1.4, text, color: '#ffd75e' });
  }

  // --------------------------------------------------------------- shop

  buy(name) {
    const def = this.db.objects.get(name);
    if (!def) return;
    const price = def.props.price || 0;
    // crane / destructor / bulldozer / constructor are services: paid per use, not on selection
    if (['transporter', 'destructor', 'bulldozer', 'constructor'].includes(kindOf(def))) {
      this.hero.held = { kind: kindOf(def), def, name };
      this.hooks.playSound('clickmenu');
      this.hooks.updateHud();
      return;
    }
    if (this.money < price) {
      this.hooks.notify(this.db.t('notify_no_more_money', 'Не хватает денег!'));
      return;
    }
    if (def.type === 'patent') {
      // an order: removes the patent from the shop and unlocks the real item
      this.money -= price;
      this.removeFromShop(name);
      this.counters['place_' + name] = (this.counters['place_' + name] || 0) + 1;
      this.counters['buy_' + name] = (this.counters['buy_' + name] || 0) + 1;
      if (def.props.patent_for) this.addToShop(def.props.patent_for);
      this.hooks.playSound('pay_shop');
      this.hooks.updateHud();
      return;
    }
    // Everything else (items, buildings, trees, sprinklers, workers) is attached to the cursor until the player picks
    // a cell; the money is taken and the sounds play only when it is put down (sub_416670, see placePending).
    const kind = kindOf(def);
    this.pending = {
      kind, def, name, unpaid: price,
      charges: def.props.max_watering || def.props.max_fert_count || undefined,
      count: def.props.max_seed_count || (kind === 'box' ? 0 : undefined),
    };
    this.hooks.playSound('clickmenu');
    this.hooks.updateShop();
    this.hooks.updateHud();
  }

  /** Put the purchase on the clicked cell: pay, sounds by type, "object_bought" burst. The hero does not walk there. */
  placePending(cell) {
    const p = this.pending;
    if (!p) return;
    const ok = !cell.blocked && !cell.occupant && !cell.plant && (p.kind === 'worker' || this.canPlace(p, cell.x, cell.y));
    if (!ok) {
      this.hooks.notify(this.db.t('notify_you_cant_place', 'Вы не можете поставить сюда объект!'));
      return;
    }
    if (this.money < p.unpaid) {
      this.hooks.notify(this.db.t('notify_no_more_money', 'Не хватает денег!'));
      return;
    }
    const obj = p.kind === 'worker' ? this.spawnWorker(p.name, cell.x, cell.y) : this.spawn(p.name, cell.x, cell.y);
    if (!obj) return;
    this.money -= p.unpaid;
    this.pending = null;
    for (const k of ['buy_', 'place_']) this.counters[k + p.name] = (this.counters[k + p.name] || 0) + 1;
    this.hooks.playSound('pay_shop');
    this.hooks.playSound(PUT_SOUNDS[p.kind] || 'clickmenu');
    this.emitParticles('object_bought', obj.x, obj.y, 50);
    this.hooks.updateShop();
    this.hooks.updateHud();
  }

  /** Second click on the shop button of the purchase on the cursor: the selection is cancelled. */
  deselectShopItem(name) {
    const h = this.hero;
    if (this.pending && this.pending.name === name) {
      this.pending = null;   // nothing was paid yet
      this.hooks.playSound('clickmenu');
      this.hooks.updateShop();
      return true;
    }
    const held = h.held;
    if (!held || held.name !== name) return false;
    h.held = { kind: 'spade' };
    this.hooks.playSound('clickmenu');
    this.hooks.updateHud();
    this.hooks.updateShop();
    return true;
  }

  selectTool(kind) {
    // switch back to a stored tool (spade only for now)
    if (kind === 'spade') {
      this.pending = null;
      const h = this.hero;
      if (h.held && h.held.kind !== 'spade') {
        // put current item down near hero
        const cell = this.cellAt(h.x, h.y);
        if (cell) this.dropHeldAt(cell.x, cell.y);
      }
      h.held = { kind: 'spade' };
      this.hooks.updateHud();
    }
  }

}

// ---------------------------------------------------------------- helpers

function kindOf(def) {
  switch (def.type) {
    case 'seed': return 'seed';
    case 'plant': return 'plant';
    case 'box': case 'multibox': return 'box';
    case 'watercan': return 'watercan';
    case 'fertilizer': return 'fertilizer';
    case 'spade': return 'spade';
    case 'hangar': return 'hangar';
    case 'house': return 'house';
    case 'beehive': return 'house';
    case 'tree': return 'tree';
    case 'waterpump': return 'waterpump';
    case 'water_sprinkler': return 'sprinkler';
    case 'worker': return 'worker';
    case 'patent': return 'patent';
    case 'transporter': return 'transporter';
    case 'bulldozer': return 'bulldozer';
    case 'destructor': return def.props.name === 'constructor' ? 'constructor' : 'destructor'; // constructor — @destructor с текстурой cultivator
    case 'truck': return 'truck';             // часть 2 (level 3): машина — сюда «кража» сдаётся (событие steal <имя>)
    case 'factory': return 'factory';         // часть 2: фабрики (sim_factory.js)
    case 'generator': return 'generator';     // часть 2: источник питания (overload/fix generator)
    case 'obstacle': return 'obstacle';       // часть 2: decor_* (болото, камни, ямы…), иногда destructable
    case 'fence': return 'fence';             // часть 2: заборы по периметру (некликабельный декор)
    case 'switch': return 'switch';           // часть 2: рубильники генератора
    case 'marker': return 'marker';           // часть 2: зона сценария (условие "enter marker")
    case 'piece': return 'item';              // часть 2: подбираемые предметы (map_piece, mobilephone, mushroom, spare)
    default: return 'item';
  }
}

function workerGoalPoint(goal) {
  const o = goal.obj;
  if (o.kind === 'plant') return { x: o.x, y: o.y + 30 };
  return taskPoint({ object: o });
}

function clampN(v, a, b) { return v < a ? a : v > b ? b : v; }

function houseSound(name) {
  return String(name).replace(/^house_/, '');
}

function isPlantType(world, type) {
  return world.db.objects.has('plant_' + type);
}

function plantName(plant) {
  // plant_pumpkin -> pumpkin
  return String(plant.name).replace(/^plant_/, '');
}

/** data действия "add to field" части 2: "obj x y [arg]" (аргумент — см. spawnFieldObject). */
function parseFieldAdd(data) {
  const m = /^(\S+)\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s+(\S+))?\s*$/.exec(String(data || '').trim());
  if (!m) return null;
  return { name: m[1], x: parseFloat(m[2]), y: parseFloat(m[3]), arg: m[4] || null };
}

/** Interaction/dock point for a task, in world pixels. */
function taskPoint(task) {
  if (task.object) {
    const o = task.object;
    const dock = o.def.props.dock_center;
    if (dock) {
      // def coords are y-up -> flip
      return { x: o.x + dock[0], y: o.y - dock[1] };
    }
    return { x: o.x, y: o.y + 20 };
  }
  if (task.plant) {
    return { x: task.plant.x, y: task.plant.y + 24 };
  }
  if (task.pt) return { x: task.pt.x, y: task.pt.y };
  if (task.cell) {
    return { x: task.cell.x * TILE + TILE / 2, y: task.cell.y * TILE + TILE / 2 };
  }
  return { x: 0, y: 0 };
}

/** sub_4014F0 ellipse test with the dock exception (the dock zone of the object being walked to may be entered). */
function ellipseHit(x, y, rA, cx, cy, rB, dock, t) {
  const hit = ((cx - x) / (rA[0] + rB[0])) ** 2 + ((cy - y) / (rA[1] + rB[1])) ** 2 <= 1;
  if (!hit) return false;
  if (dock) {
    const targetInDock = ((dock.c[0] - t.x) / dock.r[0]) ** 2 + ((dock.c[1] - t.y) / dock.r[1]) ** 2 <= 1.2;
    const inDock = ((dock.c[0] - x) / (dock.r[0] + 4)) ** 2 + ((dock.c[1] - y) / (dock.r[1] + 4)) ** 2 <= 1;
    if (targetInDock && inDock) return false;
  }
  return true;
}

/** Base (feet) point of an object in world pixels (y flipped from def). */
function basePoint(obj) {
  const bc = obj.def.props.base_center;
  const x = obj.x + (bc ? bc[0] : 0);
  const y = obj.y - (bc ? bc[1] : 0);
  return [x, y];
}

/**
 * Animation index of a heading (sub_401A30): the original keeps y up, index = floor(angle / 45 + 0.5) % 8 with
 * 0 = right, 1 = up-right, 2 = up (back view), 4 = left, 6 = down (front view). `dy` here is screen-down.
 */
export function dirIndex(dx, dy) {
  if (!dx && !dy) return 0;
  const a = Math.atan2(-dy, dx) * 180 / Math.PI;
  return ((Math.floor(a / 45 + 0.5) % 8) + 8) % 8;
}

/** One step of an original CParticle (sub_408DE0); `ms` is the frame time in milliseconds. */
function stepFx(p, ms) {
  p.x += p.vx * ms; p.y += p.vy * ms;
  p.vx += p.gx * ms; p.vy += p.gy * ms;
  p.size += p.dsize * ms;
  if (p.size <= 0) { p.size = 0; p.dead = true; }
  p.angle += p.dangle * ms;
  for (let k = 0; k < 3; k++) {            // r, g, b bounce between 0 and 255
    p.c[k] += p.dc[k] * ms;
    if (p.c[k] < 0) { p.c[k] = 0; p.dc[k] = -p.dc[k]; }
    if (p.c[k] > 255) { p.c[k] = 255; p.dc[k] = -p.dc[k]; }
  }
  p.c[3] += p.dc[3] * ms;                  // alpha: dies at 0
  if (p.c[3] > 255) { p.c[3] = 255; p.dc[3] = -p.dc[3]; }
  if (p.c[3] < 0) { p.c[3] = 0; p.dead = true; }
}
