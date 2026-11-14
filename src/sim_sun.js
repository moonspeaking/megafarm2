// Солнце и освещение части 2. Восстановлено дизассемблером Game.dll (sub_1001B41C: "set sun", "start day/…"; sub_100178CE —
// объект освещения: угол солнца +300 (старт 90), цель +304, скорость +308, цвет +252/+268, lightmap + flashlight2.tga):
//  * "set sun A T": угол → A за T мс (T=0 — мгновенно); цвет не трогается;
//  * "start <фаза> T": угол и цвет плавно за T мс: day 90° (1,1,1), morning 45° (0.82,0.92,1), evening 45° (1,0.92,0.82),
//    night 15° (0.75,0.8,1), moon 15° (0.75,0.95,1);
//  * освещение — lightmap (EnvironmentLayer, update sub_10017535, draw sub_10018483): RT-текстура, залитая серым
//    `угол/90` (фаза 15° = 0.17, 45° = 0.5), на которую аддитивно кладутся источники света (фонарь героини
//    flashlight2.tga 384×192, уличные фонари streetlamplight.tga 1024×512); результат умножается на сцену;
//  * электричество (CLevelStats +517/+518): спрос = Σ power_usage фонарей (по умолчанию 1), предложение =
//    Σ power_production исправных генераторов (generator 3, big_generator 999); доля = предложение/спрос (≤1;
//    0 без предложения, 1 без спроса). Фонарь светит при доле ≥ 0.01 (StreetLamp::update, sub_100437FD);
//  * ниже `#float sunset_angle` уровня работники берутся за объект, только если доля ≥ 0.4 и объект в освещённой клетке
//    (sub_10026858: освещены клетки в эллипсе 640×320 px вокруг работающих фонарей).

export const PHASES = {
  day: [90, [1, 1, 1]],
  morning: [45, [0.82, 0.92, 1]],
  evening: [45, [1, 0.92, 0.82]],
  night: [15, [0.75, 0.8, 1]],
  moon: [15, [0.75, 0.95, 1]],
};
export const DEFAULT_SUNSET = 20;

export function initSun(w) {
  w.sun = { angle: 90, target: 90, speed: 0, color: [1, 1, 1], ctarget: [1, 1, 1], cspeed: [0, 0, 0] };
  const s = w.level && w.level.props.sunset_angle;
  w.sunsetAngle = Number.isFinite(s) ? s : DEFAULT_SUNSET;
}

/** "set sun A T". */
export function setSun(w, angle, ms) {
  const s = w.sun;
  if (!Number.isFinite(angle)) return;
  s.target = angle;
  if (!(ms > 1)) { s.angle = angle; s.speed = 0; } else s.speed = (angle - s.angle) / ms; // °/мс
}

/** "start <фаза> T". */
export function startPhase(w, phase, ms) {
  const p = PHASES[phase];
  if (!p) return;
  const s = w.sun;
  setSun(w, p[0], ms);
  s.ctarget = [...p[1]];
  if (!(ms > 1)) { s.color = [...p[1]]; s.cspeed = [0, 0, 0]; } else s.cspeed = p[1].map((c, i) => (c - s.color[i]) / ms);
}

export function updateSun(w, dt) {
  const s = w.sun;
  if (!s) return;
  const ms = dt * 1000;
  if (s.speed) {
    s.angle += s.speed * ms;
    if ((s.speed > 0 && s.angle >= s.target) || (s.speed < 0 && s.angle <= s.target)) { s.angle = s.target; s.speed = 0; }
  }
  for (let i = 0; i < 3; i++) {
    if (!s.cspeed[i]) continue;
    s.color[i] += s.cspeed[i] * ms;
    if ((s.cspeed[i] > 0 && s.color[i] >= s.ctarget[i]) || (s.cspeed[i] < 0 && s.color[i] <= s.ctarget[i])) { s.color[i] = s.ctarget[i]; s.cspeed[i] = 0; }
  }
}

/** Фоновая яркость lightmap 0..1 = угол/90 (sub_10017535). */
export function ambient(w) {
  const s = w.sun;
  if (!s) return 1;
  return Math.max(0, Math.min(1, s.angle / 90));
}

/** Доля электричества (CLevelStats::sub_10026768): предложение генераторов / спрос фонарей. */
export function powerRatio(w) {
  let demand = 0, supply = 0;
  for (const o of w.objects) {
    if (o.name === 'streetlamp') demand += o.def.props.power_usage ?? 1;
    else if (o.kind === 'generator' && !o.broken) supply += o.def.props.power_production || 0;
  }
  if (supply === 0) return 0;
  if (demand === 0) return 1;
  return Math.min(1, supply / demand);
}

export const LAMP_LIT_MIN = 0.01;   // фонарь светит
export const LAMP_WORK_MIN = 0.4;   // работники работают в темноте
export const LAMP_RADIUS = [640, 320]; // px, эллипс освещённых клеток

/** Светящиеся фонари (питание ≥ 0.01). */
export function litLamps(w) {
  if (powerRatio(w) < LAMP_LIT_MIN) return [];
  return w.objects.filter((o) => o.name === 'streetlamp');
}

/** sub_10026858: может ли работник работать с объектом (днём всегда; ночью — при питании ≥ 0.4 в освещённой зоне). */
export function isWorkable(w, o) {
  const s = w.sun;
  if (!s || w.sunsetAngle < s.angle) return true;
  if (powerRatio(w) < LAMP_WORK_MIN) return false;
  return litLamps(w).some((l) => ((o.x - l.x) / LAMP_RADIUS[0]) ** 2 + ((o.y - l.y) / LAMP_RADIUS[1]) ** 2 <= 1);
}

export const serializeSun = (w) => JSON.parse(JSON.stringify(w.sun));
export function restoreSun(w, d) { if (d) w.sun = d; }
