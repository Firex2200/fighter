import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA, frameCamera, initialCamera, maxHalfH } from '../src/camera.js';

const PHONE = 390 / 844; // iPhone landscape, height / width
const LAPTOP = 720 / 1280;
const ULTRAWIDE = 1 / 2.4;

/** Run the camera for n frames with fixed fighter positions. */
function settle(cam, points, aspect, n = 600) {
  for (let i = 0; i < n; i++) cam = frameCamera(cam, points, aspect);
  return cam;
}

/** Is a point inside the camera's view? */
function inView(cam, p, aspect) {
  const halfW = cam.halfH / aspect;
  return Math.abs(p.x - cam.x) <= halfW && Math.abs(p.y - cam.y) <= cam.halfH;
}

test('both fighters end up in view, at every screen shape', () => {
  for (const aspect of [PHONE, LAPTOP, ULTRAWIDE]) {
    for (const pts of [
      [{ x: -60, y: 13 }, { x: 60, y: 13 }],
      [{ x: -150, y: 13 }, { x: 140, y: 40 }],
      [{ x: 0, y: 13 }, { x: 10, y: 120 }],
    ]) {
      const cam = settle(initialCamera(aspect), pts, aspect);
      for (const p of pts) assert.ok(inView(cam, p, aspect), `${JSON.stringify(p)} off-screen at aspect ${aspect.toFixed(2)}`);
    }
  }
});

test('zoom stays between its closest and widest limits', () => {
  for (const aspect of [PHONE, LAPTOP, ULTRAWIDE]) {
    const close = settle(initialCamera(aspect), [{ x: 0, y: 13 }, { x: 2, y: 13 }], aspect);
    assert.ok(Math.abs(close.halfH - CAMERA.minHalfH) < 0.5, 'two fighters together: fully zoomed in');
    const far = settle(initialCamera(aspect), [{ x: -230, y: 13 }, { x: 230, y: 170 }], aspect);
    assert.ok(far.halfH <= maxHalfH(aspect) + 1e-9, 'never wider than the blast box allows');
  }
});

test('small movements inside the dead zone do not change the zoom', () => {
  const aspect = PHONE;
  let cam = settle(initialCamera(aspect), [{ x: -200, y: 13 }, { x: 200, y: 13 }], aspect);
  assert.ok(cam.halfH > CAMERA.minHalfH + 10, 'setup: should start zoomed out');
  const settled = cam.halfH;

  // Close in by ~5%: well inside the dead zone.
  cam = settle(cam, [{ x: -190, y: 13 }, { x: 190, y: 13 }], aspect, 300);
  assert.ok(Math.abs(cam.halfH - settled) < 0.5, `zoom drifted ${settled} -> ${cam.halfH}`);

  // Close in by a lot: now it should zoom back in.
  cam = settle(cam, [{ x: -40, y: 13 }, { x: 40, y: 13 }], aspect, 600);
  assert.ok(cam.halfH < settled * 0.85, 'a big change should still zoom in');
});

test('zooming out reacts faster than zooming back in', () => {
  const aspect = LAPTOP;
  const near = [{ x: -20, y: 13 }, { x: 20, y: 13 }];
  const far = [{ x: -180, y: 13 }, { x: 180, y: 13 }];
  const framesTo = (cam, pts, done) => {
    let n = 0;
    while (!done(cam) && n < 2000) {
      cam = frameCamera(cam, pts, aspect);
      n++;
    }
    return { n, cam };
  };
  const start = settle(initialCamera(aspect), near, aspect);
  const wideH = settle(start, far, aspect).halfH;
  const out = framesTo(start, far, (c) => c.halfH >= start.halfH + (wideH - start.halfH) * 0.9);
  const back = framesTo(out.cam, near, (c) => c.halfH <= start.halfH + (wideH - start.halfH) * 0.1);
  assert.ok(out.n < back.n / 2, `out took ${out.n} frames, in took ${back.n}`);
});

test('a wider screen sees more of the stage sideways at the same zoom', () => {
  const pts = [{ x: 0, y: 13 }];
  const phone = settle(initialCamera(PHONE), pts, PHONE);
  const laptop = settle(initialCamera(LAPTOP), pts, LAPTOP);
  assert.equal(phone.halfH, laptop.halfH, 'same vertical zoom, so characters are the same size');
  assert.ok(phone.halfH / PHONE > laptop.halfH / LAPTOP, 'the phone shows more width');
});
