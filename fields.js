/* Forms and field display, driven by the table definitions and the shared
 * rules in shared.js: a field appears, is editable, or is required exactly
 * when the rules say so, for this user and this stage. */
import { h, iconEl, fmtDate, fmtMoney, fmtNumber, toast, formDialog } from './ui.js';
import { model, enqueue, newTempKey, isTemp } from './sync.js';
import { CONFIG } from './config.js';
import { openFile } from './files.js';

const B = window.BGS;

/* Column order of each form (SOURCE: AppSheet form views' ColumnOrder;
 * "null" in AppSheet means all columns in table order). */
const FORM_ORDER = {
  'Projects': ['Stage', 'BD Project Name', 'Project Name', 'Company', 'Customer', 'Contract#', 'Quotation_No', 'PO_No', 'Invoice#', 'Expected Cash In', 'Documentation_Verified', 'Satisfaction_Completed', 'Rejection Reason', 'Quotation', 'PO', 'Invoice'],
  'Action Tracker': ['Project #', 'BD Project Name', 'Criticality', 'Action', 'Owner', 'Due Date', 'Estimated Time', 'Location', 'Status', 'Created at']
};
export function formColumns(table) { return FORM_ORDER[table] || B.SCHEMA[table].columns.map(c => c.name); }

export function parentOf(table, rec) {
  if (table !== 'Items' || !rec) return null;
  return findRecord('Projects', rec.Project_ID);
}
export function findRecord(table, key) {
  const kc = B.SCHEMA[table].key;
  return model.view[table].find(r => String(r[kc]).trim().toLowerCase() === String(key).trim().toLowerCase()) || null;
}
export function ruleFor(table, col, rec, isNew) {
  return B.fieldRule(table, col, rec, model.user, { parent: parentOf(table, rec), isNew: !!isNew });
}

/* ---------- display of one value ---------- */
export function valueNode(table, col, rec) {
  const c = B.column(table, col);
  const v = rec[col];
  if (v === '' || v === null || v === undefined) return h('span', { class: 'muted' }, '—');
  if (typeof v === 'string' && v.startsWith('pending-upload:')) return h('span', { class: 'muted' }, 'Waiting to upload: ' + v.slice(15));
  switch (c && c.type) {
    case 'date': case 'datetime': return fmtDate(v);
    case 'price': return fmtMoney(v);
    case 'number': case 'decimal': return fmtNumber(v);
    case 'bool': return v === true ? 'Yes' : v === false ? 'No' : String(v);
    case 'email': return h('a', { href: 'mailto:' + v }, String(v));
    case 'ref': {
      const target = c.ref;
      if (target === 'Projects' && (Number(v) === 0 || v === '')) return h('span', { class: 'muted' }, '—');
      const r = findRecord(target, v);
      const label = target === 'Projects' && r ? r['BD Project Name'] || v : String(v);
      return r ? h('a', { href: refHref(target, v) }, String(label)) : String(label);
    }
    default: return String(v);
  }
}
export function refHref(table, key) {
  if (table === 'Projects') return '#/p/' + encodeURIComponent(key);
  if (table === 'Items') return '#/i/' + encodeURIComponent(key);
  if (table === 'Action Tracker') return '#/a/' + encodeURIComponent(key);
  return '#/r/' + encodeURIComponent(table) + '/' + encodeURIComponent(key);
}

/** A list of label/value rows for the visible columns. */
export function fieldList(table, rec, cols) {
  const rows = [];
  cols.forEach(col => {
    const c = B.column(table, col); if (!c) return;
    const rule = ruleFor(table, col, rec, false);
    if (!rule.visible) return;
    if (c.type === 'file' || c.type === 'image') { rows.push(fileRow(table, col, rec, rule)); return; }
    rows.push(h('div', { class: 'field-row' }, h('dt', null, B.labelOf(table, col)), h('dd', null, valueNode(table, col, rec))));
  });
  return h('dl', { class: 'fields' }, rows);
}

