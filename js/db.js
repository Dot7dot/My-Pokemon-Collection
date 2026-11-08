// IndexedDB：items 存文字資料，blobs 存照片（原圖＋縮圖），分開存讓列表載入很快。
const DB_NAME = 'my-pokemon-collection';
const VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('items')) {
        const s = db.createObjectStore('items', { keyPath: 'id' });
        s.createIndex('dex', 'dex');
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

async function tx(stores, mode, fn) {
  const db = await open();
  const t = db.transaction(stores, mode);
  const done = new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
  });
  const out = await fn(t);
  await done;
  return out;
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export function allItems() {
  return tx(['items'], 'readonly', (t) => req(t.objectStore('items').getAll()));
}

export async function itemsFor(dex) {
  const list = await tx(['items'], 'readonly', (t) => req(t.objectStore('items').index('dex').getAll(dex)));
  return list.sort((a, b) => a.created - b.created);
}

export function saveItem(item, blobs) {
  return tx(['items', 'blobs'], 'readwrite', (t) => {
    t.objectStore('items').put(item);
    if (blobs) t.objectStore('blobs').put(blobs, item.id);
  });
}

export function deleteItem(id) {
  return tx(['items', 'blobs'], 'readwrite', (t) => {
    t.objectStore('items').delete(id);
    t.objectStore('blobs').delete(id);
  });
}

export function getBlobs(id) {
  return tx(['blobs'], 'readonly', (t) => req(t.objectStore('blobs').get(id)));
}

// 縮圖網址快取：同一張照片只建立一次 object URL
const urlCache = new Map();
export async function imageURL(id, kind = 'thumb') {
  const key = id + ':' + kind;
  if (urlCache.has(key)) return urlCache.get(key);
  const b = await getBlobs(id);
  const blob = b?.[kind] || b?.full;
  if (!blob) return '';
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}
export function forgetURLs(id) {
  for (const k of ['thumb', 'full']) {
    const key = id + ':' + k;
    if (urlCache.has(key)) { URL.revokeObjectURL(urlCache.get(key)); urlCache.delete(key); }
  }
}

export async function askPersist() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* 不支援就算了 */ }
}
