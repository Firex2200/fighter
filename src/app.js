// The app: one loop, a handful of screens, and the 3D world behind them.
//
//   title -> select -> match (countdown, fight) -> gameover ("GAME!") -> results
//
// Gameplay runs in fixed 60-per-second steps exactly as before (src/match.js);
// drawing happens once per screen refresh.

import { World } from './render/world.js';
import { modelReady } from './render/rookModel.js';
import { Match } from './match.js';
import { frameCamera, initialCamera } from './camera.js';
import { BINDINGS, PlayerInput } from './input.js';
import { paletteFor } from './rook.js';
import { Hud } from './ui/hud.js';
import { Screens, COSTUME_KEYS } from './ui/screens.js';
import { Sound } from './sound.js';

const STEP_MS = 1000 / 60;
const MAX_CATCHUP = 5; // never let a background tab spiral into a huge catch-up
const COUNTDOWN = ['3', '2', '1', 'GO!'];
const BEAT = 50; // frames per countdown beat
const GAME_FRAMES = 150; // how long "GAME!" shows before results

const pressedAny = (s) =>
  s.jumpPressed || s.attackPressed || s.strongPressed || s.specialPressed || s.shieldPressed;

/** An idle menu pose, for figures on the title and select screens. */
const menuPose = (facing, frame, extra = {}) => ({
  kind: 'idle', t: 0, phase: null, move: null, frame, vx: 0, vy: 0, stride: 0, airborne: false, ox: 0, oy: 0, facing, ...extra,
});

export class App {
  constructor() {
    this.world = new World(document.getElementById('world'));
    this.inputs = BINDINGS.map((b) => new PlayerInput(b));
    this.sound = new Sound();

    // Portraits for the HUD, rendered once per costume from the 3D model.
    const portraits = () => Object.fromEntries(COSTUME_KEYS.map((k) => [k, this.world.portrait(paletteFor(k))]));
    this.portraits = portraits();
    // Redrawn once the sculpted model arrives; the HUD shares this object.
    modelReady.then((ok) => ok && Object.assign(this.portraits, portraits()));

    const ui = document.getElementById('ui');
    this.hud = new Hud(ui, this.portraits);
    this.screens = new Screens(ui, {
      start: () => this.goSelect(),
      pickCostume: (p, key) => this.pickCostume(p, key),
      toggleCpu: () => {
        this.p2IsCpu = !this.p2IsCpu;
        this.sound.blip();
        this.screens.renderSelect(this.costumes, this.p2IsCpu);
      },
      fight: () => this.startMatch(),
      rematch: () => this.startMatch(),
      changeCostumes: () => this.goSelect(),
      toggleMute: () => {
        this.sound.setMuted(!this.sound.muted);
        this.screens.setMuted(this.sound.muted);
      },
    });
    this.screens.setMuted(this.sound.muted);

    // Audio may only start after a tap or keypress (iPhone rule).
    const unlock = () => this.sound.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    this.costumes = ['default', 'ember'];
    this.p2IsCpu = true;
    this.match = null;
    this.events = []; // match events gathered by tick(), drawn and played by draw()
    this.frame = 0;
    this.modeFrame = 0;
    this.acc = 0;
    this.last = performance.now();
    this.cam = initialCamera(this.world.aspect);
    this.world.sky.onStrike = () => this.sound.thunder();

    // ?start=match skips the menus (used by the automated browser checks).
    if (new URLSearchParams(location.search).get('start') === 'match') this.startMatch(true);
    else this.goTitle();

    requestAnimationFrame((t) => this.loop(t));
  }

  // ------------------------------------------------------------- screens

  setMode(mode) {
    this.mode = mode;
    this.modeFrame = 0;
    this.screens.show(mode);
    this.hud.show(mode === 'match' || mode === 'gameover');
    // Touch buttons only during the fight; menus are tapped directly.
    document.body.classList.toggle('in-match', mode === 'match');
  }

  goTitle() {
    this.world.setFighters(this.costumes.map(paletteFor));
    this.setMode('title');
  }

  goSelect() {
    this.sound.confirm();
    this.world.setFighters(this.costumes.map(paletteFor));
    this.screens.renderSelect(this.costumes, this.p2IsCpu);
    this.setMode('select');
  }

  pickCostume(p, key) {
    // Two players in the same colours would be impossible to tell apart.
    if (this.costumes[1 - p] === key) return;
    this.costumes[p] = key;
    this.world.rooks[p]?.setPalette(paletteFor(key));
    this.screens.renderSelect(this.costumes, this.p2IsCpu);
    this.sound.blip();
  }

  /** Step a player's costume left or right, skipping the other player's. */
  cycleCostume(p, dir) {
    let i = COSTUME_KEYS.indexOf(this.costumes[p]);
    do i = (i + dir + COSTUME_KEYS.length) % COSTUME_KEYS.length;
    while (COSTUME_KEYS[i] === this.costumes[1 - p]);
    this.pickCostume(p, COSTUME_KEYS[i]);
  }

