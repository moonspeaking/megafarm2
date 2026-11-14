#!/usr/bin/env node
// Тесты инфраструктуры части 2 (задача 4, docs/opencode-tasks.md): расстановка поля
// ("add to field" / "add bed"), действия группы A (allow action, set plant *, overload/fix
// generator, kill all people, water all, spawn object, set upgrade, add event from pattern),
// новые объекты (decor_*/fence_*, bulldozer/constructor/destructor, generator, multibox/fivebox,
// switch, marker, plant_bur), события-группы и счётчики условий.
// Ожидания — из скриптов assets/scripts (level1..8*.txt, objects/*.txt) и rus.txt (подсказки магазина).
// Запуск: node tools/test_sim_part2.mjs (код возврата != 0 при ошибках).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../src/assets.js';
import { loadData } from '../src/data.js';
import { World, TILE } from '../src/sim.js';
import { boxCapacity } from '../src/sim_infra.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

globalThis.fetch = async (url) => {
  const rel = String(url).replace(/[?#].*$/, '').replace(/^https?:\/\/[^/]+/, '');
  let abs = rel.startsWith('/') ? rel : path.join(ROOT, rel);
  try {
    const text = await fs.readFile(abs, 'utf8');
    return { ok: true, text: async () => text, json: async () => JSON.parse(text) };
  } catch {
    return { ok: false, text: async () => '', json: async () => { throw new Error('not found: ' + rel); } };
  }
};

const stubAssets = { resolve: () => null, load: () => null, image: () => null, sound: () => null, missing: new Set() };

// ---------------------------------------------------------------- запуск

let passed = 0, failed = 0;
const failures = [];

function ok(cond, name, detail) {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; failures.push(name); console.error(`  FAIL ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`); }
}

function makeHooks(rec) {
  return {
    showMessage: () => {}, notify: () => {},
    showEnd: (result) => { if (!rec.over) rec.over = result; },
    updateHud: () => {}, updateShop: () => {}, updateTasks: () => {},
    playSound: () => {}, showHelp: () => {},
    showDialogue: rec.dialogues ? (name) => rec.dialogues.push(name) : undefined,
  };
}

function newWorld(db, n, rec) {
  const w = new World(db, stubAssets, n, makeHooks(rec || {}));
  w.start();
  return w;
}

/** Шаги симуляции, пока не выполнится условие (или не кончатся шаги). */
function stepUntil(w, cond, maxSteps) {
  for (let i = 0; i < maxSteps; i++) {
    w.update(0.25);
    if (cond()) return true;
  }
  return cond();
}

const at = (c) => c * TILE + TILE / 2;
const runA = (w, type, data) => w.runAction({ type, data, delay: 0 });
const byName = (w, name) => w.objects.find((o) => o.name === name);
const near = (w, x, y) => w.cell(Math.floor(x / TILE), Math.floor(y / TILE));

// ------------------------------------------------------------------ тесты

async function main() {
  const db = await loadData(await loadManifest());
  if (!db.levels.size) {
    console.error('уровни не загрузились');
    process.exit(2);
  }

  console.log('=== расстановка поля (задача 1 → 4): add to field / add bed');
  {
    const w = newWorld(db, 1);
    const weeds = w.objects.filter((o) => o.kind === 'plant' && o.def.props.weed);
    ok(weeds.length === 8, 'level1: 8 сорняков plant_bur из add bed "…1 1 plant_bur"', weeds.length);
    const cell = w.cell(9, 2);
    ok(cell && cell.dug && cell.plant && cell.plant.name === 'plant_bur', 'add bed вскапывает клетку и сажает растение');
    const fences = w.objects.filter((o) => o.kind === 'fence');
    ok(fences.length === 14, 'заборы fence_* расставлены (14 в level1)', fences.length);
    const obstacle = w.objects.find((o) => o.kind === 'obstacle');
    ok(!!obstacle, 'keyldo_* декорации — объекты kind obstacle (@obstacle)');
    const hangar = byName(w, 'hangar_vegetables');
    ok(hangar && Math.abs(hangar.x - (4.087582 * TILE + TILE / 2)) < 0.01, 'add to field: дробные координаты data', hangar && hangar.x);
    const hero = w.hero;
    ok(Math.abs(hero.x - (8.701228 * TILE + TILE / 2)) < 0.01, 'hero ставится по координатам из data', hero.x);
    const tree = w.objects.find((o) => o.kind === 'tree' && o.noFruits);
    ok(!!tree, 'аргумент "no_fruits" — дерево без плодов');
    stepUntil(w, () => w.time > 5, 40);
    ok(tree && tree.fruits === 0 && !tree.ready && tree.progress === 0, 'no_fruits: дерево не зреет');
    ok(w.money === 20, 'set money события l1_init отработал', w.money);
    const looser = byName(w, 'looser');
    ok(looser && looser.kind === 'worker' && looser.tag === 'wwoir', 'тэг персонажа из 4-го аргумента data');
  }

  console.log('=== начальный апгрейд и set upgrade');
  {
    const w = newWorld(db, 2);
    // в level2 entry house_sheep стоит с аргументом 0
    const house = byName(w, 'house_sheep');
    ok(house && house.kind === 'house' && house.upgrade === 0, 'число в data "house_sheep x y 0" — начальный апгрейд', house && house.upgrade);
    runA(w, 'set upgrade', 'house_sheep 0 1');
    ok(house.upgrade === 1, 'set upgrade меняет уровень дома', house.upgrade);
    ok((w.counters.upgraded_house_sheep_1 || 0) === 1, 'счётчик upgraded_house_sheep_1 для условия "upgraded house_sheep 1"');
    runA(w, 'upgrade factory', 'factory_sausage 2');
    ok((w.counters.upgraded_factory_sausage_2 || 0) === 1, 'upgrade factory даёт счётчик upgraded_<имя>_<уровень>');
  }

  console.log('=== allow action: способности героини (#bool cant_* уровня + allow action)');
  {
    const w = newWorld(db, 1);
    ok(w.allowed.dig && !w.allowed.plant && !w.allowed.weed && !w.allowed.harvest,
      'level1: копать можно, сеять/полоть/собирать нельзя до allow action', w.allowed);
    // событие l1_dig_first_by_scenario (условие "dig bed >= 4") открывает посадку
    w.dugCount = 4;
    stepUntil(w, () => w.firedEvents.has('l1_dig_first_by_scenario'), 20);
    ok(w.firedEvents.has('l1_dig_first_by_scenario'), 'условие "dig bed >=4" (счётчик dig_bed = dugCount) выполняет событие');
    ok(w.allowed.plant, 'allow action "plant 1" разрешает посев');
    runA(w, 'allow action', 'dig 0');
    ok(!w.allowed.dig, 'allow action "dig 0" запрещает копание');
    const c = w.cell(13, 9);
    w.hero.x = at(13); w.hero.y = at(9) + 40;
    w.click(at(13), at(9), true); // двойной клик — копать
    stepUntil(w, () => !w.heroIdle(), 40);
    ok(!c.dug, 'запрещённое копание не выполняется', c.dug);
  }

  console.log('=== прополка сорняков (условие "kill plant_bur")');
  {
    const w = newWorld(db, 1);
    const weed = w.objects.find((o) => o.name === 'plant_bur');
    runA(w, 'allow action', 'weed 1');
    w.hero.x = weed.x; w.hero.y = weed.y + 40;
    w.click(weed.x, weed.y, false);
    const reached = stepUntil(w, () => !w.objects.includes(weed), 200);
    ok(reached, 'клик по сорняку (пустые руки) выдёргивает его');
    ok((w.counters.kill_plant_bur || 0) >= 1, 'счётчик kill_plant_bur для условия "kill plant_bur >=8"');
    ok((w.counters.dead_plant_bur || 0) >= 1, 'прополка считается и как смерть растения (dead_plant_bur)');
    // без разрешения — не выдёргивается
    const w2 = newWorld(db, 1);
    const weed2 = w2.objects.find((o) => o.name === 'plant_bur');
    w2.hero.x = weed2.x; w2.hero.y = weed2.y + 40;
    w2.click(weed2.x, weed2.y, false);
    stepUntil(w2, () => !w2.objects.includes(weed2), 80);
    ok(w2.objects.includes(weed2), 'без allow action "weed 1" сорняк остаётся');
  }

  console.log('=== посев пакетами части 2 (seed_carrot → plant_carrot)');
  {
    const w = newWorld(db, 2);
    const c = w.cell(8, 8);
    c.dug = true; c.wet = 1;
    w.hero.x = at(8); w.hero.y = at(8) + 40;
    w.hero.held = { kind: 'seed', def: db.objects.get('seed_carrot'), name: 'seed_carrot', count: 12 };
    runA(w, 'allow action', 'plant 1');
    w.click(at(8), at(8), false);
    const done = stepUntil(w, () => !!w.cell(8, 8).plant, 200);
    ok(done && w.cell(8, 8).plant.name === 'plant_carrot', 'sow seed_carrot даёт plant_carrot', w.cell(8, 8).plant && w.cell(8, 8).plant.name);
    ok((w.counters.sow_seed_carrot || 0) === 1, 'счётчик sow_seed_carrot для условия "sow seed_carrot >=N"');
  }

  console.log('=== инструменты части 2: constructor / destructor / bulldozer');
  {
    const w = newWorld(db, 2);
    w.money = 300;
    const cell = w.cell(14, 10);
    const held = { kind: 'constructor', def: db.objects.get('constructor'), name: 'constructor' };
    w.hero.held = held;
    const consumed = w.useTool(w.hero.held, null, cell);
    ok(consumed && cell.dug && cell.wet, 'constructor мгновенно вскапывает клетку');
    ok(w.money === 200, 'constructor списывает цену (100)', w.money);
    const blocked = w.cell(0, 0); // граница поля
    ok(!w.useTool(w.hero.held, null, blocked) && !blocked.dug, 'constructor не копает заблокированную клетку');
    // destructor выкапывает грядку обратно
    const heldD = { kind: 'destructor', def: db.objects.get('destructor'), name: 'destructor' };
    w.hero.held = heldD;
    ok(w.useTool(w.hero.held, null, cell) && !cell.dug, 'destructor уничтожает пустую грядку (destructor_shop_hint)');
    ok(w.money === 195, 'destructor списывает цену (5)', w.money);
    // bulldozer убирает destructable-препятствие
    runA(w, 'add to field', 'decor_stones 15 10');
    const stones = w.objects.find((o) => o.name === 'decor_stones');
    runA(w, 'add to field', 'decor_lake 18 10');
    const lake = w.objects.find((o) => o.name === 'decor_lake');
    w.money = 500;
    const heldB = { kind: 'bulldozer', def: db.objects.get('bulldozer'), name: 'bulldozer' };
    w.hero.held = heldB;
    ok(w.useTool(w.hero.held, stones, null), 'bulldozer убирает decor_stones (#bool destructable)');
    ok(!w.objects.includes(stones), 'препятствие исчезло');
    ok((w.counters.kill_decor_stones || 0) === 1, 'счётчик kill_decor_stones для условий "kill decor_*"');
    ok(w.money === 400, 'bulldozer списывает цену (100)', w.money);
    ok(!w.useTool(w.hero.held, lake, null) && w.objects.includes(lake), 'bulldozer не трогает препятствие без destructable');
  }

  console.log('=== боксы части 2: fivebox (boxcount 5) / multibox (7, infinite)');
  {
    ok(boxCapacity(db.objects.get('box')) === 4, 'обычный box — 4 (BOX_CAPACITY)');
    ok(boxCapacity(db.objects.get('fivebox')) === 5, 'fivebox — boxcount 5');
    ok(boxCapacity(db.objects.get('multibox')) === 7, 'multibox — boxcount 7');
    const w = newWorld(db, 1);
    // сбор в fivebox: 5 плодов, шестой не влезает
    const plant = w.spawn('plant_tomato', 10, 9);
    w.cell(10, 9).plant = plant;
    plant.fruits = 1; plant.ready = true; plant.health = 100;
    const held = { kind: 'box', def: db.objects.get('fivebox'), name: 'fivebox', count: 0 };
    w.hero.held = held;
    runA(w, 'allow action', 'harvest 1');
    w.hero.x = plant.x; w.hero.y = plant.y + 40;
    for (let i = 0; i < 5; i++) {
      w.click(plant.x, plant.y, false);
      stepUntil(w, () => w.heroIdle(), 200);
      plant.fruits = 1; plant.ready = true; // тестовый поток плодов
    }
    ok(held.count === 5, 'fivebox вмещает 5 плодов', held.count);
    w.click(plant.x, plant.y, false);
    stepUntil(w, () => w.heroIdle(), 100);
    ok(held.count === 5, 'шестой плод не помещается — сбор невозможен', held.count);
  }

  console.log('=== рубильники и маркеры (switch / marker)');
  {
    const w = newWorld(db, 3);
    runA(w, 'add to field', 'switch 10 10 0');
    runA(w, 'add to field', 'switch 12 10 1');
    const switches = w.objects.filter((o) => o.kind === 'switch');
    const s1 = switches.find((o) => Math.abs(o.x - at(10)) < 1);
    const s2 = switches.find((o) => Math.abs(o.x - at(12)) < 1);
    ok(!!s1 && !!s2, 'switch ставится из add to field');
    ok(!w.allowed.switch, 'level3 (#bool cant_switch): рубильники запрещены до allow action');
    // семантика клика — runClick (попадание objectAt по спрайтам поля здесь не проверяем)
    runA(w, 'allow action', 'switch 1');
    w.runClick(s1, null, false, null);
    ok(s1.on === true, 'клик включает рубильник (allowed.switch)');
    ok(w.counter('switches_on') === 1, 'счётчик switches_on = 1');
    ok(w.counter('all_switches_on') === 0, 'all_switches_on = 0, пока не все включены');
    w.runClick(s2, null, false, null);
    ok(w.counter('switches_on') === 2, 'счётчик switches_on = 2 (свой рубильник level3 ещё выключен)');
    // "все включены" на мире без посторонних рубильников
    const w1 = newWorld(db, 1);
    runA(w1, 'add to field', 'switch 10 10 0');
    runA(w1, 'add to field', 'switch 12 10 1');
    const t1 = w1.objects.find((o) => o.kind === 'switch' && Math.abs(o.x - at(10)) < 1);
    const t2 = w1.objects.find((o) => o.kind === 'switch' && Math.abs(o.x - at(12)) < 1);
    w1.runClick(t1, null, false, null);
    ok(w1.counter('all_switches_on') === 0, 'all_switches_on = 0, пока не все включены');
    w1.runClick(t2, null, false, null);
    ok(w1.counter('all_switches_on') === 1, 'все рубильники включены → all_switches_on = 1');
    // с запрещённым действием (#bool cant_switch уровня, L14) рубильник не включается
    const w2 = newWorld(db, 3);
    runA(w2, 'allow action', 'switch 0');
    runA(w2, 'add to field', 'switch 10 10 0');
    const s3 = w2.objects.find((o) => o.kind === 'switch');
    w2.runClick(s3, null, false, null);
    ok(!s3.on, 'allow action "switch 0" запрещает включать рубильник');
    // маркер
    runA(w, 'add to field', 'marker 20 10');
    const marker = w.objects.find((o) => o.kind === 'marker');
    w.hero.x = marker.x; w.hero.y = marker.y;
    w.update(0.25);
    ok((w.counters.enter_marker || 0) === 1 && marker.entered, 'вход героини в маркер даёт счётчик enter_marker');
    w.update(0.25);
    ok((w.counters.enter_marker || 0) === 1, 'счётчик не растёт, пока героиня стоит в маркере');
  }

  console.log('=== генератор: overload / fix');
  {
    const w = newWorld(db, 3);
    runA(w, 'add to field', 'generator 10 12');
    const gen = w.objects.find((o) => o.kind === 'generator' && o.name === 'generator');
    ok(!!gen && gen.broken === false, 'generator ставится целым');
    runA(w, 'overload generator', 'generator');
    ok(gen.broken === true, 'overload generator ломает генератор');
    runA(w, 'fix generator', 'generator');
    ok(gen.broken === false && (w.counters.fixed_generator || 0) === 1, 'fix generator чинит и даёт счётчик fixed_generator');
    // починка кликом
    runA(w, 'overload generator', 'generator');
    w.hero.x = gen.x; w.hero.y = gen.y + 60;
    w.click(gen.x, gen.y, false);
    const fixed = stepUntil(w, () => !gen.broken, 200);
    ok(fixed, 'клик по сломанному генератору при allowed.fix чинит его');
  }

  console.log('=== spawn object у respawn и "take from respawn"');
  {
    const w = newWorld(db, 2);
    const respawn = byName(w, 'respawn');
    ok(!!respawn && respawn.kind === 'obstacle', 'объект respawn есть на поле (level2)');
    runA(w, 'spawn object', 'seed_carrot');
    const item = w.objects.find((o) => o.name === 'seed_carrot' && o.fromRespawn);
    ok(!!item, 'spawn object кладёт предмет у respawn');
    w.hero.x = item.x; w.hero.y = item.y + 40;
    w.click(item.x, item.y, false);
    stepUntil(w, () => !w.objects.includes(item), 200);
    ok((w.counters.take_seed_carrot || 0) === 1, 'подбор предмета даёт счётчик take_<имя>');
    ok((w.counters.take_from_respawn || 0) === 1, 'подбор предмета из respawn даёт take_from_respawn');
  }

  console.log('=== погода/растения: set plant thirst / health / growth, water all');
  {
    const w = newWorld(db, 2);
    const plant = w.spawn('plant_carrot', 9, 9);
    w.cell(9, 9).plant = plant;
    plant.health = 100;
    const before = plant.dry;
    w.update(1);
    ok(plant.dry === before, 'в level2 plant_thirst_growth 0 — растения не сохнут');
    runA(w, 'set plant thirst', '15');
    ok(w.level.props.plant_thirst_growth === 15, 'set plant thirst меняет plant_thirst_growth уровня');
    const d0 = plant.dry;
    w.update(1);
    ok(plant.dry > d0, 'после set plant thirst растения сохнут');
    runA(w, 'set plant thirst', '0');
    runA(w, 'water all', '0');
    ok(plant.dry === 0 && !plant.thirsty, 'water all поливает все растения');
    runA(w, 'set plant health', '15');
    ok(plant.health === 15, 'set plant health делает живые растения больными', plant.health);
    ok(w.level.props.plant_starting_health === 15, 'set plant health меняет plant_starting_health уровня');
    runA(w, 'set fruit growth', '50');
    ok(w.level.props.plant_fruit_growth === 50, 'set fruit growth меняет plant_fruit_growth');
  }

  console.log('=== kill all people');
  {
    const w = newWorld(db, 3);
    const people = w.objects.filter((o) => o.kind === 'worker' && ['guard', 'manager', 'looser'].includes(o.name));
    ok(people.length >= 2, 'на level3 есть сценарные люди', people.length);
    runA(w, 'kill all people', '');
    ok(!w.objects.some((o) => o.kind === 'worker' && ['guard', 'manager', 'looser'].includes(o.name)), 'kill all people убирает guard/manager/looser');
    ok(w.hero && Number.isFinite(w.hero.x), 'героиня осталась на месте');
  }

  console.log('=== события и отложенные действия (delay в мс)');
  {
    const rec = { dialogues: [] };
    const w = newWorld(db, 1, rec);
    stepUntil(w, () => w.time > 1.2, 20);
    ok(rec.dialogues.includes('l1_dig_first_by_scenario_dialog'), 'add dialogue уходит в hooks.showDialogue', rec.dialogues);
    ok(w.pendingActions.length === 0, 'действие с delay 1000 выполняется через секунду (delay — мс)');
    // "add event from pattern"
    const w3 = newWorld(db, 3);
    const before = w3.events.length;
    runA(w3, 'add event from pattern', 'l3_switch_wanted');
    ok(w3.events.length === before + 1, 'add event from pattern создаёт событие из @pattern');
    ok(w3.dynamicEvents.includes('l3_switch_wanted'), 'динамическое событие запомнено для сейва');
    // перезапуск шаблона создаёт ещё одно событие
    runA(w3, 'add event from pattern', 'l3_switch_wanted');
    ok(w3.events.length === before + 2, 'шаблон можно запускать повторно');
  }

  console.log('=== счётчики сценариев части 2');
  {
    const w = newWorld(db, 2);
    const plant = w.spawn('plant_carrot', 9, 9);
    w.cell(9, 9).plant = plant;
    runA(w, 'set plant health', '15');
    w.hero.held = { kind: 'fertilizer', def: db.objects.get('fertilizer'), name: 'fertilizer', charges: 6 };
    runA(w, 'allow action', 'fertilize 1');
    w.hero.x = plant.x; w.hero.y = plant.y + 40;
    w.click(plant.x, plant.y, false);
    stepUntil(w, () => plant.fertTicks > 0, 200);
    ok((w.counters.plants_fertilized || 0) === 1, 'удобрение даёт счётчик plants_fertilized');
    plant.fruits = 1; plant.ready = true;
    w.hero.held = { kind: 'box', def: db.objects.get('box'), name: 'box', count: 0 };
    runA(w, 'allow action', 'harvest 1');
    w.click(plant.x, plant.y, false);
    stepUntil(w, () => w.heroIdle(), 200);
    ok((w.counters.harvest_plant_carrot || 0) === 1, 'сбор даёт счётчик harvest_<имя растения>');
  }

  console.log('=== сериализация нового состояния');
  {
    const w = newWorld(db, 1);
    runA(w, 'allow action', 'dig 0');
    w.dugCount = 2;
    w.money = 77;
    stepUntil(w, () => w.time > 1.2, 20);
    const data = w.serialize();
    const w2 = newWorld(db, 1);
    w2.restore(data);
    ok(w2.allowed.dig === false && w2.allowed.plant === false, 'allowed восстанавливается из сейва');
    ok(w2.dugCount === 2 && w2.money === 77, 'базовые поля на месте');
    ok(w2.firedEvents.has('l1_dig_first_by_scenario') === w.firedEvents.has('l1_dig_first_by_scenario'),
      'флаги событий восстанавливаются');
    ok(w2.actions.every((a, i) => a.fired === w.actions[i].fired), 'состояния действий совпадают');
    const weed = w2.objects.find((o) => o.name === 'plant_bur');
    ok(!!weed, 'растения из add bed восстанавливаются');
    const w3 = newWorld(db, 3);
    runA(w3, 'add event from pattern', 'l3_switch_wanted');
    const d3 = w3.serialize();
    const w4 = newWorld(db, 3);
    w4.restore(d3);
    ok(w4.dynamicEvents.includes('l3_switch_wanted') && w4.events.length === w3.events.length,
      'динамические события из @pattern восстанавливаются');
  }

  console.log('=== дома/ангары части 2: @accept_goods_list, @accept_feed_list, time_complete_N');
  {
    const w = newWorld(db, 2);
    const hangar = byName(w, 'hangar_vegetables');
    ok(w.hangarTakes(hangar, 'tomato') && w.hangarTakes(hangar, 'tree_apple'),
      'hangar_vegetables принимает plant_tomato и tree_apple (@accept_goods_list)');
    ok(!w.hangarTakes(hangar, 'milk') && !w.hangarTakes(hangar, 'honey'),
      'овощной ангар не принимает молоко/мёд');
    const fridge = w.objects.find((o) => o.name === 'hangar_refrigerator');
    if (fridge) ok(w.hangarTakes(fridge, 'house_beehive'), 'hangar_refrigerator принимает мёд (@accept_goods_list)');
    const sheep = byName(w, 'house_sheep');
    ok(w.feedAccepts(sheep, 'carrot') && w.feedAccepts(sheep, 'cabbage'), 'house_sheep ест carrot/cabbage (@accept_feed_list)');
    ok(!w.feedAccepts(sheep, 'corn'), 'house_sheep не ест corn');
    // производство: upgrade 0 — дом не работает; после set upgrade 1 — время time_complete_1
    sheep.upgrade = 0; sheep.feed = 0;
    const p = sheep.def.props;
    w.update(p.time_feed + 1); // корм кончился задолго до теста
    ok(sheep.ready === 0 && sheep.progress === 0, 'неотремонтированный дом (upgrade 0) не производит');
    runA(w, 'set upgrade', 'house_sheep 0 1');
    sheep.feed = p.time_feed || 60;
    const t0 = w.time;
    stepUntil(w, () => sheep.ready > 0, Math.ceil((p.time_complete_1 || 150) + 10) * 4);
    ok(sheep.ready > 0, 'после ремонта дом производит по time_complete_1', sheep.ready);
  }

  console.log('=== покупка инструментов из магазина (constructor/bulldozer — услуги, вид «в руке»)');
  {
    const w = newWorld(db, 2);
    w.money = 500;
    w.buy('constructor');
    ok(w.hero.held && w.hero.held.kind === 'constructor', 'constructor берётся в руки как инструмент', w.hero.held && w.hero.held.kind);
    w.hero.held = { kind: 'spade' };
    w.buy('bulldozer');
    ok(w.hero.held && w.hero.held.kind === 'bulldozer', 'bulldozer берётся в руки как инструмент', w.hero.held && w.hero.held.kind);
    w.hero.held = { kind: 'spade' };
    w.buy('destructor');
    ok(w.hero.held && w.hero.held.kind === 'destructor', 'destructor берётся в руки как инструмент');
  }

  console.log('=== 24 уровня: старт и 120 с симуляции без ошибок');
  for (let n = 1; n <= 24; n++) {
    let err = null;
    try {
      const w = newWorld(db, n);
      for (let i = 0; i < 240 && !w.over; i++) w.update(0.5);
      const bad = w.objects.filter((o) => !Number.isFinite(o.x) || !Number.isFinite(o.y));
      if (bad.length) err = 'NaN: ' + bad.map((o) => o.name).join(',');
    } catch (e) {
      err = String(e && e.stack || e).split('\n').slice(0, 2).join(' | ');
    }
    ok(!err, `уровень ${n}: сценарий и симуляция без ошибок`, err);
  }

  console.log(`\nитог: ${passed} ok, ${failed} FAIL`);
  if (failed) {
    console.error('провалено: ' + failures.join('; '));
    process.exit(1);
  }
}

main().catch((err) => { console.error(String(err && err.stack || err)); process.exit(2); });
