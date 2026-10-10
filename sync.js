/* The app's data model and synchronisation.
 *
 * snapshot = the last full copy of the data received from the server.
 * outbox   = the user's changes not yet confirmed by the server.
 * view     = snapshot + outbox applied on top. Screens always show the view,
 *            so a change appears instantly even with no connection.
 *
 * Sending: changes go to the server oldest-first, each with a unique ID.
 * The server applies each ID at most once, so a change sent twice (for
 * example after a dropped connection) is never applied twice. A change is
 * removed from the phone only after the server confirms it.             */
import { call, ApiError } from './api.js';
import { store } from './store.js';
import { CONFIG } from './config.js';

const B = window.BGS;
const listeners = new Set();

export const model = {
  chat: [],        // group chat messages, oldest first (see chat functions at the end)
  chatSeen: '',    // newest message time this phone has seen in the Group screen
  members: [],     // AI team members
  token: null,
  user: null,
  perms: {},
  snapshot: emptyTables(),
  view: emptyTables(),
  outbox: [],
  conflicts: [],
  today: localToday(),
  lastSync: null,
  status: 'idle',        // idle | syncing | synced | offline | failed
  statusMessage: '',
  ready: false
};

function emptyTables() { const t = {}; Object.keys(B.SCHEMA).forEach(n => { t[n] = []; }); return t; }
export function localToday() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function localNow() { const d = new Date(); return localToday() + ' ' + [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':'); }
export function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2)); }
export function newTempKey() { return 'tmp-' + uuid().slice(0, 13); }
export function isTemp(k) { return typeof k === 'string' && k.indexOf('tmp-') === 0; }
const clone = o => JSON.parse(JSON.stringify(o));
const sameKey = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(kind, detail) { listeners.forEach(fn => { try { fn(kind, detail); } catch (e) { console.error(e); } }); }

/* ---------------- start-up and sign-in ---------------- */

export async function loadFromPhone() {
  const [token, user, perms, snapshot, lastSync, today, outbox, conflicts, chat, chatSeen, members] = await Promise.all([
    store.get('token'), store.get('user'), store.get('perms'), store.get('tables'), store.get('lastSync'), store.get('today'),
    store.outboxAll(), store.conflictsAll(), store.get('chat'), store.get('chatSeen'), store.get('members')
  ]);
  model.chat = Array.isArray(chat) ? chat : [];
  model.chatSeen = chatSeen || '';
  model.members = Array.isArray(members) ? members : [];
  model.token = token || null;
  model.user = user || null;
  model.perms = perms || {};
  model.snapshot = Object.assign(emptyTables(), snapshot || {});
  model.lastSync = lastSync || null;
  model.today = localToday();
  model.outbox = outbox || [];
  model.conflicts = conflicts || [];
  rebuildView();
  model.ready = true;
  emit('change');
}

export async function signedIn(token, user) {
  model.token = token; model.user = user;
  await store.set('token', token);
  await store.set('user', user);
  emit('change');
}

export async function signOut() {
  const t = model.token;
  try { if (t) await call('logout', {}, t); } catch (e) { /* signing out locally is enough */ }
  await store.clearAll();
  Object.assign(model, { token: null, user: null, perms: {}, snapshot: emptyTables(), view: emptyTables(), outbox: [], conflicts: [], lastSync: null, status: 'idle', statusMessage: '', chat: [], chatSeen: '', members: [] });
  emit('change');
}

/* ---------------- local changes ---------------- */

/** Queue a change. It is shown immediately and sent as soon as possible. */
export async function enqueue(change, summary) {
  const item = Object.assign({ id: uuid(), createdAt: new Date().toISOString(), state: 'pending', summary: summary || describe(change) }, change);
  const seq = await store.outboxAdd(item);
  item.seq = seq;
  model.outbox.push(item);
  rebuildView();
  emit('change');
  scheduleSync(600);
  return item;
}

