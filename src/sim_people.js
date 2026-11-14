// Персонажи сценария части 2: охрана (патруль по путевым точкам, погоня, «арест» героини).
// Логика восстановлена дизассемблером Game.dll части 2 (IDA 9.5: sub_10035D95 — ИИ охранника, sub_1001B41C — действия
// "add/clear guard waypoint", "reset guards", "disable guards"; подробности — docs/original-notes.md, «Часть 2»).

export const TILE = 64;
export const GUARD_SEE = 450;     // px: героиня ближе (расстояние с удвоенным dy) — охранник преследует
export const GUARD_CATCH = 90;    // px: ближе — арест (счётчик "arrested"), охранник замирает
export const GUARD_REACH = 32;    // px: путевая точка достигнута

/** Охранники — @worker с job "guard". */
const isGuard = (o) => o.kind === 'worker' && o.name === 'guard';
/** Расстояние оригинала: изометрия, ось y удваивается. */
const dist2 = (ax, ay, bx, by) => Math.hypot(ax - bx, 2 * (ay - by));
const matches = (o, tag) => !tag || o.tag === tag;

/**
 * "add guard waypoint": data = "x y [тэг]". Точка добавляется охранникам с этим тэгом (без тэга — всем);
 * если у охранника маршрут был пуст, эта точка становится его «домом» (куда его возвращает "reset guards").
 */
export function addGuardWaypoint(w, data) {
  const [x, y, tag] = String(data || '').trim().split(/\s+/);
  if (!isFinite(+x) || !isFinite(+y) || x === '' || x === undefined) return;
  const p = { x: +x * TILE + TILE / 2, y: +y * TILE + TILE / 2 };
  for (const o of w.objects) {
    if (!isGuard(o) || !matches(o, tag)) continue;
    o.route ||= [];
    if (!o.route.length) o.home = { ...p };
    o.route.push({ ...p });
  }
}

/** "clear guard waypoints [тэг]": маршрут очищается, охранник останавливается на месте. */
export function clearGuardWaypoints(w, data) {
  const tag = String(data || '').trim();
  for (const o of w.objects) {
    if (!isGuard(o) || !matches(o, tag)) continue;
    o.route = []; o.wpIdx = 0; o.path = []; o.moving = false;
  }
}

/** "reset guards": охранники возвращаются домой (первая путевая точка), состояние — спокойное. */
export function resetGuards(w) {
  for (const o of w.objects) {
    if (!isGuard(o)) continue;
    if (o.home) { o.x = o.home.x; o.y = o.home.y; }
    o.path = []; o.wpIdx = 0; o.caught = false; o.moving = false; o.chasing = false;
  }
}

/** "disable guards": охрана останавливается и больше не замечает героиню. */
export function disableGuards(w) {
  for (const o of w.objects) if (isGuard(o)) { o.disabled = true; o.path = []; o.moving = false; }
}

export const MANAGER_PERIOD = 1; // с между выплатами (оригинал: менеджер идёт к ждущему работнику, затем платит)

/**
 * Менеджер (CManagerAI, sub_1003D794): сам платит зарплату работникам, ждущим оплаты («$»), если денег хватает
 * с учётом цены покупки на курсоре. Порт платит мгновенно раз в MANAGER_PERIOD (без ходьбы менеджера к работнику).
 */
function updateManager(w, dt) {
  if (!w.objects.some((o) => o.kind === 'worker' && o.name === 'manager')) return;
  w.managerT = (w.managerT || 0) + dt;
  if (w.managerT < MANAGER_PERIOD) return;
  w.managerT = 0;
  const free = w.money - (w.pending ? w.pending.unpaid || 0 : 0);
  const wk = w.objects.find((o) => o.kind === 'worker' && o.state === 'idle' && o.def.props.work_time > 0
    && (o.def.props.pay || 0) <= free);
  if (wk) w.workerClicked(wk);
}

/** Индекс из 8 направлений (как dirIndex в sim.js; копия — чтобы не было циклического импорта). */
function dirIndex(dx, dy) {
  if (!dx && !dy) return 0;
  const a = Math.atan2(-dy, dx) * 180 / Math.PI;
  return ((Math.floor(a / 45 + 0.5) % 8) + 8) % 8;
}

/** Кривая оригинала (sub_10012FF3): Catmull–Rom от P1 (t=0) до P2 (t=1), P0 и P3 — соседи. */
function spline(P, t) {
  const f = (a, b, c, d) => {
    const v11 = a - b, v18 = d - c - v11;
    return (v11 - v18) * t * t + v18 * t * t * t + (c - a) * t + b;
  };
  return { x: f(P[0].x, P[1].x, P[2].x, P[3].x), y: f(P[0].y, P[1].y, P[2].y, P[3].y) };
}
/** Случайная точка эллипса вокруг дома (угол sub_10012C32: случайный в [−π, π]). */
function ringPoint(home, rx, ry) {
  const r = (Math.random() * 2 - 1) * Math.PI;
  return { x: home.x + Math.sin(r) * rx, y: home.y + Math.cos(r) * ry };
}

/**
 * Светлячок (CLightbugAI, sub_1003D49B). Пока у него нет задания, он берёт следующую точку кривой через 4 контрольные точки
 * на эллипсе 48×24 вокруг дома (шаг t += 0.1, точка = spline(P1..P2, t)) и летит к ней обычным движением работника.
 * Когда t ≥ 1 — точки сдвигаются, новая P3 ставится на эллипсе 64×32; если светлячок «следует» (+42), дом перед этим
 * переносится в позицию героини +140 px по y. Следовать он начинает, когда героиня подняла предмет (Piece), под которым
 * висел его дом (sub_1003F15F) — см. lightbugsFollow.
 */
