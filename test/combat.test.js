import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  knockback,
  launchSpeed,
  hitstun,
  sakuraiAngle,
  resolveAngle,
  launchVector,
  rageMultiplier,
  resolveHit,
  SAKURAI,
} from '../src/combat.js';

// A hand-computed reference point. If the formula is ever "simplified", this catches it.
// jab: d=2.8, p=2.8, w=100, kbg=25, bkb=15
//   damageTerm = 2.8/10 + 2.8*2.8/20 = 0.28 + 0.392      = 0.672
//   * 200/200 * 1.4                                       = 0.9408
//   + 18                                                  = 18.9408
//   * 0.25                                                = 4.7352
//   + 15                                                  = 19.7352
test('knockback matches a hand-computed reference value', () => {
  const kb = knockback(2.8, 2.8, 100, 25, 15);
  assert.ok(Math.abs(kb - 19.7352) < 1e-4, `expected ~19.7352, got ${kb}`);
});

test('knockback rises monotonically with accumulated damage', () => {
  let prev = -Infinity;
  for (let percent = 0; percent <= 200; percent += 10) {
    const kb = knockback(10, percent, 100, 90, 30);
    assert.ok(kb > prev, `knockback fell at ${percent}%: ${kb} <= ${prev}`);
    prev = kb;
  }
});

test('heavier fighters take less knockback from an identical hit', () => {
  const light = knockback(12, 100, 62, 90, 30);
  const mid = knockback(12, 100, 96, 90, 30);
  const heavy = knockback(12, 100, 135, 90, 30);
  assert.ok(light > mid && mid > heavy, `expected light>mid>heavy, got ${light}/${mid}/${heavy}`);

  // The 200/(w+100) term should give the lightest character ~45% more knockback
  // than the heaviest, ignoring the flat +18 and bkb terms that compress the gap.
  const ratio = (200 / (62 + 100)) / (200 / (135 + 100));
  assert.ok(Math.abs(ratio - 1.45) < 0.02, `weight ratio drifted: ${ratio}`);
});

test('weight only scales the damage term, never zeroes knockback out', () => {
  // Even an absurdly heavy target still gets launched by a strong hit.
  const kb = knockback(14, 150, 135, 95, 40);
  assert.ok(kb > 40, `heavy target should still be launchable, got ${kb}`);
});

test('launch speed is knockback * 0.03', () => {
  assert.equal(launchSpeed(100), 3);
  assert.equal(launchSpeed(0), 0);
});

test('hitstun is floor(kb * 0.4) - 1 and never negative', () => {
  assert.equal(hitstun(100), 39); // floor(40) - 1
  assert.equal(hitstun(19.7352), 6); // floor(7.894) - 1
  assert.equal(hitstun(0), 0); // clamped, not -1
  assert.equal(hitstun(2), 0); // floor(0.8) - 1 = -1, clamped
});

test('sakurai angle: flat below 60, 38 degrees above 88, interpolating between', () => {
  assert.equal(sakuraiAngle(0, false), 0);
  assert.equal(sakuraiAngle(59.9, false), 0);
  assert.equal(sakuraiAngle(60, false), 0); // boundary: (60-60)/28*38 = 0
  assert.equal(sakuraiAngle(89, false), 38);
  assert.equal(sakuraiAngle(500, false), 38);

  const mid = sakuraiAngle(74, false); // halfway through the 60-88 ramp
  assert.ok(Math.abs(mid - 19) < 0.01, `expected ~19 degrees at kb=74, got ${mid}`);
});

test('sakurai angle is always 38 degrees against an airborne target', () => {
  for (const kb of [0, 30, 60, 74, 88, 300]) {
    assert.equal(sakuraiAngle(kb, true), 38, `airborne angle wrong at kb=${kb}`);
  }
});

test('sakurai angle ramp is continuous at both boundaries', () => {
  // No visible "snap" in launch direction as knockback crosses 60 or 88.
  assert.ok(Math.abs(sakuraiAngle(60.01, false) - 0) < 0.02);
  assert.ok(Math.abs(sakuraiAngle(87.99, false) - 38) < 0.02);
});

