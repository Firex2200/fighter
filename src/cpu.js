// CPU opponent. Produces exactly the input object PlayerInput.poll() produces, so
// the fighter cannot tell a CPU from a person and no game code special-cases it.
// No Phaser here: the whole AI runs in `node --test`.

import { STATE } from './fighter.js';
import { STAGE } from './stage.js';

const MAIN = STAGE.platforms.find((p) => p.solid);

const NEUTRAL = {
  x: 0,
  y: 0,
  jump: false,
  down: false,
  jumpPressed: false,
  downPressed: false,
  attackPressed: false,
  strongPressed: false,
};

/** Small deterministic RNG so tests and replays behave the same every run. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Reach, measured from Rook's hitboxes plus half a target's body width.
const JAB_REACH = 22;
const STRONG_REACH = 28;
const KILL_PERCENT = 80; // start going for the strong attack around here
const EDGE_MARGIN = 10; // stop chasing this far from the ledge

export class Cpu {
  /**
   * @param {number} seed       RNG seed
   * @param {number} reaction   average frames between decisions; higher = easier
   */
  constructor(seed = 1, reaction = 14) {
    this.random = rng(seed);
    this.reaction = reaction;
    this.wait = 0;
    this.shieldHold = 0;
  }

  /** Decide this frame's input for `self`, fighting `target`. */
  think(self, target) {
    const out = { ...NEUTRAL };
    if (self.state === STATE.DEAD || self.state === STATE.HITSTUN) return out;

    // Hold jump through the squat so every CPU jump is a full hop.
    if (self.state === STATE.JUMPSQUAT) {
      out.jump = true;
      return out;
    }

    // On the ledge: climb up once able, sometimes ledge-jump instead.
    if (self.state === STATE.LEDGE) {
      if (self.stateFrame > 10 + this.random() * 20) {
        if (this.random() < 0.25) out.jumpPressed = out.jump = true;
        else out.x = -self.ledge.side;
      }
      return out;
    }

    if (this.recovering(self)) return this.recover(self, out);

    // Keep a shield up for as long as it decided to.
    if (this.shieldHold > 0 && (self.state === STATE.SHIELD || self.canAct)) {
      this.shieldHold--;
      out.shield = true;
      return out;
    }

    // Reaction delay: a human cannot respond every frame, so neither does this.
    if (this.wait > 0) {
      this.wait--;
      return out;
    }

    if (target.state === STATE.DEAD) {
      out.x = Math.sign(-self.x); // drift back to centre while they respawn
      return out;
    }

    const dx = target.x - self.x;
    const dy = target.y - self.y;
    const dist = Math.abs(dx);
    const toward = Math.sign(dx) || 1;
    const inLine = Math.abs(dy) < 15;

    // Opponent starting an attack nearby: sometimes block it. Judged once, on
    // the attack's first frame; re-rolling every frame would block nearly all.
    const incoming = target.state === STATE.ATTACK && target.moveFrame <= 1;
    if (incoming && dist < 35 && inLine && self.canAct && !self.airborne && this.random() < 0.35) {
      this.shieldHold = 12 + Math.round(this.random() * 10);
      out.shield = true;
      return out;
    }

    if (self.canAct && inLine) {
      // Holding toward the target while attacking makes the swing face them.
      if (target.percent >= KILL_PERCENT && dist < STRONG_REACH) {
        out.x = toward;
        out.strongPressed = true;
        this.cooldown();
        return out;
      }
      if (dist < JAB_REACH) {
        out.x = toward;
        out.attackPressed = true;
        if (!self.airborne && this.random() < 0.3) out.y = -1; // mix in the low sweep
        this.cooldown();
        return out;
      }
      // Mid range on the ground: sometimes close the gap with Storm Draw.
      if (!self.airborne && dist > 32 && dist < 55 && this.random() < 0.04) {
        out.x = toward;
        out.specialPressed = true;
        this.cooldown();
        return out;
      }
    }

    // Opponent just overhead: up tilt to swat them.
    if (self.canAct && !self.airborne && dy > 12 && dy < 40 && dist < 14) {
      out.y = 1;
      out.attackPressed = true;
      this.cooldown();
      return out;
    }

    // Both in the air and close: forward or back aerial toward them.
    if (self.canAct && self.airborne && dist < 24 && Math.abs(dy) < 18) {
      out.x = toward;
      out.attackPressed = true;
      this.cooldown();
      return out;
    }

    // Opponent above and close: jump at them.
    if (dy > 20 && dist < 40 && self.canAct && !self.airborne) {
      out.jump = true;
      out.jumpPressed = true;
      this.cooldown();
      return out;
    }

    // Walk toward them, but never chase off the ledge. Account for momentum:
    // a running fighter slides some way after letting go of the stick.
    const stopDist = (self.vx * self.vx) / (2 * self.char.groundFriction);
    const ahead = self.x + toward * (stopDist + 2);
    if (!self.airborne && (ahead < MAIN.x1 + EDGE_MARGIN || ahead > MAIN.x2 - EDGE_MARGIN)) {
      return out;
    }
    if (dist > JAB_REACH * 0.7) out.x = toward;
    return out;
  }

  cooldown() {
    // Uniform around the average reaction time, never less than 4 frames.
    this.wait = Math.max(4, Math.round(this.reaction * (0.5 + this.random())));
  }

  /** Off the side of the main stage, or below it while still airborne. */
  recovering(self) {
    return self.airborne && (self.x < MAIN.x1 || self.x > MAIN.x2 || self.y < MAIN.y);
  }

  recover(self, out) {
    // Below the stage surface there is no way up through it, so first aim for
    // the column just outside the ledge, then come in over the top.
    const side = Math.sign(self.x) || 1;
    const aimX = self.y < MAIN.y + 4 ? side * (MAIN.x2 + 8) : 0;
    out.x = Math.sign(aimX - self.x);
    // Save the double jump until falling, so it buys the most height; then
    // Rising Storm as the last resort once below the stage.
    if (self.vy + self.launchY < 0 && self.canAct) {
      if (self.jumpsUsed < self.char.airJumps) {
        out.jump = true;
        out.jumpPressed = true;
      } else if (!self.airUses.has('risingStorm') && self.y < MAIN.y + 10) {
        out.y = 1;
        out.specialPressed = true;
        out.x = Math.sign(-self.x) || 1; // aim it back at the stage
      }
    }
    return out;
  }
}
