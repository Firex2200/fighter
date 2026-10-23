import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/match.js';
import { MOVES } from '../src/characters.js';
import { ARCS, rigPose } from '../src/rook.js';
import { Cpu } from '../src/cpu.js';

const NEUTRAL = { x: 0, y: 0, jump: false, down: false, jumpPressed: false, downPressed: false };

test('a CPU-vs-CPU match runs to a winner with consistent stats and events', () => {
  const m = new Match({ costumes: ['default', 'ember'], p2IsCpu: true, seed: 7 });
  // Player 1 is driven by a second CPU so both sides fight.
  const p1 = new Cpu(99, 16);
  const seen = new Set();
  for (let i = 0; i < 60 * 60 * 8 && !m.over; i++) {
    m.tick([p1.think(m.fighters[0], m.fighters[1]), NEUTRAL]);
    for (const e of m.drainEvents()) seen.add(e.type);
  }
  assert.ok(m.over, 'match should end');
  const loser = m.fighters.find((f) => f !== m.winner);
  assert.equal(loser.stocks, 0);
  assert.equal(m.stats[loser.slot].falls, 3);
  const totalKos = m.stats[0].kos + m.stats[1].kos;
  const totalFalls = m.stats[0].falls + m.stats[1].falls;
  assert.ok(totalKos <= totalFalls, 'every KO credited is a real fall');
  assert.ok(m.stats[m.winner.slot].damageDealt > 0);
  for (const type of ['hit', 'ko', 'land', 'jump', 'swing']) assert.ok(seen.has(type), `no ${type} event seen`);
});

test('player 2 is handed to a person the moment they press something', () => {
  const m = new Match({ p2IsCpu: true });
  m.tick([NEUTRAL, NEUTRAL]);
  assert.equal(m.p2IsCpu, true);
  m.tick([NEUTRAL, { ...NEUTRAL, x: -1 }]);
  assert.equal(m.p2IsCpu, false);
});

// ------------------------------------------------------------ pose → rig

const mid = (move, phase, t = 0.5, airborne = false) =>
  rigPose({ kind: 'attack', move, phase, t, frame: 30, vx: 0, vy: 0, stride: 0, airborne, ox: 0, oy: 0 });
const dir = (r) => ({ x: Math.cos((r.blade.a * Math.PI) / 180), y: Math.sin((r.blade.a * Math.PI) / 180) });

test('every move produces a drawable rig at every phase', () => {
  for (const move of Object.keys(ARCS)) {
    for (const phase of ['startup', 'active', 'recovery']) {
      for (const t of [0, 0.5, 1]) {
        const r = mid(move, phase, t);
        for (const v of [r.angle, r.sy, r.hand[0], r.hand[1], r.blade.a, r.blade.len]) {
          assert.ok(Number.isFinite(v), `${move} ${phase} ${t}: ${v}`);
        }
      }
    }
  }
  assert.ok(Object.keys(MOVES).every((m) => ARCS[m]), 'every move in the moveset has a blade arc');
});

test('the blade points where each move actually hits', () => {
  // Hitboxes: in front for these...
  for (const m of ['jab', 'strong', 'fair', 'stormDraw']) {
    assert.ok(dir(mid(m, 'active', 0.6)).x > 0.2, `${m} blade should be in front`);
  }
  assert.ok(dir(mid('bair', 'active', 0.5)).x < -0.5, 'bair blade behind');
  assert.ok(dir(mid('uair', 'active', 0.5)).y > 0.5, 'uair blade up');
  assert.ok(dir(mid('upTilt', 'active', 0.6)).y > 0.5, 'up tilt blade up');
  assert.ok(dir(mid('dair', 'active', 0.5)).y < -0.9, 'dair blade straight down');
  assert.ok(dir(mid('downTilt', 'active', 0.9)).y < 0, 'down tilt blade low');
});

test('the blade is only drawn during attacks', () => {
  for (const kind of ['idle', 'run', 'air', 'shield', 'ledge', 'tumble', 'freefall', 'dizzy']) {
    const r = rigPose({ kind, t: 0.5, frame: 10, vx: 0, vy: 0, stride: 1, airborne: kind !== 'idle', ox: 0, oy: 0 });
    assert.equal(r.blade, null, kind);
  }
});
