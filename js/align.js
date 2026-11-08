// 卡片透視校正：依照使用者拉好的四個角，把斜拍的卡片「拉正」成 63:88 的直立卡片。
// （原本的自動偵測四邊效果不夠好，已經拿掉，只保留手動調整四角用的校正。）
import { sizeOf, makeCanvas } from './image.js';

const RATIO = 63 / 88;

// 把四邊形拉正成一張直立的卡片，四周留一點邊讓使用者還能往外調。
// 回傳 { canvas, rect }：rect 是卡片在 canvas 裡的位置
export function warpCard(src, quad, { cardW = 1000, margin = 0.06 } = {}) {
  let q = orderQuad(quad);
  // 卡片是橫的（照片轉了 90°）：把左邊當成上面，轉成直的
  if (dist(q[0], q[1]) + dist(q[3], q[2]) > dist(q[0], q[3]) + dist(q[1], q[2])) q = [q[3], q[0], q[1], q[2]];
  const cardH = Math.round(cardW / RATIO), m = Math.round(cardW * margin);
  const OW = cardW + 2 * m, OH = cardH + 2 * m;
  // 來源先縮到合理大小，避免手機記憶體不夠
  const { w: SW, h: SH } = sizeOf(src);
  const sk = Math.min(1, 2400 / Math.max(SW, SH));
  const sw = Math.round(SW * sk), sh = Math.round(SH * sk);
  const sc = makeCanvas(sw, sh);
  const sctx = sc.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(src, 0, 0, sw, sh);
  const sd = sctx.getImageData(0, 0, sw, sh).data;
  // 輸出座標 → 原圖座標 的單應矩陣
  const Hm = homography(
    [[m, m], [m + cardW, m], [m + cardW, m + cardH], [m, m + cardH]],
    q.map((p) => [p.x * sk, p.y * sk]),
  );
  const out = makeCanvas(OW, OH);
  const octx = out.getContext('2d');
  const img = octx.createImageData(OW, OH), od = img.data;
  const [h0, h1, h2, h3, h4, h5, h6, h7] = Hm;
  for (let y = 0; y < OH; y++) {
    for (let x = 0; x < OW; x++) {
      const z = h6 * x + h7 * y + 1;
      const fx = (h0 * x + h1 * y + h2) / z, fy = (h3 * x + h4 * y + h5) / z;
      const o = (y * OW + x) * 4;
      if (fx < 0 || fy < 0 || fx > sw - 1 || fy > sh - 1) { od[o] = 17; od[o + 1] = 17; od[o + 2] = 17; od[o + 3] = 255; continue; }
      // 雙線性內插
      const x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = sd[i00 + ch] + (sd[i10 + ch] - sd[i00 + ch]) * ax;
        const bot = sd[i01 + ch] + (sd[i11 + ch] - sd[i01 + ch]) * ax;
        od[o + ch] = top + (bot - top) * ay;
      }
      od[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return { canvas: out, rect: { x: m, y: m, w: cardW, h: cardH } };
}

// 預設四邊形：取景框（或圖片中間 80%）
export function defaultQuad(src, rect) {
  const { w, h } = sizeOf(src);
  const r = rect || (() => {
    const ch = h * 0.8, cw = Math.min(w * 0.8, ch * RATIO);
    return { x: (w - cw) / 2, y: (h - cw / RATIO) / 2, w: cw, h: cw / RATIO };
  })();
  return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
}

// ───────── 小工具 ─────────
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// 依照繞中心的角度排序：左上、右上、右下、左下
export function orderQuad(ps) {
  const cx = ps.reduce((s, p) => s + p.x, 0) / 4, cy = ps.reduce((s, p) => s + p.y, 0) / 4;
  const sorted = [...ps].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  // atan2 由 -180° 開始：左上大約 -135°；若第一個其實是左下（例如歪很多），找 x+y 最小的當左上
  let s = 0, min = Infinity;
  sorted.forEach((p, i) => { if (p.x + p.y < min) { min = p.x + p.y; s = i; } });
  return [0, 1, 2, 3].map((i) => sorted[(s + i) % 4]);
}
// 解 8 個未知數：把 from 的四個點對應到 to
function homography(from, to) {
  const A = [], B = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  // 高斯消去
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [B[c], B[p]] = [B[p], B[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      B[r] -= f * B[c];
    }
  }
  return B.map((b, i) => b / A[i][i]);
}
