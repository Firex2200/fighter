// Fighter state machine and physics. Runs on a fixed 60fps step and knows nothing
// about Phaser -- the scene reads this state and draws it.
//
// Convention: y points UP, y is the position of the fighter's FEET.

import {
  LAUNCH_DECAY,
  SHIELD_DECAY,
  SHIELD_MAX,
  SHIELD_REGEN,
  resolveHit,
  shieldstun,
} from './combat.js';
import {
  JUMPSQUAT_FRAMES,
  LANDING_LAG_FRAMES,
  counterStrike,
  RESPAWN_FRAMES,
  RESPAWN_INVULN_FRAMES,
} from './characters.js';
import { STAGE, blastLineCrossed, findLanding } from './stage.js';

/** Input with nothing pressed, for frames the fighter is not in control. */
const NO_INPUT = { x: 0, y: 0, jump: false, down: false, jumpPressed: false, downPressed: false };

export const STATE = {
  IDLE: 'idle',
  JUMPSQUAT: 'jumpsquat',
  ATTACK: 'attack',
  LAG: 'lag', // landing lag, shield drop: committed, cannot act
  HITSTUN: 'hitstun',
  SHIELD: 'shield',
  SHIELDBREAK: 'shieldbreak',
  DODGE: 'dodge', // spot dodge or roll, on the ground
  AIRDODGE: 'airdodge',
  FREEFALL: 'freefall', // helpless: drift only, until landing or a ledge
  LEDGE: 'ledge',
  GETUP: 'getup',
  DEAD: 'dead',
};

/**
 * Defensive timings. Sources: SmashWiki (Shield, Air dodge, Ledge) where it gives
 * a number; values marked ~ are typical Ultimate frame data, not a documented
 * universal constant, and are the first thing to tune by feel.
 */
export const DEFENSE = {
  shieldDropLag: 11,
  spotDodge: { total: 26, intangible: [3, 17] }, // ~
  roll: { total: 31, intangible: [4, 15], move: [4, 22], distance: 30 }, // ~
  airDodgeNeutral: { total: 49, intangible: [3, 29], landingLag: 10 },
  airDodgeDirectional: { total: 60, intangible: [3, 19], slide: 15, speed: 2.6, landingLag: 14 },
  freefallLandingLag: 10, // ~
  ledgeIntangible: 40, // flat stand-in for Ultimate's airtime/% formula
  ledgeMaxHang: 390, // 6.5s, then you let go
  ledgeActable: 8, // ~ frames to finish grabbing before you can act
  ledgeRegrabCooldown: 30, // ~
  getup: 20, // ~ intangible climb onto the stage
  getupInset: 10, // where the climb puts you, measured in from the ledge
};

const MAIN = STAGE.platforms.find((p) => p.solid);
const LEDGES = [
  { x: MAIN.x1, y: MAIN.y, side: -1 },
  { x: MAIN.x2, y: MAIN.y, side: 1 },
];

export class Fighter {
  constructor(character, spawn, slot) {
    this.char = character;
    this.slot = slot;
    this.stocks = 3;
    this.reset(spawn);
  }

  reset(spawn) {
    this.x = spawn.x;
    this.y = spawn.y;
    this.vx = 0; // the fighter's own movement: running, jumping, falling
    this.vy = 0;
    // Knockback, tracked separately as Ultimate does: it decays at its own flat
    // rate while gravity acts only on vy, which stays capped at fall speed.
    // Summing the two into one vector let gravity compound with no cap, so every
    // launch nosedived and fighters died off the bottom instead of the side.
    this.launchX = 0;
    this.launchY = 0;
    this.facing = this.x < 0 ? 1 : -1;
    this.percent = 0;
    this.airborne = true;
    this.platform = null;
    this.ignorePlatform = null;
    this.jumpsUsed = 0; // counts AIR jumps only; the grounded jump is free
    this.fastFalling = false;
    this.state = STATE.IDLE;
    this.stateFrame = 0;
    this.lagFrames = 0;
    this.move = null;
    this.moveFrame = 0;
    this.hasHit = false;
    this.hitstunFrames = 0;
    this.invulnFrames = RESPAWN_INVULN_FRAMES;
    this.respawnTimer = 0;
    this.shieldHP = SHIELD_MAX;
    this.shieldstun = 0;
    this.breakFrames = 0;
    this.dodge = null;
    this.airDodge = null;
    this.airDodgeUsed = false;
    this.ledge = null;
    this.ledgeCooldown = 0;
    this.airUses = new Set(); // once-per-airtime moves already spent
  }

