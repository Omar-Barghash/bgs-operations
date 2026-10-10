/* Phone notifications for the Group Chat (1.3.0).
 * Turning them on asks the phone for permission, gets this phone's
 * notification address from its push service (Google / Apple) and gives it
 * to our server. The pop-up itself is shown by sw.js.
 *
 * iPhone: notifications only work after "Add to Home Screen" (iOS 16.4+),
 * opened from the home-screen icon. */
import { call } from './api.js';
import { store } from './store.js';
import { CONFIG } from './config.js';

const TAG = 'bgs-group';

function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function standalone() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
function supported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }

function keyBytes(b64url) {
  const s = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
function sameKey(sub, b64url) {
  try {
    const have = new Uint8Array(sub.options.applicationServerKey), want = keyBytes(b64url);
    return have.length === want.length && have.every((v, i) => v === want[i]);
  } catch (e) { return true; }
}

/** 'on' | 'off' | 'blocked' | 'ios-install' | 'unsupported' */
export async function pushStatus() {
  if (!supported()) return isIOS() && !standalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub && (await store.get('pushEndpoint')) === sub.endpoint ? 'on' : 'off';
  } catch (e) { return 'off'; }
}

async function subscribe(token) {
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await call('pushKey', {}, token);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, publicKey)) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await call('pushSubscribe', { subscription: sub.toJSON(), device: navigator.userAgent }, token);
  await store.set('apiUrl', new URL(CONFIG.API_URL, location.href).href);   // the service worker needs it
  await store.set('pushEndpoint', sub.endpoint);
  await store.set('pushChecked', new Date().toISOString().slice(0, 10));
}

/** Turn on (must run from a tap: the phone asks for permission). */
export async function enablePush(token) {
  if (!supported()) throw new Error(isIOS() ? 'On iPhone, first add the app to the Home Screen, then open it from there.' : 'This browser cannot show notifications.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied'
    ? 'Notifications are blocked for this app. Allow them in the phone settings, then try again.'
    : 'Notifications were not allowed.');
  await subscribe(token);
}

/** Turn off on this phone (also used when signing out). Never throws. */
export async function disablePush() {
  try {
    const endpoint = await store.get('pushEndpoint');
    await store.del('pushEndpoint');
    if (!supported()) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    const ep = (sub && sub.endpoint) || endpoint;
    if (ep) { try { await call('pushUnsubscribe', { endpoint: ep }); } catch (e) { /* the server forgets it on the next failed alert */ } }
    if (sub) await sub.unsubscribe();
  } catch (e) { /* nothing to undo */ }
}

/** Once a day while the app is open: re-register (addresses can change, or the server may have dropped one). */
export async function refreshPush(token) {
  try {
    if (!token || !supported() || Notification.permission !== 'granted' || !(await store.get('pushEndpoint'))) return;
    if ((await store.get('pushChecked')) === new Date().toISOString().slice(0, 10)) return;
    await subscribe(token);
  } catch (e) { /* try again tomorrow */ }
}

/** The chat was read on screen: remove its pop-ups and the icon number. */
export async function clearChatNotifications() {
  try {
    if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
    const reg = 'serviceWorker' in navigator && await navigator.serviceWorker.getRegistration();
    if (reg && reg.getNotifications) (await reg.getNotifications({ tag: TAG })).forEach(n => n.close());
  } catch (e) { /* nothing to clear */ }
}
