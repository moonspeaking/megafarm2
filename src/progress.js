// Player progress: finished levels, records and trophies (kept in localStorage).
//
// Rules recovered from the original (sub_42F2B0, level-finished handler of the map screen);
// for part 2 the trophy numbering follows interfaces/levelmenu.txt:
//  * a finished level is marked "completed"; if it was finished within `level_time` it is
//    "gold" and gives trophy #level (the levelmenu screen shows trophies 1..24, one per level,
//    each with its own trophy_hintN text);
//  * once all 24 level trophies are owned, trophy #25 is granted — the big crystal globe
//    (levelmenu.txt image trophy25, hint «приз за превосходное прохождение игры»);
//  * best time is the minimum, best money the maximum, over all runs of that level.

const KEY = 'megafarm2.progress.v1';
export const LEVELS = 24;
export const TROPHY_CUP = 25;

export class Progress {
  constructor(settings) {
    this.settings = settings;
    this.data = {};
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = JSON.parse(raw) || {};
    } catch (e) { /* storage unavailable */ }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
  }

  get profile() {
    const name = this.settings.get('player') || 'default';
    if (!this.data[name]) this.data[name] = { levels: {}, trophies: [], comics: [] };
    // данные, записанные старой версией: части полей может не быть
    if (!this.data[name].levels) this.data[name].levels = {};
    if (!this.data[name].trophies) this.data[name].trophies = [];
    if (!this.data[name].comics) this.data[name].comics = [];
    this.migrateProfile(this.data[name]);
    return this.data[name];
  }

  /** Часть 1 хранила трофеи как #(level-1) 0..11 + кубок 12 (12 уровней); часть 2 —
   *  #level 1..24 + кубок 25. Данные, записанные портом части 1, один раз переводятся
   *  на новую нумерацию (пометка trophies_v2). */
  migrateProfile(p) {
    if (p.trophies_v2) return;
    if (p.trophies.length) {
      p.trophies = p.trophies.map((i) => (i < 12 ? i + 1 : (i === 12 ? TROPHY_CUP : i)));
      this.save();
    }
    p.trophies_v2 = true;
  }

  level(n) { return this.profile.levels[n] || null; }
  done(n) { return !!this.level(n); }
  gold(n) { return !!(this.level(n) && this.level(n).gold); }
  /** Levels open one after another. */
  unlocked(n) { return n <= 1 || this.done(n - 1); }
  /** First level that was not finished yet (what the map selects initially). */
  current() {
    for (let n = 1; n <= LEVELS; n++) if (!this.done(n)) return n;
    return LEVELS;
  }
  trophies() { return this.profile.trophies; }
  comicsSeen(n) { return this.profile.comics.includes(n); }
  markComics(n) {
    if (!this.profile.comics.includes(n)) { this.profile.comics.push(n); this.save(); }
  }

  /** Имена профилей, у которых есть сохранённый прогресс. */
  profiles() { return Object.keys(this.data); }

  /** Стереть прогресс профиля; сохранение игры удаляется отдельно (savegame.js). */
  removeProfile(name) {
    if (!this.data[name]) return false;
    delete this.data[name];
    this.save();
    return true;
  }

  /**
   * Record a won level. `limit` is the gold time in seconds.
   * Returns { gold, newTrophies: [index, ...] }.
   */
  complete(n, time, money, limit) {
    const p = this.profile;
    p.trophies_v2 = true; // новые записи уже в нумерации части 2
    const old = p.levels[n];
    const gold = time <= limit || !!(old && old.gold);
    const rec = {
      gold,
      time: old && old.time && old.time < time ? old.time : Math.round(time),
      money: Math.max(old ? old.money : 0, Math.round(money)),
    };
    p.levels[n] = rec;
    const fresh = [];
    if (gold && !p.trophies.includes(n)) { p.trophies.push(n); fresh.push(n); }
    const owned = p.trophies.filter((i) => i >= 1 && i <= LEVELS).length;
    if (owned === LEVELS && !p.trophies.includes(TROPHY_CUP)) { p.trophies.push(TROPHY_CUP); fresh.push(TROPHY_CUP); }
    this.save();
    return { gold: time <= limit, newTrophies: fresh };
  }
}

export function formatTime(sec) {
  const s = Math.max(0, Math.round(sec));
  const p = (v) => String(v).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
