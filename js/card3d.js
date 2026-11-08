// 立體卡片：拖曳／陀螺儀傾斜、跟著角度移動的反光與閃卡效果、翻面
// 互動方式參考 CardKing 的卡牌詳情（按住拖曳看反光），再加上厚度、彈簧回正、陀螺儀。
import { clamp, esc } from './ui.js';

export const FINISHES = {
  holo: { label: '彩虹閃卡' },
  gold: { label: '金屬亮面' },
  sparkle: { label: '星塵閃' },
  plain: { label: '一般' },
};

// front：卡片正面的內容（照片或自製卡面）
export function cardShell(front, finish = 'holo', { big = false } = {}) {
  const f = FINISHES[finish] ? finish : 'holo';
  const edges = big ? Array.from({ length: 6 }, (_, i) => `<i class="c3-edge" style="--z:${(i - 2.5) * 0.45}px"></i>`).join('') : '';
  return `<div class="card3d f-${f}${big ? ' big' : ''}">
    <div class="c3-rot">
      ${edges}
      <div class="c3-back"><span class="c3-back-ball"></span><span class="c3-back-word">MY COLLECTION</span></div>
      <div class="c3-front">
        ${front}
        <div class="c3-holo"></div>
        <div class="c3-glare"></div>
      </div>
    </div>
  </div>`;
}

export const cardHTML = (src, finish, opts) => cardShell(`<img src="${esc(src)}" alt="" draggable="false">`, finish, opts);

// 陀螺儀權限：整個頁面只問一次，之後每張卡直接沿用。
// iPhone 規定要在使用者點擊的當下要求，所以打開卡片的那次點擊就要呼叫這個。
let motionPerm = null;
export function ensureMotion() {
  const D = window.DeviceOrientationEvent;
  if (!D || !window.isSecureContext) return Promise.resolve(false);
  if (typeof D.requestPermission !== 'function') return Promise.resolve(true); // Android 等不需要權限
  if (!motionPerm) {
    motionPerm = D.requestPermission()
      .then((r) => r === 'granted')
      .catch(() => { motionPerm = null; return false; }); // 不是在點擊當下呼叫：下次再試
  }
  return motionPerm;
}

// 讓一張大卡片可以互動；motion: true 時直接用陀螺儀（晃手機看反光）
// 回傳 { flip, setFinish, destroy }
export function interactive(holder, { motion = false } = {}) {
  const card = holder.querySelector('.card3d');
  const rot = holder.querySelector('.c3-rot');
  // 目前值與目標值（-1 ~ 1），用彈簧慢慢追上，手感比較柔
  const cur = { x: 0, y: 0, v: 0, w: 0 };
  const tgt = { x: 0, y: 0 };
  let flipped = false, flipAngle = 0, flipCur = 0;
  let dragging = false, gyroBase = null, gyroAt = -1e9, lastInput = 0, raf = 0, alive = true;

  const setFromPoint = (e) => {
    const r = card.getBoundingClientRect();
    tgt.x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1.2, 1.2);
    tgt.y = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1.2, 1.2);
    lastInput = performance.now();
  };
  let downAt = 0, downPos = null;
  holder.addEventListener('pointerdown', (e) => {
    dragging = true;
    downAt = performance.now();
    downPos = { x: e.clientX, y: e.clientY };
    holder.setPointerCapture?.(e.pointerId);
    card.classList.add('active');
    setFromPoint(e);
  });
  holder.addEventListener('pointermove', (e) => {
    if (dragging || e.pointerType === 'mouse') { card.classList.add('active'); setFromPoint(e); }
  });
  const release = (e) => {
    if (dragging && e?.type === 'pointerup' && performance.now() - downAt < 250 && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) < 8) {
      // 輕點：檢查是否雙擊翻面
      const now = performance.now();
      if (now - (release.lastTap || 0) < 320) { api.flip(); release.lastTap = 0; } else release.lastTap = now;
    }
    dragging = false;
    if (performance.now() - gyroAt > 500) { tgt.x = 0; tgt.y = 0; } // 有陀螺儀時放手就交回給手機角度
    card.classList.remove('active');
  };
  holder.addEventListener('pointerup', release);
  holder.addEventListener('pointercancel', release);
  holder.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') release(e); });

  const onOrient = (e) => {
    if (e.beta == null || e.gamma == null) return;
    // 橫拿手機時左右、前後的軸會對調
    const ang = screen.orientation?.angle ?? window.orientation ?? 0;
    let gx = e.gamma, gy = e.beta;
    if (ang === 90) { gx = e.beta; gy = -e.gamma; } else if (ang === -90 || ang === 270) { gx = -e.beta; gy = e.gamma; }
    // 以打開卡片時的拿法為正中間，之後慢慢跟上新的拿法（換姿勢後卡片會自己回正）
    if (!gyroBase) gyroBase = { x: gx, y: gy };
    gyroBase.x += (gx - gyroBase.x) * 0.004;
    gyroBase.y += (gy - gyroBase.y) * 0.004;
    gyroAt = lastInput = performance.now();
    if (dragging) return;
    tgt.x = clamp((gx - gyroBase.x) / 20, -1.2, 1.2);
    tgt.y = clamp((gy - gyroBase.y) / 20, -1.2, 1.2);
  };
  if (motion) ensureMotion().then((ok) => { if (ok && alive) window.addEventListener('deviceorientation', onOrient); });

  const tick = (t) => {
    if (!alive) return;
    // 沒在操作時輕輕晃，看起來是立體的
    const idle = !dragging && t - lastInput > 1200; // 陀螺儀一直有資料進來時不會進入閒置
    const gx = idle ? Math.sin(t / 1400) * 0.32 : tgt.x;
    const gy = idle ? Math.cos(t / 1900) * 0.22 : tgt.y;
    // 彈簧
    cur.v = (cur.v + (gx - cur.x) * 0.12) * 0.72;
    cur.w = (cur.w + (gy - cur.y) * 0.12) * 0.72;
    cur.x += cur.v; cur.y += cur.w;
    flipCur += (flipAngle - flipCur) * 0.14;
    const s = card.style;
    s.setProperty('--px', cur.x.toFixed(4));
    s.setProperty('--py', cur.y.toFixed(4));
    s.setProperty('--mx', (50 + cur.x * 50).toFixed(2) + '%');
    s.setProperty('--my', (50 + cur.y * 50).toFixed(2) + '%');
    s.setProperty('--hyp', Math.min(1, Math.hypot(cur.x, cur.y)).toFixed(3));
    rot.style.transform = `rotateY(${(cur.x * 18 + flipCur).toFixed(2)}deg) rotateX(${(-cur.y * 18).toFixed(2)}deg)`;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const api = {
    flip() { flipped = !flipped; flipAngle += 180; card.classList.toggle('flipped', flipped); },
    setFinish(f) {
      for (const k of Object.keys(FINISHES)) card.classList.toggle('f-' + k, k === f);
    },
    destroy() { alive = false; cancelAnimationFrame(raf); window.removeEventListener('deviceorientation', onOrient); },
  };
  return api;
}
