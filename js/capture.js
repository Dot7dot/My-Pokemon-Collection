// 卡片拍照：PTCG 標準尺寸（63 × 88 mm）取景框 → 微調裁切 → 輸出 63:88 的卡片圖
import { layer, $, clamp, toast, pickFile } from './ui.js';
import { CARD_W, CARD_H, CARD_RATIO, loadBitmap, sizeOf, makeCanvas } from './image.js';

// 回傳 canvas（900 × 1257）或 null
export async function captureCard({ source = 'camera' } = {}) {
  if (source === 'camera') {
    const shot = await openCamera();
    if (!shot) return null;
    if (shot.file) return cropper(await loadBitmap(shot.file));
    return cropper(shot.bitmap, shot.rect);
  }
  const file = await pickFile(false);
  if (!file) return null;
  return cropper(await loadBitmap(file));
}

// 取景框在畫面上的大小（相機與裁切共用，讓兩邊看起來一樣）
function frameSize(box) {
  const maxW = box.width * 0.82, maxH = box.height * 0.62;
  const w = Math.min(maxW, maxH * CARD_RATIO, 520);
  return { w, h: w / CARD_RATIO };
}

function openCamera() {
  return new Promise((resolve) => {
    let stream = null, result = null;
    const el = layer(`<div class="cam" role="dialog" aria-label="拍攝卡片">
      <video class="cam-video" playsinline muted autoplay></video>
      <div class="cam-frame"><i class="cn tl"></i><i class="cn tr"></i><i class="cn bl"></i><i class="cn br"></i></div>
      <div class="cam-top">
        <button class="btn round dark" data-close aria-label="取消">✕</button>
        <p class="cam-hint">把卡片對準框線<br><small>PTCG 標準尺寸 63 × 88 mm · 平放、避開反光</small></p>
        <button class="btn round dark" data-torch aria-label="閃光燈" hidden>🔦</button>
      </div>
      <div class="cam-bottom">
        <button class="btn round dark" data-pick aria-label="從相簿選">🖼️</button>
        <button class="shutter" data-shot aria-label="拍照"></button>
        <span class="round-spacer"></span>
      </div>
      <p class="cam-msg" hidden></p>
    </div>`, {
      cls: 'full',
      onClose: () => { stream?.getTracks().forEach((t) => t.stop()); resolve(result); },
    });
    const video = $('.cam-video', el), frame = $('.cam-frame', el);
    const place = () => {
      const { w, h } = frameSize(el.getBoundingClientRect());
      frame.style.width = w + 'px';
      frame.style.height = h + 'px';
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);

    const fallback = (msg) => {
      const m = $('.cam-msg', el);
      m.hidden = false;
      m.innerHTML = `${msg}<br><button class="btn primary" data-native>用手機相機拍</button>`;
      $('[data-native]', m).onclick = async () => {
        const file = await pickFile(true);
        if (file) { result = { file }; el.close(); }
      };
    };

    if (!navigator.mediaDevices?.getUserMedia) {
      fallback('這個瀏覽器不能在網頁裡開相機（需要 HTTPS）。');
    } else {
      navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      }).then((s) => {
        stream = s;
        if (!el.isConnected) { s.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = s;
        video.play().catch(() => {});
        const track = s.getVideoTracks()[0];
        const caps = track.getCapabilities?.() || {};
        if (caps.torch) {
          let on = false;
          const b = $('[data-torch]', el);
          b.hidden = false;
          b.onclick = () => { on = !on; track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {}); b.classList.toggle('on', on); };
        }
        if (caps.focusMode?.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
      }).catch((err) => {
        fallback(err?.name === 'NotAllowedError' ? '沒有相機權限，請在瀏覽器設定允許使用相機。' : '打不開相機。');
      });
    }

    $('[data-pick]', el).onclick = async () => {
      const file = await pickFile(false);
      if (file) { result = { file }; el.close(); }
    };
    $('[data-shot]', el).onclick = async () => {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw) { toast('相機還沒準備好'); return; }
      // 把畫面上的取景框換算成影片的像素座標（影片是 object-fit: cover）
      const vr = video.getBoundingClientRect(), fr = frame.getBoundingClientRect();
      const s = Math.max(vr.width / vw, vr.height / vh);
      const ox = (vr.width - vw * s) / 2, oy = (vr.height - vh * s) / 2;
      const rect = {
        x: (fr.left - vr.left - ox) / s, y: (fr.top - vr.top - oy) / s,
        w: fr.width / s, h: fr.height / s,
      };
      const c = makeCanvas(vw, vh);
      c.getContext('2d').drawImage(video, 0, 0);
      el.classList.add('flash');
      result = { bitmap: c, rect };
      ro.disconnect();
      setTimeout(() => el.close(), 120);
    };
  });
}

