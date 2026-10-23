// Sound effects, synthesized with the Web Audio API: no sound files. iPhones
// only allow audio after a tap or keypress, so nothing plays until unlock().

const MUTE_KEY = 'fighter-muted';

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {}
  }

  /** Call from a tap or keypress. Safe to call repeatedly. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      // A compressor keeps a pile-up of hits from clipping.
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(muted) {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {}
    if (this.master) this.master.gain.value = muted ? 0 : 0.55;
  }

  get ready() {
    return this.ctx && this.ctx.state === 'running' && !this.muted;
  }

  /** A pitched blip with a slide and a quick fade. */
  tone({ freq, to = freq, type = 'sine', dur = 0.15, vol = 0.3, delay = 0 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Filtered noise: whooshes, impacts, thunder. */
  noise({ dur = 0.2, vol = 0.3, filter = 'bandpass', freq = 1200, to = freq, q = 1, delay = 0 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(gain).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  swing(heavy = false) {
    this.noise({ dur: heavy ? 0.22 : 0.13, vol: heavy ? 0.22 : 0.14, freq: 700, to: 2600, q: 1.4 });
  }

  /** Bigger hits thump lower and longer; kill-strength hits crack on top. */
  hit(damage, kb) {
    const big = Math.min(1, damage / 15);
    this.tone({ freq: 160 - big * 40, to: 45, dur: 0.12 + big * 0.14, vol: 0.35 + big * 0.3 });
    this.noise({ dur: 0.08 + big * 0.1, vol: 0.25 + big * 0.2, filter: 'lowpass', freq: 3000, to: 400 });
    if (kb > 120) {
      this.tone({ freq: 1400, to: 600, type: 'square', dur: 0.09, vol: 0.12 });
      this.noise({ dur: 0.35, vol: 0.25, filter: 'highpass', freq: 2500, to: 6000, delay: 0.02 });
    }
  }

  block() {
    this.tone({ freq: 1300, to: 900, type: 'triangle', dur: 0.12, vol: 0.18 });
    this.tone({ freq: 1950, to: 1500, type: 'triangle', dur: 0.08, vol: 0.1 });
  }

  counter() {
    this.tone({ freq: 500, to: 1500, type: 'sawtooth', dur: 0.18, vol: 0.15 });
    this.hit(14, 140);
  }

  jump() {
    this.tone({ freq: 280, to: 520, type: 'triangle', dur: 0.09, vol: 0.1 });
  }

  land() {
    this.noise({ dur: 0.07, vol: 0.12, filter: 'lowpass', freq: 500, to: 200 });
  }

  ko() {
    this.noise({ dur: 1.1, vol: 0.7, filter: 'lowpass', freq: 2200, to: 80 });
    this.tone({ freq: 110, to: 30, dur: 0.9, vol: 0.55 });
    [1320, 1760, 2640].forEach((f, i) => this.tone({ freq: f, to: f * 1.5, type: 'triangle', dur: 0.25, vol: 0.06, delay: 0.05 + i * 0.05 }));
  }

  thunder() {
    this.noise({ dur: 2.2, vol: 0.22, filter: 'lowpass', freq: 380, to: 60, delay: 0.25 + Math.random() * 0.4 });
  }

  blip() {
    this.tone({ freq: 660, type: 'square', dur: 0.05, vol: 0.07 });
  }

  confirm() {
    this.tone({ freq: 523, type: 'square', dur: 0.07, vol: 0.08 });
    this.tone({ freq: 784, type: 'square', dur: 0.12, vol: 0.08, delay: 0.07 });
  }

  /** Countdown beeps: 3, 2, 1 low; GO! high with a chord. */
  count(text) {
    if (text === 'GO!') {
      [523, 659, 784, 1047].forEach((f) => this.tone({ freq: f, type: 'sawtooth', dur: 0.5, vol: 0.06 }));
    } else if (text) {
      this.tone({ freq: 440, type: 'square', dur: 0.16, vol: 0.09 });
    }
  }

  game() {
    [392, 523, 659, 784].forEach((f, i) => this.tone({ freq: f, type: 'sawtooth', dur: 0.4, vol: 0.07, delay: i * 0.09 }));
    this.noise({ dur: 0.8, vol: 0.2, filter: 'highpass', freq: 3000, to: 8000 });
  }

  /** React to a frame's match events. */
  handleEvents(events) {
    for (const e of events) {
      switch (e.type) {
        case 'swing':
          this.swing(['strong', 'stormDraw', 'dair', 'bair'].includes(e.move));
          break;
        case 'hit':
          this.hit(e.damage, e.kb);
          break;
        case 'block':
          this.block();
          break;
        case 'counter':
          this.counter();
          break;
        case 'jump':
          this.jump();
          break;
        case 'land':
          this.land();
          break;
        case 'ko':
          this.ko();
          break;
      }
    }
  }
}
