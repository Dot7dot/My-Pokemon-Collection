// 自製收藏卡（模型、色違）：最上面是名稱、上半部是照片、下半部是介紹。
// 新增時直接出現一張空白卡片，照片框裡就是相機畫面，名稱和介紹直接在卡片上打字。
import { layer, $, $$, esc, pad, clamp, toast, pickFile } from './ui.js';
import { loadBitmap, sizeOf, makeCanvas, toBlob, resized } from './image.js';
import { FINISHES } from './card3d.js';

export const MADE_CATS = new Set(['figure', 'shiny']);
export const PHOTO_W = 1200, PHOTO_H = 900; // 照片框 4:3
const BADGE = { figure: '🧸 模型', shiny: '✨ 色違' };
export const DEFAULT_FINISH = { figure: 'plain', shiny: 'sparkle' };

// 字數越多字越小，讓介紹盡量放得下
const titleSize = (t) => { const n = [...(t || '')].length; return n > 12 ? 's3' : n > 8 ? 's2' : 's1'; };
const descSize = (t) => { const n = [...(t || '')].length + (t || '').split('\n').length * 8; return n > 130 ? 's3' : n > 70 ? 's2' : 's1'; };
const fmtDate = (ms) => { const d = new Date(ms || Date.now()); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };

// info：{ id, zh, typeText, t1, t2 }
export function madeCardFace({ cat, info, title, note, photo, created }, { editable = false } = {}) {
  const t = title ?? info.title ?? info.zh;
  return `<div class="mcard mc-${cat}" style="--t1:${info.t1};--t2:${info.t2}">
    <div class="mc-inner">
      <div class="mc-head">
        ${editable
          ? `<input class="mc-title ${titleSize(t)}" value="${esc(t)}" maxlength="24" placeholder="名稱" aria-label="卡片名稱" enterkeyhint="next">`
          : `<span class="mc-title ${titleSize(t)}">${esc(t)}</span>`}
        <span class="mc-badge">${BADGE[cat]}</span>
      </div>
      <div class="mc-photo">${photo ? `<img src="${esc(photo)}" alt="" draggable="false">` : editable ? '' : '<span class="mc-nophoto">沒有照片</span>'}</div>
      <div class="mc-strip">No.${pad(info.id)} ${esc(info.zh)}${info.formName ? ` · ${esc(info.formName)}` : ''} · ${esc(info.typeText)}</div>
      ${editable
        ? `<textarea class="mc-desc ${descSize(note)}" maxlength="300" placeholder="在這裡寫介紹…（在哪裡買的、什麼時候抓到、心得…）" aria-label="介紹">${esc(note || '')}</textarea>`
        : `<div class="mc-desc ${descSize(note)}">${esc(note || '')}</div>`}
      <div class="mc-foot"><span>MY POKÉMON COLLECTION</span><span>${fmtDate(created)}</span></div>
    </div>
  </div>`;
}

