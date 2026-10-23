// On-screen controls for phones. Plain HTML over the canvas, feeding the same
// named actions as the keyboard and gamepad (see PlayerInput.poll), so no game
// code knows whether you are touching glass or holding a controller.
//
// Left half: a floating joystick — put a thumb down anywhere, drag to steer.
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

const STICK_RADIUS = 46; // px the thumb travels for a full push
const STICK_DEADZONE = 0.38; // fraction of the radius before it counts

/** Buttons, laid out like an Xbox pad's face buttons. */
const BUTTONS = [
  { action: 'jump', label: 'Jump', cls: 'b-jump' },
  { action: 'attack', label: 'Atk', cls: 'b-attack' },
  { action: 'strong', label: 'Strong', cls: 'b-strong' },
  { action: 'special', label: 'Spec', cls: 'b-special' },
  { action: 'shield', label: 'Shield', cls: 'b-shield' },
];

export function initTouch() {
  if (!isTouchScreen()) return;

  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = `
    <div class="t-stick-zone"><div class="t-stick-base"><div class="t-stick-knob"></div></div></div>
    <div class="t-buttons">${BUTTONS.map(
      (b) => `<div class="t-btn ${b.cls}" data-action="${b.action}">${b.label}</div>`
    ).join('')}</div>`;
  document.body.appendChild(root);

  bindStick(root.querySelector('.t-stick-zone'));
  for (const el of root.querySelectorAll('.t-btn')) bindButton(el);

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

function bindButton(el) {
  const action = el.dataset.action;
  const set = (on) => {
    touch[action] = on;
    el.classList.toggle('down', on);
  };
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    set(true);
  });
  el.addEventListener('pointerup', () => set(false));
  el.addEventListener('pointercancel', () => set(false));
}
