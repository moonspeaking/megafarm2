#!/usr/bin/env node
// Тест охраны части 2 (патруль, арест, reset guards). Запуск: node tools/test_people.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../src/assets.js';
import { loadData } from '../src/data.js';
import { World } from '../src/sim.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Скрипты грузятся через fetch от корня сервера; подменяем его чтением с диска.
globalThis.fetch = async (url) => {
  const rel = String(url).replace(/[?#].*$/, '').replace(/^https?:\/\/[^/]+/, '');
  let abs = path.join(ROOT, rel);
  if (rel.startsWith('/')) abs = rel;
  try {
    const text = await fs.readFile(abs, 'utf8');
    return { ok: true, text: async () => text, json: async () => JSON.parse(text) };
  } catch {
    return { ok: false, text: async () => '', json: async () => { throw new Error('not found: ' + rel); } };
  }
};

// Заглушка Assets: sim.js сам ни к какой графике не обращается.
const stubAssets = { resolve: () => null, load: () => null, image: () => null, sound: () => null, missing: new Set() };



const hooks = { showMessage() {}, notify() {}, showEnd() {}, updateHud() {}, updateShop() {}, updateTasks() {}, playSound() {}, stopSound() {}, showHelp() {}, showDialogue() {}, centerView() {}, openShopTab() {} };
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

const manifest = await loadManifest();
const db = await loadData(manifest);
const w = new World(db, stubAssets, 3, hooks);
w.start();
const guards = w.objects.filter((o) => o.name === 'guard');
ok(guards.length >= 4, `уровень 3: охранников ${guards.length}`);
w.hero.x = 99999; w.hero.y = 99999;
for (let i = 0; i < 1200; i++) w.update(0.1);      // 120 с: после 100 с игры появляются путевые точки
const oleg = guards.find((o) => o.tag === 'oleg');
ok(oleg.route && oleg.route.length > 3, `маршрут oleg задан (${oleg.route && oleg.route.length} точек)`);
ok(oleg.home && Math.abs(oleg.home.x - (8 * 64 + 32)) < 1, 'дом = первая путевая точка (8, 23)');
const x0 = oleg.x, y0 = oleg.y;
for (let i = 0; i < 300; i++) w.update(0.1);
ok(Math.hypot(oleg.x - x0, oleg.y - y0) > 20, 'охранник oleg ходит по маршруту');
ok(!w.counters.arrested, 'героиня далеко — ареста нет');
// погоня: героиня в радиусе 450 (с удвоенным dy), но дальше 90
w.hero.x = oleg.x + 300; w.hero.y = oleg.y;
const dBefore = Math.hypot(oleg.x - w.hero.x, 2 * (oleg.y - w.hero.y));
for (let i = 0; i < 10; i++) w.update(0.1);
ok(Math.hypot(oleg.x - w.hero.x, 2 * (oleg.y - w.hero.y)) < dBefore, 'охранник преследует героиню в радиусе 450');
ok(!w.counters.arrested, 'пока не дошёл — ареста нет');
w.hero.x = oleg.x + 40; w.hero.y = oleg.y;
w.update(0.1);
ok(w.counters.arrested === 1, 'героиня ближе 90 — арест (счётчик arrested)');
for (let i = 0; i < 20; i++) w.update(0.1);
ok(w.counters.arrested === 1, 'арест не повторяется, охранник замер');
const xs = oleg.x;
for (let i = 0; i < 20; i++) w.update(0.1);
ok(oleg.x === xs, 'пойманный охранник стоит до reset guards');
w.runAction({ type: 'reset guards', data: '' });
ok(!oleg.caught && Math.abs(oleg.x - oleg.home.x) < 1, 'reset guards: охранник дома, арест снят');
w.hero.x = 99999; w.hero.y = 99999;
w.runAction({ type: 'disable guards', data: '' });
w.hero.x = oleg.x + 40; w.hero.y = oleg.y;
w.update(0.1);
ok(w.counters.arrested === 1, 'disable guards: охрана не замечает героиню');
const snap = JSON.parse(JSON.stringify(w.serialize()));
const w2 = new World(db, stubAssets, 3, hooks); w2.restore(snap);
const o2 = w2.objects.find((o) => o.name === 'guard' && o.tag === 'oleg');
ok(o2 && o2.route && o2.route.length === oleg.route.length && o2.disabled, 'сохранение хранит маршрут и disabled');
// кража: ящик огурцов отдан машине (sub_10046948) → счётчик steal_plant_cucumber
const truck = w.objects.find((o) => o.name === 'truck');
ok(truck && truck.kind === 'truck', 'машина (truck) есть в уровне 3');
w.hero.held = { kind: 'box', def: db.objects.get('box'), name: 'box', count: 4, type: 'cucumber' };
w.hero.x = truck.x - 250; w.hero.y = truck.y + 150; w.hero.task = null; w.hero.path = [];
w.runAction({ type: 'disable guards', data: '' });
w.click(truck.x, truck.y - 20, false);
for (let i = 0; i < 600 && !w.counters.steal_plant_cucumber; i++) w.update(0.1);
ok(w.counters.steal_plant_cucumber === 1 && w.hero.held.kind === 'spade', 'ящик отдан машине: steal_plant_cucumber, руки пусты');
// менеджер платит ждущему работнику (CManagerAI)
const w4 = new World(db, stubAssets, 7, hooks); w4.start();
w4.money = 1000;
const worker = w4.spawnWorker('harvester', 10, 10);
w4.spawnWorker('manager', 12, 10);
ok(worker.state === 'idle', 'нанятый работник ждёт оплаты');
for (let i = 0; i < 100; i++) w4.update(0.1);
ok(worker.state === 'work' && w4.money < 1000, 'менеджер заплатил работнику сам');
// светлячок (CLightbugAI): летает по кривой около дома, после подъёма предмета под домом — следует за героиней
const w5 = new World(db, stubAssets, 20, hooks); w5.start();
const bug = w5.objects.find((o) => o.name === 'lightbug');
ok(!!bug, 'уровень 20: светлячок есть');
w5.hero.x = 99999; w5.hero.y = 99999;
const home0 = { x: bug.x, y: bug.y };
let far = 0;
for (let i = 0; i < 300; i++) { w5.update(0.1); far = Math.max(far, Math.hypot(bug.x - bug.home.x, bug.y - bug.home.y)); }
ok(far < 140 && far > 5, `светлячок порхает у дома (макс. отклонение ${far.toFixed(0)} px)`);
const item = { kind: 'item', name: 'map_piece', x: bug.home.x, y: bug.home.y, size: [64, 64] };
bug.nearPiece = true;
w5.hero.x = bug.home.x + 600; w5.hero.y = bug.home.y + 400;
import('../src/sim_people.js').then(async (m) => {
  m.lightbugsFollow(w5, item);
  ok(bug.follow === true, 'предмет под домом поднят: светлячок следует');
  for (let i = 0; i < 1500; i++) w5.update(0.1);
  console.log(JSON.stringify({x:bug.x,y:bug.y,home:bug.home,t:bug.lb.t,path:bug.path,f:bug.follow,hero:[w5.hero.x,w5.hero.y]}));
  const dh = Math.hypot(bug.x - w5.hero.x, bug.y - w5.hero.y);
  ok(dh < 400, `светлячок догнал героиню (${dh.toFixed(0)} px)`);
  console.log(fails ? `итог: ${fails} FAIL` : 'итог: охрана ок');
  process.exit(fails ? 1 : 0);
});
