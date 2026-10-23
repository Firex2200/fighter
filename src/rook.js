// Rook Ashvane — "The Wandering Storm". Drawn in code from named palette slots
// rather than loaded as a flat image, because the concept defines alt costumes as
// three-colour swaps (kimono / obi / spark). Recolouring is therefore exact, not
// a hue shift, and the art scales to any screen without sprite assets.
//
// Proportions follow the model sheet: about 4 heads tall, big head and hands for
// gameplay readability. Traveller's kimono, wide hakama, straw sandals, woven hat
// slung on the back, long blade through the obi at the left hip.
//
// Character space: percentages of total height. x is FORWARD (the way he faces),
// y is UP from the ground. Layout: crown 100 · chin 76 · shoulders 74 · obi 50-57
// · hem 7 · ground 0. Animation is drawing only; it never changes gameplay.

import { STATE, DEFENSE } from './fighter.js';

/** Fixed colours, identical across every costume. */
const BASE = {
  hakama: 0x2b2e40, // Hakama charcoal
  straw: 0xc49a4c, // Straw
  hair: 0x1d2040, // Night hair
  skin: 0xf2d2b3,
  sandal: 0xf3ead6,
  steel: 0x8f9bb8, // blade, light enough to read on a dark stage
  ink: 0x12141f,
};

/**
 * The four costumes from the concept sheet. Only three slots change per costume —
 * values sampled directly from the document, not estimated.
 */
export const COSTUMES = {
  default: { name: 'Default', kimono: 0x2e3271, obi: 0xf1a93b, spark: 0x3fe6d4 },
  ember: { name: 'Ember', kimono: 0x3a3a42, obi: 0xe06039, spark: 0xffca4a },
  frost: { name: 'Frost', kimono: 0xdce4ef, obi: 0x4d7fd6, spark: 0xa0e8ff },
  moss: { name: 'Moss', kimono: 0x1f3b2d, obi: 0xc9d45c, spark: 0x7cefa1 },
};

export function paletteFor(costumeKey) {
  return { ...BASE, ...COSTUMES[costumeKey] };
}

/** Darken every colour in a palette, for the helpless (freefall) look. */
const dimmed = new WeakMap();
function dim(pal) {
  if (!dimmed.has(pal)) {
    const shade = (c) => {
      const k = 0.5;
      return (((c >> 16) & 255) * k) << 16 | (((c >> 8) & 255) * k) << 8 | ((c & 255) * k);
    };
    dimmed.set(pal, Object.fromEntries(Object.entries(pal).map(([k, v]) => [k, typeof v === 'number' ? shade(v) : v])));
  }
  return dimmed.get(pal);
}

/**
 * How the blade moves through each attack. Angles in degrees, character space:
 * 0 forward, 90 up, 180 behind, -90 down. The blade goes from `windup` (end of
 * startup) to `strike` (end of the active frames), then lowers and is sheathed.
 * `lean` is body lean at windup and at strike (negative leans forward).
 */
