/* BGS Operations — start-up, navigation and sign-in. */
import { h, icon, toast } from './ui.js';
import { call } from './api.js';
import { model, onChange, loadFromPhone, signedIn, syncNow, startBackgroundSync, pendingCount, attentionCount } from './sync.js';
import * as S from './screens.js';
import { CONFIG } from './config.js';

const B = window.BGS;
const root = document.getElementById('app');
let current = null;          // the screen on display
let needsLogin = false;

/* ---------------- routes ----------------
 * #/active            Active Projects (everyone)
 * #/projects          Projects, all stages (Management)
 * #/actions           Actions dashboard
 * #/cs                Customer Satisfaction form (CS roles)
 * #/p/<P#>            project        #/i/<Item #>   item
 * #/a/<Action #>      action         #/r/<table>/<key>  any other record
 * #/actions/at/<location>?who=<name>   open actions of one person at one location
 * #/t/<table>         list of a reference table
 * #/new/<table>?...   add            #/edit/<table>/<key>  edit
 * #/sync  #/more                                                    */
function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { parts, params: new URLSearchParams(query || '') };
}

function screenFor({ parts, params }) {
  const [a, b, c] = parts;
  const perms = model.perms || {};
  switch (a) {
    case undefined: case '': case 'active': return S.projectsScreen('active');
    case 'projects': return perms.seeAllProjectsMenu ? S.projectsScreen('all') : S.projectsScreen('active');
    case 'actions': return b === 'at' ? S.actionsAtScreen(c, params.get('who')) : S.actionsScreen();
    case 'cs': return S.satisfactionScreen();
    case 'p': return S.projectScreen(b);
    case 'i': return S.itemScreen(b);
    case 'a': return S.actionScreen(b);
    case 'r': return S.recordScreen(b, c);
    case 't': return S.tableScreen(b);
    case 'new': return S.formScreen(b, null, params);
    case 'edit': return S.formScreen(b, c, params);
    case 'sync': return S.syncScreen();
    case 'more': return S.moreScreen();
    default: return S.projectsScreen('active');
  }
}

/* ---------------- shell ---------------- */
const view = h('main', { id: 'view', tabindex: '-1' });
const title = h('h1', null, 'BGS Operations');
const backBtn = h('a', { class: 'icon-btn', href: '#/', 'aria-label': 'Back', html: icon.back, hidden: true });
const pill = h('button', { class: 'sync-pill', onclick: () => { location.hash = '#/sync'; } }, h('span', { class: 'dot' }), h('span', { class: 'txt' }, ''));
const moreBtn = h('a', { class: 'icon-btn', href: '#/more', 'aria-label': 'Account and lists', html: icon.user });
const topbar = h('header', { class: 'topbar' }, backBtn, title, pill, moreBtn);
const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Main' });
const banners = h('div');
let fab = null;

function drawTabs() {
  const perms = model.perms || {};
  const tabs = [
    perms.seeAllProjectsMenu ? ['#/projects', 'Projects', icon.archive, 'projects'] : null,
    ['#/active', 'Active', icon.pipeline, 'active'],
    ['#/actions', 'Actions', icon.tasks, 'actions'],
    perms.seeSatisfactionMenu ? ['#/cs', 'Satisfaction', icon.smile, 'cs'] : null
  ].filter(Boolean);
  const here = parseRoute().parts[0] || 'active';
  tabbar.innerHTML = '';
  tabs.forEach(([href, label, ic, id]) => tabbar.append(h('a', { href, 'aria-current': here === id ? 'page' : null }, h('span', { html: ic, style: 'display:inline-flex' }), label)));
}

function drawPill() {
  const p = pendingCount(), a = attentionCount();
  const st = model.status;
  let text = { syncing: 'Syncing', synced: 'Synced', offline: 'Offline', failed: 'Sync failed', idle: 'Not synced' }[st] || '';
  if (st !== 'syncing' && p) text = p + ' pending';
  if (st === 'offline') text = p ? 'Offline, ' + p + ' pending' : 'Offline';
  if (a) text = a + ' to fix';
  pill.dataset.state = a ? 'failed' : (st === 'synced' && p ? 'idle' : st);
  pill.querySelector('.txt').textContent = text;
  pill.setAttribute('aria-label', 'Sync status: ' + text + '. Open sync screen.');
}

function drawBanners() {
  banners.innerHTML = '';
  if (model.status === 'offline') banners.append(h('div', { class: 'banner warn', role: 'status' }, 'You are offline. You can keep working; changes are saved on this phone and sent when the connection returns.'));
  else if (model.status === 'failed' && model.statusMessage && parseRoute().parts[0] !== 'sync') banners.append(h('div', { class: 'banner error', role: 'alert' }, h('span', null, model.statusMessage), h('button', { class: 'btn small', onclick: () => syncNow() }, 'Retry')));
}