  get body() {
    const { w, h } = this.char.body;
    return { x1: this.x - w / 2, x2: this.x + w / 2, y1: this.y, y2: this.y + h };
  }

  /** World-space hitbox if an attack is in its active frames, else null. */
  get activeHitbox() {
    if (this.state !== STATE.ATTACK || !this.move) return null;
    const { startup, active, hitbox } = this.move;
    if (!hitbox) return null;
    if (this.moveFrame < startup || this.moveFrame >= startup + active) return null;
    const cx = this.x + hitbox.x * this.facing;
    const cy = this.y + this.char.body.h / 2 + hitbox.y;
    return {
      x1: cx - hitbox.w / 2,
      x2: cx + hitbox.w / 2,
      y1: cy - hitbox.h / 2,
      y2: cy + hitbox.h / 2,
    };
  }

  get canAct() {
    return this.state === STATE.IDLE;
  }

  /** Hits pass straight through. Derived from state, so it can never go stale. */
  get intangible() {
    const f = this.stateFrame;
    const within = ([a, b]) => f >= a && f <= b;
    switch (this.state) {
      case STATE.DODGE:
        return within(DEFENSE[this.dodge.kind].intangible);
      case STATE.AIRDODGE:
        return within(this.airDodge.spec.intangible);
      case STATE.LEDGE:
        return f <= DEFENSE.ledgeIntangible;
      case STATE.GETUP:
        return true;
      default:
        return false;
    }
  }

  /** In a counter stance's window: an incoming hit triggers a counter-strike. */
  get countering() {
    const w = this.state === STATE.ATTACK && this.move.counter;
    return !!w && this.moveFrame >= w[0] && this.moveFrame <= w[1];
  }

  get hittable() {
    return this.state !== STATE.DEAD && this.invulnFrames <= 0 && !this.intangible;
  }

  /** Advance one fixed 60fps frame. */
  step(input) {
    if (this.invulnFrames > 0) this.invulnFrames--;
    if (this.ledgeCooldown > 0) this.ledgeCooldown--;

    if (this.state === STATE.DEAD) {
      if (--this.respawnTimer <= 0) {
        const spawn = STAGE.spawns[this.slot];
        const stocks = this.stocks;
        this.reset(spawn);
        this.stocks = stocks;
      }
      return;
    }

    if (this.state !== STATE.SHIELD && this.state !== STATE.SHIELDBREAK) {
      this.shieldHP = Math.min(SHIELD_MAX, this.shieldHP + SHIELD_REGEN);
    }

    this.decayLaunch();
    if (this.state === STATE.HITSTUN) this.stepHitstun();
    else this.stepControlled(input);

    if (this.state !== STATE.LEDGE && this.state !== STATE.GETUP) this.integrate();
  }

  /** Launch speed bleeds off at a flat rate per frame, independent of direction. */
  decayLaunch() {
    const speed = Math.hypot(this.launchX, this.launchY);
    if (speed === 0) return;
    const next = Math.max(0, speed - LAUNCH_DECAY);
    this.launchX *= next / speed;
    this.launchY *= next / speed;
  }

  stepHitstun() {
    // No control, but gravity and air friction still act on his own velocity.
    this.applyMovement(NO_INPUT);

    if (--this.hitstunFrames <= 0) this.toIdle();
  }

  toIdle() {
    this.state = STATE.IDLE;
    this.stateFrame = 0;
  }

  enterLag(frames) {
    this.state = STATE.LAG;
    this.stateFrame = 0;
    this.lagFrames = frames;
  }

