// Integration tests: run the real simulation headlessly. This works because
// fighter/stage/combat have no engine dependency, so a "match" is just a loop.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, JUMPSQUAT_FRAMES, MOVES, makeCharacter } from '../src/characters.js';
import { Fighter, STATE, resolveCombat } from '../src/fighter.js';
import { STAGE } from '../src/stage.js';

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

const input = (over = {}) => ({ ...NEUTRAL, ...over });

function spawn(charId = 'rook', slot = 0, at = null) {
  const f = new Fighter(CHARACTERS[charId], at ?? STAGE.spawns[slot], slot);
  f.invulnFrames = 0; // tests want hits to land immediately
  return f;
}

/** Run n frames of a single fighter with a constant input. */
function run(fighter, frames, over = {}) {
  for (let i = 0; i < frames; i++) fighter.step(input(over));
  return fighter;
}

test('a fighter spawned in the air falls and lands on the main platform', () => {
  const f = spawn('rook');
  assert.ok(f.airborne, 'should start airborne');
  run(f, 120);
  assert.equal(f.airborne, false, 'should have landed');
  assert.equal(f.y, 0, 'should rest on the main platform surface');
  assert.equal(f.platform.solid, true);
});

test('fall speed is capped at the character terminal velocity', () => {
  // Drop from high above the stage, past the platform's x range so nothing catches it.
  const f = spawn('rook', 0, { x: 200, y: 160 });
  run(f, 200);
  assert.ok(
    f.vy >= -CHARACTERS.rook.fallSpeed - 1e-9,
    `fall speed exceeded terminal: ${f.vy} vs ${-CHARACTERS.rook.fallSpeed}`
  );
});

test('fastfall is strictly faster than a normal fall', () => {
  const normal = spawn('rook', 0, { x: 200, y: 160 });
  const fast = spawn('rook', 0, { x: 200, y: 160 });
  run(normal, 40);

  // Fastfall only engages once already descending, so fall first, then tap down.
  run(fast, 20);
  fast.step(input({ down: true, downPressed: true }));
  run(fast, 19, { down: true });

  assert.ok(fast.y < normal.y, `fastfall should be lower: ${fast.y} vs ${normal.y}`);
});

test('fastfall does not engage while still rising', () => {
  const f = spawn('rook');
  run(f, 150);
  f.step(input({ jump: true, jumpPressed: true }));
  for (let i = 0; i < JUMPSQUAT_FRAMES; i++) f.step(input({ jump: true }));
  assert.ok(f.vy > 0, 'should be rising');

  f.step(input({ down: true, downPressed: true }));
  assert.equal(f.fastFalling, false, 'cannot fastfall on the way up');
});

test('jump has a 3-frame jumpsquat, then leaves the ground', () => {
  const f = spawn('rook');
  run(f, 120); // land first
  assert.equal(f.airborne, false);

  f.step(input({ jump: true, jumpPressed: true }));
  assert.equal(f.state, STATE.JUMPSQUAT);
  assert.equal(f.airborne, false, 'still grounded during jumpsquat');

  // Hold jump through the squat for a full hop.
  for (let i = 0; i < JUMPSQUAT_FRAMES; i++) f.step(input({ jump: true }));
  assert.equal(f.airborne, true, 'should be airborne after jumpsquat');
  assert.ok(f.y > 0, 'should be rising off the platform');
});

test('short hop reaches roughly half the height of a full hop', () => {
  // Measured relative to the ground the fighter jumped from, not absolute y.
  const hopHeight = (holdJump) => {
    const f = spawn('rook');
    run(f, 150);
    const ground = f.y;
    f.step(input({ jump: true, jumpPressed: true }));
    let best = f.y;
    for (let i = 0; i < 90; i++) {
      f.step(input({ jump: holdJump }));
      best = Math.max(best, f.y);
    }
    return best - ground;
  };

  const full = hopHeight(true);
  const short = hopHeight(false);
  assert.ok(full > 0 && short > 0, `both hops must leave the ground: ${full}/${short}`);

  const ratio = short / full;
  assert.ok(ratio > 0.4 && ratio < 0.6, `short hop should be ~half of full hop, got ${ratio.toFixed(3)}`);
});

test('double jump works once in the air and resets on landing', () => {
  const f = spawn('rook');
  run(f, 120);
  assert.equal(f.jumpsUsed, 0, 'landing resets the jump counter');

  f.step(input({ jump: true, jumpPressed: true }));
  for (let i = 0; i < JUMPSQUAT_FRAMES; i++) f.step(input({ jump: true }));
  assert.equal(f.airborne, true);

  f.step(input({ jump: true, jumpPressed: true })); // double jump
  assert.equal(f.jumpsUsed, 1);
  const vyAfterDouble = f.vy;
  assert.ok(vyAfterDouble > 0, 'double jump should push upward');

  f.step(input({ jump: true, jumpPressed: true })); // third jump: should be refused
  assert.equal(f.jumpsUsed, 1, 'no third jump');
});

