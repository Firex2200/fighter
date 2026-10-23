// Shield, dodges, air dodge and ledge — run headlessly against the real fighter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, MOVES } from '../src/characters.js';
import { Fighter, STATE, DEFENSE, resolveCombat } from '../src/fighter.js';
import { SHIELD_MAX, shieldstun } from '../src/combat.js';
import { STAGE } from '../src/stage.js';
import { Cpu } from '../src/cpu.js';

const MAIN = STAGE.platforms[0];
const NEUTRAL = {
  x: 0,
  y: 0,
  jump: false,
  down: false,
  shield: false,
  xPressed: false,
  jumpPressed: false,
  downPressed: false,
  attackPressed: false,
  strongPressed: false,
  specialPressed: false,
  shieldPressed: false,
};
const input = (over = {}) => ({ ...NEUTRAL, ...over });

function fighter(x, y = 20, slot = 0) {
  const f = new Fighter(CHARACTERS.rook, { x, y }, slot);
  f.invulnFrames = 0;
  return f;
}
function run(f, frames, over = {}) {
  for (let i = 0; i < frames; i++) f.step(input(over));
  return f;
}
const grounded = (x, slot = 0) => run(fighter(x, 20, slot), 90);

/** Attacker jabs a defender holding shield; returns the combat events. */
function jabInto(defender, defenderInput = { shield: true }) {
  const a = grounded(0);
  a.facing = 1;
  a.step(input({ attackPressed: true }));
  let events = [];
  for (let i = 0; i < 20 && !events.length; i++) {
    a.step(input());
    defender.step(input(defenderInput));
    events = resolveCombat([a, defender]);
  }
  return events;
}

// ---------------------------------------------------------------- shield

test('a raised shield blocks a hit: no damage, no launch, shield worn down', () => {
  const d = grounded(14, 1);
  d.step(input({ shield: true }));
  assert.equal(d.state, STATE.SHIELD);

  const events = jabInto(d);
  assert.equal(events.length, 1);
  assert.equal(events[0].shielded, true);
  assert.equal(d.percent, 0, 'shield must stop the damage');
  assert.equal(d.state, STATE.SHIELD, 'a blocked hit must not launch');
  assert.ok(d.shieldHP < SHIELD_MAX - MOVES.jab.damage + 0.5, `shield should lose ~${MOVES.jab.damage}`);
  assert.ok(d.shieldstun > 0, 'blocking causes shieldstun');
});

test('shieldstun locks you in shield: you cannot drop it until it ends', () => {
  const d = grounded(14, 1);
  d.step(input({ shield: true }));
  jabInto(d);
  assert.equal(d.shieldstun, shieldstun(MOVES.jab.damage));
  d.step(input({ shield: false })); // let go immediately
  assert.equal(d.state, STATE.SHIELD, 'still locked in shieldstun');
});

test('holding shield drains it and it breaks at zero', () => {
  const d = grounded(0);
  let broke = false;
  for (let i = 0; i < 400 && !broke; i++) {
    d.step(input({ shield: true }));
    broke = d.state === STATE.SHIELDBREAK;
  }
  assert.ok(broke, 'shield should break from holding it too long');
  // 50 HP at 0.15 per frame is ~333 frames.
  assert.ok(d.launchY > 0 || d.airborne, 'a shield break pops you upward');
});

test('a hit that empties the shield breaks it instead of blocking cleanly', () => {
  const d = grounded(14, 1);
  d.step(input({ shield: true }));
  d.shieldHP = 2;
  jabInto(d);
  assert.equal(d.state, STATE.SHIELDBREAK);
  assert.equal(d.percent, 0, 'the breaking hit still does no damage');
});

test('shield break stuns, then you recover with a full shield', () => {
  const d = grounded(0);
  d.step(input({ shield: true }));
  d.breakShield();
  run(d, 80, { attackPressed: true });
  assert.equal(d.state, STATE.SHIELDBREAK, 'cannot act while shield-broken');
  run(d, 400);
  assert.notEqual(d.state, STATE.SHIELDBREAK);
  assert.ok(d.shieldHP > SHIELD_MAX - 1);
});

test('the shield refills after you let go', () => {
  const d = grounded(0);
  run(d, 100, { shield: true });
  const low = d.shieldHP;
  run(d, 120);
  assert.ok(d.shieldHP > low + 5, `shield should regenerate: ${low} -> ${d.shieldHP}`);
});

test('releasing shield costs shield-drop lag', () => {
  const d = grounded(0);
  run(d, 5, { shield: true });
  d.step(input());
  assert.equal(d.state, STATE.LAG);
  run(d, DEFENSE.shieldDropLag);
  assert.equal(d.state, STATE.IDLE);
});