  stepControlled(input) {
    this.stateFrame++;

    switch (this.state) {
      case STATE.JUMPSQUAT:
        // Up + attack/special during the squat cancels the jump into the up
        // move, as Smash allows. This is what makes up-moves usable on a
        // keyboard, where W is both "up" and "jump".
        if (input.y > 0 && (input.attackPressed || input.strongPressed || input.specialPressed)) {
          this.startMove(input.specialPressed ? this.char.moves.risingStorm : this.char.moves.upTilt);
          break;
        }
        // Releasing jump during the 3 jumpsquat frames gives a short hop.
        if (!input.jump) this.shortHopQueued = true;
        if (this.stateFrame >= JUMPSQUAT_FRAMES) {
          this.vy = this.shortHopQueued ? this.char.shortHopVel : this.char.jumpVel;
          this.shortHopQueued = false;
          this.airborne = true;
          this.platform = null;
          this.fastFalling = false;
          this.toIdle();
        }
        break;

      case STATE.ATTACK: {
        this.moveFrame++;
        const m = this.move;
        if (m.impulse && this.moveFrame === m.impulse.frame) {
          this.vx = m.impulse.x * this.facing;
          if (this.airborne || m.impulse.y > 1) this.vy = m.impulse.y;
          if (!this.airborne && m.impulse.y > 1) {
            this.airborne = true; // a rising move leaves the ground
            this.platform = null;
          }
        }
        // Grounded moves stop at the ledge instead of carrying you off it.
        if (!this.airborne && this.platform) {
          const next = this.x + this.vx;
          if (next < this.platform.x1 + 2 || next > this.platform.x2 - 2) this.vx = 0;
        }
        if (this.moveFrame >= m.startup + m.active + m.recovery) {
          this.move = null;
          this.moveFrame = 0;
          this.hasHit = false;
          if (m.helpless && this.airborne) {
            this.state = STATE.FREEFALL;
            this.stateFrame = 0;
          } else {
            this.toIdle();
          }
        }
        break;
      }

      case STATE.LAG:
        if (this.stateFrame >= this.lagFrames) this.toIdle();
        break;

      case STATE.SHIELD:
        return this.stepShield(input);
      case STATE.SHIELDBREAK:
        if (this.stateFrame >= this.breakFrames) {
          this.shieldHP = SHIELD_MAX;
          this.toIdle();
        }
        return this.applyMovement(NO_INPUT);
      case STATE.DODGE:
        return this.stepDodge();
      case STATE.AIRDODGE:
        return this.stepAirDodge(input);
      case STATE.LEDGE:
        return this.stepLedge(input);
      case STATE.GETUP:
        return this.stepGetup();
    }

    // Movement and new actions are only available out of commitment states.
    if (this.state === STATE.IDLE) this.handleActions(input);
    this.applyMovement(input);
  }

  handleActions(input) {
    if (input.attackPressed || input.strongPressed || input.specialPressed) {
      // A grounded attack swings toward a held direction, as in Smash. Without
      // this, turning to face someone means running, which carries you past them.
      // Specials can be aimed in the air too (Smash's B-reverse), so an up
      // special while facing away from the stage can still head back to it.
      if ((!this.airborne || input.specialPressed) && input.x !== 0) this.facing = input.x;
      const move = this.pickMove(input);
      if (move.oncePerAir && this.airborne && this.airUses.has(move.name)) return;
      return this.startMove(move);
    }

    if (this.airborne) {
      if (input.shieldPressed && !this.airDodgeUsed) return this.startAirDodge(input);
    } else if (input.shield && this.shieldHP > 0) {
      this.state = STATE.SHIELD;
      this.stateFrame = 0;
      return;
    }

    if (input.jumpPressed) {
      if (!this.airborne) {
        this.startJumpsquat();
      } else if (this.jumpsUsed < this.char.airJumps) {
        this.jumpsUsed++;
        this.vy = this.char.doubleJumpVel;
        this.fastFalling = false;
        if (input.x !== 0) this.facing = input.x;
      }
      return;
    }

    // Drop through a soft platform.
    if (input.downPressed && !this.airborne && this.platform && !this.platform.solid) {
      this.ignorePlatform = this.platform;
      this.airborne = true;
      this.platform = null;
      this.y -= 0.5;
    }
  }

  /** Direction + button -> move, Smash style. Air moves are relative to facing. */
  pickMove(input) {
    const m = this.char.moves;
    if (input.specialPressed) {
      if (input.y > 0) return m.risingStorm;
      if (input.y < 0) return m.counter;
      return m.stormDraw;
    }
    if (this.airborne) {
      if (input.y > 0) return m.uair;
      if (input.y < 0) return m.dair;
      if (input.x === this.facing) return m.fair;
      if (input.x === -this.facing) return m.bair;
      return m.nair;
    }
    if (input.strongPressed) return m.strong;
    if (input.y > 0) return m.upTilt;
    if (input.y < 0) return m.downTilt;
    return m.jab;
  }

  startJumpsquat() {
    this.state = STATE.JUMPSQUAT;
    this.stateFrame = 0;
    this.shortHopQueued = false;
  }

