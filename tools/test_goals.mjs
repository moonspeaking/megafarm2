#!/usr/bin/env node
// Тест строк целей на доске заданий (часть 2: события player_task). Запуск: node tools/test_goals.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../src/assets.js';
import { loadData } from '../src/data.js';
import { World } from '../src/sim.js';
import { taskGoalLines, counterOf } from '../src/goals.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
globalThis.fetch = async (url) => {
  const rel = String(url).replace(/[?#].*$/, '').replace(/^https?:\/\/[^/]+/, '');
  try {
    const text = await fs.readFile(rel.startsWith('/') ? rel : path.join(ROOT, rel), 'utf8');
    return { ok: true, text: async () => text, json: async () => JSON.parse(text) };
  } catch { return { ok: false, text: async () => '', json: async () => { throw new Error('nf'); } }; }
};
const stub = { resolve: () => null, load: () => null, image: () => null, sound: () => null, missing: new Set() };
const hooks = new Proxy({}, { get: () => () => {} });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

const db = await loadData(await loadManifest());
ok(counterOf('dig bed') === 'dig_bed', 'counterOf: "dig bed" -> dig_bed');
ok(taskGoalLines(null).length === 0, 'нет мира — пусто');

const w = new World(db, stub, 1, hooks);
w.start();
for (let i = 0; i < 5; i++) w.update(0.5);
let lines = taskGoalLines(w);
ok(lines.length === 1 && lines[0].cur === 0 && lines[0].target === 4, `уровень 1: цель 0/4 — ${JSON.stringify(lines)}`);
ok(/Вскопать/.test(lines[0] && lines[0].text), 'подпись «Вскопать грядок» из пака');
w.dugCount = 2; w.update(0.5);
lines = taskGoalLines(w);
ok(lines[0] && lines[0].cur === 2, 'прогресс 2/4');
w.dugCount = 4; w.update(0.5);
ok(!taskGoalLines(w).some((l) => /Вскопать/.test(l.text)), 'выполненное задание уходит с доски');
console.log(fails ? `итог: ${fails} FAIL` : 'итог: цели ок');
process.exit(fails ? 1 : 0);
