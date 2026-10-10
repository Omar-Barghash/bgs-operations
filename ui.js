/* Small building blocks for the screens: an element builder, icons,
 * dialogs, toasts and formatting. No outside libraries. */

/** h('div', {class:'x', onclick: fn}, child, 'text', [more]) -> element.
 *  Text is always inserted as text, never as HTML. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v; // only used for our own icon SVGs
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const icon = {
  pipeline: P('<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>'),
  archive: P('<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>'),
  check: P('<path d="M4 12.5l5 5L20 6.5"/>'),
  tasks: P('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M3.5 18l1.5 1.5L7.5 17"/>'),
  smile: P('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/>'),
  back: P('<path d="M15 5l-7 7 7 7"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  search: P('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  more: P('<circle cx="12" cy="5.5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="18.5" r="1.2"/>'),
  user: P('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  edit: P('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  trash: P('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  file: P('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>'),
  camera: P('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  upload: P('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/>'),
  arrow: P('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  x: P('<path d="M6 6l12 12M18 6L6 18"/>'),
  chat: P('<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>'),
  clip: P('<path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>'),
  pin: P('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  send: P('<path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5L20 4"/>'),
  refresh: P('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>')
};
export const iconEl = (name, cls) => h('span', { class: cls || 'ic', html: icon[name], style: 'display:inline-flex' });

/* ---------- toasts ---------- */
export function toast(message, opts = {}) {
  const root = document.querySelector('.toast-root');
  if (!root) return;
  root.innerHTML = ''; // one message at a time
  const el = h('div', { class: 'toast' + (opts.error ? ' error' : ''), role: 'status' }, h('span', null, message));
  if (opts.actionText) el.appendChild(h('button', { onclick: () => { opts.onAction(); el.remove(); } }, opts.actionText));
  root.appendChild(el);
  setTimeout(() => el.remove(), opts.ms || (opts.error ? 7000 : 2500));
}

/* ---------- dialogs ---------- */
function openSheet(build) {
  return new Promise(resolve => {
    const prev = document.activeElement;
    const close = (val) => { scrim.remove(); document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
    const scrim = h('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim) close(null); } }, sheet);
    build(sheet, close);
    document.body.appendChild(scrim);
    document.addEventListener('keydown', onKey);
    const f = sheet.querySelector('input, textarea, select, button.primary, button');
    if (f) setTimeout(() => f.focus(), 30);
  });
}

export function confirmDialog({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false, extra = null }) {
  return openSheet((sheet, close) => {
    sheet.append(
      h('h3', null, title),
      message ? h('p', null, message) : null,
      extra,
      h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: () => close(false) }, cancelText),
        h('button', { class: 'btn primary' + (danger ? ' danger solid' : ''), onclick: () => close(true) }, confirmText))
    );
  }).then(v => !!v);
}

export function promptDialog({ title, message, label, confirmText = 'Save', required = true, multiline = true, danger = false }) {
  return openSheet((sheet, close) => {
    const input = multiline ? h('textarea', { class: 'input', rows: 4 }) : h('input', { class: 'input' });
    const err = h('div', { class: 'error-text', hidden: true });
    const submit = () => {
      const v = input.value.trim();
      if (required && !v) { err.textContent = label + ' is required.'; err.hidden = false; input.classList.add('invalid'); input.focus(); return; }
      close(v);
    };
    sheet.append(
      h('h3', null, title),
      message ? h('p', null, message) : null,
      h('div', { class: 'form', style: 'padding:0' }, h('label', { class: 'lbl' }, label, required ? h('span', { class: 'req' }, ' *') : null), input, err),
      h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: () => close(null) }, 'Cancel'),
        h('button', { class: 'btn primary' + (danger ? ' danger solid' : ''), onclick: submit }, confirmText))
    );
  });
}

/** A small form in a dialog. fields: [{name, label, required, hint}].
 * Resolves to {name: value} or null when cancelled. */
export function formDialog({ title, message, fields, confirmText = 'Save' }) {
  return openSheet((sheet, close) => {
    const inputs = {}, errs = {};
    const rows = fields.map(f => {
      inputs[f.name] = h('input', { class: 'input', autocomplete: 'off', 'aria-label': f.label });
      errs[f.name] = h('div', { class: 'error-text', hidden: true });
      return h('div', { class: 'field' }, h('label', { class: 'lbl' }, f.label, f.required ? h('span', { class: 'req' }, ' *') : null),
        inputs[f.name], f.hint ? h('div', { class: 'hint' }, f.hint) : null, errs[f.name]);
    });
    const submit = () => {
      const out = {}; let bad = null;
      fields.forEach(f => {
        const v = inputs[f.name].value.trim(); out[f.name] = v;
        const missing = f.required && !v;
        errs[f.name].hidden = !missing; errs[f.name].textContent = missing ? f.label + ' is required.' : '';
        inputs[f.name].classList.toggle('invalid', missing);
        if (missing && !bad) bad = inputs[f.name];
      });
      if (bad) { bad.focus(); return; }
      close(out);
    };
    sheet.append(...[
      h('h3', null, title),
      message ? h('p', null, message) : null,
      h('form', { class: 'form', style: 'padding:0', novalidate: true, onsubmit: e => { e.preventDefault(); submit(); } }, rows, h('button', { type: 'submit', hidden: true })),
      h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: () => close(null) }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: submit }, confirmText))
    ].filter(Boolean));
  });
}

export function menuSheet(title, items) {
  return openSheet((sheet, close) => {
    sheet.append(h('h3', null, title), h('ul', { class: 'menu-list' }, items.filter(Boolean).map(it =>
      h('li', null, it.href
        ? h('a', { href: it.href, onclick: () => close(true) }, it.label)
        : h('button', { onclick: () => { close(true); it.onClick(); } }, it.label)))));
  });
}

export function infoDialog(title, body) {
  return openSheet((sheet, close) => {
    sheet.append(h('h3', null, title), body, h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: () => close(true) }, 'OK')));
  });
}

/* ---------- formatting ---------- */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(v) {
  const s = String(v ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
  if (!m) return s; // legacy text such as "10/9" is shown exactly as stored
  const d = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return m[4] ? `${d}, ${m[4]}:${m[5]}` : d;
}
export function fmtMoney(v) {
  if (v === '' || v === null || v === undefined) return '';
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return 'EGP ' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function fmtNumber(v) {
  if (v === '' || v === null || v === undefined) return '';
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}
export function relTime(iso) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return fmtDate(new Date(iso).toISOString().slice(0, 10));
}
export function stageShort(stage) { return String(stage || '').replace(/^\d+-\s*/, ''); }
