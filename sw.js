/* BGS Operations — offline support (service worker).
 * Keeps a copy of the app's own files on the phone so the app opens with no
 * connection. Data is NOT stored here (that is in IndexedDB, see store.js),
 * and requests to the API always go to the network.
 *
 * Phones pick up new files automatically when online. When you publish an
 * update, also change VERSION below (and APP_VERSION in config.js) so the
 * saved offline copy is refreshed and phones show "Reload".               */
const VERSION = '1.3.0';
const CACHE = 'bgs-ops-' + VERSION;
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'app.css',
  'shared.js', 'config.js', 'api.js', 'store.js', 'sync.js', 'ui.js', 'fields.js', 'files.js', 'screens.js', 'app.js',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon-32.png', 'badge-96.png', 'push.js'
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

/* ---------------- phone notifications (1.3.0) ----------------
 * The server sends an empty alert; here the app wakes up, downloads the new
 * Group Chat messages with this phone's own sign-in, and shows them like
 * WhatsApp: the sender and the message, or "N new messages" for several.
 * If the app is open on screen, no pop-up: the open app refreshes instead. */
const NOTIF_TAG = 'bgs-group';

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('bgs-operations');
    r.onupgradeneeded = () => { r.transaction.abort(); reject(new Error('no data yet')); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function kvGet(keys) {
  const db = await idb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction('kv', 'readonly'), s = t.objectStore('kv'), out = {};
      keys.forEach(k => { const q = s.get(k); q.onsuccess = () => { out[k] = q.result; }; });
      t.oncomplete = () => resolve(out); t.onerror = () => reject(t.error);
    });
  } finally { db.close(); }
}
async function kvSet(key, value) {
  const db = await idb();
  try {
    await new Promise((resolve, reject) => {
      const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(value, key);
      t.oncomplete = resolve; t.onerror = () => reject(t.error);
    });
  } finally { db.close(); }
}

async function fetchChat(apiUrl, token, since) {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, credentials: 'omit', cache: 'no-store',
        body: JSON.stringify({ action: 'chat', token, since, appVersion: VERSION }) });
      const data = JSON.parse(await res.text());
      if (data && data.ok && Array.isArray(data.chat)) return data.chat;
      if (data && data.ok === false) return null;   // signed out or expired: no details
    } catch (e) { /* Google sometimes answers oddly: try once more */ }
  }
  return null;
}

function preview(m) {
  const t = String(m.Text || '').replace(/\s+/g, ' ').trim();
  let att = '';
  if (m.Attachment) att = /^image\//.test(m.Attachment_Type) ? '📷 Photo' : '📄 ' + (m.Attachment_Name || 'Document');
  else if (m.Location) att = '📍 Location';
  const body = att && t ? (att.startsWith('📷') ? '📷 ' + t : att + ' · ' + t) : (att || t);
  return body.length > 160 ? body.slice(0, 157) + '…' : body;
}

async function onPush() {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const onScreen = wins.find(c => c.visibilityState === 'visible');
  if (onScreen) { wins.forEach(c => c.postMessage({ type: 'chat-push' })); return; }

  let kv = {};
  try { kv = await kvGet(['token', 'apiUrl', 'user', 'chatSeen', 'chat']); } catch (e) { /* show the plain alert */ }
  const me = kv.user && kv.user.name;
  const seen = kv.chatSeen || '';
  const since = seen || new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 19);
  const got = kv.token && kv.apiUrl ? await fetchChat(kv.apiUrl, kv.token, since) : null;

  let title = 'BGS Group', body = 'New message', count = 1, stamp = Date.now();
  if (got) {
    // keep them on the phone so the chat opens with them straight away
    try {
      const byId = new Map((Array.isArray(kv.chat) ? kv.chat : []).map(m => [m.Message_ID, m]));
      got.forEach(m => byId.set(m.Message_ID, Object.assign({}, byId.get(m.Message_ID) || {}, m)));
      await kvSet('chat', [...byId.values()].sort((a, b) => (a.Sent_At < b.Sent_At ? -1 : a.Sent_At > b.Sent_At ? 1 : 0)).slice(-300));
    } catch (e) { /* only a cache */ }
    const unread = got.filter(m => m.Sent_At > seen && m.Author_Type !== 'system' && !(m.Author_Type === 'human' && m.Author === me));
    if (!unread.length) {
      // already read on this phone (or only company updates): Chrome still needs a notification shown, so update quietly
      const old = await self.registration.getNotifications({ tag: NOTIF_TAG });
      if (old.length) return;
      title = 'BGS Group'; body = 'The group chat has new activity';
    } else {
      count = unread.length;
      const last = unread[unread.length - 1];
      stamp = Date.parse(last.Sent_At) || Date.now();
      const name = m => m.Author + (m.Author_Type === 'ai' ? ' (AI)' : '');
      if (count === 1) { title = name(last); body = preview(last); }
      else { title = 'BGS Group · ' + count + ' new messages'; body = unread.slice(-5).map(m => name(m) + ': ' + preview(m)).join('\n'); }
    }
  }
  if (self.navigator && self.navigator.setAppBadge) { try { await self.navigator.setAppBadge(count); } catch (e) { /* not supported */ } }
  await self.registration.showNotification(title, {
    body, tag: NOTIF_TAG, renotify: true, icon: 'icon-192.png', badge: 'badge-96.png', timestamp: stamp,
    vibrate: [120, 60, 120], data: { url: './#/group' }
  });
}

self.addEventListener('push', event => { event.waitUntil(onPush()); });

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL((event.notification.data && event.notification.data.url) || './#/group', self.registration.scope).href;
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find(c => c.url.startsWith(self.registration.scope));
    if (win) { win.postMessage({ type: 'open-group' }); return win.focus(); }
    return self.clients.openWindow(url);
  })());
});