test('walking off the edge makes a fighter airborne', () => {
  const f = spawn('rook');
  run(f, 120);
  assert.equal(f.airborne, false);
  run(f, 200, { x: 1 }); // run right, off the stage
  assert.equal(f.airborne, true, 'should have walked off and started falling');
  assert.ok(f.x > STAGE.platforms[0].x2, 'should be past the stage edge');
});

test('down does not drop a fighter through the solid main platform', () => {
  const f = spawn('rook');
  run(f, 120);
  f.step(input({ down: true, downPressed: true }));
  run(f, 10, { down: true });
  assert.equal(f.airborne, false, 'the main stage must not be droppable');
  assert.equal(f.y, 0);
});

test('down drops a fighter through a soft platform', () => {
  const soft = STAGE.platforms[1];
  const f = spawn('rook', 0, { x: (soft.x1 + soft.x2) / 2, y: soft.y + 40 });
  run(f, 120);
  assert.equal(f.platform, soft, 'should have landed on the soft platform');

  f.step(input({ down: true, downPressed: true }));
  assert.equal(f.airborne, true, 'should drop through');
  run(f, 120);
  assert.equal(f.y, 0, 'should fall to the main stage below');
});

test('an attack connects, deals its damage, and launches the target', () => {
  const a = spawn('rook', 0, { x: 0, y: 0 });
  const d = spawn('rook', 1, { x: 14, y: 0 });
  run(a, 60);
  run(d, 60);
  a.facing = 1;

  a.step(input({ attackPressed: true }));
  assert.equal(a.state, STATE.ATTACK);

  let events = [];
  for (let i = 0; i < 20 && events.length === 0; i++) {
    a.step(input());
    d.step(input());
    events = resolveCombat([a, d]);
  }

  assert.equal(events.length, 1, 'the jab should connect exactly once');
  // Derived from the move data so retuning damage does not break this test.
  assert.ok(
    Math.abs(d.percent - MOVES.jab.damage) < 1e-9,
    `expected ${MOVES.jab.damage}%, got ${d.percent}`
  );
  assert.equal(d.state, STATE.HITSTUN);
  assert.ok(d.hitstunFrames > 0);
});

test('a single attack cannot hit twice during its active frames', () => {
  const a = spawn('rook', 0, { x: 0, y: 0 });
  const d = spawn('rook', 1, { x: 14, y: 0 });
  run(a, 60);
  run(d, 60);
  a.facing = 1;
  a.step(input({ attackPressed: true }));

  let hits = 0;
  for (let i = 0; i < 40; i++) {
    a.step(input());
    d.step(input());
    hits += resolveCombat([a, d]).length;
  }
  assert.equal(hits, 1, `multi-frame hitbox machine-gunned the target: ${hits} hits`);
});

test('damage accumulates across repeated hits', () => {
  const a = spawn('rook', 0, { x: 0, y: 0 });
  const d = spawn('rook', 1, { x: 14, y: 0 });
  run(a, 60);
  run(d, 60);

  let hits = 0;
  for (let i = 0; i < 600 && hits < 3; i++) {
    a.x = d.x - 14; // keep the attacker in range as the target gets knocked back
    a.facing = 1;
    if (a.canAct) a.step(input({ attackPressed: true }));
    else a.step(input());
    d.step(input());
    hits += resolveCombat([a, d]).length;
  }

  assert.equal(hits, 3, 'should have landed three jabs');
  const expected = MOVES.jab.damage * 3;
  assert.ok(Math.abs(d.percent - expected) < 1e-6, `expected ${expected}%, got ${d.percent}`);
});

test('a strong hit at high damage KOs across the side blast line', () => {
  const a = spawn('rook', 0, { x: 0, y: 0 });
  const d = spawn('rook', 1, { x: 16, y: 0 });
  run(a, 60);
  run(d, 60);
  d.percent = 130;
  a.facing = 1;

  a.step(input({ strongPressed: true }));
  let landed = false;
  for (let i = 0; i < 30 && !landed; i++) {
    a.step(input());
    d.step(input());
    landed = resolveCombat([a, d]).length > 0;
  }
  assert.ok(landed, 'the strong attack should connect');

  const stocksBefore = d.stocks;
  let ko = null;
  for (let i = 0; i < 400 && !ko; i++) {
    d.step(input());
    ko = d.checkKO();
  }

  assert.ok(ko, 'a strong hit at 130% should carry the target past a blast line');
  assert.equal(d.stocks, stocksBefore - 1, 'exactly one stock lost');
  assert.equal(d.state, STATE.DEAD);
});

test('crossing a blast line costs exactly one stock, not one per frame', () => {
  const f = spawn('rook', 0, { x: 0, y: 0 });
  f.x = STAGE.blast.right + 50;
  const before = f.stocks;

  assert.ok(f.checkKO(), 'first check should register the KO');
  for (let i = 0; i < 30; i++) f.checkKO();
  assert.equal(f.stocks, before - 1, 'stock drained repeatedly while dead');
});

