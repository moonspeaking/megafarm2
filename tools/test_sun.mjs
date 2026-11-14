#!/usr/bin/env node
// Тест солнца, lightmap-яркости и электричества части 2 (sim_sun.js). Запуск: node tools/test_sun.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../src/assets.js';
import { loadData } from '../src/data.js';
import { World } from '../src/sim.js';
import { ambient, powerRatio, isWorkable, litLamps } from '../src/sim_sun.js';

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
const near = (a, b) => Math.abs(a - b) < 1e-3;

const manifest = await loadManifest();
const db = await loadData(manifest);
const w = new World(db, stubAssets, 13, hooks);   // уровень 13: фонари и генераторы, sunset_angle
w.start();
ok(w.sunsetAngle === 15 || w.sunsetAngle === 20, `sunset_angle уровня прочитан (${w.sunsetAngle})`);
w.runAction({ type: 'set sun', data: '90 1' });
ok(near(ambient(w), 1), 'день: яркость 1 (угол 90)');
w.runAction({ type: 'start night', data: '1' });
ok(near(w.sun.angle, 15) && near(ambient(w), 15 / 90), 'ночь: угол 15, яркость угол/90');
ok(w.sun.color[0] === 0.75 && w.sun.color[2] === 1, 'ночной цвет (0.75, 0.8, 1)');
w.runAction({ type: 'start morning', data: '1000' });
for (let i = 0; i < 5; i++) w.update(0.1);
ok(w.sun.angle > 15 && w.sun.angle < 45, 'плавный переход угла за время фазы');
for (let i = 0; i < 12; i++) w.update(0.1);
ok(near(w.sun.angle, 45) && near(w.sun.color[0], 0.82), 'фаза morning достигнута: 45°, (0.82,0.92,1)');

// электричество
const gen = w.objects.find((o) => o.kind === 'generator');
const lamp = (x, y) => w.spawn('streetlamp', x, y);
const l1 = lamp(5, 5), l2 = lamp(6, 5), l3 = lamp(7, 5), l4 = lamp(8, 5);
const nGen = w.objects.filter((o) => o.kind === 'generator' && !o.broken).length;
ok(nGen >= 1 && powerRatio(w) > 0 && powerRatio(w) <= 1, `питание: исправных генераторов ${nGen}, доля ${powerRatio(w).toFixed(2)} (≤ 1)`);
for (const o of w.objects) if (o.kind === 'generator') o.broken = true;
ok(powerRatio(w) === 0 && litLamps(w).length === 0, 'все генераторы сломаны: доля 0, фонари не светят');
w.runAction({ type: 'fix generator', data: '' });
ok(powerRatio(w) > 0, 'fix generator возвращает питание');
// ночь: работа только в освещённой зоне при доле ≥ 0.4
w.runAction({ type: 'set sun', data: '10 1' });
const inside = { x: l1.x + 100, y: l1.y + 20 }, outside = { x: l1.x + 2000, y: l1.y };
ok(isWorkable(w, inside) && !isWorkable(w, outside), 'ночью работают только рядом с горящим фонарём');
w.runAction({ type: 'set sun', data: '90 1' });
ok(isWorkable(w, outside), 'днём работают везде');
console.log(fails ? `итог: ${fails} FAIL` : 'итог: свет ок');
process.exit(fails ? 1 : 0);
