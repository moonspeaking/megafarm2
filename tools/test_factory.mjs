#!/usr/bin/env node
// Тест фабрик части 2 (заправка, переработка, сейв). Запуск: node tools/test_factory.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../src/assets.js';
import { loadData } from '../src/data.js';
import { World } from '../src/sim.js';
import { feedFactory, feedList, phaseOf } from '../src/sim_factory.js';

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



const hooks = { showMessage() {}, notify(t) { notes.push(t); }, showEnd() {}, updateHud() {}, updateShop() {}, updateTasks() {}, playSound() {}, stopSound() {}, showHelp() {}, showDialogue() {}, centerView() {}, openShopTab() {} };
const notes = [];
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

const manifest = await loadManifest();
const db = await loadData(manifest);
const w = new World(db, stubAssets, 11, hooks);
w.start();
const f = w.objects.find((o) => o.name === 'factory_sausage');
ok(f && f.kind === 'factory', 'уровень 11: сосисочная фабрика есть, kind=factory');
const clothes = w.objects.find((o) => o.name === 'factory_clothes');
ok(clothes && phaseOf(clothes) === 0, 'текстильная стоит в фазе 0 (add to field ... 0)');
ok(phaseOf(f) === 3, 'сосисочная в фазе 3 (ждёт топлива)');
const feeds = feedList(f);
ok(feeds.length === 3, `три вида сырья: ${feeds.join(', ')}`);
const box = (name) => ({ kind: 'box', def: db.objects.get('box'), name: 'box', count: 4, type: name.replace(/^(plant|house|tree)_/, '') });
ok(feedFactory(w, f, box('nothing')) === 'notify_hangar_not_accept', 'чужой товар не принимается');
ok(feedFactory(w, f, box(feeds[0])) === null && Math.abs(f.fuel[0] - 100 / 3) < 1e-6, 'один ящик = 100/max_resource (33.3) шкалы');
ok(phaseOf(f) === 3, 'одного вида мало — фаза остаётся 3');
feedFactory(w, f, box(feeds[1])); feedFactory(w, f, box(feeds[2]));
ok(phaseOf(f) === 4 && w.counters.refuel_factory_sausage === 1, 'все три вида → фаза 4, событие refuel_factory_sausage');
ok(feedFactory(w, clothes, box(feedList(clothes)[0])) === null && phaseOf(clothes) === 0, 'сломанная фабрика принимает топливо, фаза не растёт');
const money0 = w.money;
for (let i = 0; i < 301; i++) w.update(0.1); // 30 с (+ шаг на накопление float)
ok((w.counters.sell_factory_sausage || 0) === 30 && w.money - money0 === 30 * 60, `за 30 с: 30 продаж × profit 60 — sell=${w.counters.sell_factory_sausage}, +${w.money - money0}`);
for (let i = 0; i < 400; i++) w.update(0.1); // всего хватает на 60 с (шкала 33.3 при расходе 0.555/с): ждём падения фазы
ok(phaseOf(f) === 3, 'топливо кончилось — фаза упала до 3');
const sold = w.counters.sell_factory_sausage;
for (let i = 0; i < 100; i++) w.update(0.1);
ok(w.counters.sell_factory_sausage === sold, 'без топлива продаж нет');
w.runAction({ type: 'upgrade factory', data: 'factory_sausage -1' });
ok(phaseOf(f) === 3, 'upgrade factory … -1 игнорируется');
w.runAction({ type: 'upgrade factory', data: 'factory_sausage 0' });
ok(phaseOf(f) === 0, 'upgrade factory … 0 — фаза 0');
feedFactory(w, f, box(feeds[0])); feedFactory(w, f, box(feeds[1])); feedFactory(w, f, box(feeds[2]));
w.runAction({ type: 'upgrade factory', data: 'factory_sausage 3' });
ok(phaseOf(f) === 4, 'фаза 3 при полном топливе сразу становится 4');
const w3 = new World(db, stubAssets, 11, hooks); w3.restore(JSON.parse(JSON.stringify(w.serialize())));
const f3 = w3.objects.find((o) => o.name === 'factory_sausage');
ok(f3 && phaseOf(f3) === 4 && f3.fuel && f3.fuel.length === 3, 'сохранение хранит фазу и шкалы');
console.log(fails ? `итог: ${fails} FAIL` : 'итог: фабрики ок');
process.exit(fails ? 1 : 0);