function describe(ch) {
  const label = B.SCHEMA[ch.table] ? ch.table : '';
  switch (ch.op) {
    case 'create': return 'New ' + singular(label);
    case 'update': return 'Edit ' + singular(label) + ' ' + ch.key;
    case 'delete': return 'Delete ' + singular(label) + ' ' + ch.key;
    case 'move': return 'Move project ' + ch.key + ' to ' + ch.to;
    case 'reject': return 'Reject project ' + ch.key;
    case 'complete': return 'Complete action ' + ch.key;
    case 'upload': return 'Upload ' + (ch.fileName || 'file') + ' to ' + singular(label) + ' ' + ch.key;
    default: return ch.op;
  }
}
function singular(t) {
  return ({ 'Projects': 'project', 'Items': 'item', 'Action Tracker': 'action', 'Customer_Satisfaction': 'satisfaction record', 'Quality_Checks': 'quality check', 'Stage_History': 'history entry', 'Lists': 'company', 'Customers': 'customer', 'Locations': 'location', 'Item Type': 'item category', 'Users': 'user' })[t] || 'record';
}

/** Rebuild the view: server snapshot + every unconfirmed change on top. */
export function rebuildView() {
  const v = clone(model.snapshot);
  model.outbox.filter(c => c.state !== 'refused').forEach(c => { try { applyLocal(v, c); } catch (e) { console.warn('Could not preview change', c, e); } });
  // Open actions past their due date show as Late straight away (also offline, also overnight).
  const today = localToday();
  v['Action Tracker'].forEach(a => { a.Status = B.statusAfterEdit(a, today); });
  model.view = v;
}

function keyCol(table) { return B.SCHEMA[table].key; }
function findIn(tables, table, key) { return tables[table].find(r => sameKey(r[keyCol(table)], key)); }

/** Show a change locally the way the server will apply it. */
function applyLocal(t, ch) {
  const u = model.user || {};
  const today = localToday();
  const now = localNow();
  const mark = r => { r.__pending = true; return r; };
  if (ch.op === 'create') {
    const rec = Object.assign({}, ch.fields);
    const k = ch.tempKey;
    if (ch.table === 'Projects') {
      const company = findIn(t, 'Lists', rec.Company);
      Object.assign(rec, { 'P#': k, Stage: B.S.S1, Created_By: u.email, Documentation_Verified: false,
        'BD Project Name': B.bdProjectName('New', company ? company['Company Code'] : '', rec['Project Name']) });
    } else if (ch.table === 'Items') {
      const p = findIn(t, 'Projects', rec.Project_ID);
      Object.assign(rec, { Item_ID: k, 'BD Project Name': p ? p['BD Project Name'] : '' });
      if (B.isBlank(rec.Delivery_Date)) rec.Delivery_Date = today;
      rec.Selling_Price = B.sellingPriceRule(rec);
    } else if (ch.table === 'Action Tracker') {
      const p = B.isBlank(rec['Project #']) ? null : findIn(t, 'Projects', rec['Project #']);
      Object.assign(rec, { 'Action #': k, Owner: B.isBlank(rec.Owner) ? u.name : rec.Owner, 'Project #': p ? p['P#'] : 0,
        'BD Project Name': p ? p['BD Project Name'] : '', Criticality: p ? p.Criticality : '' });
      if (B.isBlank(rec['Created at'])) rec['Created at'] = today;
      if (B.isBlank(rec['Due Date'])) rec['Due Date'] = today;
      rec.Status = B.statusForNewAction(rec['Due Date'], today);
    } else if (ch.table === 'Customer_Satisfaction') {
      Object.assign(rec, { Satisfaction_ID: k, Submitted_By: u.email, Submitted_At: now });
    } else if (ch.table === 'Stage_History') {
      Object.assign(rec, { History_ID: k, Changed_By: u.name, Changed_At: now });
    } else if (ch.table === 'Quality_Checks') {
      rec.Check_ID = k;
    }
    t[ch.table].push(mark(rec));
  } else if (ch.op === 'update') {
    const r = findIn(t, ch.table, ch.key); if (!r) return;
    Object.assign(r, ch.fields);
    if (ch.table === 'Items') r.Selling_Price = B.sellingPriceRule(r);
    if (ch.table === 'Action Tracker') r.Status = B.statusAfterEdit(r, today);
    mark(r);
  } else if (ch.op === 'delete') {
    const kc = keyCol(ch.table);
    t[ch.table] = t[ch.table].filter(r => !sameKey(r[kc], ch.key));
  } else if (ch.op === 'move') {
    const r = findIn(t, 'Projects', ch.key); if (!r) return;
    const from = r.Stage;
    r.Stage = ch.to;
    const m = B.moveTo(ch.to);
    if (m && m.sets && m.sets.Execution_Started_At) r.Execution_Started_At = today;
    mark(r);
    t.Stage_History.push(mark({ History_ID: 'tmp-h-' + ch.id.slice(0, 8), Project_ID: r['P#'], From_Stage: from, To_Stage: ch.to, Changed_By: u.name, Changed_At: now, Comment: '' }));
  } else if (ch.op === 'back') {
    const r = findIn(t, 'Projects', ch.key); if (!r) return;
    const from = r.Stage, prev = B.previousStage(r); if (!prev) return;
    r.Stage = prev; mark(r);
    t.Stage_History.push(mark({ History_ID: 'tmp-h-' + ch.id.slice(0, 8), Project_ID: r['P#'], From_Stage: from, To_Stage: prev, Changed_By: u.name, Changed_At: now, Comment: '' }));
  } else if (ch.op === 'reject') {
    const r = findIn(t, 'Projects', ch.key); if (!r) return;
    const from = r.Stage;
    Object.assign(r, { Stage: B.S.S7, 'Rejection Reason': ch.reason });
    mark(r);
    t.Stage_History.push(mark({ History_ID: 'tmp-h-' + ch.id.slice(0, 8), Project_ID: r['P#'], From_Stage: from, To_Stage: B.S.S7, Changed_By: u.name, Changed_At: now, Comment: '' }));
  } else if (ch.op === 'complete') {
    const r = findIn(t, 'Action Tracker', ch.key); if (r) { r.Status = 'Completed'; mark(r); }
  } else if (ch.op === 'upload') {
    const r = findIn(t, ch.table, ch.key); if (r) { r[ch.column] = 'pending-upload:' + (ch.fileName || 'file'); mark(r); }
  }
}