function fileRow(table, col, rec, rule) {
  const v = rec[col];
  const key = rec[B.SCHEMA[table].key];
  const dd = h('dd', null);
  if (B.isBlank(v)) dd.append(h('span', { class: 'muted' }, 'No file'));
  else if (String(v).startsWith('pending-upload:')) dd.append(h('span', { class: 'muted' }, 'Waiting to upload: ' + String(v).slice(15)));
  else dd.append(h('button', { class: 'btn small', onclick: () => openFile(table, key, col, v) }, iconEl('file'), 'Open'), h('span', { class: 'muted', style: 'font-size:13px' }, String(v).split('/').pop()));
  if (rule.editable && !isTemp(key)) {
    dd.append(filePickerButtons(B.column(table, col).type, async (f) => {
      await enqueue({ op: 'upload', table, key, column: col, fileName: f.name, mimeType: f.mimeType, data: f.data }, 'Upload ' + f.name);
      toast('Saved on this phone. It uploads when online.');
    }, B.isBlank(v) ? 'Upload' : 'Replace'));
  }
  return h('div', { class: 'field-row file' }, h('dt', null, B.labelOf(table, col)), dd);
}

/* ---------- picking files and photos ---------- */
export function filePickerButtons(type, onPicked, verb = 'Upload') {
  const wrap = h('span', { class: 'filepick' });
  const make = (label, ic, accept, capture) => {
    const input = h('input', { type: 'file', accept, hidden: true, capture: capture || null });
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      try { onPicked(await readPicked(file)); }
      catch (e) { toast(e.message, { error: true }); }
    });
    return [input, h('button', { type: 'button', class: 'btn small', onclick: () => input.click() }, iconEl(ic), label)];
  };
  if (type === 'image') {
    wrap.append(...make('Take photo', 'camera', 'image/*', 'environment'), ...make('Choose photo', 'upload', 'image/*'));
  } else {
    wrap.append(...make(verb + ' file', 'upload', 'application/pdf,image/*,.doc,.docx,.xls,.xlsx'));
  }
  return wrap;
}

async function readPicked(file) {
  const maxMb = 20;
  if (file.size > maxMb * 1024 * 1024 * 1.5) throw new Error('This file is larger than ' + maxMb + ' MB. Choose a smaller file.');
  let blob = file, name = file.name || 'file', mime = file.type || 'application/octet-stream';
  if (/^image\/(jpeg|png|webp|heic|heif)/.test(mime)) {
    try { blob = await shrinkImage(file); mime = 'image/jpeg'; name = name.replace(/\.\w+$/, '') + '.jpg'; } catch (e) { /* keep the original */ }
  }
  if (blob.size > maxMb * 1024 * 1024) throw new Error('This file is larger than ' + maxMb + ' MB. Choose a smaller file.');
  const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(new Error('The file could not be read.')); r.readAsDataURL(blob); });
  return { name, mimeType: mime, data };
}

async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, CONFIG.PHOTO_MAX_PX / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82));
}

/* ---------- the form ---------- */
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const NEW = '__add_new__';
/* Lists that can be added to from inside a form (Omar, 5 Oct 2026). */
const ADDABLE = { 'Customers': true, 'Lists': true, 'Item Type': true };

/**
 * renderForm({table, record, isNew, context, onDone})
 *  record  : the existing record, or starting values for a new one
 *  context : extra fields set by where the form was opened from
 *            (e.g. {Project_ID: 563} when adding an item to a project)
 */
