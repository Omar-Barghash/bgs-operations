/* BGS Operations — offline support (service worker).
 * Keeps a copy of the app's own files on the phone so the app opens with no
 * connection. Data is NOT stored here (that is in IndexedDB, see store.js),
 * and requests to the API always go to the network.
 *
 * Phones pick up new files automatically when online. When you publish an
 * update, also change VERSION below (and APP_VERSION in config.js) so the
 * saved offline copy is refreshed and phones show "Reload".               */
const VERSION = '1.0.2';
const CACHE = 'bgs-ops-' + VERSION;
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'app.css',
  'shared.js', 'config.js', 'api.js', 'store.js', 'sync.js', 'ui.js', 'fields.js', 'files.js', 'screens.js', 'app.js',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon-32.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('bgs-ops-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Network first (so updates show up straight away), with the saved copy
 * used when there is no connection or the network takes over 4 seconds. */
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.endsWith('/api')) return; // API calls: network only
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const fromNet = fetch(req).then(res => {
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    });
    const timeout = new Promise(resolve => setTimeout(resolve, 4000, null));
    try {
      const res = await Promise.race([fromNet, timeout]);
      if (res) return res;
    } catch (e) { /* offline */ }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fromNet; } catch (e) { return (await cache.match('index.html')) || Response.error(); }
  })());
});

/* A new version takes over when the user taps "Reload". */
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