/* ---------------- sync ---------------- */

let syncing = null;
let timer = null;

export function scheduleSync(ms) {
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow().catch(() => {}); }, ms);
}

function setStatus(status, message) {
  model.status = status; model.statusMessage = message || '';
  emit('status');
}

export function pendingCount() { return model.outbox.filter(c => c.state !== 'refused').length; }
export function attentionCount() { return model.outbox.filter(c => c.state === 'refused').length + model.conflicts.length; }

/** Send everything waiting, then download fresh data. Safe to call any time. */
let again = false;
export function syncNow() {
  if (syncing) { again = true; return syncing; } // a change arrived mid-sync: run once more afterwards
  if (!model.token) return Promise.resolve();
  syncing = (async () => {
    if (navigator.onLine === false) { setStatus('offline', 'No connection. Changes are kept on this phone.'); return; }
    setStatus('syncing');
    try {
      await pushAll();
      const data = await call('pull', {}, model.token);
      if (!data.tables || !Array.isArray(data.tables.Projects) || !Array.isArray(data.tables.Users)) {
        throw new ApiError('NETWORK', 'The data download was incomplete. Your data on this phone was kept.');
      }
      model.snapshot = Object.assign(emptyTables(), data.tables);
      if (Array.isArray(data.chat)) { model.chat = data.chat; await store.set('chat', model.chat); }
      if (Array.isArray(data.members)) { model.members = data.members; await store.set('members', model.members); }
      model.user = data.user; model.perms = data.perms; model.today = data.today || localToday();
      model.lastSync = new Date().toISOString();
      await Promise.all([store.set('tables', model.snapshot), store.set('user', model.user), store.set('perms', model.perms), store.set('lastSync', model.lastSync), store.set('today', model.today)]);
      rebuildView();
      emit('change');
      setStatus('synced');
    } catch (e) {
      rebuildView();
      emit('change');
      if (e instanceof ApiError && e.isAuth) { setStatus('failed', e.message); emit('auth', e); return; }
      if (e instanceof ApiError && e.code === 'APP_TOO_OLD') { setStatus('failed', e.message); emit('update-required', e); return; }
      if (e instanceof ApiError && e.isNetwork) { setStatus(navigator.onLine === false ? 'offline' : 'failed', e.message + ' Your changes are kept on this phone.'); return; }
      setStatus('failed', (e && e.message) || 'Sync failed.');
    } finally {
      syncing = null;
      if (again) { again = false; if (pendingCount() && model.status !== 'offline') setTimeout(() => syncNow(), 50); }
    }
  })();
  return syncing;
}

