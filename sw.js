// Offline support for the home-screen app. Network first, so a published update
// shows up the next time you open the game online; the cached copy is only used
// when there is no connection. Every file the game loads gets cached as it loads.

const CACHE = 'fighter-v2';

self.addEventListener('install', () => self.skipWaiting());
// Drop caches from older versions (e.g. the 2D build's Phaser files).
self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
