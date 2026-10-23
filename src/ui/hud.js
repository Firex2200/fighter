// Smash-style damage cards: a portrait, name, a big outlined damage %, and
// stock icons. Plain HTML over the 3D view, so text stays crisp at any size.

import { COSTUMES } from '../rook.js';

/** Damage colour: white, then yellow, orange and red as it climbs. */
export function damageColor(pct) {
  const stops = [
    [0, [255, 255, 255]],
    [50, [255, 222, 90]],
    [100, [255, 140, 46]],
    [150, [255, 58, 58]],
    [220, [190, 20, 40]],
  ];
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i];
    const [p0, c0] = stops[i - 1];
    if (pct <= p1) {
      const t = (pct - p0) / (p1 - p0);
      return `rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * t)).join(',')})`;
    }
  }
  return 'rgb(190,20,40)';
}

export class Hud {
  /**
   * @param parent     element to build the HUD in
   * @param portraits  costume key -> image URL
   */
  constructor(parent, portraits) {
    this.portraits = portraits;
    this.el = document.createElement('div');
    this.el.id = 'hud';
    parent.appendChild(this.el);
    this.cards = [];
    this.shown = [];
  }

  /** Build one card per fighter. */
  setup(fighters) {
    this.el.innerHTML = '';
    this.cards = fighters.map((f, i) => {
      const card = document.createElement('div');
      card.className = `card p${i + 1}`;
      card.style.setProperty('--accent', `#${f.palette.obi.toString(16).padStart(6, '0')}`);
      card.style.setProperty('--tint', `#${f.palette.kimono.toString(16).padStart(6, '0')}`);
      card.innerHTML = `
        <img class="portrait" alt="" src="${this.portraits[f.costume]}">
        <div class="meta">
          <div class="pct"><span class="num">0</span><span class="sign">%</span></div>
          <div class="name">ROOK <em></em></div>
          <div class="stocks"></div>
        </div>`;
      this.el.appendChild(card);
      return card;
    });
    this.shown = fighters.map(() => ({ pct: -1, stocks: -1, cpu: null }));
  }

  /** Update text only when something changed, to keep the page cheap to draw. */
  update(fighters, p2IsCpu) {
    fighters.forEach((f, i) => {
      const card = this.cards[i];
      const shown = this.shown[i];
      const pct = Math.round(f.percent);
      if (pct !== shown.pct) {
        const num = card.querySelector('.num');
        num.textContent = pct;
        card.querySelector('.pct').style.color = damageColor(pct);
        // Bump the number when it goes up, like taking a hit in Smash.
        if (pct > shown.pct && shown.pct >= 0) {
          card.classList.remove('bump');
          void card.offsetWidth; // restart the animation
          card.classList.add('bump');
        }
        shown.pct = pct;
      }
      if (f.stocks !== shown.stocks) {
        card.querySelector('.stocks').innerHTML = Array.from(
          { length: Math.max(0, f.stocks) },
          () => `<img alt="" src="${this.portraits[f.costume]}">`
        ).join('');
        card.classList.toggle('out', f.stocks <= 0);
        shown.stocks = f.stocks;
      }
      const cpu = i === 1 && p2IsCpu;
      if (cpu !== shown.cpu) {
        card.querySelector('.name em').textContent = `${COSTUMES[f.costume].name}${cpu ? ' · CPU' : ''}`;
        shown.cpu = cpu;
      }
    });
  }

  show(on) {
    this.el.style.display = on ? '' : 'none';
  }
}