async function pushAll() {
  for (let round = 0; round < 40; round++) {
    const queue = model.outbox.filter(c => c.state === 'pending' || c.state === 'waiting').sort((a, b) => a.seq - b.seq);
    if (!queue.length) return;
    const batch = [];
    let size = 0;
    for (const c of queue) {
      const s = c.op === 'upload' ? (c.data || '').length : 1000;
      if (batch.length && (batch.length >= 20 || size + s > 4000000)) break;
      batch.push(c); size += s;
      if (c.op === 'upload') break; // one file per request
    }
    const payload = batch.map(c => {
      const o = { id: c.id, op: c.op, table: c.table };
      ['key', 'fields', 'orig', 'to', 'from', 'reason', 'tempKey', 'column', 'fileName', 'mimeType', 'data', 'messageId'].forEach(k => { if (c[k] !== undefined) o[k] = c[k]; });
      return o;
    });
    const res = await call('push', { changes: payload }, model.token);
    let progressed = false, serverError = null;
    for (const r of res.results) {
      const c = batch.find(b => b.id === r.id);
      if (!c) continue;
      if (r.status === 'applied') {
        progressed = true;
        await removeFromOutbox(c);
        (r.records || []).forEach(x => upsert(x.table, x.record));
        (r.deleted || []).forEach(x => removeRecord(x.table, x.key));
        if (r.tempKey && r.key !== undefined) await remapKey(r.tempKey, r.key);
        if (Array.isArray(r.chat)) await mergeChat(r.chat);
        emit('applied', { change: c, result: r });
      } else if (r.status === 'conflict') {
        progressed = true;
        await removeFromOutbox(c);
        const conflict = { id: c.id, change: c, server: r.server, fields: r.fields, message: r.message, at: new Date().toISOString() };
        model.conflicts.push(conflict);
        await store.conflictPut(conflict);
        if (r.server) upsert(c.table, r.server);
      } else if (r.status === 'refused' && r.code === 'WAITING') {
        c.state = 'waiting'; c.message = r.message; await store.outboxPut(c);
      } else if (r.status === 'refused') {
        progressed = true;
        c.state = 'refused'; c.message = r.message; await store.outboxPut(c);
      } else {
        c.message = r.message; await store.outboxPut(c);
        serverError = r.message;
      }
    }
    if (res.keyMap) for (const tmp of Object.keys(res.keyMap)) await remapKey(tmp, res.keyMap[tmp]);
    await store.set('tables', model.snapshot);
    rebuildView();
    emit('change');
    if (serverError) throw new ApiError('SERVER_ERROR', serverError);
    if (!progressed) return; // only waiting items left
  }
}

async function removeFromOutbox(c) {
  model.outbox = model.outbox.filter(x => x.seq !== c.seq);
  await store.outboxDelete(c.seq);
}

function upsert(table, rec) {
  if (!rec || !model.snapshot[table]) return;
  const kc = keyCol(table);
  const i = model.snapshot[table].findIndex(r => sameKey(r[kc], rec[kc]));
  if (i >= 0) model.snapshot[table][i] = rec; else model.snapshot[table].push(rec);
}
function removeRecord(table, key) {
  const kc = keyCol(table);
  model.snapshot[table] = model.snapshot[table].filter(r => !sameKey(r[kc], key));
}

/** A record made offline got its real number: update every reference to it. */
async function remapKey(tmp, real) {
  for (const c of model.outbox) {
    let changed = false;
    if (c.key === tmp) { c.key = real; changed = true; }
    if (c.fields) Object.keys(c.fields).forEach(k => { if (c.fields[k] === tmp) { c.fields[k] = real; changed = true; } });
    if (changed) await store.outboxPut(c);
  }
  emit('keymap', { tmp, real });
}

/* ---------------- fixing problems ---------------- */

