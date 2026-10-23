import { CHARACTERS, PLAYER_COSTUMES } from '../characters.js';
import { Fighter, STATE, resolveCombat } from '../fighter.js';
import { STAGE } from '../stage.js';
import { frameCamera, initialCamera } from '../camera.js';
import { BINDINGS, PlayerInput, anyGamepadConnected } from '../input.js';
import { COSTUMES, paletteFor, drawRook, poseOf } from '../rook.js';
import { Cpu } from '../cpu.js';
import { shieldScale } from '../combat.js';

const STEP_MS = 1000 / 60;
const MAX_CATCHUP_STEPS = 5; // never let a background tab spiral into a huge catch-up

// A mirror match: both players are Rook, told apart by costume alone.
const ROSTER = [CHARACTERS.rook, CHARACTERS.rook];

/**
 * Freeze frames on impact. shortcut: this is a feel approximation, not Ultimate's
 * real hitlag formula, which the research pass did not confirm. Upgrade if hits
 * ever feel mistimed relative to the real game.
 */
function hitlagFrames(damage) {
  return Math.floor(damage * 0.65) + 5;
}

/** True if a player's input this frame shows a human is there. */
function touchedAnything(s) {
  return s.x !== 0 || s.down || s.jump || s.attackPressed || s.strongPressed;
}

export class MatchScene extends Phaser.Scene {
  constructor() {
    super('match');
  }

  create() {
    // The game's width follows the screen's shape (see main.js), so read the
    // live size every frame rather than the size it booted with.
    this.cam = initialCamera(this.scale.height / this.scale.width);
    this.syncView();

    this.fighters = ROSTER.map((c, i) => {
      const f = new Fighter(c, STAGE.spawns[i], i);
      f.costume = PLAYER_COSTUMES[i];
      f.palette = paletteFor(f.costume);
      return f;
    });
    this.inputs = BINDINGS.map((b) => new PlayerInput(b));
    // P2 is the CPU until a person presses any P2 control, then it's theirs for
    // the rest of the match. No menu needed to play alone or with a friend.
    this.cpu = new Cpu(Date.now() & 0xffff);
    this.p2IsCpu = true;
    this.accumulator = 0;
    this.hitlag = 0;
    this.frame = 0; // free-running counter driving the idle sway
    this.showHitboxes = false;

    this.stageGfx = this.add.graphics();
    this.fighterGfx = this.add.graphics();
    this.drawStage();

    this.hud = this.fighters.map((f, i) =>
      this.add
        .text(0, 0, '', {
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: '44px',
          color: '#ffffff',
        })
        .setOrigin(0.5)
    );
    this.hudSub = this.fighters.map((f, i) =>
      this.add
        .text(0, 0, '', {
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: '20px',
          color: '#8b93a7',
        })
        .setOrigin(0.5)
    );

    this.hint = this.add
      .text(0, 36, '', {
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: '18px',
        color: '#6d748a',
        align: 'center',
        lineSpacing: 6,
      })
      .setOrigin(0.5);

    // Hitbox debug view, useful when tuning move ranges.
    this.input.keyboard.on('keydown-H', () => (this.showHitboxes = !this.showHitboxes));
  }

  /** World units -> screen pixels. The single place y gets flipped. */
  toScreenX(x) {
    return this.originX + (x - this.cam.x) * this.scale_;
  }
  toScreenY(y) {
    return this.originY - (y - this.cam.y) * this.scale_;
  }

  /** Screen centre and world-to-pixel scale for the current camera and size. */
  syncView() {
    this.originX = this.scale.width / 2;
    this.originY = this.scale.height / 2;
    this.scale_ = this.scale.height / (2 * this.cam.halfH);
  }

  /** Frame every living fighter; the zoom rules live in camera.js. */
  updateCamera() {
    const alive = this.fighters.filter((f) => f.state !== STATE.DEAD);
    const points = alive.map((f) => ({ x: f.x, y: f.y + f.char.body.h / 2 }));
    this.cam = frameCamera(this.cam, points, this.scale.height / this.scale.width);
    this.syncView();
  }

  drawStage() {
    const g = this.stageGfx;
    g.clear();

    // Blast lines, so you can see how much room is left.
    g.lineStyle(2, 0x2a2f3d, 1);
    for (const x of [STAGE.blast.left, STAGE.blast.right]) {
      g.lineBetween(this.toScreenX(x), 0, this.toScreenX(x), this.scale.height);
    }

    for (const p of STAGE.platforms) {
      const x = this.toScreenX(p.x1);
      const w = (p.x2 - p.x1) * this.scale_;
      const y = this.toScreenY(p.y);
      if (p.solid) {
        g.fillStyle(0x2e3445, 1).fillRect(x, y, w, 26 * this.scale_);
        g.fillStyle(0x4a5570, 1).fillRect(x, y, w, 3);
      } else {
        g.fillStyle(0x394054, 0.85).fillRect(x, y, w, 5);
        g.fillStyle(0x4a5570, 1).fillRect(x, y, w, 2);
      }
    }
  }

  update(time, delta) {
    this.accumulator += Math.min(delta, STEP_MS * MAX_CATCHUP_STEPS);
    let steps = 0;
    while (this.accumulator >= STEP_MS && steps < MAX_CATCHUP_STEPS) {
      this.tick();
      this.accumulator -= STEP_MS;
      steps++;
    }
    this.render();
  }

