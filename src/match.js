// One match: two fighters, the CPU, hitlag, stats, and the events the renderer
// and sound react to. No drawing and no DOM, so a whole match runs in node.

import { CHARACTERS } from './characters.js';
import { Fighter, STATE, resolveCombat } from './fighter.js';
import { STAGE } from './stage.js';
import { Cpu } from './cpu.js';
import { paletteFor } from './rook.js';

/**
 * Freeze frames on impact. shortcut: this is a feel approximation, not Ultimate's
 * real hitlag formula, which the research pass did not confirm. Upgrade if hits
 * ever feel mistimed relative to the real game.
 */
export function hitlagFrames(damage) {
  return Math.floor(damage * 0.65) + 5;
}

/** True if a player's input this frame shows a human is there. */
export function touchedAnything(s) {
  return s.x !== 0 || s.down || s.jump || s.attackPressed || s.strongPressed || s.specialPressed;
}

export class Match {
  /**
   * @param costumes  costume key per player, e.g. ['default', 'ember']
   * @param p2IsCpu   whether player 2 starts as the CPU
   * @param seed      CPU randomness
   */
  constructor({ costumes = ['default', 'ember'], p2IsCpu = true, seed = 1 } = {}) {
    this.fighters = costumes.map((costume, i) => {
      const f = new Fighter(CHARACTERS.rook, STAGE.spawns[i], i);
      f.costume = costume;
      f.palette = paletteFor(costume);
      return f;
    });
    this.cpu = new Cpu(seed);
    this.p2IsCpu = p2IsCpu;
    this.hitlag = 0;
    this.frame = 0;
    this.over = false;
    this.winner = null;
    this.events = []; // read and cleared by whoever renders the frame
    this.stats = this.fighters.map(() => ({ kos: 0, falls: 0, damageDealt: 0, hardestHit: 0 }));
    this.lastHitBy = [null, null];
    this.prev = this.fighters.map((f) => ({ airborne: f.airborne, state: f.state, jumps: f.jumpsUsed }));
  }

  /**
   * Advance one 60fps frame.
   * @param states  input per player; player 2's is ignored while the CPU plays
   */
  tick(states) {
    this.frame++;
    if (this.over) return;
    states = [...states];
    if (this.p2IsCpu && states[1] && touchedAnything(states[1])) this.p2IsCpu = false;
    if (this.p2IsCpu) states[1] = this.cpu.think(this.fighters[1], this.fighters[0]);

    // Hitlag freezes the simulation; input is still read above so presses
    // during the freeze aren't lost.
    if (this.hitlag > 0) {
      this.hitlag--;
      return;
    }

    this.fighters.forEach((f, i) => f.step(states[i]));

    for (const e of resolveCombat(this.fighters)) {
      this.hitlag = Math.max(this.hitlag, hitlagFrames(e.hit.damage));
      const a = e.attacker.slot;
      if (!e.shielded) {
        this.stats[a].damageDealt += e.hit.damage;
        this.stats[a].hardestHit = Math.max(this.stats[a].hardestHit, e.hit.kb ?? 0);
        this.lastHitBy[e.defender.slot] = a;
      }
      this.events.push({
        type: e.countered ? 'counter' : e.shielded ? 'block' : 'hit',
        attacker: e.attacker,
        defender: e.defender,
        damage: e.hit.damage,
        kb: e.hit.kb ?? 0,
        x: (e.attacker.x + e.defender.x) / 2,
        y: e.defender.y + e.defender.char.body.h / 2,
      });
    }

    this.fighters.forEach((f, i) => {
      const x = f.x;
      const y = f.y;
      const line = f.checkKO();
      if (line) {
        this.stats[i].falls++;
        const by = this.lastHitBy[i];
        if (by !== null && by !== i) this.stats[by].kos++;
        this.lastHitBy[i] = null;
        this.events.push({ type: 'ko', fighter: f, line, x, y, final: f.stocks <= 0 });
        if (f.stocks <= 0 && !this.over) {
          this.over = true;
          this.winner = this.fighters.find((o) => o !== f);
        }
      }
    });

    this.detectMotionEvents();
  }

  /** Landings, jumps, ledge grabs and respawns, for dust, puffs and sounds. */
  detectMotionEvents() {
    this.fighters.forEach((f, i) => {
      const p = this.prev[i];
      if (p.airborne && !f.airborne && f.state !== STATE.DEAD) this.events.push({ type: 'land', fighter: f });
      if (!p.airborne && f.airborne && f.vy > 0) this.events.push({ type: 'jump', fighter: f });
      if (f.airborne && f.jumpsUsed > p.jumps) this.events.push({ type: 'jump', fighter: f, air: true });
      if (f.state === STATE.LEDGE && p.state !== STATE.LEDGE) this.events.push({ type: 'ledge', fighter: f });
      if (p.state === STATE.DEAD && f.state !== STATE.DEAD) this.events.push({ type: 'respawn', fighter: f });
      if (f.state === STATE.ATTACK && p.state !== STATE.ATTACK && f.move) {
        this.events.push({ type: 'swing', fighter: f, move: f.move.name });
      }
      this.prev[i] = { airborne: f.airborne, state: f.state, jumps: f.jumpsUsed };
    });
  }

  /** Hand the frame's events to the caller and start a fresh list. */
  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
