import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS } from '../src/characters.js';
import { Fighter, STATE, resolveCombat } from '../src/fighter.js';
import { STAGE } from '../src/stage.js';
import { Cpu } from '../src/cpu.js';

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

function fighter(at, slot = 0) {
  const f = new Fighter(CHARACTERS.rook, at, slot);
  f.invulnFrames = 0;
  return f;
}

/** Let a fighter fall and settle on whatever is below it. */
function settle(f) {
  for (let i = 0; i < 120; i++) f.step(NEUTRAL);
  return f;
}

test('the CPU walks toward a distant opponent', () => {
  const me = settle(fighter({ x: -60, y: 20 }));
  const them = settle(fighter({ x: 60, y: 20 }, 1));
  const cpu = new Cpu(7);
  const start = me.x;
  for (let i = 0; i < 40; i++) me.step(cpu.think(me, them));
  assert.ok(me.x > start + 20, `CPU should close the gap: ${start} -> ${me.x}`);
});

test('the CPU attacks an opponent standing in reach', () => {
  const me = settle(fighter({ x: 0, y: 20 }));
  const them = settle(fighter({ x: 15, y: 20 }, 1));
  me.facing = 1;
  const cpu = new Cpu(3);
  let attacked = false;
  for (let i = 0; i < 40 && !attacked; i++) {
    me.step(cpu.think(me, them));
    attacked = me.state === STATE.ATTACK;
  }
  assert.ok(attacked, 'CPU should swing at an opponent in range');
});

test('the CPU turns to face an opponent behind it before attacking', () => {
  const me = settle(fighter({ x: 0, y: 20 }));
  const them = settle(fighter({ x: -15, y: 20 }, 1));
  me.facing = 1; // looking the wrong way
  const cpu = new Cpu(3);
  let move = null;
  for (let i = 0; i < 40 && !move; i++) {
    me.step(cpu.think(me, them));
    if (me.state === STATE.ATTACK) move = me.facing;
  }
  assert.equal(move, -1, 'CPU must face the opponent when it swings');
});

test('the CPU goes for the strong attack once the target is at kill percent', () => {
  const me = settle(fighter({ x: 0, y: 20 }));
  const them = settle(fighter({ x: 20, y: 20 }, 1));
  them.percent = 120;
  me.facing = 1;
  const cpu = new Cpu(5);
  let used = null;
  for (let i = 0; i < 40 && !used; i++) {
    me.step(cpu.think(me, them));
    if (me.state === STATE.ATTACK) used = me.move.name;
  }
  assert.equal(used, 'strong');
});

test('the CPU does not run off the ledge chasing an opponent', () => {
  const me = settle(fighter({ x: 60, y: 20 }));
  const them = fighter({ x: 150, y: 20 }, 1); // hanging out past the edge
  them.airborne = true;
  const cpu = new Cpu(9);
  for (let i = 0; i < 200; i++) me.step(cpu.think(me, them));
  assert.equal(me.airborne, false, 'CPU walked off the stage');
});

test('the CPU recovers to the stage after being knocked off the side', () => {
  for (const side of [1, -1]) {
    const me = fighter({ x: 108 * side, y: 12 });
    me.jumpsUsed = 0;
    const them = settle(fighter({ x: 0, y: 20 }, 1));
    const cpu = new Cpu(11);
    let frames = 0;
    while (frames < 400 && (me.airborne || me.state === STATE.DEAD)) {
      me.step(cpu.think(me, them));
      if (me.checkKO()) break;
      frames++;
    }
    assert.equal(me.state === STATE.DEAD, false, `CPU fell to its death off the ${side > 0 ? 'right' : 'left'}`);
    assert.equal(me.airborne, false, 'CPU should be back on the stage');
    assert.equal(me.y, 0);
  }
});

test('a CPU-vs-CPU match runs to a winner', () => {
  const a = fighter(STAGE.spawns[0], 0);
  const b = fighter(STAGE.spawns[1], 1);
  const cpuA = new Cpu(101);
  const cpuB = new Cpu(202, 18); // slightly slower, so the match is not a mirror

  const limit = 60 * 60 * 8; // eight minutes of game time
  let frame = 0;
  while (frame < limit && a.stocks > 0 && b.stocks > 0) {
    const inA = cpuA.think(a, b);
    const inB = cpuB.think(b, a);
    a.step(inA);
    b.step(inB);
    resolveCombat([a, b]);
    a.checkKO();
    b.checkKO();
    frame++;
  }
  assert.ok(a.stocks === 0 || b.stocks === 0, `no winner after ${frame} frames: ${a.stocks} vs ${b.stocks}`);
});
