#!/usr/bin/env node
// Тест времени и счётчиков сценария части 2 (game time/time в мс, счётчики события относительные). Запуск: node tools/test_scenario.mjs
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



const hooks = new Proxy({}, { get: () => () => {} });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const db = await loadData(await loadManifest());

// "game time" — миллисекунды от старта уровня (порог из скрипта в мс), "time" — мс с создания события
const w = new World(db, stubAssets, 18, hooks); w.start();
ok(Math.abs(w.counter('game_time') - 0) < 1, 'game time стартует с 0');
for (let i = 0; i < 20; i++) w.update(0.5);
ok(Math.abs(w.counter('game_time') - 10000) < 1, `game time = 10000 мс через 10 с (${w.counter('game_time')})`);
const before = w.events.length;
const overloads = []; const orig = w.runAction.bind(w);
w.runAction = (a) => { if (a.type === 'overload generator') overloads.push(w.time); return orig(a); };
// l18: первая поломка по "time >=360000" (мс с создания события), затем шаблон l18_ahtung повторяется каждые 180 с
for (let i = 0; i < 2 * 345; i++) w.update(0.5);
ok(overloads.length === 0, 'до 360 с поломок нет');
for (let i = 0; i < 2 * 20; i++) w.update(0.5);
ok(overloads.length >= 1 && overloads[0] >= 359 && overloads[0] <= 362, `первая поломка на 360-й секунде (${overloads[0]})`);
for (let i = 0; i < 2 * 180; i++) w.update(0.5);
ok(overloads.length >= 2 && Math.abs(overloads[1] - overloads[0] - 180) < 2, `шаблон повторяется каждые 180 с (${overloads.map((t) => t.toFixed(0)).join(', ')})`);
ok(w.events.length < before + 10, `события не множатся рекурсивно (${before} → ${w.events.length})`);

// счётчики события считают только после его включения
const w2 = new World(db, stubAssets, 1, hooks); w2.start();
w2.dugCount = 3; for (let i = 0; i < 4; i++) w2.update(0.5);
const ev = w2.events.find((e) => e.conds.some((c) => c.type === 'dig bed'));
ok(ev && ev.base && ev.base.dig_bed === 0, 'базовый снимок счётчиков взят при включении события');
console.log(fails ? `итог: ${fails} FAIL` : 'итог: сценарий ок');
process.exit(fails ? 1 : 0);
