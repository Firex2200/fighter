// Keyboard and gamepad collapsed into one set of named actions, so no game code
// ever asks which device it is running on.
//
// Uses the raw DOM and Gamepad APIs rather than Phaser's wrappers: the Gamepad
// API behaves identically in Safari, Chrome and Xbox Edge, which is the whole
// point of this layer.

import { touch } from './touch.js';

const DEADZONE = 0.35;

/** Standard gamepad mapping, shared by Xbox/PlayStation/generic pads. */
const PAD = {
  jump: [0], // A
  special: [1], // B
  attack: [2], // X
  strong: [3], // Y
  shield: [4, 5, 6, 7], // either bumper or trigger
  up: [12],
  down: [13],
  left: [14],
  right: [15],
};

const heldKeys = new Set();
let keyboardReady = false;

function initKeyboard() {
  if (keyboardReady) return;
  keyboardReady = true;
  window.addEventListener('keydown', (e) => {
    heldKeys.add(e.code);
    // Stop the browser scrolling the page out from under the game.
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => heldKeys.delete(e.code));
  window.addEventListener('blur', () => heldKeys.clear());
}

/** Default bindings. Player 2 defaults to a gamepad but keeps a keyboard fallback. */
export const BINDINGS = [
  {
    label: 'WASD move · J attack · K strong · L special · I shield',
    keys: {
      left: 'KeyA',
      right: 'KeyD',
      up: 'KeyW',
      down: 'KeyS',
      jump: 'KeyW',
      attack: 'KeyJ',
      strong: 'KeyK',
      special: 'KeyL',
      shield: 'KeyI',
    },
    pad: 0,
    touch: true, // on-screen controls drive player 1
  },
  {
    label: 'Arrows · , attack · . strong · / special · R-Shift shield',
    keys: {
      left: 'ArrowLeft',
      right: 'ArrowRight',
      up: 'ArrowUp',
      down: 'ArrowDown',
      jump: 'ArrowUp',
      attack: 'Comma',
      strong: 'Period',
      special: 'Slash',
      shield: 'ShiftRight',
    },
    pad: 1,
  },
];

const NO_TOUCH = { x: 0, y: 0 };

/** Per-player input, tracking the previous frame so it can report edges. */
export class PlayerInput {
  constructor(binding) {
    this.binding = binding;
    this.prev = { x: 0, jump: false, attack: false, strong: false, special: false, shield: false, down: false };
    this.state = {
      x: 0,
      y: 0,
      jump: false,
      down: false,
      shield: false,
      xPressed: false, // a direction newly pushed this frame, for rolls
      jumpPressed: false,
      downPressed: false,
      attackPressed: false,
      strongPressed: false,
      specialPressed: false,
      shieldPressed: false,
    };
    initKeyboard();
  }

  /** Whichever pad sits in this player's slot, or null if nothing is connected. */
  get pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    return pads[this.binding.pad] || null;
  }

  poll() {
    const k = this.binding.keys;
    const pad = this.pad;

    const key = (code) => heldKeys.has(code);
    const button = (list) => !!pad && list.some((i) => pad.buttons[i]?.pressed);
    const axis = (i) => (pad && Math.abs(pad.axes[i] ?? 0) > DEADZONE ? pad.axes[i] : 0);

    const t = this.binding.touch ? touch : NO_TOUCH;

    const left = key(k.left) || button(PAD.left) || axis(0) < 0 || t.x < 0;
    const right = key(k.right) || button(PAD.right) || axis(0) > 0 || t.x > 0;
    const down = key(k.down) || button(PAD.down) || axis(1) > 0 || t.y < 0;
    const up = key(k.up) || button(PAD.up) || axis(1) < 0 || t.y > 0;

    const jump = key(k.jump) || button(PAD.jump) || t.jump;
    const attack = key(k.attack) || button(PAD.attack) || t.attack;
    const strong = key(k.strong) || button(PAD.strong) || t.strong;
    const special = key(k.special) || button(PAD.special) || t.special;
    const shield = key(k.shield) || button(PAD.shield) || t.shield;

    const s = this.state;
    s.x = (right ? 1 : 0) - (left ? 1 : 0);
    s.y = (up ? 1 : 0) - (down ? 1 : 0);
    s.jump = jump;
    s.down = down;
    s.shield = shield;
    s.xPressed = s.x !== 0 && s.x !== this.prev.x;
    s.jumpPressed = jump && !this.prev.jump;
    s.downPressed = down && !this.prev.down;
    s.attackPressed = attack && !this.prev.attack;
    s.strongPressed = strong && !this.prev.strong;
    s.specialPressed = special && !this.prev.special;
    s.shieldPressed = shield && !this.prev.shield;

    this.prev = { x: s.x, jump, attack, strong, special, shield, down };
    return s;
  }
}

/** True once any gamepad is visible. iOS only reports pads after a button press. */
export function anyGamepadConnected() {
  if (!navigator.getGamepads) return false;
  return Array.from(navigator.getGamepads()).some((p) => p);
}