  startMove(move) {
    // Plant the feet: a standing attack is not a dash attack, so it should not
    // carry a full run's momentum (that slid fighters ~30 units off ledges).
    if (!this.airborne) this.vx *= 0.25;
    // Spent until landing. A grounded move only counts if it takes you airborne.
    if (move.oncePerAir && (this.airborne || move.impulse?.y > 1)) this.airUses.add(move.name);
    this.state = STATE.ATTACK;
    this.stateFrame = 0;
    this.move = move;
    this.moveFrame = 0;
    this.hasHit = false;
  }

  // ---------------------------------------------------------------- shield

  stepShield(input) {
    if (this.airborne) return this.toIdle(); // shield only exists on the ground

    this.shieldHP -= SHIELD_DECAY;
    if (this.shieldHP <= 0) return this.breakShield();

    if (this.shieldstun > 0) {
      this.shieldstun--; // locked in place: cannot drop, dodge or jump
    } else if (input.jumpPressed) {
      this.startJumpsquat(); // jump out of shield
    } else if (input.downPressed) {
      this.startDodge('spotDodge', 0);
    } else if (input.xPressed) {
      this.startDodge('roll', input.x);
    } else if (!input.shield) {
      this.enterLag(DEFENSE.shieldDropLag);
    }
    this.applyMovement(NO_INPUT); // friction bleeds off any shield pushback
  }

  /** A hit landing on a raised shield: no damage, no launch, just shield wear. */
  blockHit(move, attackerFacing) {
    this.shieldHP -= move.damage;
    this.shieldstun = shieldstun(move.damage, move.aerial);
    this.vx = attackerFacing * Math.min(1.2, 0.2 + 0.08 * move.damage); // pushback
    if (this.shieldHP <= 0) this.breakShield();
    return { damage: move.damage, shielded: true };
  }

  breakShield() {
    this.state = STATE.SHIELDBREAK;
    this.stateFrame = 0;
    this.shieldHP = 0;
    this.shieldstun = 0;
    // Stun is shorter at higher %, per SmashWiki. ~ exact curve undocumented.
    this.breakFrames = Math.max(120, 300 - Math.round(this.percent));
    this.launchY = 2.2; // popped straight up
    this.airborne = true;
    this.platform = null;
  }

  // ----------------------------------------------------------------- dodges

  startDodge(kind, dir) {
    this.state = STATE.DODGE;
    this.stateFrame = 0;
    this.dodge = { kind, dir };
  }

  stepDodge() {
    const spec = DEFENSE[this.dodge.kind];
    const f = this.stateFrame;

    if (this.dodge.kind === 'roll' && f >= spec.move[0] && f < spec.move[1]) {
      this.vx = (this.dodge.dir * spec.distance) / (spec.move[1] - spec.move[0]);
      // Rolls stop at the ledge rather than carrying you off the stage.
      const next = this.x + this.vx;
      if (this.platform && (next < this.platform.x1 + 2 || next > this.platform.x2 - 2)) this.vx = 0;
    } else {
      this.vx = 0;
    }

    if (f >= spec.total) {
      // A roll ends facing back the way you came, so you can punish behind you.
      if (this.dodge.kind === 'roll') this.facing = -this.dodge.dir;
      this.dodge = null;
      this.toIdle();
    }
  }

  startAirDodge(input) {
    const len = Math.hypot(input.x, input.y);
    const directional = len > 0;
    const spec = directional ? DEFENSE.airDodgeDirectional : DEFENSE.airDodgeNeutral;
    this.airDodge = { directional, spec };
    this.airDodgeUsed = true; // one per airtime
    this.fastFalling = false;
    this.state = STATE.AIRDODGE;
    this.stateFrame = 0;
    if (directional) {
      this.vx = (input.x / len) * spec.speed;
      this.vy = (input.y / len) * spec.speed;
      this.launchX = 0;
      this.launchY = 0;
    }
  }

  stepAirDodge(input) {
    const { directional, spec } = this.airDodge;
    if (directional && this.stateFrame <= spec.slide) {
      // The burst of movement slows to a stop; gravity is held off meanwhile.
      this.vx *= 0.86;
      this.vy *= 0.86;
    } else {
      this.applyMovement(directional ? NO_INPUT : input, !directional);
    }

    if (this.stateFrame >= spec.total) {
      this.airDodge = null;
      // A directional dodge spends your recovery: helpless until you land.
      if (directional) {
        this.state = STATE.FREEFALL;
        this.stateFrame = 0;
      } else {
        this.toIdle();
      }
    }
  }

  // ----------------------------------------------------------------- ledges

