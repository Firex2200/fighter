// Smash Ultimate's documented combat math. Pure functions, no engine dependency.
// Sources: SmashWiki (Knockback, Hitstun, Sakurai angle, Weight). All values are in
// "Smash units" at a fixed 60fps timestep -- do not mix pixels in here.

export const FPS = 60;

/** Launch angle sentinel: the angle varies with knockback instead of being fixed. */
export const SAKURAI = 361;

/** Baseline weight. Moves that ignore weight pass this. */
export const BASE_WEIGHT = 100;

/**
 * Knockback, the core equation driving everything else.
 *   KB = ((((p/10 + p*d/20) * 200/(w+100) * 1.4) + 18) * s + b) * r
 * @param {number} damage      damage the move deals (d)
 * @param {number} percent     target's damage % AFTER the hit lands (p)
 * @param {number} weight      target's weight (w)
 * @param {number} kbg         knockback growth, 0-200ish (s = kbg/100)
 * @param {number} bkb         base knockback (b)
 * @param {number} [modifier]  composite multiplier r (rage, etc.)
 */
export function knockback(damage, percent, weight, kbg, bkb, modifier = 1) {
  const damageTerm = percent / 10 + (percent * damage) / 20;
  const weightRatio = 200 / (weight + 100);
  return ((damageTerm * weightRatio * 1.4 + 18) * (kbg / 100) + bkb) * modifier;
}

/** Knockback converts to an initial launch speed in units/frame. */
export function launchSpeed(kb) {
  return kb * 0.03;
}

/** Launch speed bleeds off by a flat amount every frame until it hits zero. */
export const LAUNCH_DECAY = 0.051;

/**
 * Frames the target is stuck in hitstun and cannot act.
 * The -1 is Ultimate-specific; Smash 4 did not subtract it.
 */
export function hitstun(kb) {
  return Math.max(0, Math.floor(kb * 0.4) - 1);
}

/**
 * The Sakurai angle (361): shallow at low knockback so weak hits combo, rising to
 * 38 degrees once the hit is strong enough to launch. This is what lets a single
 * move poke at 0% and KO at 150%.
 * @returns {number} angle in degrees
 */
export function sakuraiAngle(kb, airborne) {
  if (airborne) return 38;
  if (kb < 60) return 0;
  if (kb > 88) return 38;
  return ((kb - 60) / 28) * 38;
}

/** Resolve a move's angle parameter into a concrete degree value. */
export function resolveAngle(angle, kb, airborne) {
  return angle === SAKURAI ? sakuraiAngle(kb, airborne) : angle;
}

/**
 * Launch velocity in units/frame. Y is positive-up (Smash convention), so the
 * renderer is responsible for flipping it, not this module.
 * @param {number} facing  +1 if the attacker faces right, -1 if left
 */
export function launchVector(kb, angleDeg, facing) {
  const speed = launchSpeed(kb);
  const rad = (angleDeg * Math.PI) / 180;
  return { x: Math.cos(rad) * speed * facing, y: Math.sin(rad) * speed };
}

/**
 * Rage: above 35% the attacker hits up to 10% harder, capped at 150%.
 * Deferred from Phase 1 scope but trivial and already tested.
 */
export function rageMultiplier(attackerPercent) {
  if (attackerPercent <= 35) return 1;
  if (attackerPercent >= 150) return 1.1;
  return 1 + ((attackerPercent - 35) / 115) * 0.1;
}

/**
 * Full hit resolution: everything one connecting hitbox does to one target.
 * @returns {{percent, kb, angle, hitstun, velocity}}
 */
export function resolveHit(move, target, facing) {
  const percent = target.percent + move.damage;
  const kb = knockback(move.damage, percent, target.weight, move.kbg, move.bkb);
  const angle = resolveAngle(move.angle, kb, target.airborne);
  return {
    damage: move.damage,
    percent,
    kb,
    angle,
    hitstun: hitstun(kb),
    velocity: launchVector(kb, angle, facing),
  };
}

// ------------------------------------------------------------------ shields
// SmashWiki: Shield, Shieldstun.

export const SHIELD_MAX = 50;
/** Drain per frame while held. */
export const SHIELD_DECAY = 0.15;
/** Refill per frame while not shielding. */
export const SHIELD_REGEN = 0.08;

/**
 * Frames a shielding fighter is locked in place after blocking a hit.
 * Aerials cause much less (t = 0.33), which is what makes them safe on shield.
 */
export function shieldstun(damage, aerial = false) {
  const t = aerial ? 0.33 : 1;
  return Math.min(60, Math.floor(0.8 * damage * t) + 2);
}

/** Visual size of the shield bubble: shrinks to 15% as it runs out. */
export function shieldScale(hp) {
  return (Math.max(0, hp) / SHIELD_MAX) * 0.85 + 0.15;
}