  tick() {
    // Hitlag freezes the simulation but still drains input edges, so a buffered
    // press during freeze isn't swallowed.
    const states = this.inputs.map((i) => i.poll());
    if (this.p2IsCpu && touchedAnything(states[1])) this.p2IsCpu = false;
    if (this.p2IsCpu) states[1] = this.cpu.think(this.fighters[1], this.fighters[0]);
    if (this.hitlag > 0) {
      this.hitlag--;
      return;
    }

    this.fighters.forEach((f, i) => f.step(states[i]));

    for (const { hit } of resolveCombat(this.fighters)) {
      this.hitlag = Math.max(this.hitlag, hitlagFrames(hit.damage));
    }

    for (const f of this.fighters) {
      if (f.checkKO() && f.stocks <= 0) {
        const winner = this.fighters.find((o) => o !== f);
        this.scene.start('results', { winner, loser: f });
        return;
      }
    }
  }

  render() {
    this.updateCamera();
    this.drawStage(); // the view moves every frame, so geometry is redrawn with it

    const g = this.fighterGfx;
    g.clear();

    this.frame++;

    for (const f of this.fighters) {
      if (f.state === STATE.DEAD) continue;

      const feetX = this.toScreenX(f.x);
      const feetY = this.toScreenY(f.y);
      const h = f.char.body.h * this.scale_;

      // Blink while respawn-invulnerable by skipping frames, since the character
      // is many shapes and alpha-fading each one separately would be wrong.
      const blinking = f.invulnFrames > 0 && Math.floor(f.invulnFrames / 4) % 2 === 0;
      // Dodges flicker faster, so intangibility reads differently from respawn.
      const flicker = f.intangible && this.frame % 4 < 2;
      if (!blinking && !flicker) {
        drawRook(g, feetX, feetY, h, f.facing, f.palette, poseOf(f, this.frame));
      }

      if (f.state === STATE.SHIELD) {
        // Bubble in his spark colour, shrinking as the shield wears down.
        const r = h * 0.62 * shieldScale(f.shieldHP);
        const cy = feetY - h * 0.5;
        g.fillStyle(f.palette.spark, f.shieldstun > 0 ? 0.55 : 0.32).fillCircle(feetX, cy, r);
        g.lineStyle(2, f.palette.spark, 0.9).strokeCircle(feetX, cy, r);
      }

      if (f.state === STATE.HITSTUN) {
        const b = f.body;
        g.lineStyle(2, 0xffd166, 0.9).strokeRect(
          this.toScreenX(b.x1) - 2,
          this.toScreenY(b.y2) - 2,
          (b.x2 - b.x1) * this.scale_ + 4,
          (b.y2 - b.y1) * this.scale_ + 4
        );
      }

      if (this.showHitboxes) {
        // Hurtbox too: the drawn character no longer matches the collision box,
        // so showing only the hitbox would be misleading.
        const b = f.body;
        g.lineStyle(1, 0x5ad1ff, 0.8).strokeRect(
          this.toScreenX(b.x1),
          this.toScreenY(b.y2),
          (b.x2 - b.x1) * this.scale_,
          (b.y2 - b.y1) * this.scale_
        );
        const hb = f.activeHitbox;
        if (hb) {
          g.fillStyle(0xff3366, 0.4).fillRect(
            this.toScreenX(hb.x1),
            this.toScreenY(hb.y2),
            (hb.x2 - hb.x1) * this.scale_,
            (hb.y2 - hb.y1) * this.scale_
          );
        }
      }
    }

    const w = this.scale.width;
    const h = this.scale.height;
    // On a phone the thumbs cover the bottom corners, so the damage display
    // moves to the top; on a laptop or TV it sits at the bottom, like Smash.
    const onPhone = window.matchMedia('(pointer: coarse)').matches;
    const [pctY, subY] = onPhone ? [46, 88] : [h - 86, h - 44];
    this.hint.setX(w / 2);
    this.fighters.forEach((f, i) => {
      const hx = w / 2 + (i === 0 ? -1 : 1) * Math.min(260, w * 0.22);
      this.hud[i].setPosition(hx, pctY);
      this.hudSub[i].setPosition(hx, subY);
      const dim = f.percent > 120 ? '#ff6b6b' : f.percent > 60 ? '#ffd166' : '#ffffff';
      this.hud[i].setText(`${Math.round(f.percent)}%`).setColor(dim);
      // Both players are Rook, so the costume is what tells them apart.
      const who = i === 1 && this.p2IsCpu ? ' (CPU)' : '';
      this.hudSub[i].setText(`${COSTUMES[f.costume].name}${who}  ${'●'.repeat(Math.max(0, f.stocks))}`);
    });

    // Two lines: how P1 plays, and who P2 is.
    const p1 = anyGamepadConnected()
      ? 'Controller: A jump · X attack · Y strong · B special · bumper shield'
      : onPhone
        ? '' // the touch buttons are labelled
        : `P1 ${BINDINGS[0].label}`;
    const p2 = this.p2IsCpu
      ? 'P2 is the CPU: press Arrows or a 2nd controller to take over'
      : `P2 ${BINDINGS[1].label}`;
    // On a phone with no controller, keyboard hints are noise: show nothing.
    this.hint.setText(onPhone && !anyGamepadConnected() ? '' : p1 ? `${p1}\n${p2}` : p2);
  }
}
