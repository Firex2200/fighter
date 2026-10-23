import { PlayerInput, BINDINGS } from '../input.js';
import { COSTUMES } from '../rook.js';

export class ResultsScene extends Phaser.Scene {
  constructor() {
    super('results');
  }

  init(data) {
    this.winner = data.winner;
    this.loser = data.loser;
  }

  create() {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    this.add
      // Both players are Rook, so the costume is what identifies the winner.
      .text(cx, cy - 70, `${COSTUMES[this.winner.costume].name} wins`, {
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: '64px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    this.add
      .text(cx, cy + 10, `${this.winner.stocks} stock${this.winner.stocks === 1 ? '' : 's'} remaining`, {
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: '24px',
        color: '#8b93a7',
      })
      .setOrigin(0.5);

    this.add
      .text(cx, cy + 90, 'press jump or attack to rematch', {
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: '20px',
        color: '#6d748a',
      })
      .setOrigin(0.5);

    this.inputs = BINDINGS.map((b) => new PlayerInput(b));
    // Ignore the input that was still held when the match ended.
    this.armDelay = 20;
  }

  update() {
    if (this.armDelay > 0) {
      this.armDelay--;
      this.inputs.forEach((i) => i.poll());
      return;
    }
    const pressed = this.inputs
      .map((i) => i.poll())
      .some((s) => s.jumpPressed || s.attackPressed || s.strongPressed);
    if (pressed) this.scene.start('match');
  }
}