  /** Snap to a ledge if falling past one with hands in reach. */
  tryGrabLedge() {
    if (!this.airborne || this.ledgeCooldown > 0) return;
    const grabbable = [STATE.IDLE, STATE.AIRDODGE, STATE.FREEFALL];
    const recoveryMove = this.state === STATE.ATTACK && this.move.ledgeGrab;
    if (!grabbable.includes(this.state) && !recoveryMove) return;
    if (this.vy + this.launchY > 0) return; // only on the way down

    const h = this.char.body.h;
    for (const L of LEDGES) {
      const outward = (this.x - L.x) * L.side;
      // The ledge has to be level with his upper body, not his feet: otherwise
      // simply walking off the edge would snap you straight onto it.
      const ledgeAboveFeet = L.y - this.y;
      if (outward >= -4 && outward <= 16 && ledgeAboveFeet >= h * 0.4 && ledgeAboveFeet <= h + 6) {
        return this.grabLedge(L);
      }
    }
  }

  grabLedge(L) {
    this.state = STATE.LEDGE;
    this.stateFrame = 0;
    this.ledge = L;
    this.x = L.x + L.side * (this.char.body.w / 2 + 0.5);
    this.y = L.y - this.char.body.h * 0.85;
    this.vx = this.vy = this.launchX = this.launchY = 0;
    this.facing = -L.side;
    this.airborne = true;
    this.platform = null;
    this.fastFalling = false;
    // Grabbing the ledge refreshes your double jump and air dodge.
    this.jumpsUsed = 0;
    this.airDodgeUsed = false;
    this.airDodge = null;
    this.airUses.clear();
    this.move = null;
    this.hasHit = false;
  }

  stepLedge(input) {
    const L = this.ledge;
    if (this.stateFrame > DEFENSE.ledgeMaxHang) return this.leaveLedge();
    if (this.stateFrame < DEFENSE.ledgeActable) return;

    if (input.jumpPressed) {
      // Ledge jump: up and slightly in, so he comes down on top of the stage.
      this.vy = this.char.jumpVel;
      this.vx = -L.side * 0.8;
      this.leaveLedge(0);
    } else if (input.downPressed || input.x === L.side) {
      this.leaveLedge();
    } else if (input.x === -L.side || input.y > 0) {
      this.state = STATE.GETUP;
      this.stateFrame = 0;
    }
  }

  leaveLedge(cooldown = DEFENSE.ledgeRegrabCooldown) {
    this.ledge = null;
    this.ledgeCooldown = cooldown;
    this.airborne = true;
    this.toIdle();
  }

  stepGetup() {
    if (this.stateFrame < DEFENSE.getup) return;
    const L = this.ledge;
    this.x = L.x - L.side * DEFENSE.getupInset;
    this.ledge = null;
    this.land(MAIN);
    this.toIdle();
  }

  // ---------------------------------------------------------------- physics

  applyMovement(input, steerable = this.isSteerable()) {
    const c = this.char;

    if (!this.airborne) {
      if (this.state === STATE.IDLE && input.x !== 0) {
        this.vx = input.x * c.runSpeed;
        this.facing = input.x;
      } else {
        // Friction, applied toward zero without overshooting into a jitter.
        const drop = Math.min(Math.abs(this.vx), c.groundFriction);
        this.vx -= Math.sign(this.vx) * drop;
      }
      return;
    }

    if (steerable && input.x !== 0) {
      this.vx += input.x * c.airAccel;
      this.vx = Math.max(-c.maxAirSpeed, Math.min(c.maxAirSpeed, this.vx));
    } else {
      const drop = Math.min(Math.abs(this.vx), c.airFriction);
      this.vx -= Math.sign(this.vx) * drop;
    }

    // Fastfall: only once per airtime, and only while already descending.
    if (input.downPressed && this.vy < 0) this.fastFalling = true;

    this.vy -= c.gravity;
    const terminal = this.fastFalling ? -c.fastFallSpeed : -c.fallSpeed;
    if (this.vy < terminal) this.vy = terminal;
  }

  isSteerable() {
    if (this.state === STATE.ATTACK) return !this.move.noDrift;
    return this.state === STATE.IDLE || this.state === STATE.FREEFALL;
  }

