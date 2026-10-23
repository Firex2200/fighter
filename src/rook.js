// Rook Ashvane — "The Wandering Storm". Costume palettes and pose data.
//
// This module decides WHERE every part of Rook is for any game state; it draws
// nothing. The 3D model (src/render/rook3d.js) follows `rigPose()`, so animation
// timing lives in one place and could drive a different model later.
//
// Character space: percentages of his total height. x is FORWARD (the way he
// faces), y is UP from the ground. Layout from the concept's model sheet, about
// 4 heads tall: crown 100 · chin 76 · shoulders 74 · obi 50-57 · hem 7 · ground 0.

import { STATE, DEFENSE } from './fighter.js';

/** Fixed colours, identical across every costume (from the concept sheet). */
const BASE = {
  straw: 0xc49a4c, // hat and sandal soles
  hair: 0x232a50, // night-blue hair
  skin: 0xf2d2b3,
  gold: 0xe0a23a, // headband, hilt wrap, tassels, scabbard fittings
  collar: 0xebe3d6, // white inner collar
  wrap: 0x23263a, // wrist and shin wraps
  wrapStripe: 0xd8d0c2,
  strap: 0x2a2228, // sandal straps
  steel: 0x8f9bb8,
  scabbard: 0x15161d,
  ink: 0x12141f,
};

/**
 * The four costumes from the concept sheet's ALT COLORS row: kimono, its sleeve
 * pattern, the sash (obi) and the hakama change per costume. Sampled from the
 * sheet (averaged patches, lit areas, paper tint discounted). `spark` is the
 * storm glow: eyes, blade edge, effects.
 */
export const COSTUMES = {
  default: { name: 'Indigo', kimono: 0x3e4573, pattern: 0xd6cdc6, obi: 0xe29b3c, hakama: 0x3a3537, spark: 0x3fe6d4 },
  ember: { name: 'Ember', kimono: 0xa8432f, pattern: 0xd08a72, obi: 0xe5993c, hakama: 0x573d31, spark: 0xffca4a },
  frost: { name: 'Frost', kimono: 0xe6ded8, pattern: 0x6a86c6, obi: 0x9aa3c2, hakama: 0x5a5658, spark: 0xa0e8ff },
  moss: { name: 'Moss', kimono: 0x56614a, pattern: 0xb5ae98, obi: 0xc4ac8c, hakama: 0x554739, spark: 0x7cefa1 },
};

export function paletteFor(costumeKey) {
  return { ...BASE, ...COSTUMES[costumeKey] };
}

/**
 * How the blade moves through each attack. Angles in degrees, character space:
 * 0 forward, 90 up, 180 behind, -90 down. The blade goes from `windup` (end of
 * startup) to `strike` (end of the active frames), then lowers and is sheathed.
 * `lean` is body lean at windup and at strike (negative leans forward).
 */
export const ARCS = {
  jab: { windup: 25, strike: -5, lean: [2, -8] },
  upTilt: { windup: -40, strike: 115, lean: [6, -4] },
  downTilt: { windup: 15, strike: -40, lean: [0, -6], crouch: 0.82 },
  strong: { windup: 155, strike: -20, lean: [12, -16] },
  nair: { spin: true },
  fair: { windup: 120, strike: -55, lean: [6, -12] },
  bair: { windup: 190, strike: 182, lean: [-6, 10], stab: true },
  uair: { windup: 15, strike: 165, lean: [0, 6] },
  dair: { windup: -70, strike: -90, lean: [0, 0], stab: true },
  // Drawn from the hip during startup, so the blade already leads the dash
  // when the hitbox comes out in front of him.
  stormDraw: { windup: -12, strike: 6, lean: [4, -22], lit: true },
  risingStorm: { windup: 70, strike: 95, lean: [0, 8], lit: true, stretch: true },
  counter: { windup: 78, strike: 78, lean: [6, 6], guard: true },
};

export const ease = (t) => t * t * (3 - 2 * t);
export const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Where the sword arm's shoulder sits, in character space. */
export const SHOULDER = [2, 70];

/**
 * Read a fighter into a pose. The only place the art looks at game state.
 * @param f      Fighter
 * @param frame  free-running frame counter
 */
