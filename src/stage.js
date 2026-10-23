// Stage geometry and blast zones. Coordinates are Smash units with y pointing UP
// and y=0 at the main platform's surface. The renderer flips y, nothing here does.

export const STAGE = {
  platforms: [
    // The main stage. solid:true means you cannot drop through it, so pressing
    // down near the edge isn't an instant suicide.
    { x1: -88, x2: 88, y: 0, solid: true },
    { x1: -62, x2: -22, y: 42, solid: false },
    { x1: 22, x2: 62, y: 42, solid: false },
  ],
  blast: { left: -240, right: 240, top: 180, bottom: -140 },
  // Outboard of the soft platforms (which span +/-22..62) so fighters drop to the
  // main stage instead of landing on a platform and starting the match elevated.
  spawns: [
    { x: -72, y: 75 },
    { x: 72, y: 75 },
  ],
};

/** The camera's view box in world units; wide enough to see the side blast lines. */
export const VIEW = { centerX: 0, centerY: 20, width: 560, height: 315 };

/** True once a fighter has crossed any blast line. */
export function isOutOfBounds(x, y, blast = STAGE.blast) {
  return x < blast.left || x > blast.right || y > blast.top || y < blast.bottom;
}

/**
 * Which blast line was crossed. Used only to pick the KO effect, but it also
 * makes the out-of-bounds logic directly testable edge by edge.
 * @returns {'left'|'right'|'top'|'bottom'|null}
 */
export function blastLineCrossed(x, y, blast = STAGE.blast) {
  if (y < blast.bottom) return 'bottom';
  if (y > blast.top) return 'top';
  if (x < blast.left) return 'left';
  if (x > blast.right) return 'right';
  return null;
}

/**
 * Find a platform to land on this frame. A fighter only lands when moving
 * downward and crossing a platform surface, which is what makes every platform
 * pass-through from below.
 * @param {number} prevY  foot height at the start of the frame
 * @param {number} y      foot height now
 * @returns the platform landed on, or null
 */
export function findLanding(prevY, x, y, vy, ignorePlatform = null) {
  if (vy > 0) return null; // rising: pass straight through
  for (const p of STAGE.platforms) {
    if (p === ignorePlatform) continue;
    if (x < p.x1 || x > p.x2) continue;
    if (prevY >= p.y && y <= p.y) return p;
  }
  return null;
}
