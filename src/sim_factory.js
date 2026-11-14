// Фабрики части 2: factory_clothes / factory_sausage / factory_sweeties.
// Модель восстановлена дизассемблером Game.dll части 2 (класс Factory, IDA 9.5; адреса — в docs/original-notes.md):
//  * фаза фабрики 0..4 (поле `upgrade` порта; в оригинале «phase», по умолчанию 3). Фазы 0..3 — не работает
//    (анимации @phase0..3), фаза 4 — полный ход. "upgrade factory X N" = установка фазы N (N<0 игнорируется);
//  * на каждый тип сырья из @accept_feed_list (их три) — шкала топлива 0..100; доставка полного ящика
//    добавляет 100/max_resource (cap 100), в любой фазе;
//  * фаза 3 и все три шкалы > 0 → фаза 4 и событие "refuel <фабрика>";
//  * в фазе 4 каждая шкала убывает на dt_мс·100/resource_time/max_resource (один ящик = resource_time),
//    самая низкая не опускается ниже 0 (остальные сдвигаются на ту же величину);
//  * в фазе 4 раз за цикл анимации gives_money (1 с) фабрика платит `profit` денег, счётчик "sell <фабрика>" += 1;
//    если шкал со сжигаемым топливом (>0) меньше 3 — фаза падает до 3 («factory_break.ogg»).

const CYCLE = 1;          // с: период анимации с #bool gives_money (animation_time 1)
export const PHASES = 5;  // фазы 0..4

export const phaseOf = (f) => (f.upgrade === undefined || f.upgrade === null ? 3 : f.upgrade);

/** Список сырья фабрики (имена из @accept_feed_list). */
export function feedList(f) {
  const list = f.def.children.find((c) => c.type === 'accept_feed_list');
  return list ? list.exprs : [];
}

/** Индекс шкалы топлива для товара ящика (тип — как у ангара: plant_X / house_X / tree_X) или -1. */
export function feedIndex(f, type) {
  return feedList(f).findIndex((n) => n === type || n === 'plant_' + type || n === 'tree_' + type || n === 'house_' + type);
}

export const factoryTakes = (f, type) => feedIndex(f, type) >= 0;

function fuel(f) {
  const n = Math.max(3, feedList(f).length);
  if (!f.fuel || f.fuel.length !== n) f.fuel = Array.from({ length: n }, (_, i) => (f.fuel && f.fuel[i]) || 0);
  return f.fuel;
}

/** sub_10032E69: смена фазы (n вне 0..4 игнорируется); возвращает true, если фаза изменилась. */
export function setFactoryPhase(w, f, n) {
  if (!(n >= 0 && n < PHASES)) return false;
  const cur = phaseOf(f);
  if (n === cur) return false;
  let target = n;
  if (n === 3 && cur < 3 && fuel(f).every((m) => m > 0)) target = 4; // уже заправлена полностью
  w.hooks.playSound(target >= cur ? 'factory_repair' : 'factory_break');
  f.upgrade = target;
  if (target === 4 && cur < 4) w.bump('refuel_' + f.name);
  return true;
}

/** Положить полный ящик в фабрику. Возвращает ключ уведомления-отказа или null (событие 4096 оригинала). */
export function feedFactory(w, f, held) {
  if (!held || held.kind !== 'box' || !held.count) return 'notify_box_empty';
  const i = feedIndex(f, held.type);
  if (i < 0) return 'notify_hangar_not_accept';
  const m = fuel(f);
  m[i] = Math.min(100, m[i] + 100 / (f.def.props.max_resource || 3));
  if (phaseOf(f) === 3 && m.every((v) => v > 0)) setFactoryPhase(w, f, 4);
  return null;
}

/** Один шаг всех фабрик (sub_100331D4). */
export function updateFactories(w, dt) {
  for (const f of w.objects) {
    if (f.kind !== 'factory') continue;
    const phase = phaseOf(f);
    if (phase !== 4) { f.prog = 0; continue; }
    const m = fuel(f);
    const rate = 100 / ((f.def.props.resource_time || 60000) / 1000) / (f.def.props.max_resource || 3); // шкала/с
    let over = 0;
    for (let i = 0; i < m.length; i++) { m[i] -= rate * dt; if (m[i] < 0) over = m[i]; }
    if (over < 0) for (let i = 0; i < m.length; i++) m[i] -= over; // нижняя шкала упирается в 0
    f.prog = (f.prog || 0) + dt;
    while (f.prog >= CYCLE && phaseOf(f) === 4) {
      f.prog -= CYCLE;
      const profit = f.def.props.profit || 0;
      w.money += profit;
      w.bump('sell_' + f.name);
      const ps = f.def.props.profit_source || [0, 0];
      w.moneyPopup(f.x + ps[0], f.y - ps[1], '+' + profit);
      w.hooks.playSound('profit');
      if (m.filter((v) => v > 0).length < 3) setFactoryPhase(w, f, 3);
    }
  }
}
