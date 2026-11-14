// Sound and music playback.

export class AudioBank {
  constructor(assets) {
    this.assets = assets;
    this.cache = new Map();
    this.music = null;
    this.sfxVolume = 0.6;
    this.musicVolume = 0.35;
    this.sfxOn = true;
    this.musicOn = true;
  }

  play(name, volume) {
    if (!this.sfxOn) return;
    const path = this.assets.sound(name + '.ogg');
    if (!path) return;
    let a = this.cache.get(name);
    if (!a) {
      a = new Audio(path);
      a.preload = 'auto';
      this.cache.set(name, a);
    }
    try {
      a.currentTime = 0;
      a.volume = volume !== undefined ? volume : this.sfxVolume;
      a.play().catch(() => {});
    } catch (e) { /* ignore */ }
  }

  /** Оборвать звук (например копание, когда анимация уже закончилась). */
  stop(name) {
    const a = this.cache.get(name);
    if (!a) return;
    try { a.pause(); a.currentTime = 0; } catch (e) { /* ignore */ }
  }

  /** Музыка уровня части 2: основная (name_pri_music) и фоновая (name_emb_music). 'music_mix' = музыка текущего уровня. */
  setLevelMusic(level) {
    const strip = (s) => (s ? String(s).replace(/\.ogg$/, '') : null);
    this.levelMusic = level ? { pri: strip(level.props.name_pri_music), emb: strip(level.props.name_emb_music) } : null;
  }

  playAmbient(name) {
    const path = name && this.assets.sound(name + '.ogg');
    if (this.ambient && this.ambient._name === name) { if (this.musicOn && this.ambient.paused) this.ambient.play().catch(() => {}); return; }
    if (this.ambient) { this.ambient.pause(); this.ambient = null; }
    if (!path || !this.musicOn) return;
    const a = new Audio(path);
    a.loop = true; a.volume = this.musicVolume * 0.7; a._name = name;
    a.play().catch(() => {});
    this.ambient = a;
  }

  playMusic(name) {
    const want = name;
    if (name === 'music_mix') {
      const lm = this.levelMusic;
      if (!lm || !lm.pri) return this.playMusic('music_menu');
      this.playAmbient(lm.emb);
      name = lm.pri;
    } else if (this.ambient) { this.ambient.pause(); this.ambient = null; }
    const path = this.assets.sound(name + '.ogg');
    if (!path) return;
    this.wantedMusic = want;
    if (!this.musicOn) return;
    if (this.music && this.music._name === name) {
      if (this.music.paused) this.music.play().catch(() => {});
      return;
    }
    if (this.music) { this.music.pause(); }
    const a = new Audio(path);
    a.loop = true;
    a.volume = this.musicVolume;
    a._name = name;
    a.play().catch(() => {});
    this.music = a;
  }

  setMusicEnabled(on) {
    this.musicOn = on;
    if (!on) { if (this.music) { this.music.pause(); this.music = null; } if (this.ambient) { this.ambient.pause(); this.ambient = null; } }
    else if (this.wantedMusic) this.playMusic(this.wantedMusic);
  }

  setSfxEnabled(on) { this.sfxOn = on; }

  /** Звук дождя (sub_1002C62C): три петли, смешиваются по силе 0..100 (пики 33/66/99, громкость 100 − |сила − пик|·3 %). */
  setRainMix(strength) {
    const loops = this.rainLoops || (this.rainLoops = {});
    const spec = [['rainlight', 33, (s) => s < 66], ['rainmiddle', 66, (s) => s > 33 && s < 99], ['rainheavy', 99, (s) => s > 66]];
    for (const [name, peak, on] of spec) {
      const active = strength > 0 && on(strength) && this.sfxOn;
      let a = loops[name];
      if (!active) { if (a) { a.pause(); loops[name] = null; } continue; }
      if (!a) {
        const path = this.assets.sound(name + '.ogg');
        if (!path) continue;
        a = new Audio(path); a.loop = true; a.play().catch(() => {});
        loops[name] = a;
      }
      a.volume = Math.max(0, Math.min(1, (100 - Math.abs(strength - peak) * 3) / 100)) * this.sfxVolume;
    }
  }

  stopAmbient() {
    if (this.ambient) { this.ambient.pause(); this.ambient = null; }
  }

  stopMusic() {
    if (this.music) { this.music.pause(); this.music = null; }
    if (this.ambient) { this.ambient.pause(); this.ambient = null; }
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.music) this.music.volume = v;
    if (this.ambient) this.ambient.volume = v * 0.7;
  }

  setSfxVolume(v) { this.sfxVolume = v; }
}