// ───────── 編輯器 ─────────
// 回傳 { title, note, finish, blobs? }（blobs 只有換了照片或調整過位置時才有）；取消回傳 null
export function openMadeEditor({ cat, info, item, photoURL }) {
  return new Promise((resolve) => {
    let out = null;
    let stream = null, facing = 'environment';
    let src = null;           // 目前照片（canvas 或 bitmap）
    let photoDirty = false;
    let finish = item?.finish || DEFAULT_FINISH[cat];
    const st = { z: 1, nx: 0, ny: 0 }; // 縮放（相對於剛好蓋滿）與位移（相對於框寬）

    const el = layer(`<div class="mce" role="dialog" aria-label="編輯收藏卡">
      <div class="mce-top">
        <button class="btn round dark" data-close aria-label="取消">✕</button>
        <span class="mce-heading">${item ? '編輯' : '新增'}${BADGE[cat].slice(2)}卡片</span>
        <button class="btn primary" data-done>完成</button>
      </div>
      <div class="mce-card">${madeCardFace({ cat, info, title: item?.title, note: item?.note, created: item?.created }, { editable: true })}</div>
      <div class="mce-tools"></div>
      <p class="mce-hint"></p>
      <div class="finish-row dark" role="radiogroup" aria-label="卡面效果">${Object.entries(FINISHES).map(([k, f]) => `<button class="finish ${k === finish ? 'on' : ''}" data-finish="${k}" role="radio">${f.label}</button>`).join('')}</div>
    </div>`, { cls: 'full dark-layer scroll', onClose: () => { stopCam(); resolve(out); } });

    const win = $('.mc-photo', el), tools = $('.mce-tools', el), hint = $('.mce-hint', el);
    const titleEl = $('.mc-title', el), descEl = $('.mc-desc', el);
    titleEl.addEventListener('input', () => { titleEl.className = 'mc-title ' + titleSize(titleEl.value); });
    titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); descEl.focus(); } });
    descEl.addEventListener('input', () => { descEl.className = 'mc-desc ' + descSize(descEl.value); });

    function stopCam() { stream?.getTracks().forEach((t) => t.stop()); stream = null; }

    const setTools = (mode) => {
      if (mode === 'live') {
        tools.innerHTML = `<button class="btn round dark" data-pick aria-label="從相簿選">🖼️</button>
          <button class="shutter small" data-shot aria-label="拍照"></button>
          <button class="btn round dark" data-switch aria-label="切換前後鏡頭">🔄</button>`;
        hint.textContent = '對準收藏按下快門，名稱和介紹直接點卡片上的字修改';
      } else if (mode === 'photo') {
        tools.innerHTML = `<button class="btn chip-btn" data-retake>📷 重拍</button><button class="btn chip-btn" data-pick>🖼️ 換照片</button>`;
        hint.textContent = '在照片上拖曳、雙指縮放可以調整位置';
      } else {
        tools.innerHTML = `<button class="btn chip-btn" data-native>📷 拍照</button><button class="btn chip-btn" data-pick>🖼️ 上傳照片</button>`;
        hint.textContent = '名稱和介紹直接點卡片上的字修改';
      }
    };

    // 照片框：相機畫面
    async function startCam() {
      stopCam();
      src = null;
      win.innerHTML = '<video class="mc-video" playsinline muted autoplay></video>';
      const video = $('video', win);
      video.classList.toggle('mirror', facing === 'user');
      setTools('live');
      if (!navigator.mediaDevices?.getUserMedia) { showEmpty('這個瀏覽器不能在網頁裡開相機'); return; }
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 2560 }, height: { ideal: 1920 } },
        });
        if (!el.isConnected || !win.contains(video)) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        video.srcObject = s;
        video.play().catch(() => {});
      } catch (err) {
        showEmpty(err?.name === 'NotAllowedError' ? '沒有相機權限，可以改用下面的按鈕' : '打不開相機，可以改用下面的按鈕');
      }
    }
    function showEmpty(msg) {
      stopCam();
      src = null;
      win.innerHTML = `<button class="mc-empty" data-native><span>📷</span>${esc(msg || '點這裡拍照')}</button>`;
      setTools('empty');
    }

    // 照片框：可拖曳縮放的照片
    function showPhoto(img, { dirty = true } = {}) {
      stopCam();
      src = img;
      photoDirty = dirty;
      st.z = 1; st.nx = 0; st.ny = 0;
      const { w, h } = sizeOf(img);
      const c = img instanceof HTMLCanvasElement ? img : (() => { const k = makeCanvas(w, h); k.getContext('2d').drawImage(img, 0, 0); return k; })();
      c.className = 'mc-canvas';
      win.innerHTML = '';
      win.append(c);
      draw();
      setTools('photo');
    }
    const cover = () => { const { w, h } = sizeOf(src); const r = win.getBoundingClientRect(); return Math.max(r.width / w, r.height / h); };
    function limit() {
      const { w, h } = sizeOf(src), r = win.getBoundingClientRect();
      const s = cover() * st.z;
      const mx = Math.max(0, (w * s - r.width) / 2) / r.width, my = Math.max(0, (h * s - r.height) / 2) / r.width;
      st.nx = clamp(st.nx, -mx, mx);
      st.ny = clamp(st.ny, -my, my);
    }
    function draw() {
      const c = $('.mc-canvas', win);
      if (!c || !src) return;
      limit();
      const r = win.getBoundingClientRect();
      c.style.transform = `translate(-50%, -50%) translate(${st.nx * r.width}px, ${st.ny * r.width}px) scale(${cover() * st.z})`;
    }
    new ResizeObserver(draw).observe(win);

    // 照片拖曳／縮放
    const pts = new Map();
    let last = null;
    const snap = () => {
      const p = [...pts.values()];
      return p.length === 1 ? { x: p[0].x, y: p[0].y, d: 0 } : { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) };
    };
    win.addEventListener('pointerdown', (e) => {
      if (!src) return;
      win.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last = snap();
    });
    win.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const now = snap(), W = win.getBoundingClientRect().width;
      if (last && pts.size === (last.d ? 2 : 1)) {
        st.nx += (now.x - last.x) / W;
        st.ny += (now.y - last.y) / W;
        if (now.d && last.d) st.z = clamp(st.z * now.d / last.d, 1, 6);
        photoDirty = true;
        draw();
      }
      last = now;
    });
    const up = (e) => { pts.delete(e.pointerId); last = pts.size ? snap() : null; };
    win.addEventListener('pointerup', up);
    win.addEventListener('pointercancel', up);
    win.addEventListener('wheel', (e) => { if (!src) return; e.preventDefault(); st.z = clamp(st.z * Math.exp(-e.deltaY * 0.0015), 1, 6); photoDirty = true; draw(); }, { passive: false });

    const fromFile = async (capture) => {
      const file = await pickFile(capture);
      if (!file) return;
      try { showPhoto(await loadBitmap(file)); } catch { toast('讀取照片失敗'); }
    };

    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.finish) { finish = b.dataset.finish; $$('.finish', el).forEach((x) => x.classList.toggle('on', x === b)); return; }
      if (b.hasAttribute('data-shot')) {
        const video = $('video', win);
        const vw = video?.videoWidth, vh = video?.videoHeight;
        if (!vw) { toast('相機還沒準備好'); return; }
        const c = makeCanvas(vw, vh), ctx = c.getContext('2d');
        if (facing === 'user') { ctx.translate(vw, 0); ctx.scale(-1, 1); }
        ctx.drawImage(video, 0, 0);
        win.classList.add('flash');
        setTimeout(() => win.classList.remove('flash'), 300);
        showPhoto(c);
      }
      if (b.hasAttribute('data-switch')) { facing = facing === 'user' ? 'environment' : 'user'; startCam(); }
      if (b.hasAttribute('data-retake')) startCam();
      if (b.hasAttribute('data-pick')) fromFile(false);
      if (b.hasAttribute('data-native')) fromFile(true);
      if (b.hasAttribute('data-done')) {
        if (!src) { toast('先拍一張照片或上傳照片'); return; }
        let blobs = null;
        if (photoDirty) {
          const c = makeCanvas(PHOTO_W, PHOTO_H), ctx = c.getContext('2d');
          const r = win.getBoundingClientRect(), k = PHOTO_W / r.width, s = cover() * st.z;
          const { w, h } = sizeOf(src);
          ctx.imageSmoothingQuality = 'high';
          ctx.translate(PHOTO_W / 2, PHOTO_H / 2);
          ctx.scale(k, k);
          ctx.translate(st.nx * r.width, st.ny * r.width);
          ctx.scale(s, s);
          ctx.drawImage($('.mc-canvas', win), -w / 2, -h / 2);
          blobs = { full: await toBlob(c, 0.9), thumb: (await resized(c, 480, 0.82)).blob };
        }
        out = { title: titleEl.value.trim() || info.title || info.zh, note: descEl.value.trim(), finish, blobs };
        el.close();
      }
    });

    // 一開始：新增就開相機，編輯就放原本的照片
    if (photoURL) loadBitmap(photoURL).then((img) => showPhoto(img, { dirty: false })).catch(() => startCam());
    else startCam();
  });
}