  integrate() {
    const prevY = this.y;
    this.x += this.vx + this.launchX;
    this.y += this.vy + this.launchY;

    if (this.airborne) {
      const landed = findLanding(prevY, this.x, this.y, this.vy + this.launchY, this.ignorePlatform);
      if (landed) this.land(landed);
      else this.tryGrabLedge();
    } else if (this.platform) {
      if (this.x < this.platform.x1 || this.x > this.platform.x2) {
        this.airborne = true; // walked off the edge
        this.platform = null;
        if (this.state === STATE.SHIELD) this.toIdle();
      } else {
        // Stay pinned to the surface; without this, gravity accumulated during
        // hitstun would drag a grounded fighter straight through the stage.
        this.y = this.platform.y;
        this.vy = 0;
      }
    }

    // Clear the drop-through exemption once clear of that platform.
    if (this.ignorePlatform && this.y < this.ignorePlatform.y - 4) this.ignorePlatform = null;
  }

  land(platform) {
    this.y = platform.y;
    this.vy = 0;
    this.launchX = 0;
    this.launchY = 0;
    this.airborne = false;
    this.platform = platform;
    this.jumpsUsed = 0;
    this.airDodgeUsed = false;
    this.airUses.clear();
    this.fastFalling = false;
    this.ignorePlatform = null;

    // Landing out of a committed aerial state costs a few frames.
    if (this.state === STATE.ATTACK || this.state === STATE.HITSTUN) {
      const lag = (this.state === STATE.ATTACK && this.move.landingLag) || LANDING_LAG_FRAMES;
      this.move = null;
      this.hasHit = false;
      this.hitstunFrames = 0;
      this.enterLag(lag);
    } else if (this.state === STATE.AIRDODGE) {
      this.enterLag(this.airDodge.spec.landingLag);
      this.airDodge = null;
    } else if (this.state === STATE.FREEFALL) {
      this.enterLag(DEFENSE.freefallLandingLag);
    }
  }

  /** Apply a connecting hit from the opponent. */
  takeHit(move, attackerFacing) {
    const hit = resolveHit(move, { percent: this.percent, weight: this.char.weight, airborne: this.airborne }, attackerFacing);
    this.percent = hit.percent;
    this.vx = 0;
    this.vy = 0;
    this.launchX = hit.velocity.x;
    this.launchY = hit.velocity.y;
    this.hitstunFrames = hit.hitstun;
    this.state = STATE.HITSTUN;
    this.stateFrame = 0;
    this.move = null;
    this.moveFrame = 0;
    this.airborne = true;
    this.platform = null;
    this.fastFalling = false;
    this.jumpsUsed = 0;
    this.airDodgeUsed = false; // getting hit refreshes the air dodge
    this.airUses.clear();
    this.airDodge = null;
    this.dodge = null;
    this.ledge = null;
    this.shieldstun = 0;
    return hit;
  }

  /** @returns the blast line crossed this frame, or null. Decrements stocks. */
  checkKO() {
    if (this.state === STATE.DEAD) return null;
    const line = blastLineCrossed(this.x, this.y);
    if (!line) return null;
    this.stocks--;
    this.state = STATE.DEAD;
    this.respawnTimer = RESPAWN_FRAMES;
    this.vx = 0;
    this.vy = 0;
    this.launchX = 0;
    this.launchY = 0;
    return line;
  }
}

/** Axis-aligned overlap test, shared by hitbox-vs-hurtbox checks. */
export function overlaps(a, b) {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

/**
 * Resolve attacks between two fighters for this frame. Each attack connects at
 * most once per use, so multi-frame hitboxes don't machine-gun the opponent.
 * @returns {Array<{attacker, defender, hit, shielded}>}
 */
export function resolveCombat(fighters) {
  const events = [];
  for (const attacker of fighters) {
    if (attacker.hasHit) continue;
    const hitbox = attacker.activeHitbox;
    if (!hitbox) continue;

    for (const defender of fighters) {
      if (defender === attacker) continue;
      if (!defender.hittable) continue;
      if (!overlaps(hitbox, defender.body)) continue;

      attacker.hasHit = true;

      if (defender.countering) {
        // Thunder Guard: the hit is caught and answered.
        defender.facing = Math.sign(attacker.x - defender.x) || defender.facing;
        const hit = attacker.takeHit(counterStrike(attacker.move.damage), defender.facing);
        defender.move = null;
        defender.enterLag(12);
        defender.invulnFrames = Math.max(defender.invulnFrames, 15);
        events.push({ attacker: defender, defender: attacker, hit, countered: true });
        break;
      }

      const shielded = defender.state === STATE.SHIELD;
      const hit = shielded
        ? defender.blockHit(attacker.move, attacker.facing)
        : defender.takeHit(attacker.move, attacker.facing);
      events.push({ attacker, defender, hit, shielded });
      break;
    }
  }
  return events;
}