test('resolveAngle passes fixed angles through untouched', () => {
  assert.equal(resolveAngle(45, 999, false), 45);
  assert.equal(resolveAngle(SAKURAI, 100, false), 38);
});

test('launch vector respects attacker facing and uses y-up', () => {
  const right = launchVector(100, 38, 1);
  const left = launchVector(100, 38, -1);
  assert.ok(right.x > 0, 'facing right should launch +x');
  assert.ok(left.x < 0, 'facing left should launch -x');
  assert.equal(right.y, left.y, 'facing must not affect vertical launch');
  assert.ok(right.y > 0, 'a 38 degree hit launches upward in y-up convention');

  const straightUp = launchVector(100, 90, 1);
  assert.ok(Math.abs(straightUp.x) < 1e-9, 'a 90 degree hit has no horizontal component');
  assert.ok(Math.abs(straightUp.y - 3) < 1e-9, 'a 90 degree hit at kb=100 launches at speed 3');

  const spike = launchVector(100, 270, 1);
  assert.ok(spike.y < 0, 'a 270 degree hit drives the target downward');
});

test('rage: inactive below 35%, caps at 1.1x by 150%', () => {
  assert.equal(rageMultiplier(0), 1);
  assert.equal(rageMultiplier(35), 1);
  assert.equal(rageMultiplier(150), 1.1);
  assert.equal(rageMultiplier(999), 1.1);
  const mid = rageMultiplier(92.5); // halfway through the 35-150 ramp
  assert.ok(Math.abs(mid - 1.05) < 0.001, `expected ~1.05, got ${mid}`);
});

test('resolveHit adds damage before computing knockback', () => {
  // The formula uses the percent AFTER the hit -- using the pre-hit value is a
  // classic off-by-one-hit bug that makes everything feel weak.
  const target = { percent: 50, weight: 100, airborne: false };
  const move = { damage: 10, kbg: 90, bkb: 30, angle: SAKURAI };
  const hit = resolveHit(move, target, 1);

  assert.equal(hit.percent, 60);
  assert.equal(hit.kb, knockback(10, 60, 100, 90, 30));
  assert.notEqual(hit.kb, knockback(10, 50, 100, 90, 30));
});

test('resolveHit produces a weak combo hit at 0% and a kill at high %', () => {
  const move = { damage: 14, kbg: 95, bkb: 40, angle: SAKURAI };
  const fresh = resolveHit(move, { percent: 0, weight: 100, airborne: false }, 1);
  const stale = resolveHit(move, { percent: 100, weight: 100, airborne: false }, 1);

  assert.ok(fresh.kb < 90, `a hit at 0% should not launch far, got ${fresh.kb}`);
  assert.ok(stale.kb > 150, `a hit at 100% should launch hard, got ${stale.kb}`);
  assert.ok(stale.hitstun > fresh.hitstun, 'more knockback must mean more hitstun');

  // Distance travelled before launch speed decays to zero: v^2 / (2 * decay).
  // The blast zone is at 240 units, so the 100% hit should carry past it.
  const travel = (v) => (v * v) / (2 * 0.051);
  assert.ok(travel(launchSpeed(fresh.kb)) < 240, 'a 0% hit must not KO');
  assert.ok(travel(launchSpeed(stale.kb)) > 240, 'a 100% strong hit should KO');
});

test('shieldstun: floor(0.8 * d * t) + 2, aerials a third, capped at 60', async () => {
  const { shieldstun, shieldScale } = await import('../src/combat.js');
  assert.equal(shieldstun(10), 10); // floor(8) + 2
  assert.equal(shieldstun(10, true), 4); // floor(2.64) + 2
  assert.equal(shieldstun(500), 60);
  assert.equal(shieldScale(50), 1);
  assert.ok(Math.abs(shieldScale(0) - 0.15) < 1e-9);
});
