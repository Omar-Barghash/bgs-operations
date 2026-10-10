/* Opening files stored in Google Drive. The file is fetched through the API
 * (which checks the user may see it), kept on the phone so it opens offline
 * next time, and shown in the app or handed to the phone's viewer. */
import { h, toast, infoDialog } from './ui.js';
import { call } from './api.js';
import { store } from './store.js';
import { model } from './sync.js';

export async function openFile(table, key, column, value) {
  const cacheKey = [table, key, column, value].join('|');
  let entry = await store.fileGet(cacheKey);
  if (!entry) {
    if (navigator.onLine === false) { toast('This file has not been opened on this phone before, so it needs a connection.', { error: true }); return; }
    toast('Opening file…', { ms: 1500 });
    try {
      const r = await call('getFile', { table, key, column }, model.token);
      const bytes = Uint8Array.from(atob(r.data), ch => ch.charCodeAt(0));
      entry = { name: r.name, mimeType: r.mimeType, blob: new Blob([bytes], { type: r.mimeType }) };
      await store.filePut(cacheKey, entry);
    } catch (e) {
      toast(e.message, { error: true });
      return;
    }
  }
  showEntry(entry);
}

function showEntry(entry) {
  const url = URL.createObjectURL(entry.blob);
  const isImage = /^image\//.test(entry.mimeType);
  const body = h('div', null,
    isImage ? h('img', { src: url, alt: entry.name, style: 'width:100%;border-radius:8px;margin-bottom:12px' }) : h('p', null, entry.name),
    h('div', { class: 'btns', style: 'display:flex;gap:10px' },
      h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, 'Open'),
      h('a', { class: 'btn', href: url, download: entry.name }, 'Save to phone')));
  infoDialog(isImage ? entry.name : 'File', body).then(() => setTimeout(() => URL.revokeObjectURL(url), 60000));
}

/* ---------- group chat photos and documents ---------- */
const inflight = new Map();
/** The file of a chat message: from the phone if it was opened/sent here before, otherwise downloaded once. */
export function chatFile(messageId) {
  if (inflight.has(messageId)) return inflight.get(messageId);
  const p = (async () => {
    const cacheKey = 'chat|' + messageId;
    let entry = await store.fileGet(cacheKey);
    if (entry) return entry;
    if (navigator.onLine === false) throw new Error('This file needs a connection the first time.');
    const r = await call('chatFile', { messageId }, model.token);
    const bytes = Uint8Array.from(atob(r.data), ch => ch.charCodeAt(0));
    entry = { name: r.name, mimeType: r.mimeType, blob: new Blob([bytes], { type: r.mimeType }) };
    await store.filePut(cacheKey, entry);
    return entry;
  })();
  inflight.set(messageId, p);
  p.catch(() => {}).finally(() => setTimeout(() => inflight.delete(messageId), 0));
  return p;
}
export async function openChatFile(messageId, localEntry) {
  try {
    if (!localEntry) toast('Opening…', { ms: 1200 });
    showEntry(localEntry || await chatFile(messageId));
  } catch (e) { toast(e.message, { error: true }); }
}
