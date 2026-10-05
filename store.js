/* On-phone storage (IndexedDB). Everything here survives closing the app
 * and works with no connection. It is cleared when the user signs out.
 *   kv       : settings and the last copy of every table (key -> value)
 *   outbox   : changes waiting to be sent to the server, in order
 *   conflicts: changes the server could not apply because someone else
 *              changed the same thing first
 *   files    : files already opened once, so they open offline        */

const DB_NAME = 'bgs-operations';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      if (!db.objectStoreNames.contains('conflicts')) db.createObjectStore('conflicts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage aborted'));
  }));
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const store = {
  get: key => tx('kv', 'readonly', s => req(s.get(key))),
  set: (key, value) => tx('kv', 'readwrite', s => req(s.put(value, key))),
  del: key => tx('kv', 'readwrite', s => req(s.delete(key))),

  outboxAll: () => tx('outbox', 'readonly', s => req(s.getAll())),
  outboxAdd: item => tx('outbox', 'readwrite', s => req(s.add(item))),
  outboxPut: item => tx('outbox', 'readwrite', s => req(s.put(item))),
  outboxDelete: seq => tx('outbox', 'readwrite', s => req(s.delete(seq))),

  conflictsAll: () => tx('conflicts', 'readonly', s => req(s.getAll())),
  conflictPut: c => tx('conflicts', 'readwrite', s => req(s.put(c))),
  conflictDelete: id => tx('conflicts', 'readwrite', s => req(s.delete(id))),

  fileGet: key => tx('files', 'readonly', s => req(s.get(key))),
  filePut: (key, value) => tx('files', 'readwrite', s => req(s.put(value, key))),

  async clearAll() {
    const db = await open();
    await Promise.all(['kv', 'outbox', 'conflicts', 'files'].map(name => new Promise((resolve, reject) => {
      const t = db.transaction(name, 'readwrite');
      t.objectStore(name).clear();
      t.oncomplete = resolve; t.onerror = () => reject(t.error);
    })));
  }
};
