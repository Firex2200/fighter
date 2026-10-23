// Rook's full moveset, run headlessly against the real fighter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, MOVES, JUMPSQUAT_FRAMES } from '../src/characters.js';
import { Fighter, STATE, resolveCombat } from '../src/fighter.js';
import { STAGE } from '../src/stage.js';

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

function fighter(x, y, slot = 0) {
  const f = new Fighter(CHARACTERS.rook, { x, y }, slot);
  f.invulnFrames = 0;
  return f;
}
function run(f, frames, over = {}) {
  for (let i = 0; i < frames; i++) f.step(input(over));
  return f;
}
const grounded = (x, slot = 0) => run(fighter(x, 20, slot), 90);

/** A fighter hanging in mid-air, well clear of the stage, for aerial tests. */
function floating(x, y, slot = 0) {
  const f = fighter(x, y, slot);
  f.vy = 0;
  return f;
}

// ------------------------------------------------------------- selection

test('direction + button picks the right move', () => {
  const cases = [
    ['ground', {}, 'attack', 'jab'],
    ['ground', { y: 1 }, 'attack', 'upTilt'],
    ['ground', { y: -1 }, 'attack', 'downTilt'],
    ['ground', {}, 'strong', 'strong'],
    ['ground', {}, 'special', 'stormDraw'],
    ['ground', { y: 1 }, 'special', 'risingStorm'],
    ['ground', { y: -1 }, 'special', 'counter'],
    ['air', {}, 'attack', 'nair'],
    ['air', { x: 1 }, 'attack', 'fair'],
    ['air', { x: -1 }, 'attack', 'bair'],
    ['air', { y: 1 }, 'attack', 'uair'],
    ['air', { y: -1 }, 'attack', 'dair'],
    ['air', { y: 1 }, 'special', 'risingStorm'],
  ];
  for (const [where, dir, button, expected] of cases) {
    const f = where === 'ground' ? grounded(0) : floating(0, 120);
    f.facing = 1;
    f.step(input({ ...dir, [`${button}Pressed`]: true }));
    assert.equal(f.state, STATE.ATTACK, `${where} ${JSON.stringify(dir)} ${button}`);
    assert.equal(f.move.name, expected, `${where} ${JSON.stringify(dir)} ${button}`);
  }
});

test('up + attack within the jump squat cancels the jump into an up-tilt', () => {
  // Keyboard players press W (up AND jump) then J: this must be an up-tilt.
  const f = grounded(0);
  f.step(input({ y: 1, jump: true, jumpPressed: true }));
  assert.equal(f.state, STATE.JUMPSQUAT);
  f.step(input({ y: 1, jump: true, attackPressed: true }));
  assert.equal(f.state, STATE.ATTACK);
  assert.equal(f.move.name, 'upTilt');
  assert.equal(f.airborne, false);
});

test('up + special within the jump squat gives the up special', () => {
  const f = grounded(0);
  f.step(input({ y: 1, jump: true, jumpPressed: true }));
  f.step(input({ y: 1, jump: true, specialPressed: true }));
  assert.equal(f.move.name, 'risingStorm');
});

// --------------------------------------------------------------- hitting

/** Put a target where `move`'s hitbox will be and check it connects once. */
function connectOnce(moveName) {
  const move = MOVES[moveName];
  const aerial = !!move.aerial;
  const a = aerial ? floating(0, 100) : grounded(0);
  a.facing = 1;
  // Target centred on the hitbox.
  const tx = move.hitbox.x;
  const ty = (aerial ? 100 : 0) + move.hitbox.y; // body centre offset is applied below
  const d = floating(tx, ty, 1);
  d.y = (aerial ? a.y : 0) + a.char.body.h / 2 + move.hitbox.y - d.char.body.h / 2;
  a.startMove(move);
  let hits = 0;
  let lastHit = null;
  const total = move.startup + move.active + move.recovery;
  for (let i = 0; i < total; i++) {
    // Freeze both in place: this test is about the hitbox, not the movement.
    const ax = a.x;
    const ay = a.y;
    a.step(input());
    a.x = ax;
    a.y = ay;
    a.vx = a.vy = 0;
    if (d.state !== STATE.HITSTUN) {
      d.vx = d.vy = 0;
    }
    for (const e of resolveCombat([a, d])) {
      hits++;
      lastHit = e.hit;
    }
  }
  return { hits, hit: lastHit, target: d };
}

for (const name of Object.keys(MOVES).filter((n) => MOVES[n].hitbox)) {
  test(`${name} connects exactly once and deals its damage`, () => {
    const { hits, target } = connectOnce(name);
    assert.equal(hits, 1, `${name} hit ${hits} times`);
    assert.ok(Math.abs(target.percent - MOVES[name].damage) < 1e-9);
  });
}

test('down air is a meteor: it sends the target downward', () => {
  const { hit } = connectOnce('dair');
  assert.ok(hit.velocity.y < 0, `dair should launch down, got vy=${hit.velocity.y}`);
});

test('back air sends the target behind the attacker', () => {
  const a = floating(0, 100);
  a.facing = 1;
  const d = floating(-14, 100, 1);
  a.startMove(MOVES.bair);
  let hit = null;
  for (let i = 0; i < 20 && !hit; i++) {
    a.step(input());
    a.x = 0;
    a.y = 100;
    for (const e of resolveCombat([a, d])) hit = e.hit;
  }
  assert.ok(hit, 'bair should connect behind him');
  assert.ok(hit.velocity.x < 0, 'facing right, bair must launch to the left');
});

