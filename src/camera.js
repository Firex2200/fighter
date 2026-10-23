// The match camera, as a pure function so it can be tested without a browser.
//
// Zoom is measured as the visible HALF-HEIGHT in world units. Characters are
// then the same size relative to the screen's height on every device, and a
// wider screen (a phone) simply sees more of the stage to the sides, instead of
// shrinking the whole game to fit with black bars.

import { STAGE } from './stage.js';

export const CAMERA = {
  minHalfH: 92, // closest zoom; ~20% further out than the first version, which felt too close
  padding: 70, // world units kept clear around the fighters
  deadZone: 0.12, // only zoom back in once the view could shrink by more than this
  overshoot: 1.05, // when zooming out, go a little further so tiny moves don't retrigger it
  zoomOutRate: 0.12, // per-frame easing toward a wider view: quick, so launches stay in frame
  zoomInRate: 0.025, // per-frame easing back in: slow and calm, like Smash
  panRate: 0.08,
};

const BLAST = STAGE.blast;

/** Widest the camera may go at this screen shape: never past the blast lines. */
export function maxHalfH(aspect) {
  const fromHeight = (BLAST.top - BLAST.bottom) / 2;
  const fromWidth = ((BLAST.right - BLAST.left) / 2) * aspect;
  return Math.max(CAMERA.minHalfH, Math.min(fromHeight, fromWidth));
}

/** A starting camera centred on the stage. */
export function initialCamera(aspect) {
  return { x: 0, y: 20, halfH: CAMERA.minHalfH, goalH: CAMERA.minHalfH, aspect };
}

/**
 * Advance the camera one frame.
 * @param cam     previous camera { x, y, halfH, goalH }
 * @param points  centres of the fighters to keep in view [{x, y}]
 * @param aspect  screen height / width
 * @returns the next camera (a new object)
 */
export function frameCamera(cam, points, aspect) {
  const next = { ...cam, aspect };
  if (points.length === 0) return next;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // How tall the view must be: enough for the vertical spread, or for the
  // horizontal spread converted through the screen's shape, whichever is more.
  const needed = Math.min(
    maxHalfH(aspect),
    Math.max(CAMERA.minHalfH, (maxY - minY) / 2 + CAMERA.padding, ((maxX - minX) / 2 + CAMERA.padding) * aspect)
  );

  // The goal only moves out when it must, and only back in once there's a
  // clear gain. Without this dead zone the zoom twitches with every step.
  if (needed > next.goalH) {
    next.goalH = Math.min(maxHalfH(aspect), needed * CAMERA.overshoot);
  } else if (needed < next.goalH * (1 - CAMERA.deadZone)) {
    next.goalH = needed;
  }
  next.goalH = Math.min(next.goalH, maxHalfH(aspect));

  const rate = next.goalH > next.halfH ? CAMERA.zoomOutRate : CAMERA.zoomInRate;
  next.halfH += (next.goalH - next.halfH) * rate;

  next.x += ((minX + maxX) / 2 - next.x) * CAMERA.panRate;
  next.y += ((minY + maxY) / 2 - next.y) * CAMERA.panRate;

  // Never pan past the blast box into empty space.
  const halfW = next.halfH / aspect;
  next.x = clampSpan(next.x, BLAST.left, BLAST.right, halfW);
  next.y = clampSpan(next.y, BLAST.bottom, BLAST.top, next.halfH);
  return next;
}

/**
 * Keep a view of half-size `half` inside [lo, hi]. If the view is wider than the
 * span it is meant to fit, centre it rather than letting the clamp invert.
 */
function clampSpan(value, lo, hi, half) {
  if (hi - lo <= half * 2) return (lo + hi) / 2;
  return Math.min(Math.max(value, lo + half), hi - half);
}