export async function discardChange(seq) {
  const c = model.outbox.find(x => x.seq === seq);
  if (c) await removeFromOutbox(c);
  rebuildView(); emit('change');
}
export async function retryChange(seq) {
  const c = model.outbox.find(x => x.seq === seq);
  if (c) { c.state = 'pending'; c.message = ''; await store.outboxPut(c); }
  rebuildView(); emit('change');
  return syncNow();
}
/** Keep my version: send my values again, this time on top of the server's. */
export async function keepMine(conflictId) {
  const k = model.conflicts.find(x => x.id === conflictId);
  if (!k) return;
  await dropConflict(conflictId);
  if (k.change.op === 'update') {
    const orig = {};
    Object.keys(k.change.fields).forEach(f => { orig[f] = k.server ? k.server[f] : ''; });
    await enqueue({ op: 'update', table: k.change.table, key: k.change.key, fields: k.change.fields, orig }, k.change.summary);
  }
}
export async function keepTheirs(conflictId) { await dropConflict(conflictId); }
async function dropConflict(id) {
  model.conflicts = model.conflicts.filter(x => x.id !== id);
  await store.conflictDelete(id);
  emit('change');
}

/* ---------------- background triggers ---------------- */

export function startBackgroundSync() {
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => setStatus('offline', 'No connection. Changes are kept on this phone.'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const age = model.lastSync ? Date.now() - Date.parse(model.lastSync) : Infinity;
      if (age > 60000 || pendingCount()) syncNow();
    }
  });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, CONFIG.SYNC_EVERY_MINUTES * 60000);
}

/* ---------------- group chat ---------------- */

/** Send a message. Queued like any change, so it also works offline. */
export async function sendChat(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const messageId = 'm' + uuid().replace(/-/g, '').slice(0, 15);
  return enqueue({ op: 'chat', table: '_Chat', fields: { Text: t }, messageId }, 'Message: ' + (t.length > 40 ? t.slice(0, 40) + '…' : t));
}

/** Messages to show: the downloaded ones plus this phone's unsent ones. */
export function chatView() {
  const have = new Set(model.chat.map(m => m.Message_ID));
  const mine = model.outbox.filter(c => c.op === 'chat' && !have.has(c.messageId)).map(c => {
    const mentions = B.mentionsIn(c.fields && c.fields.Text);
    return { Message_ID: c.messageId, Sent_At: localNow().replace(' ', 'T'), Author: (model.user && model.user.name) || 'Me', Author_Type: 'human',
      Text: (c.fields && c.fields.Text) || '', Mentions: mentions, Task_Status: mentions.length ? 'waiting' : '', Reply_To: '',
      __pending: c.state !== 'refused', __refused: c.state === 'refused' ? (c.message || 'Not sent') : null };
  });
  return model.chat.concat(mine);
}

async function mergeChat(list) {
  if (!list || !list.length) return;
  const byId = new Map(model.chat.map(m => [m.Message_ID, m]));
  list.forEach(m => byId.set(m.Message_ID, Object.assign({}, byId.get(m.Message_ID) || {}, m)));
  model.chat = [...byId.values()].sort((a, b) => String(a.Sent_At).localeCompare(String(b.Sent_At))).slice(-500);
  await store.set('chat', model.chat);
  emit('chat');
}

function newestChatStamp() {
  let s = '';
  model.chat.forEach(m => { if (m.Sent_At > s) s = m.Sent_At; if (m.Updated_At && m.Updated_At > s) s = m.Updated_At; });
  return s;
}

/** Quick check for new messages (only the chat, not all the data). */
let chatBusy = false;
export async function refreshChat() {
  if (chatBusy || !model.token || navigator.onLine === false) return;
  chatBusy = true;
  try {
    const data = await call('chat', { since: newestChatStamp() }, model.token);
    if (Array.isArray(data.members)) model.members = data.members;
    await mergeChat(data.chat || []);
  } catch (e) { /* the regular sync shows connection problems */ }
  finally { chatBusy = false; }
}

/** Messages from others newer than what this phone has seen in the Group screen. */
export function unreadChat() {
  const me = model.user ? model.user.name : '';
  return model.chat.filter(m => m.Sent_At > (model.chatSeen || '') && m.Author !== me && m.Author_Type !== 'system').length;
}
export async function markChatSeen() {
  const s = model.chat.length ? model.chat[model.chat.length - 1].Sent_At : '';
  if (s && s !== model.chatSeen) { model.chatSeen = s; await store.set('chatSeen', s); emit('chat'); }
}