test('up tilt hits a target above, not one standing in front', () => {
  const a = grounded(0);
  a.facing = 1;
  const above = floating(3, 22, 1);
  a.startMove(MOVES.upTilt);
  let hits = 0;
  for (let i = 0; i < 12; i++) {
    a.step(input());
    above.vy = 0;
    above.y = 22;
    hits += resolveCombat([a, above]).length;
  }
  assert.equal(hits, 1);
});

// --------------------------------------------------------------- specials

test('Rising Storm climbs higher than a double jump, then leaves him helpless', () => {
  const peak = (useSpecial) => {
    const f = floating(200, 40);
    const y0 = f.y;
    if (useSpecial) f.step(input({ y: 1, specialPressed: true }));
    else f.step(input({ jump: true, jumpPressed: true }));
    let best = f.y;
    let wentHelpless = false;
    for (let i = 0; i < 80; i++) {
      f.step(input());
      best = Math.max(best, f.y);
      wentHelpless ||= f.state === STATE.FREEFALL;
    }
    return { rise: best - y0, wentHelpless };
  };
  const special = peak(true);
  const jump = peak(false);
  assert.ok(special.rise > jump.rise * 1.3, `up special ${special.rise} vs double jump ${jump.rise}`);
  assert.ok(special.wentHelpless, 'Rising Storm ends helpless');
});

test('Rising Storm can only be used once per airtime', () => {
  const f = floating(200, 100);
  f.step(input({ y: 1, specialPressed: true }));
  const total = MOVES.risingStorm.startup + MOVES.risingStorm.active + MOVES.risingStorm.recovery;
  run(f, total + 1);
  f.state = STATE.IDLE; // even if he somehow could act again...
  f.step(input({ y: 1, specialPressed: true }));
  assert.notEqual(f.state, STATE.ATTACK, '...a second Rising Storm is refused');
});

test('Rising Storm from well below the stage gets him back', () => {
  // Start out of ledge range so a grab can only come from the climb itself.
  const f = floating(MAIN.x2 + 10, -45);
  f.jumpsUsed = f.char.airJumps; // double jump already spent
  f.facing = -1;
  f.step(input({ y: 1, specialPressed: true }));
  let highest = f.y;
  let outcome = 'fell';
  for (let i = 0; i < 200; i++) {
    f.step(input());
    highest = Math.max(highest, f.y);
    if (f.state === STATE.LEDGE) { outcome = 'ledge'; break; }
    if (!f.airborne) { outcome = 'landed'; break; }
    if (f.checkKO()) break;
  }
  assert.ok(highest > -45 + 30, `should have climbed, peaked at ${highest}`);
  assert.notEqual(outcome, 'fell', 'up special must get him back to the ledge or stage');
});

test('Storm Draw dashes forward', () => {
  const f = grounded(-40);
  f.facing = 1;
  const x0 = f.x;
  f.step(input({ specialPressed: true }));
  run(f, 40);
  assert.ok(f.x > x0 + 15, `Storm Draw should travel: ${x0} -> ${f.x}`);
});

test('Storm Draw on the ground stops at the ledge', () => {
  const f = grounded(MAIN.x2 - 10);
  f.facing = 1;
  f.step(input({ specialPressed: true }));
  run(f, 60);
  assert.equal(f.airborne, false, `dashed off the stage to x=${f.x}`);
});

test('Thunder Guard catches a hit in its window and strikes back', () => {
  const g = grounded(14, 1);
  g.facing = -1;
  g.step(input({ y: -1, specialPressed: true }));
  run(g, 6); // into the counter window

  const a = grounded(0);
  a.facing = 1;
  a.startMove(MOVES.strong);
  let event = null;
  for (let i = 0; i < 20 && !event; i++) {
    a.step(input());
    for (const e of resolveCombat([a, g])) event = e;
  }
  assert.ok(event?.countered, 'the strong attack should be countered');
  assert.equal(g.percent, 0, 'the counterer takes no damage');
  assert.ok(a.percent >= MOVES.strong.damage * 1.2 - 1e-9, `countered for ${a.percent}`);
  assert.equal(a.state, STATE.HITSTUN);
});

test('Thunder Guard outside its window gets hit normally', () => {
  const g = grounded(14, 1);
  g.facing = -1;
  g.step(input({ y: -1, specialPressed: true }));
  run(g, MOVES.counter.counter[1] + 2); // window has closed

  const a = grounded(0);
  a.facing = 1;
  a.startMove(MOVES.jab);
  let event = null;
  for (let i = 0; i < 10 && !event; i++) {
    a.step(input());
    for (const e of resolveCombat([a, g])) event = e;
  }
  assert.ok(event && !event.countered);
  assert.ok(g.percent > 0);
});

// ----------------------------------------------------------------- landing

test('landing during an aerial costs that aerial\'s landing lag', () => {
  const f = fighter(0, 6);
  f.vy = -1;
  f.step(input({ y: -1, attackPressed: true })); // dair: long and laggy
  assert.equal(f.move.name, 'dair');
  run(f, 20);
  assert.equal(f.airborne, false);
  assert.equal(f.state, STATE.LAG);
  assert.equal(f.lagFrames, MOVES.dair.landingLag);
});

test('the jump squat is still 3 frames when no move is pressed', () => {
  const f = grounded(0);
  f.step(input({ jump: true, jumpPressed: true }));
  run(f, JUMPSQUAT_FRAMES, { jump: true });
  assert.equal(f.airborne, true);
});