export function renderForm({ table, record, isNew, context = {}, onDone, submitText }) {
  const def = B.SCHEMA[table];
  const start = Object.assign({}, record || {});
  if (isNew) Object.assign(start, previewDefaults(table, start, context));
  const values = Object.assign({}, start);
  const files = {};
  const inputs = {};
  const errors = {};
  const box = h('div', { class: 'form' });
  const formEl = h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } }, box);

  function draw() {
    box.innerHTML = '';
    formColumns(table).forEach(col => {
      const c = B.column(table, col); if (!c) return;
      const rule = ruleFor(table, col, values, isNew);
      if (!rule.visible) return;
      if (isNew && c.auto && B.isBlank(values[col]) && !['Stage', 'Owner', 'Status'].includes(col)) return;
      box.append(fieldEditor(c, rule));
    });
  }

  function fieldEditor(c, rule) {
    const col = c.name;
    const id = 'f-' + col.replace(/\W/g, '_');
    const v = values[col];
    const label = h('label', { class: 'lbl', for: id }, B.labelOf(table, col), rule.required ? h('span', { class: 'req' }, ' *') : null);
    const wrap = h('div', { class: 'field' }, label);
    const hint = (t) => wrap.append(h('div', { class: 'hint' }, t));
    const err = errors[col] ? h('div', { class: 'error-text' }, errors[col]) : null;
    const set = (val) => { values[col] = val; delete errors[col]; };
    let input;

    if (!rule.editable) {
      const shown = c.type === 'ref' ? refLabel(c.ref, v) : c.type === 'date' || c.type === 'datetime' ? fmtDate(v) : c.type === 'price' ? fmtMoney(v) : c.type === 'bool' ? (v === true ? 'Yes' : v === false ? 'No' : String(v ?? '')) : String(v ?? '');
      input = h('input', { id, class: 'input', readonly: true, value: shown || '—' });
      wrap.append(input);
      return wrap;
    }

    switch (c.type) {
      case 'longtext':
        input = h('textarea', { id, oninput: e => set(e.target.value) }); input.value = v ?? ''; break;
      case 'number': case 'price': case 'decimal':
        input = h('input', { id, class: 'input', inputmode: 'decimal', value: v ?? '', oninput: e => set(e.target.value.trim()) });
        if (c.type === 'price') hint('Egyptian pounds (EGP)');
        break;
      case 'date': case 'datetime': {
        const legacy = !B.isBlank(v) && !ISO.test(String(v).slice(0, 10));
        input = h('input', { id, class: 'input', type: 'date', value: legacy ? '' : String(v ?? '').slice(0, 10), onchange: e => set(e.target.value) });
        if (legacy) hint('Currently stored as "' + v + '". Pick a date to replace it, or leave empty to keep it.');
        break;
      }
      case 'bool': {
        const odd = v !== true && v !== false && !B.isBlank(v);
        input = h('input', { id, type: 'checkbox', checked: v === true, onchange: e => set(e.target.checked) });
        wrap.append(h('div', { class: 'toggle' }, input, h('span', null, 'Yes')));
        if (odd) hint('Currently stored as "' + v + '". Switching sets it to Yes or No.');
        if (err) wrap.append(err);
        inputs[col] = input;
        return wrap;
      }
      case 'enum':
        input = h('select', { id, onchange: e => set(e.target.value) }, h('option', { value: '' }, '—'), c.values.map(o => h('option', { value: o, selected: o === v }, o)));
        break;
      case 'ref':
        input = refSelect(id, c, v, (val) => {
          set(val);
          if (table === 'Projects' && col === 'Company') { values.Customer = ''; draw(); }
          if (table === 'Action Tracker' && col === 'Project #') {
            const p = B.isBlank(val) ? null : findRecord('Projects', val);
            values['BD Project Name'] = p ? p['BD Project Name'] : '';
            values.Criticality = p ? p.Criticality : '';
            draw();
          }
        });
        break;
      case 'email':
        input = h('input', { id, class: 'input', type: 'email', autocomplete: 'off', value: v ?? '', oninput: e => set(e.target.value.trim()) }); break;
      case 'file': case 'image': {
        const name = h('span', { class: 'name' }, files[col] ? files[col].name : (B.isBlank(v) ? 'No file' : String(v).split('/').pop()));
        wrap.append(h('div', { class: 'filepick' }, name, filePickerButtons(c.type, f => { files[col] = f; name.textContent = f.name + ' (will upload)'; }, B.isBlank(v) ? 'Choose' : 'Replace')));
        return wrap;
      }
      default:
        input = h('input', { id, class: 'input', value: v ?? '', oninput: e => set(e.target.value) });
    }
    if (input.tagName !== 'TEXTAREA' && input.tagName !== 'SELECT' && !input.classList.contains('input')) input.classList.add('input');
    if (errors[col]) input.classList.add('invalid');
    wrap.insertBefore(input, null);
    if (c.rating) {
      wrap.append(h('div', { class: 'chips', role: 'group', 'aria-label': 'Quick rating' }, ['1', '2', '3', '4', '5'].map(n =>
        h('button', { type: 'button', 'aria-pressed': String(values[col]) === n ? 'true' : 'false', onclick: () => { set(n); input.value = n; draw(); } }, n))));
    }
    if (err) wrap.append(err);
    inputs[col] = input;
    return wrap;
  }

  function refSelect(id, c, v, onPick) {
    let opts = [];
    if (c.ref === 'Customers' && table === 'Projects') opts = B.customersForCompany(values.Company, model.view.Customers).map(r => [r.Customer, r.Customer]);
    else if (c.ref === 'Projects') opts = model.view.Projects.slice().sort((a, b) => Number(b['P#']) - Number(a['P#'])).map(r => [r['P#'], r['BD Project Name'] || r['Project Name'] || r['P#']]);
    else if (c.ref === 'Users') opts = model.view.Users.filter(u => u.Active !== false && !B.same(u.Active, 'Inactive') && !B.isBlank(u.Name)).map(u => [u.Name, u.Name]).sort((a, b) => a[1].localeCompare(b[1]));
    else {
      const t = B.SCHEMA[c.ref];
      opts = model.view[c.ref].map(r => [r[t.key], r[t.key]]).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    }
    const has = opts.some(o => String(o[0]) === String(v));
    const blankText = c.ref === 'Customers' && B.isBlank(values.Company) ? 'Choose a company first'
      : (table === 'Action Tracker' && c.name === 'Project #') ? 'No project (general action)'
      : (table === 'Action Tracker' && c.name === 'Owner') ? 'Me' : '—';
    const addable = ADDABLE[c.ref] && B.canAdd(c.ref, model.user);
    const sel = h('select', { id, onchange: async e => {
        if (e.target.value !== NEW) { onPick(e.target.value); return; }
        e.target.value = v ?? '';
        const key = await addNew(c.ref);
        if (key) { onPick(key); draw(); }
      } },
      h('option', { value: '' }, blankText),
      !has && !B.isBlank(v) ? h('option', { value: v, selected: true }, String(v) + ' (not in list)') : null,
      opts.map(([val, lab]) => h('option', { value: val, selected: String(val) === String(v) }, String(lab))),
      addable ? h('option', { value: NEW }, '+ Add new ' + humanTable(c.ref) + '…') : null);
    return sel;
  }

  /* Add a company, customer or item category from inside a form, then select it.
   * It is saved like any other change (works offline, sent in order before this form). */
  async function addNew(ref) {
    let fields;
    if (ref === 'Customers') {
      const company = values.Company;
      if (B.isBlank(company)) { toast('Choose the company first, then add its customer.', { error: true }); return null; }
      const r = await formDialog({ title: 'New customer', message: 'For ' + company + '.', confirmText: 'Add customer',
        fields: [{ name: 'Customer', label: 'Customer name', required: true }] });
      if (!r) return null;
      fields = { Customer: r.Customer, Company: company, Active: true };
    } else if (ref === 'Lists') {
      const r = await formDialog({ title: 'New company', confirmText: 'Add company',
        fields: [{ name: 'Company', label: 'Company name', required: true },
                 { name: 'Company Code', label: 'Company code', required: true, hint: 'Short code used in project names, e.g. HO for Henkel OCT.' }] });
      if (!r) return null;
      fields = { Company: r.Company, 'Company Code': r['Company Code'] };
    } else if (ref === 'Item Type') {
      const r = await formDialog({ title: 'New item category', confirmText: 'Add category',
        fields: [{ name: 'Item_Type', label: 'Item category', required: true }] });
      if (!r) return null;
      fields = { Item_Type: r.Item_Type };
    } else return null;
    const keyCol = B.SCHEMA[ref].key;
    const existing = findRecord(ref, fields[keyCol]);
    if (existing) { toast('"' + existing[keyCol] + '" already exists. It is now selected.'); return existing[keyCol]; }
    await enqueue({ op: 'create', table: ref, fields }, 'New ' + humanTable(ref) + ': ' + fields[keyCol]);
    toast('Added ' + humanTable(ref) + ' "' + fields[keyCol] + '".');
    return fields[keyCol];
  }

  function validate() {
    let ok = true;
    for (const k of Object.keys(errors)) delete errors[k];
    formColumns(table).forEach(col => {
      const c = B.column(table, col); if (!c) return;
      const rule = ruleFor(table, col, values, isNew);
      if (!rule.visible || !rule.editable) return;
      const v = values[col];
      if (rule.required && B.isBlank(v) && !files[col]) { errors[col] = B.labelOf(table, col) + ' is required.'; ok = false; }
      if (['number', 'price', 'decimal'].includes(c.type) && !B.isBlank(v) && isNaN(Number(v))) { errors[col] = 'Enter a number.'; ok = false; }
      if (c.type === 'email' && !B.isBlank(v) && !/^\S+@\S+\.\S+$/.test(String(v))) { errors[col] = 'Enter a valid email address.'; ok = false; }
    });
    if (isNew && !def.columns.find(c => c.name === def.key).auto && B.isBlank(values[def.key])) { errors[def.key] = B.labelOf(table, def.key) + ' is required.'; ok = false; }
    if (isNew && !def.columns.find(c => c.name === def.key).auto && !B.isBlank(values[def.key]) && findRecord(table, values[def.key])) { errors[def.key] = '"' + values[def.key] + '" already exists.'; ok = false; }
    return ok;
  }

  async function save() {
    if (!validate()) { draw(); const f = box.querySelector('.invalid, .error-text'); if (f) f.scrollIntoView({ block: 'center' }); toast('Check the highlighted fields.', { error: true }); return; }
    const fields = {}, orig = {};
    formColumns(table).concat(def.columns.map(c => c.name)).forEach(col => {
      if (col in fields) return;
      const c = B.column(table, col); if (!c || c.type === 'file' || c.type === 'image') return;
      const rule = ruleFor(table, col, values, isNew);
      if (!rule.editable) return;
      const now = values[col], was = start[col];
      if (isNew) { if (!B.isBlank(now)) fields[col] = normalise(c, now); }
      else if (String(now ?? '') !== String(was ?? '')) { fields[col] = normalise(c, now); orig[col] = was ?? ''; }
    });
    let key;
    if (isNew) {
      const tempKey = newTempKey();
      for (const k of Object.keys(context)) { if (!(k in fields) && !(B.column(table, k) && ruleFor(table, k, values, isNew).editable)) fields[k] = context[k]; }
      await enqueue({ op: 'create', table, tempKey, fields }, 'New ' + humanTable(table) + (fields['Project Name'] || fields.Item_Name || fields.Action ? ': ' + (fields['Project Name'] || fields.Item_Name || fields.Action) : ''));
      key = def.columns.find(c => c.name === def.key).auto ? tempKey : fields[def.key];
    } else {
      key = record[def.key];
      if (Object.keys(fields).length) await enqueue({ op: 'update', table, key, fields, orig }, 'Edit ' + humanTable(table) + ' ' + (record[def.label] || key));
    }
    for (const col of Object.keys(files)) {
      const f = files[col];
      await enqueue({ op: 'upload', table, key, column: col, fileName: f.name, mimeType: f.mimeType, data: f.data }, 'Upload ' + f.name);
    }
    toast(navigator.onLine ? 'Saved.' : 'Saved on this phone. It will sync when online.');
    onDone && onDone(key);
  }

  draw();
  return { el: formEl, save, submitText: submitText || (isNew ? 'Add' : 'Save') };
}