// 裁切：拖曳移動、雙指／滾輪縮放、旋轉 90°、微調角度
function cropper(img, rect) {
  return new Promise((resolve) => {
    let out = null;
    const { w: iw, h: ih } = sizeOf(img);
    const el = layer(`<div class="crop" role="dialog" aria-label="調整卡片範圍">
      <div class="crop-stage"><div class="crop-img"></div><div class="crop-frame"></div></div>
      <div class="crop-top">
        <button class="btn round dark" data-close aria-label="取消">✕</button>
        <p class="cam-hint">拖曳、縮放，讓卡片剛好填滿框線</p>
        <button class="btn round dark" data-rot aria-label="旋轉 90 度">⟳</button>
      </div>
      <div class="crop-bottom">
        <label class="tilt-row">角度微調 <input type="range" min="-12" max="12" step="0.1" value="0" data-fine></label>
        <div class="row-btns">
          <button class="btn ghost light" data-reset>重設</button>
          <button class="btn primary" data-ok>使用這張</button>
        </div>
      </div>
    </div>`, { cls: 'full', onClose: () => resolve(out) });

    const stage = $('.crop-stage', el), frameEl = $('.crop-frame', el), holder = $('.crop-img', el);
    const view = img instanceof HTMLCanvasElement ? img : (() => { const c = makeCanvas(iw, ih); c.getContext('2d').drawImage(img, 0, 0); return c; })();
    view.className = 'crop-canvas';
    holder.append(view);

    let F = { w: 1, h: 1 };
    const st = { tx: 0, ty: 0, s: 1, rot: 0, fine: 0 };
    const angle = () => (st.rot + st.fine) * Math.PI / 180;
    const fit = () => {
      // 沒有相機取景資料：讓照片蓋滿取景框
      const rotated = st.rot % 180 !== 0;
      const w = rotated ? ih : iw, h = rotated ? iw : ih;
      st.s = Math.max(F.w / w, F.h / h);
      st.tx = 0; st.ty = 0;
    };
    const fromRect = () => {
      st.s = F.w / rect.w;
      st.tx = (iw / 2 - (rect.x + rect.w / 2)) * st.s;
      st.ty = (ih / 2 - (rect.y + rect.h / 2)) * st.s;
    };
    const draw = () => {
      view.style.transform = `translate(-50%, -50%) translate(${st.tx}px, ${st.ty}px) rotate(${angle()}rad) scale(${st.s})`;
    };
    const layout = (reset) => {
      const prev = F.w;
      F = frameSize(stage.getBoundingClientRect());
      frameEl.style.width = F.w + 'px';
      frameEl.style.height = F.h + 'px';
      if (reset) { st.rot = 0; st.fine = 0; $('[data-fine]', el).value = 0; rect ? fromRect() : fit(); }
      else if (prev !== F.w) { const k = F.w / prev; st.s *= k; st.tx *= k; st.ty *= k; }
      draw();
    };
    layout(true);
    const ro = new ResizeObserver(() => layout(false));
    ro.observe(stage);

    // 手勢
    const pts = new Map();
    let last = null;
    const snapshot = () => {
      const p = [...pts.values()];
      if (p.length === 1) return { x: p[0].x, y: p[0].y, d: 0 };
      return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) };
    };
    const minS = () => Math.min(F.w / iw, F.h / ih) * 0.5;
    const zoomAt = (k, cx, cy) => {
      const r = stage.getBoundingClientRect();
      const px = cx - (r.left + r.width / 2), py = cy - (r.top + r.height / 2);
      const ns = clamp(st.s * k, minS(), 12);
      k = ns / st.s;
      st.tx = px - (px - st.tx) * k;
      st.ty = py - (py - st.ty) * k;
      st.s = ns;
    };
    stage.addEventListener('pointerdown', (e) => {
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last = snapshot();
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const now = snapshot();
      if (last && pts.size === (last.d ? 2 : 1)) {
        st.tx += now.x - last.x;
        st.ty += now.y - last.y;
        if (now.d && last.d) zoomAt(now.d / last.d, now.x, now.y);
        draw();
      }
      last = now;
    });
    const up = (e) => { pts.delete(e.pointerId); last = pts.size ? snapshot() : null; };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); draw(); }, { passive: false });

    $('[data-rot]', el).onclick = () => { st.rot = (st.rot + 90) % 360; const k = st.tx; st.tx = -st.ty; st.ty = k; fit(); draw(); };
    $('[data-fine]', el).oninput = (e) => { st.fine = +e.target.value; draw(); };
    $('[data-reset]', el).onclick = () => layout(true);
    $('[data-ok]', el).onclick = () => {
      // 依照畫面上的變換，把取景框內的範圍畫到 900 × 1257 的畫布
      const c = makeCanvas(CARD_W, CARD_H);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, CARD_W, CARD_H);
      ctx.imageSmoothingQuality = 'high';
      const k = CARD_W / F.w;
      ctx.translate(CARD_W / 2, CARD_H / 2);
      ctx.scale(k, k);
      ctx.translate(st.tx, st.ty);
      ctx.rotate(angle());
      ctx.scale(st.s, st.s);
      ctx.drawImage(view, -iw / 2, -ih / 2);
      out = c;
      ro.disconnect();
      el.close();
    };
  });
}
