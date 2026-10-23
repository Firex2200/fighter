import { MatchScene } from './scenes/match.js';
import { ResultsScene } from './scenes/results.js';
import { initTouch } from './touch.js';

initTouch();
showPhoneQr();

// Offline play for the home-screen app. Browsers only allow this on https (or
// localhost), so it quietly does nothing when played over home wifi.
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// 1280x720 is the Xbox's native dashboard resolution and scales cleanly to every
// phone. FIT keeps the whole playfield visible rather than cropping it on a TV.
const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  parent: 'game',
  backgroundColor: '#0f1117',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [MatchScene, ResultsScene],
});

// Exposed for debugging from the browser console.
window.game = game;

/**
 * On a laptop, a QR code that opens the game on a phone. When hosted online it
 * points at the site itself; locally the launcher passes the wifi address as
 * ?lan=..., since a page opened at localhost can't know which address to use.
 */
function showPhoneQr() {
  const lan = new URLSearchParams(location.search).get('lan');
  // Hosted on the internet: the phone can use this very address.
  const online = location.protocol === 'https:';
  if ((!lan && !online) || window.matchMedia('(pointer: coarse)').matches || !window.qrcode) return;
  const qr = window.qrcode(0, 'M');
  qr.addData(online ? location.origin + location.pathname : `http://${lan}:${location.port}/`);
  qr.make();
  const box = document.createElement('div');
  box.id = 'phone-qr';
  box.innerHTML = `${qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true })}<span>Scan to play on your phone</span>`;
  document.body.appendChild(box);
}