function normalise(c, v) {
  if (['number', 'price', 'decimal'].includes(c.type)) return v === '' ? '' : Number(v);
  if (c.type === 'bool') return v === true || v === false ? v : v;
  return typeof v === 'string' ? v.trim() : v;
}
function refLabel(table, v) {
  if (B.isBlank(v)) return '';
  if (table === 'Projects') { const r = findRecord('Projects', v); return r ? r['BD Project Name'] : String(v); }
  return String(v);
}
export function humanTable(t) {
  return ({ 'Projects': 'project', 'Items': 'item', 'Action Tracker': 'action', 'Customer_Satisfaction': 'satisfaction record', 'Quality_Checks': 'quality check', 'Stage_History': 'history entry', 'Lists': 'company', 'Customers': 'customer', 'Locations': 'location', 'Item Type': 'item category', 'Users': 'user' })[t] || 'record';
}

/** Starting values shown on a new form (the server sets the real ones). */
function previewDefaults(table, rec, ctx) {
  const today = model.today || new Date().toISOString().slice(0, 10);
  const out = Object.assign({}, ctx);
  if (table === 'Projects') { out.Stage = B.S.S1; out.Documentation_Verified = false; }
  if (table === 'Items') { out.Delivery_Date = rec.Delivery_Date || today; const p = findRecord('Projects', ctx.Project_ID); if (p) out['BD Project Name'] = p['BD Project Name']; }
  if (table === 'Action Tracker') {
    out.Owner = model.user && model.user.name; out['Created at'] = today; out['Due Date'] = rec['Due Date'] || today; out.Status = 'In Progress';
    const p = ctx['Project #'] ? findRecord('Projects', ctx['Project #']) : null;
    if (p) { out['BD Project Name'] = p['BD Project Name']; out.Criticality = p.Criticality; }
  }
  return out;
}
