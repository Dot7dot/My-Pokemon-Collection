// 備份：把所有收藏（文字＋照片）打包成一個 .zip；匯入時讀回來。
// 照片本來就是 JPEG，不必壓縮，所以用最簡單的「只儲存」格式，不需要外部函式庫。
import { allItems, getImages, saveItem } from './db.js';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();
function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export async function exportZip(onProgress) {
  const items = await allItems();
  const files = [{ name: 'collection.json', data: enc.encode(JSON.stringify({ app: 'my-pokemon-collection', version: 1, exported: new Date().toISOString(), items }, null, 1)) }];
  let i = 0;
  for (const it of items) {
    const b = await getImages(it.id);
    const bytes = async (x) => new Uint8Array(x instanceof Blob ? await x.arrayBuffer() : x);
    try {
      if (b?.full) files.push({ name: `photos/${it.id}.jpg`, data: await bytes(b.full) });
      if (b?.thumb) files.push({ name: `thumbs/${it.id}.jpg`, data: await bytes(b.thumb) });
    } catch { /* 讀不到的照片就略過，其他照常備份 */ }
    onProgress?.(++i, items.length);
  }
  const parts = [], central = [];
  let offset = 0;
  const { time, date } = dosTime(new Date());
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return { blob: new Blob([...parts, ...central, end.buffer], { type: 'application/zip' }), count: items.length };
}

export async function importZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('不是有效的備份檔');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = new Map();
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('備份檔損毀');
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    if (method === 0) files.set(name, buf.subarray(start, start + size));
    p += 46 + nameLen + extra + comment;
  }
  const meta = files.get('collection.json');
  if (!meta) throw new Error('備份檔裡找不到 collection.json');
  const data = JSON.parse(dec.decode(meta));
  let added = 0;
  for (const it of data.items || []) {
    const full = files.get(`photos/${it.id}.jpg`);
    if (!full) continue;
    const thumb = files.get(`thumbs/${it.id}.jpg`) || full;
    delete it.broken;
    await saveItem(it, { full, thumb, type: 'image/jpeg' }); // 直接存位元組（saveItem 會複製一份 ArrayBuffer）
    added++;
  }
  return added;
}