export function poseOf(f, frame) {
  const p = {
    kind: 'idle',
    t: 0,
    phase: null,
    move: null,
    frame,
    // Velocity in character space (forward-positive), for trailing hair and cloth.
    vx: (f.vx + f.launchX) * f.facing,
    vy: f.vy + f.launchY,
    stride: f.x * f.facing * 0.18,
    airborne: f.airborne,
    ox: 0,
    oy: 0,
  };

  switch (f.state) {
    case STATE.IDLE:
      p.kind = f.airborne ? 'air' : Math.abs(f.vx) > 0.3 ? 'run' : 'idle';
      break;
    case STATE.JUMPSQUAT:
    case STATE.LAG:
      p.kind = 'squat';
      break;
    case STATE.ATTACK: {
      const m = f.move;
      const a = m.startup;
      const b = a + m.active;
      const k = f.moveFrame;
      p.kind = 'attack';
      p.move = m.name;
      if (k < a) {
        p.phase = 'startup';
        p.t = a ? k / a : 1;
      } else if (k < b) {
        p.phase = 'active';
        p.t = (k - a) / Math.max(1, m.active);
      } else {
        p.phase = 'recovery';
        p.t = (k - b) / Math.max(1, m.recovery);
      }
      // Thunder Guard has no hitbox; it "lights" while the counter window is open.
      if (m.counter) p.glow = k >= m.counter[0] && k <= m.counter[1];
      break;
    }
    case STATE.HITSTUN:
      p.kind = Math.hypot(f.launchX, f.launchY) > 1.5 ? 'tumble' : 'flinch';
      break;
    case STATE.SHIELD:
      p.kind = 'shield';
      break;
    case STATE.SHIELDBREAK:
      p.kind = 'dizzy';
      break;
    case STATE.DODGE:
      p.kind = f.dodge.kind === 'roll' ? 'roll' : 'spotdodge';
      p.t = f.stateFrame / DEFENSE[f.dodge.kind].total;
      break;
    case STATE.AIRDODGE:
      p.kind = 'airdodge';
      break;
    case STATE.FREEFALL:
      p.kind = 'freefall';
      break;
    case STATE.LEDGE:
      p.kind = 'ledge';
      break;
    case STATE.GETUP: {
      // The sim holds him on the ledge then places him on the stage at the end;
      // the drawing climbs between the two so it reads as one motion.
      const L = f.ledge;
      const h = f.char.body.h;
      p.kind = 'getup';
      p.t = clamp(f.stateFrame / DEFENSE.getup, 0, 1);
      const endX = L.x - L.side * DEFENSE.getupInset;
      p.ox = (((endX - f.x) * f.facing) / h) * 100;
      p.oy = ((L.y - f.y) / h) * 100;
      break;
    }
  }
  return p;
}

/** Blade angle (deg), glow and length for the current attack frame. */
export function bladeFor(pose, arc) {
  if (arc.spin) {
    // Neutral air: one full turn through the active frames.
    if (pose.phase === 'startup') return { a: lerp(-60, 0, pose.t), lit: false };
    if (pose.phase === 'active') return { a: 360 * pose.t, lit: true };
    return { a: lerp(360, 300, pose.t), lit: false };
  }
  if (pose.phase === 'startup') return { a: lerp(-60, arc.windup, ease(pose.t)), lit: !!arc.lit };
  if (pose.phase === 'active') return { a: lerp(arc.windup, arc.strike, ease(pose.t)), lit: true };
  return { a: lerp(arc.strike, -60, ease(pose.t)), lit: !!arc.lit && pose.t < 0.3 };
}

/**
 * Turn a pose into concrete positions: body lean/squash, where each foot and
 * the sword hand go, the blade's angle, and the trailing hair. Pure data, in
 * character space, so any renderer can follow it.
 */