const ARCS = {
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

const ease = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Read a fighter into a drawing pose. The only place the art looks at game state.
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

/**
 * Draw Rook into a Phaser Graphics object.
 * @param g       Phaser.GameObjects.Graphics
 * @param feetX   screen x of the centre of his feet
 * @param feetY   screen y of the ground under him
 * @param h       total height in pixels (crown to ground)
 * @param facing  +1 right, -1 left
 * @param palette result of paletteFor()
 * @param pose    result of poseOf()
 */
export function drawRook(g, feetX, feetY, h, facing, palette, pose) {
  const u = h / 100;
  const pal = pose.kind === 'freefall' ? dim(palette) : palette;
  const t = pose.frame;

  // ---------------------------------------------------------- body transform
  // One transform for the whole figure: lean (rotation about a pivot), squash,
  // and an offset. Every shape goes through P(), so mirroring, lean and tumble
  // all apply consistently.
  let angle = 0; // degrees, positive leans back
  let pivotY = 30;
  let sy = 1;
  let ox = pose.ox;
  let oy = pose.oy;
  let bob = 0;

  const idleSway = Math.sin(t / 26) * 0.8;
  const arc = pose.move ? ARCS[pose.move] : null;

  switch (pose.kind) {
    case 'idle':
      bob = idleSway;
      break;
    case 'run':
      angle = -9;
      bob = Math.abs(Math.sin(pose.stride)) * 1.6;
      break;
    case 'squat':
      sy = 0.86;
      break;
    case 'shield':
      sy = 0.94;
      angle = 4;
      break;
    case 'spotdodge':
      angle = 14 * Math.sin(Math.PI * pose.t);
      break;
    case 'roll':
      sy = 0.72;
      angle = -360 * ease(pose.t);
      pivotY = 40;
      break;
    case 'airdodge':
      angle = -8;
      break;
    case 'flinch':
      angle = 16;
      break;
    case 'tumble':
      angle = (t * 14) % 360;
      pivotY = 50;
      break;
    case 'dizzy':
      angle = Math.sin(t / 7) * 10;
      break;
    case 'ledge':
      angle = -6;
      break;
    case 'getup':
      sy = lerp(0.8, 1, ease(pose.t));
      ox *= ease(pose.t);
      oy *= ease(pose.t);
      break;
    case 'attack': {
      const lean = arc.lean ?? [0, 0];
      if (pose.phase === 'startup') angle = lerp(0, lean[0], ease(pose.t));
      else if (pose.phase === 'active') angle = lerp(lean[0], lean[1], ease(pose.t));
      else angle = lerp(lean[1], 0, ease(pose.t));
      if (arc.crouch) sy = arc.crouch;
      if (arc.stretch && pose.phase !== 'recovery') sy = 1.08;
      break;
    }
  }

  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Character space -> screen. Rotation is about (0, pivotY); positive angle tips
  // the top backwards.
  const P = (x, y) => {
    const ly = (y - pivotY) * sy;
    const rx = x * cos - ly * sin;
    const ry = x * sin + ly * cos + pivotY;
    return [feetX + (rx + ox) * u * facing, feetY - (ry + oy + bob) * u];
  };
  const poly = (pts) => {
    g.beginPath();
    const [x0, y0] = P(pts[0][0], pts[0][1]);
    g.moveTo(x0, y0);
    for (let i = 1; i < pts.length; i++) {
      const [x, y] = P(pts[i][0], pts[i][1]);
      g.lineTo(x, y);
    }
    g.closePath();
    g.fillPath();
  };
  const box = (x1, y1, x2, y2) => poly([[x1, y1], [x2, y1], [x2, y2], [x1, y2]]);
  const ellipse = (x, y, w, hh) => {
    const [cx, cy] = P(x, y);
    g.fillEllipse(cx, cy, w * u, hh * u * sy);
  };
  const circle = (x, y, r) => {
    const [cx, cy] = P(x, y);
    g.fillCircle(cx, cy, r * u);
  };

  // ------------------------------------------------- trailing parts ("bones")
  // Ponytail and headband tails trail against his motion, as the concept's
  // physics bones would.
  const trailX = clamp(-pose.vx * 3, -8, 8) - 1;
  const trailY = clamp(-pose.vy * 3, -8, 8) + (pose.kind === 'idle' ? idleSway : 0);

  // ---------------------------------------------------------- legs and feet
  const airborne = pose.airborne && pose.kind !== 'ledge';
  let frontFoot = 5;
  let backFoot = -6;
  let frontLift = 0;
  let backLift = 0;
  if (pose.kind === 'run') {
    const s = Math.sin(pose.stride);
    frontFoot = 4 + s * 8;
    backFoot = -5 - s * 8;
    frontLift = Math.max(0, Math.cos(pose.stride)) * 5;
    backLift = Math.max(0, -Math.cos(pose.stride)) * 5;
  } else if (airborne || pose.kind === 'ledge') {
    // Rising: knees tucked. Falling or hanging: legs hang loose.
    const tuck = pose.vy > 0 ? 9 : 3;
    frontFoot = 7;
    backFoot = -4;
    frontLift = tuck;
    backLift = tuck * 0.6;
  } else if (pose.kind === 'shield' || pose.kind === 'squat') {
    frontFoot = 8;
    backFoot = -9;
  }

  // ------------------------------------------------------- hat (behind him)
  g.fillStyle(pal.straw, 0.9);
  poly([
    [-7, 74],
    [-15, 66],
    [-13, 50],
    [-6, 56],
  ]);

  // ----------------------------------------------------------------- hakama
  // Hem follows the feet, so the trousers swing with the stride.
  const hemY = 7 + Math.min(frontLift, backLift);
  g.fillStyle(pal.hakama, 1);
  poly([
    [-9, 55],
    [9, 55],
    [frontFoot + 7, hemY + frontLift * 0.4],
    [backFoot - 7, hemY + backLift * 0.4],
  ]);
  g.fillStyle(pal.ink, 0.22); // pleats
  poly([
    [-4.6, 54],
    [-3.4, 54],
    [lerp(-3.4, backFoot, 0.5), hemY + 1],
    [lerp(-4.6, backFoot, 0.5) - 1, hemY + 1],
  ]);
  poly([
    [2.6, 54],
    [3.8, 54],
    [lerp(3.8, frontFoot, 0.5) + 1, hemY + 1],
    [lerp(2.6, frontFoot, 0.5), hemY + 1],
  ]);

  // ---------------------------------------------------------------- sandals
  g.fillStyle(pal.sandal, 1);
  box(backFoot - 4.5, 1.5 + backLift, backFoot + 4.5, 7 + backLift);
  box(frontFoot - 4.5, 1.5 + frontLift, frontFoot + 4.5, 7 + frontLift);

  // ----------------------------------------------------------------- kimono
  g.fillStyle(pal.kimono, 1);
  poly([
    [-10, 50],
    [10, 50],
    [11, 75],
    [-11, 75],
  ]);
  g.fillStyle(pal.straw, 1); // under-robe at the collar
  poly([
    [-4.5, 75],
    [4.5, 75],
    [0, 62],
  ]);
  g.fillStyle(pal.ink, 0.25); // lapel edge
  poly([
    [4.5, 75],
    [10.5, 75],
    [10.5, 70],
  ]);

  // -------------------------------------------------------------------- obi
  g.fillStyle(pal.obi, 1);
  box(-10, 50, 10, 57);
  g.fillStyle(pal.ink, 0.2);
  box(-10, 55.2, 10, 57);

  // ------------------------------------------------------------------- head
  const hy = 88;
  g.fillStyle(pal.hair, 1);
  ellipse(-1, hy, 24, 25);
  poly([
    [-8, hy + 4],
    [-20 + trailX, hy - 2 + trailY],
    [-17 + trailX, hy - 9 + trailY],
    [-6, hy - 4],
  ]);
  g.fillStyle(pal.skin, 1);
  ellipse(3.5, hy - 2, 17, 19);

  g.fillStyle(pal.obi, 1); // headband
  box(-11, hy + 4, 11, hy + 7);
  poly([
    [-9, hy + 8],
    [-21 + trailX * 1.3, hy + 4 + trailY * 1.3],
    [-20 + trailX * 1.3, hy + 9 + trailY * 1.3],
  ]);

  // Eye and storm mark. Dizzy and helpless get a narrowed eye.
  g.fillStyle(pal.spark, 1);
  const eyeH = pose.kind === 'dizzy' || pose.kind === 'freefall' ? 0.8 : 2.2;
  box(5, hy - 1.2, 8.4, hy - 1.2 + eyeH);
  box(8.5, hy - 8, 10, hy - 5);

  // ------------------------------------------------------- arm and the blade
  drawArmAndBlade(pose, arc, pal, P, poly, circle, g, u);

  // Dizzy stars circling his head after a shield break.
  if (pose.kind === 'dizzy') {
    g.fillStyle(pal.spark, 1);
    for (let i = 0; i < 3; i++) {
      const a = t / 9 + (i * Math.PI * 2) / 3;
      circle(Math.cos(a) * 14, 104 + Math.sin(a) * 3, 1.8);
    }
  }
}

/** Blade angle (deg) and whether it glows, for the current attack frame. */
function bladeFor(pose, arc) {
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

function drawArmAndBlade(pose, arc, pal, P, poly, circle, g, u) {
  const shoulder = [2, 70];
  const handAt = (aDeg, reach = 11) => {
    const r = (aDeg * Math.PI) / 180;
    return [shoulder[0] + Math.cos(r) * reach, shoulder[1] + Math.sin(r) * reach];
  };
  const quad = (from, aDeg, len, width) => {
    const r = (aDeg * Math.PI) / 180;
    const dx = Math.cos(r);
    const dy = Math.sin(r);
    const nx = -dy * width;
    const ny = dx * width;
    const tip = [from[0] + dx * len, from[1] + dy * len];
    poly([
      [from[0] + nx, from[1] + ny],
      [tip[0] + nx, tip[1] + ny],
      [tip[0] - nx, tip[1] - ny],
      [from[0] - nx, from[1] - ny],
    ]);
  };

  // Sheathed: blade through the obi, angled back and down.
  const sheathed = () => {
    g.fillStyle(pal.steel, 1);
    poly([
      [-3, 54],
      [-26, 36],
      [-24, 33],
      [-2, 50],
    ]);
    g.fillStyle(pal.obi, 1); // hilt wrap
    poly([
      [-2, 52],
      [4, 57],
      [5, 54],
      [-1, 49],
    ]);
  };

  if (pose.kind !== 'attack') {
    sheathed();
    // Free hand: reaching for the ledge, thrown up when helpless or tumbling,
    // forward when guarding, swinging with the stride when running.
    let hand;
    switch (pose.kind) {
      case 'ledge':
        hand = [32, 84];
        break;
      case 'getup':
        hand = [lerp(32, 12, ease(pose.t)), lerp(84, 64, ease(pose.t))];
        break;
      case 'freefall':
      case 'tumble':
        hand = handAt(100 + Math.sin(pose.frame / 3) * 25);
        break;
      case 'shield':
        hand = [13, 66];
        break;
      case 'run':
        hand = [8 + Math.sin(pose.stride + Math.PI) * 6, 60];
        break;
      default:
        hand = [10, 60 + (pose.kind === 'idle' ? Math.sin(pose.frame / 26) * 0.8 : 0)];
    }
    g.fillStyle(pal.kimono, 1); // sleeve
    quad(shoulder, (Math.atan2(hand[1] - shoulder[1], hand[0] - shoulder[0]) * 180) / Math.PI,
      Math.hypot(hand[0] - shoulder[0], hand[1] - shoulder[1]), 3.2);
    g.fillStyle(pal.skin, 1);
    circle(hand[0], hand[1], 3.4);
    return;
  }

  const { a, lit } = bladeFor(pose, arc);
  const glowing = lit || pose.glow;
  const hand = handAt(a);
  // A thrust extends the blade through the active frames; a swing keeps it full.
  const len = arc.stab && pose.phase === 'active' ? lerp(26, 40, ease(pose.t)) : 34;

  // Swing trail: fading copies of the blade at earlier angles.
  if (pose.phase === 'active' && !arc.stab && !arc.guard) {
    const prev = bladeFor({ ...pose, t: Math.max(0, pose.t - 0.35) }, arc).a;
    for (let i = 1; i <= 4; i++) {
      const ta = lerp(a, prev, i / 4);
      g.fillStyle(pal.spark, 0.22 - i * 0.04);
      quad(handAt(ta), ta, len, 2.6);
    }
  }

  if (glowing) {
    g.fillStyle(pal.spark, 0.3); // storm glow around the blade
    quad(hand, a, len + 2, 5);
  }

  // Empty scabbard still at the hip.
  g.fillStyle(pal.ink, 0.6);
  poly([
    [-3, 54],
    [-22, 39],
    [-21, 37],
    [-2, 51],
  ]);

  g.fillStyle(pal.kimono, 1); // sleeve
  quad(shoulder, a, 11, 3.2);
  g.fillStyle(pal.steel, 1); // blade
  quad(hand, a, len, 1.4);
  if (glowing) {
    g.fillStyle(pal.spark, 1); // the split edge
    quad(hand, a, len, 0.6);
  }
  g.fillStyle(pal.obi, 1); // hilt
  quad(hand, a + 180, 4, 1.4);
  g.fillStyle(pal.skin, 1);
  circle(hand[0], hand[1], 3.4);
}