function updateLightbug(w, o, dt) {
  o.state = 'work';
  if (!o.home) o.home = { x: o.x, y: o.y };
  if (!o.lb) {
    o.lb = { P: [0, 1, 2, 3].map(() => ringPoint(o.home, 48, 24)), t: 0 };
    const p1 = o.lb.P[1];
    o.x = p1.x; o.y = p1.y;
    if (o.nearPiece === undefined) o.nearPiece = w.objects.some((it) => it.kind === 'item' && onItem(it, o.home));
    o.path = [];
  }
  const lb = o.lb;
  // летит прямо (светлячок не упирается в препятствия); скорость — speed объекта, как у работника (S = speed·0.00105 px/мс)
  const step = (tg) => {
    const S = (o.speed || 60) * 0.00105 * dt * 1000;
    const dx = tg.x - o.x, dy = tg.y - o.y, d = Math.hypot(dx, dy / 0.5);
    o.moving = true;
    if (d <= S) { o.x = tg.x; o.y = tg.y; return true; }
    o.x += dx / d * S; o.y += dy / d * S * 0.5;
    o.facing = dirIndex(dx, dy);
    return false;
  };
  if (o.path && o.path.length) { if (step(o.path[0])) o.path = []; return; }
  lb.t += 0.1;
  if (lb.t >= 1) {
    if (o.follow) o.home = { x: w.hero.x, y: w.hero.y + 140 };
    lb.t -= 1;
    lb.P = [lb.P[1], lb.P[2], lb.P[3], ringPoint(o.home, 64, 32)];
  }
  o.path = [spline(lb.P, lb.t)];
}
const onItem = (it, p) => Math.abs(p.x - it.x) <= it.size[0] / 2 && Math.abs(p.y - it.y) <= it.size[1] / 2;

/** Героиня подняла предмет: светлячки, чей дом лежал над ним, начинают следовать за героиней (sub_1003F15F). */
export function lightbugsFollow(w, item) {
  for (const o of w.objects) {
    if (o.kind !== 'worker' || o.name !== 'lightbug' || !o.nearPiece) continue;
    if (!onItem(item, o.home)) continue;
    o.nearPiece = false;
    o.follow = true;
    o.path = []; // sub_10001C86: текущее задание прерывается
  }
}

/** Пчела-работник (CBeeAI, sub_1002FC5B, эллипс 64×32) порхает около «дома» (+9916/9920 оригинала). */
function updateFlyer(o, dt) {
  const [rx, ry] = [64, 32];
  o.state = 'work';
  o.home ||= { x: o.x, y: o.y };
  o.ang = (o.ang === undefined ? (o.id % 7) : o.ang) + dt * 1.3;
  o.x = o.home.x + Math.sin(o.ang) * rx;
  o.y = o.home.y + Math.cos(o.ang * 1.37) * ry;
  o.moving = true;
}

/** "distract bees" (sub_1001B41C): все пчёлы-работники перелетают к первому растению с готовым плодом (+32, +32). */
export function distractBees(w) {
  const p = w.objects.find((o) => o.kind === 'plant' && !o.dead && o.fruits > 0);
  if (!p) return;
  for (const o of w.objects) if (o.kind === 'worker' && o.name === 'bee') o.home = { x: p.x + 32, y: p.y + 32 };
  w.bump('bees_distracted');
}

/** Машина уезжает (visual effect start truck): едет вправо, героиня внутри. */
function updateTruck(w, o, dt) {
  o.x += 220 * dt;
  w.hero.x = o.x - 65; w.hero.y = o.y + 90;
}

/** Один шаг персонажей: охрана (sub_10035D95), менеджер, светлячки. */
export function updatePeople(w, dt) {
  updateManager(w, dt);
  for (const o of w.objects) {
    if (o.kind === 'truck' && o.leaving) updateTruck(w, o, dt);
    if (o.kind === 'worker' && o.name === 'lightbug') { updateLightbug(w, o, dt); continue; }
    if (o.kind === 'worker' && o.name === 'bee') { updateFlyer(o, dt); continue; }
    if (!isGuard(o)) continue;
    o.state = 'work'; // не «ждёт оплаты» (нет значка $)
    if (o.disabled || o.caught || w.over) { o.moving = false; continue; }
    const d = dist2(o.x, o.y, w.hero.x, w.hero.y);
    if (d < GUARD_CATCH) {
      o.caught = true; o.path = []; o.moving = false;
      w.bump('arrested'); // один раз за арест: до "reset guards" охранник замер
      continue;
    }
    if (d < GUARD_SEE) {
      // погоня: цель — текущая позиция героини (путь обновляется, когда она ушла дальше чем на GUARD_REACH)
      const t = o.path[0];
      if (!t || Math.hypot(t.x - w.hero.x, t.y - w.hero.y) > GUARD_REACH) o.path = [{ x: w.hero.x, y: w.hero.y }];
      o.chasing = true;
      w.moveActor(o, dt, null);
      continue;
    }
    if (o.chasing) { o.chasing = false; o.path = []; }
    const route = o.route;
    if (!route || !route.length) { o.moving = false; continue; }
    // патруль: дошёл до точки (≤ 32 px) → следующая по кругу
    const cur = route[o.wpIdx || 0];
    if (!o.path.length) {
      if (Math.hypot(o.x - cur.x, o.y - cur.y) <= GUARD_REACH) {
        o.wpIdx = ((o.wpIdx || 0) + 1) % route.length;
      }
      const nxt = route[o.wpIdx || 0];
      o.path = [{ x: nxt.x, y: nxt.y }];
    }
    w.moveActor(o, dt, null);
  }
}
