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

// Height is fixed at 720 (every size in the game is designed around it); the
// width follows the screen's shape, so a wide phone fills edge to edge instead
// of shrinking a 16:9 game with black bars at the sides.
const HEIGHT = 720;
function widthForScreen() {
  // Clamped: portrait phones get the rotate message anyway, and extreme
  // ultrawides would show past the blast lines.
  const aspect = Math.min(2.4, Math.max(4 / 3, window.innerWidth / window.innerHeight));
  return Math.round(HEIGHT * aspect);
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: widthForScreen(),
  height: HEIGHT,
  parent: 'game',
  backgroundColor: '#0f1117',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [MatchScene, ResultsScene],
});

// Rotating a phone or resizing a window reshapes the game to match.
window.addEventListener('resize', () => game.scale.resize(widthForScreen(), HEIGHT));

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