test('you can jump straight out of shield', () => {
  const d = grounded(0);
  run(d, 5, { shield: true });
  d.step(input({ shield: true, jump: true, jumpPressed: true }));
  assert.equal(d.state, STATE.JUMPSQUAT);
});

// ----------------------------------------------------------------- dodges

test('a spot dodge makes an attack pass straight through', () => {
  const d = grounded(14, 1);
  d.step(input({ shield: true }));
  d.step(input({ shield: true, down: true, downPressed: true }));
  assert.equal(d.state, STATE.DODGE);
  run(d, 3, { shield: true }); // into the intangible window

  const a = grounded(0);
  a.facing = 1;
  a.step(input({ attackPressed: true }));
  let hits = 0;
  for (let i = 0; i < 8; i++) {
    a.step(input());
    d.step(input());
    hits += resolveCombat([a, d]).length;
  }
  assert.equal(hits, 0, 'intangible frames must not be hittable');
  assert.equal(d.percent, 0);
});

test('a roll travels sideways and ends facing back the way it came', () => {
  const d = grounded(0);
  d.facing = 1;
  d.step(input({ shield: true }));
  d.step(input({ shield: true, x: 1, xPressed: true }));
  assert.equal(d.state, STATE.DODGE);
  run(d, DEFENSE.roll.total + 2);
  assert.ok(d.x > 20, `roll should move ~${DEFENSE.roll.distance} units, moved ${d.x}`);
  assert.equal(d.facing, -1);
});

test('a roll stops at the ledge instead of rolling off', () => {
  const d = grounded(MAIN.x2 - 8);
  d.step(input({ shield: true }));
  d.step(input({ shield: true, x: 1, xPressed: true }));
  run(d, DEFENSE.roll.total + 2);
  assert.equal(d.airborne, false, `rolled off the stage to x=${d.x}`);
});

// -------------------------------------------------------------- air dodge

test('only one air dodge per airtime, refreshed on landing', () => {
  const d = grounded(0);
  d.step(input({ jump: true, jumpPressed: true }));
  run(d, 4, { jump: true });
  assert.ok(d.airborne);

  d.step(input({ shield: true, shieldPressed: true }));
  assert.equal(d.state, STATE.AIRDODGE);
  run(d, DEFENSE.airDodgeNeutral.total + 1);

  if (d.airborne) {
    d.step(input({ shield: true, shieldPressed: true }));
    assert.notEqual(d.state, STATE.AIRDODGE, 'a second air dodge before landing must be refused');
  }
  run(d, 200);
  assert.equal(d.airborne, false);
  assert.equal(d.airDodgeUsed, false, 'landing refreshes the air dodge');
});

test('a directional air dodge moves you, then leaves you helpless until you land', () => {
  const d = fighter(0, 150); // high enough to finish the dodge before landing
  d.vy = 0;
  d.step(input({ x: 1, shield: true, shieldPressed: true }));
  assert.equal(d.state, STATE.AIRDODGE);
  const x0 = d.x;
  run(d, DEFENSE.airDodgeDirectional.total + 1);
  assert.ok(d.x > x0 + 10, 'a directional dodge should travel');
  assert.equal(d.state, STATE.FREEFALL);

  d.step(input({ attackPressed: true, jumpPressed: true, jump: true }));
  assert.equal(d.state, STATE.FREEFALL, 'helpless: no attacking or jumping');
  run(d, 200);
  assert.equal(d.airborne, false);
  run(d, DEFENSE.freefallLandingLag + 1);
  assert.equal(d.state, STATE.IDLE);
});

test('an air dodge is intangible', () => {
  const d = fighter(14, 60, 1);
  d.step(input({ shield: true, shieldPressed: true }));
  run(d, 3);
  assert.equal(d.intangible, true);
  assert.equal(d.hittable, false);
});

// ------------------------------------------------------------------ ledge

/** Drop a fighter just outside the right ledge, already falling. */
function fallingPastRightLedge() {
  const f = fighter(MAIN.x2 + 6, 6);
  f.vy = -1;
  return f;
}

test('falling past the ledge grabs it', () => {
  const f = fallingPastRightLedge();
  let grabbed = false;
  for (let i = 0; i < 60 && !grabbed; i++) {
    f.step(input());
    grabbed = f.state === STATE.LEDGE;
  }
  assert.ok(grabbed, 'should snap to the ledge');
  assert.equal(f.facing, -1, 'hangs facing the stage');
  assert.ok(f.x > MAIN.x2, 'hangs on the outside of the stage');
});

test('walking off the stage does not instantly snap onto the ledge', () => {
  const f = grounded(MAIN.x2 - 5);
  f.step(input({ x: 1 }));
  run(f, 3, { x: 1 });
  assert.notEqual(f.state, STATE.LEDGE, 'the ledge must be at hand height, not foot height');
});