function render() {
  if (!model.token || needsLogin) { renderLogin(); return; }
  if (!root.contains(view)) {
    root.innerHTML = '';
    root.append(topbar, banners, view, tabbar, h('div', { class: 'toast-root', 'aria-live': 'polite' }));
  }
  current = screenFor(parseRoute());
  title.textContent = current.title || 'BGS Operations';
  document.title = (current.title ? current.title + ' — ' : '') + 'BGS Operations';
  const back = current.back;
  backBtn.hidden = !back; if (back) backBtn.href = back;
  view.innerHTML = '';
  view.append(current.node);
  if (fab) { fab.remove(); fab = null; }
  if (current.fab) { fab = h('a', { class: 'fab', href: current.fab.href }, h('span', { html: icon.plus, style: 'display:inline-flex' }), current.fab.label); root.append(fab); }
  drawTabs(); drawPill(); drawBanners();
}

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

onChange((kind, detail) => {
  if (kind === 'auth') { needsLogin = true; render(); return; }
  if (kind === 'update-required') { showUpdate(true); return; }
  if (kind === 'keymap') {
    // a record made offline got its real number: if it is on screen, follow it
    const hash = location.hash;
    if (hash.includes(encodeURIComponent(detail.tmp))) location.replace(hash.replace(encodeURIComponent(detail.tmp), encodeURIComponent(detail.real)));
    return;
  }
  if (kind === 'status') { if (root.contains(view)) { drawPill(); drawBanners(); } return; }
  if (kind === 'change' && root.contains(view)) {
    drawPill(); drawTabs();
    if (current && current.live && current.redraw) {
      const y = window.scrollY;
      const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest('.search');
      if (!focused) { current = screenFor(parseRoute()); view.innerHTML = ''; view.append(current.node); window.scrollTo(0, y); }
    }
  }
});

/* ---------------- sign-in ---------------- */
function renderLogin() {
  if (fab) { fab.remove(); fab = null; }
  let email = (model.user && model.user.email) || '';
  const err = h('div', { class: 'error-text', role: 'alert' });
  const card = h('div', { class: 'card' });
  const page = h('div', { class: 'login' }, h('div', { class: 'watermark', 'aria-hidden': 'true' }, 'B'), card);
  root.innerHTML = '';
  root.append(page, h('div', { class: 'toast-root', 'aria-live': 'polite' }));

  function stepEmail() {
    card.innerHTML = '';
    const input = h('input', { class: 'input', type: 'email', autocomplete: 'email', inputmode: 'email', id: 'login-email', value: email, placeholder: 'name@bgs.llc' });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Send sign-in code');
    card.append(
      h('h1', null, 'BGS Operations'),
      h('p', null, needsLogin ? 'Please sign in again. Your unsent changes are still on this phone.' : 'Enter your work email. We will email you a 6-digit code.'),
      h('form', { class: 'form', style: 'padding:0', onsubmit: async (e) => {
        e.preventDefault();
        email = input.value.trim();
        if (!email) { err.textContent = 'Enter your email address.'; return; }
        btn.disabled = true; btn.textContent = 'Sending…'; err.textContent = '';
        try { await call('requestCode', { email }); stepCode(); }
        catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = 'Send sign-in code'; }
      } }, h('label', { class: 'lbl', for: 'login-email' }, 'Email'), input, btn, err));
    setTimeout(() => input.focus(), 50);
  }

  function stepCode() {
    card.innerHTML = '';
    const input = h('input', { class: 'input code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', id: 'login-code', placeholder: '000000' });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Sign in');
    card.append(
      h('h1', null, 'Check your email'),
      h('p', null, 'We sent a 6-digit code to ' + email + '. It works for 10 minutes. Check spam if it is not there within a minute.'),
      h('form', { class: 'form', style: 'padding:0', onsubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true; btn.textContent = 'Signing in…'; err.textContent = '';
        try {
          const r = await call('verifyCode', { email, code: input.value.trim(), device: navigator.userAgent });
          await signedIn(r.token, r.user);
          needsLogin = false;
          if (!location.hash || location.hash === '#/') location.hash = '#/active';
          render();
          syncNow();
        } catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = 'Sign in'; }
      } }, h('label', { class: 'lbl', for: 'login-code' }, 'Sign-in code'), input, btn, err,
      h('button', { class: 'btn link', type: 'button', style: 'margin-top:12px', onclick: stepEmail }, 'Use a different email or send a new code')));
    setTimeout(() => input.focus(), 50);
  }
  stepEmail();
}

/* ---------------- updates (service worker) ---------------- */
let swReg = null;
function showUpdate(required) {
  toast(required ? 'A new version is required.' : 'A new version of the app is ready.', { actionText: 'Reload', ms: 600000, onAction: () => {
    if (swReg && swReg.waiting) {
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
      swReg.waiting.postMessage('skipWaiting');
    } else location.reload();
  } });
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then(reg => {
    swReg = reg;
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(false); });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(e => console.warn('Offline support unavailable:', e));
}

/* ---------------- start ---------------- */
(async function start() {
  try {
    await loadFromPhone();
  } catch (e) {
    root.innerHTML = '';
    root.append(h('div', { class: 'empty' }, h('strong', null, 'This browser blocked storage'), 'BGS Operations needs to save data on this phone. Turn off private browsing, or allow site data, then reload.'));
    return;
  }
  render();
  startBackgroundSync();
  if (model.token) syncNow();
  window.BGS_DEBUG = { model, syncNow, version: CONFIG.APP_VERSION, rules: B };
})();
