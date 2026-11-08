// 卡片自動對齊：找出照片裡卡片的四個角，再用透視校正把卡片「拉正」。
// 做法（不靠外部函式庫）：
//   1. 縮小成最長邊 640 的灰階圖，模糊去雜訊
//   2. Sobel 算邊緣強度與方向，非極大值抑制留下細邊
//   3. 霍夫轉換找直線（每個邊緣點只投票給跟它梯度方向接近的角度，比較快也比較準）
//   4. 取「接近直的」與「接近橫的」兩組線，兩兩配對成四邊形
//   5. 依「四條邊上有多少邊緣點」「面積」「長寬比接近 63:88」打分數，取最高分
import { sizeOf, makeCanvas } from './image.js';

const RATIO = 63 / 88;
const DEG = Math.PI / 180;

// 回傳卡片四個角 [左上, 右上, 右下, 左下]（原圖像素座標），找不到回傳 null
// region：只在這個範圍裡找（相機取景框附近），可省略；portrait：只接受直的卡片
export function detectCard(src, region, { portrait = false } = {}) {
  const { w: SW, h: SH } = sizeOf(src);
  const R = region ? clipRect(region, SW, SH) : { x: 0, y: 0, w: SW, h: SH };
  if (R.w < 40 || R.h < 40) return null;
  const k = Math.min(1, 640 / Math.max(R.w, R.h));
  const W = Math.max(8, Math.round(R.w * k)), H = Math.max(8, Math.round(R.h * k));
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, R.x, R.y, R.w, R.h, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;

  // 灰階＋模糊
  let g = new Float32Array(W * H);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];
  g = boxBlur(boxBlur(g, W, H, 1), W, H, 1);

  // Sobel
  const mag = new Float32Array(W * H), gxA = new Float32Array(W * H), gyA = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = -g[i - W - 1] - 2 * g[i - 1] - g[i + W - 1] + g[i - W + 1] + 2 * g[i + 1] + g[i + W + 1];
      const gy = -g[i - W - 1] - 2 * g[i - W] - g[i - W + 1] + g[i + W - 1] + 2 * g[i + W] + g[i + W + 1];
      gxA[i] = gx; gyA[i] = gy;
      mag[i] = Math.hypot(gx, gy);
    }
  }
  // 非極大值抑制
  const nms = new Float32Array(W * H);
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x, m = mag[i];
      if (m < 8) continue;
      const a = Math.atan2(gyA[i], gxA[i]);
      const dx = Math.round(Math.cos(a)), dy = Math.round(Math.sin(a));
      if (m >= mag[i + dy * W + dx] && m >= mag[i - dy * W - dx]) nms[i] = m;
    }
  }
  // 雙門檻（Canny 的滯後門檻）：強邊緣一定留，弱邊緣只要接到強邊緣也留，邊線比較完整
  const vals = [];
  for (let i = 0; i < nms.length; i++) if (nms[i] > 0) vals.push(nms[i]);
  if (vals.length < 50) return null;
  vals.sort((a, b) => a - b);
  const thr = Math.min(40, Math.max(24, vals[Math.floor(vals.length * 0.5)])), low = 10;
  const edge = new Uint8Array(W * H);
  const pts = [], stack = [];
  for (let i = 0; i < nms.length; i++) if (nms[i] >= thr) { edge[i] = 1; pts.push(i); stack.push(i); }
  while (stack.length) {
    const i = stack.pop();
    for (const o of [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1]) {
      const j = i + o;
      if (j > 0 && j < nms.length && !edge[j] && nms[j] >= low) { edge[j] = 1; pts.push(j); stack.push(j); }
    }
  }

  // 霍夫轉換：x·cosθ + y·sinθ = ρ，θ 0~179°
  const diag = Math.ceil(Math.hypot(W, H)), NR = diag * 2 + 1, NT = 180;
  const acc = new Uint16Array(NT * NR);
  const cos = new Float32Array(NT), sin = new Float32Array(NT);
  for (let t = 0; t < NT; t++) { cos[t] = Math.cos(t * DEG); sin[t] = Math.sin(t * DEG); }
  for (const i of pts) {
    const x = i % W, y = (i / W) | 0;
    let t0 = Math.round(Math.atan2(gyA[i], gxA[i]) / DEG);
    t0 = ((t0 % 180) + 180) % 180;
    for (let d = -10; d <= 10; d++) {
      const t = (t0 + d + 180) % 180;
      const r = Math.round(x * cos[t] + y * sin[t]) + diag;
      acc[t * NR + r]++;
    }
  }
  // 找峰值（附近範圍內最大，且票數夠多）
  const minVotes = Math.max(20, Math.min(W, H) * 0.12);
  const peaks = [];
  for (let t = 0; t < NT; t++) {
    for (let r = 0; r < NR; r++) {
      const v = acc[t * NR + r];
      if (v < minVotes) continue;
      let isMax = true;
      for (let dt = -3; dt <= 3 && isMax; dt++) {
        const tt = (t + dt + NT) % NT;
        for (let dr = -4; dr <= 4; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= NR || (dt === 0 && dr === 0)) continue;
          const u = acc[tt * NR + rr];
          if (u > v || (u === v && (dt < 0 || (dt === 0 && dr < 0)))) { isMax = false; break; }
        }
      }
      if (isMax) peaks.push({ t, r: r - diag, v });
    }
  }
  peaks.sort((a, b) => b.v - a.v);
  // 同一條線附近的重複峰值拿掉；分成「接近直的」與「接近橫的」兩組
  const vert = [], hori = [], MAXL = 56;
  for (const p of peaks) {
    const group = p.t < 40 || p.t > 140 ? vert : p.t > 50 && p.t < 130 ? hori : null;
    if (!group || group.length >= MAXL) continue;
    if (group.some((q) => angDiff(p.t, q.t) < 4 && Math.abs(p.r - q.r * (Math.abs(p.t - q.t) > 90 ? -1 : 1)) < 7)) continue;
    group.push(p);
    if (vert.length >= MAXL && hori.length >= MAXL) break;
  }
  if (vert.length < 2 || hori.length < 2) return null;

  // 每個邊緣點的方向（0~179°）；沒有邊緣是 -1
  const ori = new Int16Array(W * H).fill(-1);
  for (const i of pts) ori[i] = ((Math.round(Math.atan2(gyA[i], gxA[i]) / DEG) % 360) + 360) % 360;
  // 沿著每條線走一遍，記下每一點「附近有沒有方向一致的邊緣」，做成累加表，
  // 之後任何一段線段的支持度都能 O(1) 算出來。桌面紋路、條紋的方向不同就不算。
  for (const l of [...vert, ...hori]) {
    const ct = Math.cos(l.t * DEG), st = Math.sin(l.t * DEG);
    l.ox = l.r * ct; l.oy = l.r * st; l.dx = -st; l.dy = ct;
    const n = 2 * diag + 1;
    // 正、負兩種明暗方向分開算：真的卡片邊整條都是同一種（例如卡框比桌面亮），
    // 格子布、條紋布的線則一段亮一段暗
    const pos = new Uint16Array(n + 1), neg = new Uint16Array(n + 1), ins = new Uint16Array(n + 1);
    for (let j = 0; j < n; j++) {
      const sPos = j - diag, cx = l.ox + l.dx * sPos, cy = l.oy + l.dy * sPos;
      let hp = 0, hn = 0, inside = 0;
      if (cx >= 0 && cy >= 0 && cx < W && cy < H) {
        inside = 1;
        for (let o = -3; o <= 3 && !hp && !hn; o++) {
          const x = Math.round(cx + ct * o), y = Math.round(cy + st * o);
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const d = ori[y * W + x];
          if (d < 0) continue;
          const diff = Math.abs(((d - l.t) % 360 + 540) % 360 - 180); // 0 = 同向，180 = 反向
          if (diff > 162) hp = 1; else if (diff < 18) hn = 1;
        }
      }
      pos[j + 1] = pos[j] + hp;
      neg[j + 1] = neg[j] + hn;
      ins[j + 1] = ins[j] + inside;
    }
    l.pos = pos; l.neg = neg; l.ins = ins;
  }
  const along = (l, p) => (p.x - l.ox) * l.dx + (p.y - l.oy) * l.dy;
  // 線 l 上 p1 到 p2 這段，有多少比例是邊緣（頭尾各去掉 6%，避開圓角）
  const support = (l, p1, p2) => {
    let s1 = along(l, p1), s2 = along(l, p2);
    if (s1 > s2) [s1, s2] = [s2, s1];
    const len = s2 - s1;
    if (len < 8) return 0;
    const j1 = Math.max(0, Math.min(2 * diag, Math.round(s1 + len * 0.06) + diag));
    const j2 = Math.max(0, Math.min(2 * diag, Math.round(s2 - len * 0.06) + diag));
    const inside = l.ins[j2 + 1] - l.ins[j1];
    if (inside < (j2 - j1 + 1) * 0.6) return 0;
    return Math.max(l.pos[j2 + 1] - l.pos[j1], l.neg[j2 + 1] - l.neg[j1]) / inside;
  };

  let best = null;
  const good = [];
  const area0 = W * H;
  // 先算好每一條直線和橫線的交點，以及交點在兩條線上的位置（手機上也要夠快）
  const NV = vert.length, NH = hori.length;
  const P = new Array(NV * NH);
  for (let a = 0; a < NV; a++) for (let c = 0; c < NH; c++) {
    const pt = cross(vert[a], hori[c]);
    P[a * NH + c] = pt && pt.x > -0.04 * W && pt.y > -0.04 * H && pt.x < 1.04 * W && pt.y < 1.04 * H ? pt : null;
  }
  for (let a = 0; a < NV; a++) for (let b = a + 1; b < NV; b++) {
    const La = vert[a], Lb = vert[b];
    for (let c2 = 0; c2 < NH; c2++) {
      const A = P[a * NH + c2], C = P[b * NH + c2];
      if (!A || !C) continue;
      const s3 = support(hori[c2], A, C);
      if (s3 < 0.55) continue;
      for (let d = c2 + 1; d < NH; d++) {
        const B = P[a * NH + d], D = P[b * NH + d];
        if (!B || !D) continue;
        // 先看四條邊有沒有邊緣支持（最便宜，也刷掉最多）
        const s1 = support(La, A, B);
        if (s1 < 0.55) continue;
        const s2 = support(Lb, C, D);
        if (s2 < 0.55) continue;
        const s4 = support(hori[d], B, D);
        if (s4 < 0.55) continue;
        const sA = dist(A, B), sB = dist(C, D), sC = dist(A, C), sD = dist(B, D);
        if (Math.min(sA, sB) / Math.max(sA, sB) < 0.65 || Math.min(sC, sD) / Math.max(sC, sD) < 0.65) continue;
        const w1 = (sA + sB) / 2, w2 = (sC + sD) / 2;
        const off = Math.abs(Math.min(w1, w2) / Math.max(w1, w2) - RATIO);
        if (off > 0.16 || (portrait && w2 > w1)) continue; // w1：直線邊長（高），w2：橫線邊長（寬）
        const q = orderQuad([A, B, C, D]);
        if (!convex(q)) continue;
        const area = polyArea(q) / area0;
        if (area < 0.08) continue;
        const minS = Math.min(s1, s2, s3, s4), meanS = (s1 + s2 + s3 + s4) / 4;
        const score = (0.4 * meanS + 0.6 * minS) * Math.sqrt(area) * (1 - 1.8 * off);
        good.push({ score, q, area, minS, off });
        if (!best || score > best.score) best = good[good.length - 1];
      }
    }
  }
  // 卡片通常有內框：在「也很像卡片、而且把最佳結果整個包住」的四邊形裡選最大的
  if (best) {
    let outer = best;
    for (const g2 of good) {
      if (g2.area <= outer.area || g2.minS < 0.75 || g2.score < best.score * 0.5 || g2.off > best.off + 0.05) continue;
      if (best.q.every((p) => inside(g2.q, p))) outer = g2;
    }
    best = outer;
  }
  if (!best) return null;
  return best.q.map((p) => ({ x: R.x + p.x / k, y: R.y + p.y / k }));
}

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
function clipRect(r, W, H) {
  const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
  return { x, y, w: Math.min(W, Math.round(r.x + r.w)) - x, h: Math.min(H, Math.round(r.y + r.h)) - y };
}
function boxBlur(src, W, H, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H), n = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[y * W + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = s / n;
      s += src[y * W + Math.min(W - 1, x + r + 1)] - src[y * W + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = s / n;
      s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  return out;
}
const angDiff = (a, b) => { const d = Math.abs(a - b) % 180; return Math.min(d, 180 - d); };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function cross(l1, l2) {
  const a1 = Math.cos(l1.t * DEG), b1 = Math.sin(l1.t * DEG), a2 = Math.cos(l2.t * DEG), b2 = Math.sin(l2.t * DEG);
  const det = a1 * b2 - a2 * b1;
  if (Math.abs(det) < 1e-6) return null;
  return { x: (l1.r * b2 - l2.r * b1) / det, y: (a1 * l2.r - a2 * l1.r) / det };
}
// 依照繞中心的角度排序：左上、右上、右下、左下
export function orderQuad(ps) {
  const cx = ps.reduce((s, p) => s + p.x, 0) / 4, cy = ps.reduce((s, p) => s + p.y, 0) / 4;
  const sorted = [...ps].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  // atan2 由 -180° 開始：左上大約 -135°；若第一個其實是左下（例如歪很多），找 x+y 最小的當左上
  let s = 0, min = Infinity;
  sorted.forEach((p, i) => { if (p.x + p.y < min) { min = p.x + p.y; s = i; } });
  return [0, 1, 2, 3].map((i) => sorted[(s + i) % 4]);
}
// p 是否在凸四邊形 q 裡（含一點點邊界）
function inside(q, p) {
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < -1) return false;
  }
  return true;
}
function convex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-9) return false;
    if (!sign) sign = Math.sign(z); else if (Math.sign(z) !== sign) return false;
  }
  return true;
}
function polyArea(q) {
  let s = 0;
  for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; s += a.x * b.y - b.x * a.y; }
  return Math.abs(s) / 2;
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
