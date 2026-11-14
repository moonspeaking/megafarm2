// Дождь и молния части 2 (CRain, IDA: update sub_1002C62C, молния sub_1002C276, радуга sub_1002C504, загрузчик свойств sub_1002CB1D,
// умолчания — конструктор sub_1002CDD4). Описания дождей — @rain в guihost_scripts.txt (heavyrain, monsoon_rain, testrain, mushroomrain).
//  * умолчания: rain_strength_begin 0, _max 100, _end 0; rain_time_begin/max/end 10000 мс; lightning вкл., lightning_strength_max 9000
//    (= период серий молний, мс); rainbow вкл., rainbow_time 10000; end_sun_angle 90;
//  * фаза −1 (старт): солнце темнеет к 90 − strength_max·0.83 за time_begin; фаза 0: сила растёт begin→max за time_begin;
//    фаза 1: сила = max, молнии; по истечении time_begin+time_max — солнце к end_sun_angle за time_end, фаза 2: сила падает max→end
//    за time_end, радуга; затем счётчик "end rain" и дождь исчезает;
//  * молнии (только в фазе 1): раз в lightning_strength_max мс серия из rand(4) вспышек; вспышка (каждые 700 мс) — угол солнца = 75,
//    затухает 0.2°/мс к текущей цели, гром (thunder1/lightning.ogg), 1–3 молнии на 250 мс; конец непустой серии — счётчик "lightning strike";
//  * радуга (фаза 2, #bool rainbow): прозрачность cos((t − tb − tm)/rainbow_time·π − π/2)·112/255;
//  * звук дождя: rainlight/rainmiddle/rainheavy смешиваются по силе (пики при 33/66/99, громкость 100 − |сила − пик|·3, %).

import { setSun } from './sim_sun.js';

const DEFAULTS = {
  rain: true, strengthBegin: 0, strengthMax: 100, strengthEnd: 0, timeBegin: 10000, timeMax: 10000, timeEnd: 10000,
  lightning: true, lightningPeriod: 9000, rainbow: true, rainbowTime: 10000, endSunAngle: 90,
};

/** Параметры дождя из @rain (db.gui) с умолчаниями оригинала. */
export function rainParams(db, name) {
  const p = db.gui && db.gui.get(name) ? db.gui.get(name).props : {};
  const num = (v, d) => (typeof v === 'number' ? v : d);
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  return {
    rain: bool(p.rain, DEFAULTS.rain),
    strengthBegin: num(p.rain_strength_begin, DEFAULTS.strengthBegin),
    strengthMax: num(p.rain_strength_max, DEFAULTS.strengthMax),
    strengthEnd: num(p.rain_strength_end, DEFAULTS.strengthEnd),
    timeBegin: num(p.rain_time_begin, DEFAULTS.timeBegin),
    timeMax: num(p.rain_time_max, DEFAULTS.timeMax),
    timeEnd: num(p.rain_time_end, DEFAULTS.timeEnd),
    lightning: bool(p.lightning, DEFAULTS.lightning),
    lightningPeriod: num(p.lightning_strength_max, DEFAULTS.lightningPeriod),
    rainbow: bool(p.rainbow, DEFAULTS.rainbow),
    rainbowTime: num(p.rainbow_time, DEFAULTS.rainbowTime),
    endSunAngle: num(p.end_sun_angle, DEFAULTS.endSunAngle),
  };
}

/** "start rain <имя>" (sub_1001B41C: sub_100666FB создаёт объект CRain по имени; незнакомое имя — умолчания). */
export function startRain(w, name) {
  const p = rainParams(w.db, name);
  w.rain = {
    name, p, t: 0, phase: -1, strength: 0, total: p.timeBegin + p.timeMax + p.timeEnd,
    lTimer: 0, lCount: 0, lFlash: 0, rainbow: p.rainbow, bolts: [], u: 0, v: 0, rainbowAlpha: 0,
  };
}

/** Один шаг дождя; dt — секунды. Возвращает nothing; состояние — w.rain. */
export function updateRain(w, dt) {
  const r = w.rain;
  if (!r || typeof r !== 'object') return;
  const ms = dt * 1000, p = r.p;
  r.t += ms;
  const sunTo = (angle, dur) => setSun(w, angle, dur);
  switch (r.phase) {
    case -1:
      sunTo(90 - p.strengthMax * 0.83, p.timeBegin);
      r.phase = 0;
      break;
    case 0:
      if (p.timeBegin < r.t) r.phase = 1;
      else r.strength = (p.strengthMax - p.strengthBegin) * (r.t / p.timeBegin) + p.strengthBegin;
      break;
    default: break;
  }
  if (r.phase === 1) {
    if (p.timeBegin + p.timeMax < r.t) {
      sunTo(p.endSunAngle, p.timeEnd);
      r.phase = 2;
    } else r.strength = p.strengthMax;
  }
  if (r.phase === 2) {
    if (r.total >= r.t) {
      r.strength = (1 - (r.t - p.timeBegin - p.timeMax) / p.timeEnd) * (p.strengthMax - p.strengthEnd) + p.strengthEnd;
      if (p.rainbow && r.rainbow) {
        r.rainbowAlpha = Math.max(0, Math.cos(((r.t - p.timeBegin - p.timeMax) / p.rainbowTime) * Math.PI - Math.PI / 2)) * 112 / 255;
      }
    } else {
      w.bump('end_rain');
      w.rain = null;
      if (w.hooks.rainSound) w.hooks.rainSound(0);
      return;
    }
    if (r.strength < 0) r.strength = 0;
  }
  // текстура дождя прокручивается тем быстрее, чем сильнее дождь (sub_1002C593)
  const s = r.strength * 0.01;
  r.u -= (0.002 * s + 0.0002) * ms;
  r.v += (s * 0.0015 + 0.00015) * ms;
  if (w.hooks.rainSound) w.hooks.rainSound(r.strength);
  updateLightning(w, r, ms);
  for (const b of r.bolts) b.life -= ms;
  r.bolts = r.bolts.filter((b) => b.life > 0);
}

function updateLightning(w, r, ms) {
  if (!r.p.lightning || r.phase !== 1) return;
  r.lTimer += ms;
  if (r.lTimer > 0) {
    r.lCount = Math.floor(w.rng ? w.rng() * 4 : Math.random() * 4);
    r.lTimer -= r.p.lightningPeriod;
  }
  r.lFlash += ms;
  if (r.lFlash > 500 && r.lCount > 0) {
    const s = w.sun;
    s.angle = 75; // вспышка: «солнце» вспыхивает и гаснет 0.2°/мс к цели
    s.speed = s.target < 75 ? -0.2 : 0.2;
    w.hooks.playSound(r.lCount === 3 ? 'thunder1' : 'lightning');
    const n = 1 + (Math.random() < 0.5 ? 1 : 0) + (Math.random() < 0.33 ? 1 : 0);
    for (let i = 0; i < n; i++) r.bolts.push({ life: 250, max: 250, x: Math.random(), seed: Math.random() * 1000 });
    r.lFlash = -200;
    if (r.lCount-- === 1) w.bump('lightning_strike');
  }
}