// ───────── 存成圖片 ─────────
// 用 canvas 照著 CSS 的比例重畫一張卡（寬 900，1 單位 = 卡寬的 1%）
export async function renderMadeCard({ cat, info, title, note, created }, photoURL) {
  const W = 900, H = Math.round(W * 88 / 63), u = W / 100;
  const c = makeCanvas(W, H), x = c.getContext('2d');
  const rr = (l, t, w, h, r) => { x.beginPath(); x.roundRect(l, t, w, h, r); };
  // 外框
  const g = x.createLinearGradient(0, 0, W, H);
  if (cat === 'shiny') ['#e6e9f2', '#f6d8ff', '#cfefff', '#fff2c4', '#e6e9f2'].forEach((col, i, a) => g.addColorStop(i / (a.length - 1), col));
  else { g.addColorStop(0, info.t1); g.addColorStop(1, info.t2); }
  x.fillStyle = g; rr(0, 0, W, H, 4.6 * u); x.fill();
  // 內框
  const ins = 3.5 * u;
  x.fillStyle = '#fbf6ea'; rr(ins, ins, W - 2 * ins, H - 2 * ins, 2.6 * u); x.fill();
  const L = ins + 3 * u, CW = W - 2 * L;
  let y = ins + 2.6 * u;
  const font = (px, weight = 400) => `${weight} ${px}px system-ui, -apple-system, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
  // 名稱＋標籤
  x.font = font(3.6 * u, 700);
  const badge = BADGE[cat], bw = x.measureText(badge).width + 3.6 * u;
  x.fillStyle = cat === 'shiny' ? '#8b3fd1' : '#c77700';
  rr(L + CW - bw, y + 2.2 * u, bw, 6.4 * u, 3.2 * u); x.fill();
  x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.fillText(badge, L + CW - bw + 1.8 * u, y + 5.5 * u);
  const ts = { s1: 7, s2: 5.8, s3: 4.8 }[titleSize(title)];
  x.font = font(ts * u, 800); x.fillStyle = '#23212a';
  x.fillText(title, L, y + 5.5 * u, CW - bw - 2 * u);
  y += 11 * u + 2 * u;
  // 照片
  const ph = CW * 3 / 4;
  x.save(); rr(L, y, CW, ph, 1.6 * u); x.clip();
  x.fillStyle = '#d9d4c8'; x.fillRect(L, y, CW, ph);
  if (photoURL) { const img = await loadBitmap(photoURL); x.drawImage(img, L, y, CW, ph); }
  x.restore();
  x.strokeStyle = 'rgba(0,0,0,.18)'; x.lineWidth = 0.5 * u; rr(L, y, CW, ph, 1.6 * u); x.stroke();
  y += ph + 2 * u;
  // 資訊條
  x.font = font(3 * u, 600); x.fillStyle = '#6c6876'; x.textAlign = 'center';
  x.fillText(`No.${pad(info.id)} ${info.zh}${info.formName ? ` · ${info.formName}` : ''} · ${info.typeText}`, W / 2, y + 2.6 * u, CW);
  x.textAlign = 'left';
  y += 6 * u + 2 * u;
  // 介紹（自動換行）
  const ds = { s1: 4.6, s2: 4, s3: 3.4 }[descSize(note)] * u, lh = ds * 1.45;
  x.font = font(ds); x.fillStyle = '#33303a'; x.textBaseline = 'top';
  const bottom = H - ins - 2.6 * u - 5 * u - 1 * u;
  const lines = [];
  for (const para of (note || '').split('\n')) {
    let line = '';
    for (const tok of para.match(/[⺀-鿿豈-﫿＀-￯　-〿]|[^\s⺀-鿿豈-﫿＀-￯　-〿]+|\s+/g) || []) {
      // 標點不放在行首（避頭點）
      if (x.measureText(line + tok).width > CW && line && !/^[，。、！？：；）」』…,.!?:;)]/.test(tok)) { lines.push(line); line = tok.trimStart(); } else line += tok;
    }
    lines.push(line);
  }
  const max = Math.floor((bottom - y) / lh);
  lines.slice(0, max).forEach((ln, i) => x.fillText(i === max - 1 && lines.length > max ? ln.slice(0, -1) + '…' : ln, L, y + i * lh));
  // 底部
  x.font = font(2.6 * u, 600); x.fillStyle = '#9a9488'; x.textBaseline = 'middle';
  const fy = H - ins - 2.6 * u - 2.5 * u;
  x.fillText('MY POKÉMON COLLECTION', L, fy);
  x.textAlign = 'right'; x.fillText(fmtDate(created), L + CW, fy);
  return toBlob(c, 0.92);
}
