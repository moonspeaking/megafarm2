// Инфраструктура части 2 (задача 4): «люди» сценария, ёмкость боксов, маркер-триггер.
// Небольшие механики вынесены из sim.js (как sim_bees.js), чтобы не раздувать основной файл.

/** Персонажи сценария (@worker, job guard/manager, looser): не нанимаются, поведение — задача 5. */
export const PERSON_NAMES = ['guard', 'manager', 'looser'];

/** Действия героини, которыми управляют `#bool cant_*` уровня и действие `allow action`. */
export const ABILITY_NAMES = ['dig', 'plant', 'weed', 'harvest', 'water', 'fertilize', 'sell', 'switch', 'fix'];

/** Имя свойства уровня, запрещающего действие (#bool cant_generator_fix — единственное несовпадение по имени). */
export function cantProp(ability) {
  return ability === 'fix' ? 'cant_generator_fix' : 'cant_' + ability;
}

/** Вместимость бокса: обычный 4 (BOX_CAPACITY), fivebox 5, multibox 7 (#int boxcount). */
export function boxCapacity(def) {
  return (def && def.props.boxcount) || 4;
}

/** Базовая (нижняя) точка объекта в мировых пикселях (деф-координаты y вверх → переворот). */
export function basePointOf(obj) {
  const bc = obj.def && obj.def.props.base_center;
  return [obj.x + (bc ? bc[0] : 0), obj.y - (bc ? bc[1] : 0)];
}

/** Один шаг инфраструктуры: маркеры (условие `enter marker`). */
export function updateInfra(w, dt) {
  void dt;
  for (const o of w.objects) {
    if (o.kind !== 'marker' || o.entered) continue;
    const [bx, by] = basePointOf(o);
    const r = (o.def.props.base_radius || [24, 12]);
    const dx = (w.hero.x - bx) / r[0], dy = (w.hero.y - by) / r[1];
    if (dx * dx + dy * dy <= 1) {
      o.entered = true;
      w.bump('enter_marker');
    }
  }
}