test('each blast line is detected on its own edge', () => {
  const cases = [
    ['right', { x: STAGE.blast.right + 1, y: 0 }],
    ['left', { x: STAGE.blast.left - 1, y: 0 }],
    ['top', { x: 0, y: STAGE.blast.top + 1 }],
    ['bottom', { x: 0, y: STAGE.blast.bottom - 1 }],
  ];
  for (const [expected, pos] of cases) {
    const f = spawn('rook', 0, { x: 0, y: 0 });
    f.x = pos.x;
    f.y = pos.y;
    assert.equal(f.checkKO(), expected, `${expected} blast line not detected`);
  }
});

test('a dead fighter respawns with its damage cleared and stocks intact', () => {
  const f = spawn('rook', 0, { x: 0, y: 0 });
  f.percent = 90;
  f.x = STAGE.blast.right + 10;
  f.checkKO();
  const stocks = f.stocks;

  run(f, 70); // past the respawn timer
  assert.notEqual(f.state, STATE.DEAD, 'should have respawned');
  assert.equal(f.percent, 0, 'damage resets on respawn');
  assert.equal(f.stocks, stocks, 'respawning must not change the stock count');
  assert.ok(f.invulnFrames > 0, 'should respawn with invulnerability');
});

test('respawn invulnerability blocks hits', () => {
  const a = spawn('rook', 0, { x: 0, y: 0 });
  const d = spawn('rook', 1, { x: 14, y: 0 });
  run(a, 60);
  run(d, 60);
  d.invulnFrames = 60;
  a.facing = 1;

  a.step(input({ attackPressed: true }));
  let hits = 0;
  for (let i = 0; i < 30; i++) {
    a.step(input());
    d.step(input());
    hits += resolveCombat([a, d]).length;
  }
  assert.equal(hits, 0, 'an invulnerable fighter must not be hit');
  assert.equal(d.percent, 0);
});

test('a heavy fighter survives longer than a light one from the same hit', () => {
  // The roster is one character now, so build weight variants explicitly rather
  // than leaning on two roster entries. Weight is the only thing that differs.
  const launch = (weight) => {
    const a = spawn('rook', 0, { x: 0, y: 0 });
    const d = new Fighter(makeCharacter({ ...CHARACTERS.rook, weight }), { x: 16, y: 0 }, 1);
    d.invulnFrames = 0;
    run(a, 60);
    run(d, 60);
    d.percent = 90;
    a.facing = 1;
    a.step(input({ strongPressed: true }));
    for (let i = 0; i < 30; i++) {
      a.step(input());
      d.step(input());
      if (resolveCombat([a, d]).length) break;
    }
    let frames = 0;
    while (frames < 600 && !d.checkKO()) {
      d.step(input());
      frames++;
    }
    return { survived: frames, died: d.state === STATE.DEAD };
  };

  const light = launch(62); // lightest in Ultimate's documented range
  const heavy = launch(135); // heaviest
  assert.ok(
    heavy.survived > light.survived || (!heavy.died && light.died),
    `heavy should outlast light: light=${light.survived} heavy=${heavy.survived}`
  );
});

test('a fighter in hitstun does not sink through the stage', () => {
  const d = spawn('rook', 1, { x: 0, y: 0 });
  run(d, 60);
  assert.equal(d.airborne, false);

  // A weak hit at 0% has very little knockback, so the target stays on stage.
  d.takeHit({ damage: 2.8, bkb: 15, kbg: 25, angle: 361 }, 1);
  run(d, 200);

  assert.ok(d.y >= 0 || d.airborne, `fighter sank below the stage to y=${d.y}`);
  assert.notEqual(d.state, STATE.DEAD, 'a jab at 0% must never kill');
});

test('a launched fighter falls no faster than its fall speed and flies out sideways', () => {
  // Regression: launch and gravity used to share one velocity, so gravity
  // compounded uncapped during hitstun and every launch nosedived off the bottom.
  const d = spawn('rook', 1, { x: 0, y: 0 });
  run(d, 60);
  d.percent = 95;
  d.takeHit(MOVES.strong, 1);

  let lowestOwnVy = 0;
  let xWhenBelowStage = null;
  while (d.state === STATE.HITSTUN) {
    d.step(input());
    lowestOwnVy = Math.min(lowestOwnVy, d.vy);
    if (xWhenBelowStage === null && d.y < 0) xWhenBelowStage = d.x;
  }
  assert.ok(
    lowestOwnVy >= -CHARACTERS.rook.fallSpeed - 1e-9,
    `own fall speed exceeded its cap during hitstun: ${lowestOwnVy}`
  );
  // A kill-strength 40 degree launch should be far out to the side before it
  // drops under the stage, not plunging beside it.
  assert.ok(
    xWhenBelowStage === null || xWhenBelowStage > 150,
    `launch dropped below the stage too close in, at x=${xWhenBelowStage}`
  );
});

test('a standing attack started from a run does not slide off the stage', () => {
  const f = spawn('rook');
  run(f, 120);
  f.x = 60;
  f.step(input({ x: 1 })); // full run speed toward the right edge
  f.step(input({ attackPressed: true }));
  run(f, 40);
  assert.equal(f.airborne, false, `slid off the ledge to x=${f.x}`);
  assert.ok(f.x < STAGE.platforms[0].x2);
});