test('grabbing the ledge refreshes the double jump and air dodge', () => {
  const f = fallingPastRightLedge();
  f.jumpsUsed = f.char.airJumps;
  f.airDodgeUsed = true;
  run(f, 60);
  assert.equal(f.state, STATE.LEDGE);
  assert.equal(f.jumpsUsed, 0);
  assert.equal(f.airDodgeUsed, false);
});

test('ledge get-up puts you standing on the stage', () => {
  const f = fallingPastRightLedge();
  run(f, 60);
  run(f, DEFENSE.ledgeActable);
  f.step(input({ x: -1 })); // toward the stage
  assert.equal(f.state, STATE.GETUP);
  assert.equal(f.hittable, false, 'get-up is intangible');
  run(f, DEFENSE.getup + 2);
  assert.equal(f.airborne, false);
  assert.equal(f.y, MAIN.y);
  assert.ok(f.x < MAIN.x2 && f.x > MAIN.x1, 'should be on top of the stage');
});

test('ledge jump launches you up and back onto the stage', () => {
  const f = fallingPastRightLedge();
  run(f, 60);
  run(f, DEFENSE.ledgeActable);
  f.step(input({ jump: true, jumpPressed: true }));
  assert.equal(f.state, STATE.IDLE);
  assert.ok(f.vy > 0);
  run(f, 120);
  assert.equal(f.airborne, false, 'should land back on the stage');
  assert.equal(f.y, MAIN.y);
});

test('pressing down drops off the ledge, without instantly regrabbing', () => {
  const f = fallingPastRightLedge();
  run(f, 60);
  run(f, DEFENSE.ledgeActable);
  f.step(input({ down: true, downPressed: true }));
  assert.notEqual(f.state, STATE.LEDGE);
  run(f, 5);
  assert.notEqual(f.state, STATE.LEDGE, 'regrab cooldown');
});

test('hanging too long lets go of the ledge', () => {
  const f = fallingPastRightLedge();
  run(f, 60);
  assert.equal(f.state, STATE.LEDGE);
  run(f, DEFENSE.ledgeMaxHang + 2);
  assert.notEqual(f.state, STATE.LEDGE);
});

test('the ledge is safe for a moment after grabbing, then you can be hit', () => {
  const f = fallingPastRightLedge();
  for (let i = 0; i < 60 && f.state !== STATE.LEDGE; i++) f.step(input());
  assert.equal(f.hittable, false, 'just grabbed: intangible');
  run(f, DEFENSE.ledgeIntangible + 2);
  assert.equal(f.state, STATE.LEDGE);
  assert.equal(f.hittable, true, 'hanging too long leaves you open');
});

// -------------------------------------------------------------------- CPU

test('the CPU gets back on stage from below ledge height, double jump spent', () => {
  for (const side of [1, -1]) {
    const me = fighter(side * (MAIN.x2 + 8), -6);
    me.vy = -0.5;
    me.jumpsUsed = me.char.airJumps;
    const them = grounded(0, 1);
    const cpu = new Cpu(5);
    for (let i = 0; i < 400 && (me.airborne || me.state !== STATE.IDLE); i++) {
      me.step(cpu.think(me, them));
      if (me.checkKO()) break;
    }
    assert.notEqual(me.state, STATE.DEAD, `CPU died recovering from the ${side > 0 ? 'right' : 'left'}`);
    assert.equal(me.airborne, false, 'should be standing on the stage');
  }
});

test('a CPU hanging on the ledge climbs back up', () => {
  for (const side of [1, -1]) {
    const me = fighter(0, 20);
    me.grabLedge({ x: side > 0 ? MAIN.x2 : MAIN.x1, y: MAIN.y, side });
    const them = grounded(0, 1);
    const cpu = new Cpu(5);
    for (let i = 0; i < 200 && (me.airborne || me.state !== STATE.IDLE); i++) {
      me.step(cpu.think(me, them));
      if (me.checkKO()) break;
    }
    assert.equal(me.airborne, false, 'CPU should leave the ledge onto the stage');
    assert.equal(me.y, MAIN.y);
  }
});

test('the CPU sometimes shields an incoming attack', () => {
  let shielded = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const me = grounded(14, 1);
    const them = grounded(0);
    them.facing = 1;
    const cpu = new Cpu(seed);
    them.step(input({ attackPressed: true }));
    for (let i = 0; i < 4; i++) {
      me.step(cpu.think(me, them));
      them.step(input());
    }
    if (me.state === STATE.SHIELD) shielded++;
  }
  assert.ok(shielded > 4 && shielded < 30, `CPU should block some but not all: ${shielded}/40`);
});
