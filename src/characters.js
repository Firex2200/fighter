// Fighter stats and move data. All distances in Smash units, all timings in frames
// at 60fps. Stat ranges follow Ultimate's documented roster spread.
//
// Rook's six stats come from the concept sheet (each rated out of 10) and are
// mapped onto game values here, so the design doc stays the source of truth:
//
//   Weight 5   -> 98   middleweight, mid-point of the 62..135 roster range
//   Ground 8   -> 2.20 run speed
//   Air 7      -> 1.13 max air speed
//   Power 7    -> move damage
//   Range 8    -> hitbox reach, sized to match the drawn blade
//   Recovery 6 -> jump and air-jump strength

import { SAKURAI } from './combat.js';

// Short hop reaches ~50% of full hop height. Height scales with v^2, so halving
// the height means scaling the launch velocity by 1/sqrt(2).
const SHORT_HOP_RATIO = Math.SQRT1_2;

/**
 * Rook's moveset. Every move is data; fighter.js reads these fields:
 *   hitbox     offset from body centre, x is in front of him (null = no hitbox)
 *   aerial     less shieldstun on block; landing mid-move costs `landingLag`
 *   impulse    { frame, x, y }: velocity set on that frame (x is forward)
 *   noDrift    no air steering during the move, so a dash keeps its line
 *   helpless   ends in freefall when used in the air
 *   oncePerAir only usable once until you land, grab a ledge or get hit
 *   ledgeGrab  can catch the ledge on the way down
 *   counter    [first, last] frames that catch an incoming hit
 * Angles above 90 send the target behind the attacker; 270 sends them down.
 * Values are tuned to the concept's Power 7 / Range 8 / Recovery 6.
 */
