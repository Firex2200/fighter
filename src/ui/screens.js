// Title, costume select, countdown, "GAME!" and results. HTML over the 3D
// view; the App drives which one is showing and passes taps back.

import { COSTUMES } from '../rook.js';

const KEYS = Object.keys(COSTUMES);
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export class Screens {
  /**
   * @param parent   element to build into
   * @param handlers { start, pickCostume(player, key), toggleCpu, fight, rematch, changeCostumes, toggleMute }
   */
  constructor(parent, handlers) {
    this.h = handlers;
    this.el = document.createElement('div');
    this.el.id = 'screens';
    parent.appendChild(this.el);

    this.el.innerHTML = `
      <section class="screen title">
        <div class="head">
          <div class="logo"><span>FIGHTER</span></div>
          <div class="sub">Rook Ashvane <i>·</i> The Wandering Storm</div>
        </div>
        <div class="press">Tap or press any button</div>
        <button class="mute" aria-label="Sound on or off"></button>
      </section>

      <section class="screen select">
        <h1>CHOOSE YOUR COSTUME</h1>
        <div class="players">
          ${[0, 1]
            .map(
              (p) => `
            <div class="player p${p + 1}" data-player="${p}">
              <div class="tag">P${p + 1}${p === 1 ? '<button class="cpu-toggle"></button>' : ''}</div>
              <div class="swatches">${KEYS.map(
                (k) => `<button class="swatch" data-key="${k}" aria-label="${COSTUMES[k].name}"
                  style="--k:${hex(COSTUMES[k].kimono)};--o:${hex(COSTUMES[k].obi)};--h:${hex(COSTUMES[k].hakama)};--s:${hex(COSTUMES[k].spark)}"><span></span></button>`
              ).join('')}</div>
              <div class="costume-name"></div>
            </div>`
            )
            .join('')}
        </div>
        <button class="fight">FIGHT!</button>
        <div class="help">Left / right to pick · Attack to fight</div>
        <button class="mute" aria-label="Sound on or off"></button>
      </section>

      <div class="banner countdown"></div>
      <div class="banner game">GAME!</div>

      <section class="screen results">
        <div class="winner"><span class="label">WINNER</span><span class="who"></span></div>
        <table class="stats"></table>
        <div class="actions">
          <button class="rematch">Rematch</button>
          <button class="change">Change costumes</button>
        </div>
      </section>`;

    const $ = (s) => this.el.querySelector(s);
    this.title = $('.title');
    this.select = $('.select');
    this.countdown = $('.countdown');
    this.gameBanner = $('.game');
    this.results = $('.results');

    this.title.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.mute')) this.h.start();
    });
    for (const btn of this.el.querySelectorAll('.mute')) {
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.h.toggleMute();
      });
    }
    for (const sw of this.el.querySelectorAll('.swatch')) {
      sw.addEventListener('pointerdown', () => {
        const p = Number(sw.closest('.player').dataset.player);
        this.h.pickCostume(p, sw.dataset.key);
      });
    }
    $('.cpu-toggle').addEventListener('pointerdown', () => this.h.toggleCpu());
    $('.fight').addEventListener('pointerdown', () => this.h.fight());
    $('.rematch').addEventListener('pointerdown', () => this.h.rematch());
    $('.change').addEventListener('pointerdown', () => this.h.changeCostumes());
  }

  show(mode) {
    this.title.classList.toggle('on', mode === 'title');
    this.select.classList.toggle('on', mode === 'select');
    this.results.classList.toggle('on', mode === 'results');
    if (mode !== 'match') this.countdown.classList.remove('on');
    this.gameBanner.classList.toggle('on', mode === 'gameover');
  }

  setMuted(muted) {
    for (const b of this.el.querySelectorAll('.mute')) b.textContent = muted ? '🔇 Sound off' : '🔊 Sound on';
  }

  /** Reflect the current picks on the select screen. */
  renderSelect(costumes, p2IsCpu) {
    this.el.querySelectorAll('.player').forEach((row, p) => {
      for (const sw of row.querySelectorAll('.swatch')) sw.classList.toggle('chosen', sw.dataset.key === costumes[p]);
      row.querySelector('.costume-name').textContent = COSTUMES[costumes[p]].name;
      row.style.setProperty('--accent', hex(COSTUMES[costumes[p]].obi));
    });
    this.el.querySelector('.cpu-toggle').textContent = p2IsCpu ? 'CPU ⇄' : 'Player ⇄';
  }

  /** "3", "2", "1", "GO!" — or '' to hide. */
  setCountdown(text) {
    if (this.countdownText === text) return;
    this.countdownText = text;
    this.countdown.textContent = text;
    this.countdown.classList.toggle('on', !!text);
    this.countdown.classList.toggle('go', text === 'GO!');
    // Restart the pop-in animation for each new number.
    this.countdown.classList.remove('pop');
    void this.countdown.offsetWidth;
    if (text) this.countdown.classList.add('pop');
  }

  /** Fill in the results card. */
  renderResults(match) {
    const w = match.winner;
    const who = this.el.querySelector('.results .who');
    who.textContent = `P${w.slot + 1} · ${COSTUMES[w.costume].name}`;
    this.results.style.setProperty('--accent', hex(w.palette.obi));
    const rows = [
      ['KOs', (s) => s.kos],
      ['Falls', (s) => s.falls],
      ['Damage dealt', (s) => `${Math.round(s.damageDealt)}%`],
      ['Hardest hit', (s) => Math.round(s.hardestHit)],
    ];
    this.el.querySelector('.stats').innerHTML =
      `<tr><th></th>${match.fighters.map((f) => `<th style="color:${hex(f.palette.obi)}">P${f.slot + 1}</th>`).join('')}</tr>` +
      rows.map(([label, fn]) => `<tr><td>${label}</td>${match.stats.map((s) => `<td>${fn(s)}</td>`).join('')}</tr>`).join('');
  }
}

export { KEYS as COSTUME_KEYS };
