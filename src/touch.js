// On-screen controls for phones. Plain HTML over the canvas, feeding the same
// named actions as the keyboard and gamepad (see PlayerInput.poll), so no game
// code knows whether you are touching glass or holding a controller.
//
// Left half: a floating GameCube-style stick — put a thumb down anywhere, drag.
// Pushing up only aims up; jumping is its own button, so up-attacks and the up
// special work without jumping by accident.

/** Live touch state, read by PlayerInput for player 1. */
export const touch = {
  x: 0,
  y: 0,
  jump: false,
  attack: false,
  strong: false,
  special: false,
  shield: false,
};

const isTouchScreen = () => window.matchMedia('(pointer: coarse)').matches;

const STICK_DEADZONE = 0.38; // fraction of a full push before it counts

/**
 * GameCube layout: big green A in the middle, small red B below-left, X and Y
 * curved around A (both jump, as in GameCube Smash), yellow C where the
 * C-stick sits, and R as the shield shoulder. Positions live in index.html.
 */
const BUTTONS = [
  { action: 'attack', key: 'A', label: 'attack', cls: 'b-a' },
  { action: 'special', key: 'B', label: 'special', cls: 'b-b' },
  { action: 'jump', key: 'X', label: 'jump', cls: 'b-x' },
  { action: 'jump', key: 'Y', label: 'jump', cls: 'b-y' },
  { action: 'strong', key: 'C', label: 'strong', cls: 'b-c' },
  { action: 'shield', key: 'R', label: 'shield', cls: 'b-r' },
];

export function initTouch() {
  if (!isTouchScreen()) return;

  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = `
    <div class="t-stick-zone"><div class="t-stick-base"><div class="t-stick-knob"></div></div></div>
    <div class="t-buttons">${BUTTONS.filter((b) => b.key !== 'R').map(button).join('')}</div>
    ${button(BUTTONS.find((b) => b.key === 'R'))}`;
  document.body.appendChild(root);

  bindStick(root.querySelector('.t-stick-zone'));
  for (const el of root.querySelectorAll('.t-btn')) bindButton(el, root);

  // Hide while a controller is connected; the controller then does everything.
  setInterval(() => {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    root.style.display = pads.some((p) => p) ? 'none' : '';
  }, 500);
}

function bindStick(zone) {
  const base = zone.querySelector('.t-stick-base');
  const knob = zone.querySelector('.t-stick-knob');
  let id = null;
  let ox = 0;
  let oy = 0;

  const release = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    touch.x = touch.y = 0;
    base.style.opacity = '0.35';
    knob.style.transform = 'translate(-50%, -50%)';
  };

  zone.addEventListener('pointerdown', (e) => {
    if (id !== null) return;
    id = e.pointerId;
    zone.setPointerCapture(id);
    // The stick appears under the thumb, wherever it lands.
    ox = e.clientX;
    oy = e.clientY;
    const r = zone.getBoundingClientRect();
    base.style.left = `${ox - r.left}px`;
    base.style.top = `${oy - r.top}px`;
    base.style.opacity = '0.8';
  });

  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const STICK_RADIUS = base.offsetWidth * 0.42; // a full push, scaled with the stick
    let dx = e.clientX - ox;
    let dy = e.clientY - oy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const nx = dx / STICK_RADIUS;
    const ny = dy / STICK_RADIUS;
    touch.x = Math.abs(nx) > STICK_DEADZONE ? Math.sign(nx) : 0;
    touch.y = Math.abs(ny) > STICK_DEADZONE ? -Math.sign(ny) : 0; // screen down = game down
  });

  zone.addEventListener('pointerup', release);
  zone.addEventListener('pointercancel', release);
}

function button(b) {
  return `<div class="t-btn ${b.cls}" data-action="${b.action}"><b>${b.key}</b><small>${b.label}</small></div>`;
}

function bindButton(el, root) {
  const action = el.dataset.action;
  // An action is held while ANY of its buttons is: X and Y both jump, so
  // letting go of one must not cancel a jump still held on the other.
  const set = (on) => {
    el.classList.toggle('down', on);
    touch[action] = [...root.querySelectorAll(`[data-action="${action}"]`)].some((b) =>
      b.classList.contains('down')
    );
  };
  el.addEventListener('pointerdown', (e) => {
    set(true); // register the press first: capture can be refused, and must not lose it
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}
  });
  el.addEventListener('pointerup', () => set(false));
  el.addEventListener('pointercancel', () => set(false));
}
