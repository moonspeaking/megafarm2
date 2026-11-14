#!/usr/bin/env node
// Тесты правил симуляции по скриптам уровня 1 части 2 (сценарий: копать → сеять → полоть → продавать).
// World без UI: data.js и sim.js не зависят от DOM, fetch подменяется чтением файлов.
// Ожидания выведены из docs/original-notes.md и скриптов assets/scripts
// (level1.txt, level1_entry.txt).
// Запуск: node tools/test_sim_rules.mjs (код возврата != 0 при ошибках).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../src/assets.js';
import { loadData } from '../src/data.js';
import { World, TILE } from '../src/sim.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LEVEL = 1;

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

let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const dialogs = [];
const hooks = new Proxy({ showDialogue: (n) => dialogs.push(n), notify() {}, showMessage() {} }, {
  get: (t, k) => (k in t ? t[k] : () => {}),
});

const manifest = await loadManifest();
const db = await loadData(manifest);
const w = new World(db, stubAssets, LEVEL, hooks);
w.start();
for (let i = 0; i < 5; i++) w.update(0.5);

console.log('=== (а) сценарий уровня 1');
ok(w.levelTime === 600, `level_time из скрипта = 600 — ${w.levelTime}`);
ok(w.money === 20, `стартовые деньги: set money 20 — ${w.money}`);
ok(w.objects.some((o) => o.name === 'hangar_vegetables'), 'ангар стоит на поле (level1_entry)');
ok(w.objects.some((o) => o.name === 'waterpump'), 'колонка стоит на поле');
ok(dialogs.includes('l1_dig_first_by_scenario_dialog'), 'первый диалог (копать) показан по сценарию');
ok(w.allowed.dig === true && w.allowed.plant === false, 'копать можно, сеять нельзя (cant_plant)');

console.log('=== (б) вскопка');
const stand = (cx, cy) => { w.hero.x = cx * TILE + TILE / 2; w.hero.y = cy * TILE + TILE / 2; };
const free = [];
for (let y = 6; y < 12 && free.length < 4; y++) for (let x = 12; x < 18 && free.length < 4; x++) {
  const c = w.cell(x, y); if (c && !c.blocked && !c.occupant && !c.plant && !c.dug) free.push(c);
}
ok(free.length === 4, 'нашлось 4 свободные клетки для грядок');
for (const c of free) {
  w.hero.task = null; w.hero.path = [];
  stand(c.x, c.y + 1);
  w.click(c.x * TILE + TILE / 2, c.y * TILE + TILE / 2, true);
  for (let i = 0; i < 80 && !c.dug; i++) w.update(0.1);
}
ok(w.dugCount === 4, `4 грядки вскопаны (dugCount=${w.dugCount})`);
ok(free.every((c) => c.dug && c.wet > 0), 'свежевскопанные грядки мокрые');
for (let i = 0; i < 5; i++) w.update(0.5);
ok(w.allowed.plant === true, 'после 4 грядок разрешён посев (allow action plant 1)');
ok(w.allowed.dig === false, 'после 4 грядок копать больше нельзя (allow action dig 0)');
ok(dialogs.includes('l1_sow_by_scenario_dialog'), 'диалог про посев показан');

console.log(fails ? `итог: ${fails} FAIL` : 'итог: правила уровня 1 ок');
process.exit(fails ? 1 : 0);
