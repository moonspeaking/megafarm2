#!/usr/bin/env node
// Тест дождя и молнии части 2 (sim_rain.js). Запуск: node tools/test_rain.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../src/assets.js';
import { loadData } from '../src/data.js';
import { World } from '../src/sim.js';
import { rainParams } from '../src/sim_rain.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
globalThis.fetch = async (url) => {
  const rel = String(url).replace(/[?#].*$/, '').replace(/^https?:\/\/[^/]+/, '');
  try {
    const text = await fs.readFile(rel.startsWith('/') ? rel : path.join(ROOT, rel), 'utf8');
    return { ok: true, text: async () => text, json: async () => JSON.parse(text) };
  } catch { return { ok: false, text: async () => '', json: async () => { throw new Error('nf'); } }; }
};
const stub = { resolve: () => null, load: () => null, image: () => null, sound: () => null, missing: new Set() };
const sounds = [], rainS = [];
const hooks = new Proxy({ playSound: (n) => sounds.push(n), rainSound: (s) => rainS.push(s) }, { get: (t, k) => (k in t ? t[k] : () => {}) });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const near = (a, b, e = 0.5) => Math.abs(a - b) <= e;

const db = await loadData(await loadManifest());
const heavy = rainParams(db, 'heavyrain'), monsoon = rainParams(db, 'monsoon_rain'), mush = rainParams(db, 'mushroomrain'), unk = rainParams(db, 'нет_такого');
ok(heavy.endSunAngle === 7 && heavy.timeMax === 120000 && heavy.rainbow === false, 'heavyrain: end_sun_angle 7, 120 с, без радуги');
ok(monsoon.lightningPeriod === 3000 && monsoon.timeBegin === 5000, 'monsoon_rain: молнии раз в 3000 мс, начало 5 с');
ok(mush.lightning === false && mush.strengthMax === 40, 'mushroomrain: без молний, сила до 40');
ok(unk.strengthMax === 100 && unk.timeBegin === 10000 && unk.lightningPeriod === 9000 && unk.endSunAngle === 90, 'умолчания оригинала');

const w = new World(db, stub, 21, hooks);
w.start();
w.rng = () => 0.9; // серия из 3 вспышек
w.runAction({ type: 'start rain', data: 'monsoon_rain' });
w.update(0.1);
ok(w.rain && w.rain.phase === 0 && near(w.sun.target, 90 - 100 * 0.83, 0.01), `старт: солнце темнеет к ${w.sun.target.toFixed(1)}°`);
for (let i = 0; i < 25; i++) w.update(0.1);   // 2.6 с из 5 с разгона
ok(w.rain.strength > 40 && w.rain.strength < 60, `сила растёт (${w.rain.strength.toFixed(0)})`);
for (let i = 0; i < 40; i++) w.update(0.1);   // → пик
ok(w.rain.phase === 1 && w.rain.strength === 100, 'пик: сила 100');
for (let i = 0; i < 60; i++) w.update(0.1);   // 6 с пика → молнии
ok(sounds.includes('lightning') || sounds.includes('thunder1'), 'прогремела молния');
ok(w.counters.lightning_strike >= 1, `серия молний завершена: lightning_strike = ${w.counters.lightning_strike}`);
for (let i = 0; i < 400; i++) w.update(0.1);
ok(w.rain === null && w.counters.end_rain === 1, 'дождь закончился: счётчик end_rain');
ok(rainS[rainS.length - 1] === 0, 'звук дождя выключен');
ok(near(w.sun.target, 90), 'солнце вернулось к end_sun_angle (90)');
console.log(fails ? `итог: ${fails} FAIL` : 'итог: дождь ок');
process.exit(fails ? 1 : 0);
