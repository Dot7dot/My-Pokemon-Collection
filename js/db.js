// IndexedDB：items 存文字資料，blobs 存照片（原圖＋縮圖），分開存讓列表載入很快，
// 改介紹文字時只寫 items，不會動到照片。
//
// iPhone Safari 注意事項：
//   - 照片一律存成 ArrayBuffer（真正的位元組），不存 File／Blob 的參照。
//     iOS 選檔拿到的是暫存檔，下次選檔就會被刪；Safari 存在 IndexedDB 裡的 Blob 也曾有讀不到的問題。
//   - 顯示時才用 new Blob([data]) 轉成網址，離開頁面就 revoke 釋放記憶體。
//   - 第 2 版資料庫：舊的 Blob 會自動轉成 ArrayBuffer；讀不到的標成 broken，畫面上會提示重新上傳。
const DB_NAME = 'my-pokemon-collection';
const VERSION = 2;
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
      // v1 → v2 的資料轉換要讀 Blob（非同步），不能在升級交易裡做，交給 migrateBlobs()
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

// 任何形式的圖片資料 → 自己的一份 ArrayBuffer（交易開始前就讀完）
async function toBuffer(x) {
  if (!x) return null;
  if (x instanceof ArrayBuffer) return x;
  if (ArrayBuffer.isView(x)) return x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength);
  if (x instanceof Blob) return x.arrayBuffer();
  throw new Error('unknown image data');
}
async function toRecord(images) {
  const full = await toBuffer(images.full);
  const thumb = images.thumb ? await toBuffer(images.thumb) : null;
  return { full, thumb, type: images.type || images.full?.type || 'image/jpeg' };
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export function allItems() {
  return tx(['items'], 'readonly', (t) => req(t.objectStore('items').getAll()));
}

export async function itemsFor(dex) {
  const list = await tx(['items'], 'readonly', (t) => req(t.objectStore('items').index('dex').getAll(dex)));
  return list.sort((a, b) => a.created - b.created);
}

// images 省略時只更新文字；有照片時文字和照片在同一個交易裡一起寫入
export async function saveItem(item, images) {
  const rec = images ? await toRecord(images) : null;
  if (rec) delete item.broken;
  return tx(['items', 'blobs'], 'readwrite', (t) => {
    t.objectStore('items').put(item);
    if (rec) t.objectStore('blobs').put(rec, item.id);
  });
}

export function deleteItem(id) {
  return tx(['items', 'blobs'], 'readwrite', (t) => {
    t.objectStore('items').delete(id);
    t.objectStore('blobs').delete(id);
  });
}

// 讀出照片原始資料：{ full: ArrayBuffer, thumb: ArrayBuffer, type }
export function getImages(id) {
  return tx(['blobs'], 'readonly', (t) => req(t.objectStore('blobs').get(id)));
}

// 顯示用網址：同一張照片只建立一次；離開寶可夢頁面時 releaseURLs() 全部釋放
const urlCache = new Map();
export async function imageURL(id, kind = 'thumb') {
  const key = id + ':' + kind;
  if (urlCache.has(key)) return urlCache.get(key);
  const rec = await getImages(id);
  const data = rec?.[kind] || rec?.full;
  if (!data) return '';
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: rec.type || 'image/jpeg' }));
  urlCache.set(key, url);
  return url;
}
// 需要檔案本身時（分享、存到手機）
export async function imageBlob(id, kind = 'full') {
  const rec = await getImages(id);
  const data = rec?.[kind] || rec?.full;
  if (!data) return null;
  return data instanceof Blob ? data : new Blob([data], { type: rec.type || 'image/jpeg' });
}
export function forgetURLs(id) {
  for (const k of ['thumb', 'full']) {
    const key = id + ':' + k;
    if (urlCache.has(key)) { URL.revokeObjectURL(urlCache.get(key)); urlCache.delete(key); }
  }
}
export function releaseURLs() {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
}

// 舊資料（照片是 Blob）轉成 ArrayBuffer；讀不到的收藏標成 broken。回傳 { converted, broken }
export async function migrateBlobs() {
  const keys = await tx(['blobs'], 'readonly', (t) => req(t.objectStore('blobs').getAllKeys()));
  let converted = 0, broken = 0;
  for (const id of keys) {
    const rec = await getImages(id);
    if (!rec || (!(rec.full instanceof Blob) && !(rec.thumb instanceof Blob))) continue;
    let fixed = null;
    try {
      fixed = await toRecord(rec);
      if (!fixed.full || !fixed.full.byteLength) fixed = null;
    } catch { fixed = null; }
    if (fixed) {
      await tx(['blobs'], 'readwrite', (t) => { t.objectStore('blobs').put(fixed, id); });
      converted++;
    } else {
      // 照片內容已經讀不到：保留文字，標記起來讓畫面提示重新上傳，不要默默消失
      // 照片紀錄換成「已損壞」標記，下次就不會再試、也不會重複提醒
      await tx(['items', 'blobs'], 'readwrite', (t) => {
        t.objectStore('blobs').put({ full: null, thumb: null, broken: true }, id);
        const s = t.objectStore('items');
        const g = s.get(id);
        g.onsuccess = () => { if (g.result) { g.result.broken = true; s.put(g.result); } };
      });
      broken++;
    }
  }
  return { converted, broken };
}

export async function askPersist() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* 不支援就算了 */ }
}
