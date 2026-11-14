// Строки целей на доске заданий (upmenu_center.task1..task7, menuhost_scripts.txt) — часть 2.
// Задание игрока — это @event с #bool player_task true. Оно «активно», когда ещё не выполнено, а события, которые
// его включают (условия "enabled by event"), уже сработали. Цели — остальные счётчиковые условия события;
// подпись берётся из ключа языкового пака task_<тип условия с подчёркиваниями> ("dig bed" -> task_dig_bed),
// справа — «текущее/нужное». Условия без ключа в паке (время, диалоги) на доске не показываются.

const MAX_LINES = 7;
const NON_GOALS = new Set(['enabled by event', 'disabled by event', 'game time', '']);

/** Счётчик условия: имя типа с подчёркиваниями ("dig bed" -> dig_bed). */
export const counterOf = (type) => String(type).replace(/\s+/g, '_');

/** Порог условия вида ">=4" / "> 3" -> число, иначе null (условие не количественное). */
function thresholdOf(data) {
  const m = /^\s*(>=|>)\s*(-?[\d.]+)\s*$/.exec(String(data == null ? '' : data));
  return m ? parseFloat(m[2]) + (m[1] === '>' ? 1 : 0) : null;
}

/** События игрока, включённые сценарием и ещё не выполненные. */
function activePlayerEvents(world) {
  return (world.events || []).filter((ev) => ev.playerTask && !ev.fired && ev.conds.every((c) => {
    if (c.named || c.type !== 'enabled by event') return true;
    return String(c.data || '').split(',').map((s) => s.trim()).filter(Boolean).every((n) => world.firedEvents.has(n));
  }));
}

/**
 * @returns {{text: string, cur: number, target: number}[]} до семи строк; пусто, если активных заданий нет.
 */
export function taskGoalLines(world) {
  if (!world || !world.events) return [];
  const lines = [];
  const seen = new Set();
  for (const ev of activePlayerEvents(world)) {
    for (const c of ev.conds) {
      if (c.named || NON_GOALS.has(c.type) || /^end dialogue/.test(c.type)) continue;
      const counter = counterOf(c.type);
      const target = thresholdOf(c.data);
      const key = 'task_' + counter;
      if (target === null || seen.has(counter)) continue;
      const text = world.db.t(key, '');
      if (!text) continue;
      seen.add(counter);
      lines.push({ text, cur: Math.min(Math.floor(world.condCounter ? world.condCounter(ev, counter) : world.counter(counter)), target), target });
      if (lines.length >= MAX_LINES) return lines;
    }
  }
  return lines;
}