export function rigPose(pose) {
  const t = pose.frame;
  const idleSway = Math.sin(t / 26) * 0.8;
  const arc = pose.move ? ARCS[pose.move] : null;

  const r = {
    angle: 0, // degrees, positive leans back
    pivotY: 30,
    sy: 1,
    ox: pose.ox,
    oy: pose.oy,
    bob: 0,
    frontFoot: 5,
    backFoot: -6,
    frontLift: 0,
    backLift: 0,
    // Ponytail and headband tails trail against his motion (the concept's
    // "physics bones").
    trailX: clamp(-pose.vx * 3, -8, 8) - 1,
    trailY: clamp(-pose.vy * 3, -8, 8) + (pose.kind === 'idle' ? idleSway : 0),
    hand: [10, 60],
    blade: null, // drawn blade during an attack, else sheathed
    eyeOpen: 1,
    dim: pose.kind === 'freefall',
    stars: pose.kind === 'dizzy',
  };

  switch (pose.kind) {
    case 'idle':
      r.bob = idleSway;
      break;
    case 'run':
      r.angle = -9;
      r.bob = Math.abs(Math.sin(pose.stride)) * 1.6;
      break;
    case 'squat':
      r.sy = 0.86;
      break;
    case 'shield':
      r.sy = 0.94;
      r.angle = 4;
      break;
    case 'spotdodge':
      r.angle = 14 * Math.sin(Math.PI * pose.t);
      break;
    case 'roll':
      r.sy = 0.72;
      r.angle = -360 * ease(pose.t);
      r.pivotY = 40;
      break;
    case 'airdodge':
      r.angle = -8;
      break;
    case 'flinch':
      r.angle = 16;
      break;
    case 'tumble':
      r.angle = (t * 14) % 360;
      r.pivotY = 50;
      break;
    case 'dizzy':
      r.angle = Math.sin(t / 7) * 10;
      break;
    case 'ledge':
      r.angle = -6;
      break;
    case 'getup':
      r.sy = lerp(0.8, 1, ease(pose.t));
      r.ox *= ease(pose.t);
      r.oy *= ease(pose.t);
      break;
    case 'attack': {
      const lean = arc.lean ?? [0, 0];
      if (pose.phase === 'startup') r.angle = lerp(0, lean[0], ease(pose.t));
      else if (pose.phase === 'active') r.angle = lerp(lean[0], lean[1], ease(pose.t));
      else r.angle = lerp(lean[1], 0, ease(pose.t));
      if (arc.crouch) r.sy = arc.crouch;
      if (arc.stretch && pose.phase !== 'recovery') r.sy = 1.08;
      break;
    }
  }

  // ------------------------------------------------------------------ feet
  const airborne = pose.airborne && pose.kind !== 'ledge';
  if (pose.kind === 'run') {
    const s = Math.sin(pose.stride);
    r.frontFoot = 4 + s * 8;
    r.backFoot = -5 - s * 8;
    r.frontLift = Math.max(0, Math.cos(pose.stride)) * 5;
    r.backLift = Math.max(0, -Math.cos(pose.stride)) * 5;
  } else if (airborne || pose.kind === 'ledge') {
    // Rising: knees tucked. Falling or hanging: legs hang loose.
    const tuck = pose.vy > 0 ? 9 : 3;
    r.frontFoot = 7;
    r.backFoot = -4;
    r.frontLift = tuck;
    r.backLift = tuck * 0.6;
  } else if (pose.kind === 'shield' || pose.kind === 'squat') {
    r.frontFoot = 8;
    r.backFoot = -9;
  }

  // ------------------------------------------------------- sword hand, blade
  const handAt = (aDeg, reach = 11) => {
    const rad = (aDeg * Math.PI) / 180;
    return [SHOULDER[0] + Math.cos(rad) * reach, SHOULDER[1] + Math.sin(rad) * reach];
  };
  if (pose.kind === 'attack') {
    const { a, lit } = bladeFor(pose, arc);
    r.hand = handAt(a);
    r.blade = {
      a,
      lit: lit || !!pose.glow,
      // A thrust extends the blade through the active frames; a swing keeps it full.
      len: arc.stab && pose.phase === 'active' ? lerp(26, 40, ease(pose.t)) : 34,
      trail: pose.phase === 'active' && !arc.stab && !arc.guard,
    };
  } else {
    switch (pose.kind) {
      case 'ledge':
        r.hand = [32, 84];
        break;
      case 'getup':
        r.hand = [lerp(32, 12, ease(pose.t)), lerp(84, 64, ease(pose.t))];
        break;
      case 'freefall':
      case 'tumble':
        r.hand = handAt(100 + Math.sin(pose.frame / 3) * 25);
        break;
      case 'shield':
        r.hand = [13, 66];
        break;
      case 'run':
        r.hand = [8 + Math.sin(pose.stride + Math.PI) * 6, 60];
        break;
      default:
        r.hand = [10, 60 + (pose.kind === 'idle' ? idleSway : 0)];
    }
  }

  if (pose.kind === 'dizzy' || pose.kind === 'freefall') r.eyeOpen = 0.35;
  return r;
}