  startMatch(skipCountdown = false) {
    this.match = new Match({ costumes: [...this.costumes], p2IsCpu: this.p2IsCpu, seed: Date.now() & 0xffff });
    this.world.setFighters(this.match.fighters.map((f) => f.palette));
    this.hud.setup(this.match.fighters);
    this.cam = initialCamera(this.world.aspect);
    this.countdown = skipCountdown ? 0 : COUNTDOWN.length * BEAT;
    this.sound.confirm();
    this.setMode('match');
  }

  // ---------------------------------------------------------------- loop

  loop(now) {
    const elapsed = now - this.last;
    this.last = now;
    this.acc += Math.min(elapsed, STEP_MS * MAX_CATCHUP);
    const dt = Math.min(0.1, elapsed / 1000);
    let steps = 0;
    while (this.acc >= STEP_MS && steps < MAX_CATCHUP) {
      this.tick();
      this.acc -= STEP_MS;
      steps++;
    }
    this.draw(dt);
    requestAnimationFrame((t) => this.loop(t));
  }

  /** One fixed 60fps step. */
  tick() {
    this.frame++;
    this.modeFrame++;
    const states = this.inputs.map((i) => i.poll());

    switch (this.mode) {
      case 'title':
        if (states.some(pressedAny)) this.goSelect();
        break;

      case 'select':
        states.forEach((s, p) => {
          if (s.xPressed) {
            if (p === 1 && this.p2IsCpu) this.p2IsCpu = false; // they picked up a controller
            this.cycleCostume(p, s.x);
          }
        });
        if (this.modeFrame > 10 && (states[0].attackPressed || states[0].jumpPressed)) this.startMatch();
        break;

      case 'match':
        if (this.countdown > 0) {
          // Fighters wait for GO!; the text and beep change on each beat.
          this.countdown--;
          const beat = COUNTDOWN.length - 1 - Math.floor(this.countdown / BEAT);
          const text = COUNTDOWN[Math.min(beat, COUNTDOWN.length - 1)];
          if (text !== this.screens.countdownText) this.sound.count(text);
          this.screens.setCountdown(text);
          // GO! fires on the last beat; the fight starts as it appears.
          if (text !== 'GO!') break;
        } else if (this.screens.countdownText && this.modeFrame > 40) {
          this.screens.setCountdown('');
        }
        this.match.tick(states);
        this.events.push(...this.match.drainEvents());
        if (this.match.over) {
          this.sound.game();
          this.setMode('gameover');
        }
        break;

      case 'gameover':
        if (this.modeFrame >= GAME_FRAMES) {
          this.screens.renderResults(this.match);
          this.world.setFighters([this.match.winner.palette]);
          this.setMode('results');
        }
        break;

      case 'results':
        if (this.modeFrame > 30) {
          if (states[0].attackPressed || states[0].jumpPressed) this.startMatch();
          else if (states[0].specialPressed || states[0].shieldPressed) this.goSelect();
        }
        break;
    }
  }

  /** Draw the current screen. */
  draw(dt) {
    const w = this.world;
    const f = this.frame;

    if (this.mode === 'match' || this.mode === 'gameover') {
      const events = this.events;
      this.events = [];
      w.handleEvents(events);
      this.sound.handleEvents(events);

      const alive = this.match.fighters.filter((x) => x.state !== 'dead');
      const points = alive.map((x) => ({ x: x.x, y: x.y + x.char.body.h / 2 }));
      this.cam = frameCamera(this.cam, points, w.aspect);
      w.setView(this.cam);
      this.hud.update(this.match.fighters, this.match.p2IsCpu);
      // "GAME!": the world keeps moving in slow motion while the banner shows.
      w.render(this.match.fighters, this.mode === 'gameover' ? dt * 0.35 : dt);
      return;
    }

    // Menus: figures posed on the stage behind the panels.
    if (this.mode === 'title') {
      const [a, b] = w.rooks;
      a.root.position.set(-26, 0, 0);
      b.root.position.set(26, 0, 0);
      a.update(null, f, menuPose(1, f));
      b.update(null, f, menuPose(-1, f + 40));
      // Slow drift, so the title shot feels alive.
      w.setView({ x: Math.sin(f / 400) * 20, y: 26 + Math.sin(f / 300) * 4, halfH: 70 + Math.sin(f / 500) * 8 });
    } else if (this.mode === 'select') {
      const [a, b] = w.rooks;
      a.root.position.set(-24, 0, 0);
      b.root.position.set(24, 0, 0);
      a.update(null, f, menuPose(1, f));
      b.update(null, f, menuPose(-1, f + 40));
      w.setView({ x: 0, y: 30, halfH: 62 });
    } else if (this.mode === 'results') {
      // Victory pose: blade raised and lit, mid "Rising Storm".
      const [winner] = w.rooks;
      winner.root.position.set(0, 0, 0);
      winner.update(null, f, menuPose(1, f, { kind: 'attack', move: 'risingStorm', phase: 'active', t: 0.6 + Math.sin(f / 30) * 0.1 }));
      w.setView({ x: 18, y: 15, halfH: 34 });
    }
    w.render(null, dt);
  }

  /** For the automated browser checks and the console. */
  get fighters() {
    return this.match?.fighters ?? [];
  }
}