export const MOVES = {
  // ---------------------------------------------------------------- ground
  // Quick-draw slash. Fast, weak, Sakurai angle: combos at low %, never kills.
  jab: {
    name: 'jab',
    damage: 3.2,
    bkb: 15,
    kbg: 26,
    angle: SAKURAI,
    startup: 4,
    active: 2,
    recovery: 11,
    hitbox: { x: 11, y: 3, w: 15, h: 11 },
  },
  // Rising guard: blade swept overhead to swat jumpers.
  upTilt: {
    name: 'upTilt',
    damage: 7,
    bkb: 30,
    kbg: 105,
    angle: 88,
    startup: 5,
    active: 4,
    recovery: 14,
    hitbox: { x: 3, y: 15, w: 22, h: 16 },
  },
  // Low sweep at the ankles; pops them up at a shallow angle.
  downTilt: {
    name: 'downTilt',
    damage: 6,
    bkb: 25,
    kbg: 60,
    angle: 25,
    startup: 6,
    active: 3,
    recovery: 14,
    hitbox: { x: 13, y: -10, w: 18, h: 7 },
  },
  // The storm blade. Slow, long, fixed 40 degree launch. Kills around 100%.
  strong: {
    name: 'strong',
    damage: 15,
    bkb: 40,
    kbg: 94,
    angle: 40,
    startup: 13,
    active: 3,
    recovery: 27,
    hitbox: { x: 14, y: 2, w: 22, h: 14 },
  },

  // --------------------------------------------------------------- aerials
  // Spinning cut around his whole body: fast, safe, starts combos.
  nair: {
    name: 'nair',
    aerial: true,
    landingLag: 7,
    damage: 7,
    bkb: 18,
    kbg: 70,
    angle: SAKURAI,
    startup: 4,
    active: 8,
    recovery: 14,
    hitbox: { x: 0, y: 0, w: 28, h: 24 },
  },
  fair: {
    name: 'fair',
    aerial: true,
    landingLag: 11,
    damage: 10,
    bkb: 30,
    kbg: 90,
    angle: 40,
    startup: 8,
    active: 4,
    recovery: 18,
    hitbox: { x: 14, y: 2, w: 20, h: 14 },
  },
  // Reverse thrust behind him; his strongest aerial.
  bair: {
    name: 'bair',
    aerial: true,
    landingLag: 10,
    damage: 12,
    bkb: 32,
    kbg: 92,
    angle: 145,
    startup: 7,
    active: 3,
    recovery: 16,
    hitbox: { x: -14, y: 2, w: 18, h: 12 },
  },
  uair: {
    name: 'uair',
    aerial: true,
    landingLag: 8,
    damage: 8,
    bkb: 30,
    kbg: 95,
    angle: 85,
    startup: 5,
    active: 4,
    recovery: 12,
    hitbox: { x: 0, y: 16, w: 22, h: 14 },
  },
  // Downward stab. Meteor: sends the target straight down, off-stage a kill.
  dair: {
    name: 'dair',
    aerial: true,
    landingLag: 18,
    damage: 13,
    bkb: 25,
    kbg: 80,
    angle: 270,
    startup: 12,
    active: 4,
    recovery: 22,
    hitbox: { x: 2, y: -16, w: 16, h: 14 },
  },

  // -------------------------------------------------------------- specials
  // Storm Draw (neutral special): the blade splits open and he dashes through.
  stormDraw: {
    name: 'stormDraw',
    damage: 11,
    bkb: 45,
    kbg: 72,
    angle: 35,
    startup: 12,
    active: 6,
    recovery: 24,
    hitbox: { x: 14, y: 2, w: 24, h: 14 },
    impulse: { frame: 12, x: 2.2, y: 0.8 },
    noDrift: true,
    oncePerAir: true,
  },
  // Rising Storm (up special): his way back to the stage. Ends helpless.
  risingStorm: {
    name: 'risingStorm',
    damage: 8,
    bkb: 45,
    kbg: 70,
    angle: 80,
    startup: 4,
    active: 10,
    recovery: 18,
    hitbox: { x: 6, y: 10, w: 20, h: 24 },
    impulse: { frame: 4, x: 0.6, y: 3.7 },
    helpless: true,
    oncePerAir: true,
    ledgeGrab: true,
    landingLag: 16,
  },
  // Thunder Guard (down special): a parry stance. Struck during the window, he
  // strikes back harder than he was hit.
  counter: {
    name: 'counter',
    damage: 0,
    startup: 0,
    active: 0,
    recovery: 40,
    hitbox: null,
    counter: [5, 28],
  },
};

/** The strike Thunder Guard answers with: at least 8%, else 1.2x the blocked hit. */
export function counterStrike(blockedDamage) {
  return {
    name: 'counterStrike',
    damage: Math.max(8, blockedDamage * 1.2),
    bkb: 50,
    kbg: 80,
    angle: SAKURAI,
  };
}

export function makeCharacter(spec) {
  return {
    ...spec,
    shortHopVel: spec.jumpVel * SHORT_HOP_RATIO,
    fastFallSpeed: spec.fallSpeed * 1.6,
    moves: MOVES,
  };
}

export const CHARACTERS = {
  rook: makeCharacter({
    id: 'rook',
    name: 'Rook Ashvane',
    title: 'The Wandering Storm',
    weight: 98,
    gravity: 0.14,
    fallSpeed: 1.7,
    walkSpeed: 1.3,
    runSpeed: 2.2,
    groundFriction: 0.08,
    airAccel: 0.07,
    airFriction: 0.012,
    maxAirSpeed: 1.13,
    jumpVel: 3.1,
    doubleJumpVel: 2.85,
    airJumps: 1,
    body: { w: 17, h: 26 },
  }),
};

/** Costume per player slot. Both play Rook; only the three-colour palette differs. */
export const PLAYER_COSTUMES = ['default', 'ember'];

/** Universal timings Ultimate standardised across the whole roster. */
export const JUMPSQUAT_FRAMES = 3;
export const LANDING_LAG_FRAMES = 4;
export const RESPAWN_FRAMES = 60;
export const RESPAWN_INVULN_FRAMES = 100;
