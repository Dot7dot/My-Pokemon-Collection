// 立體卡片：拖曳／陀螺儀傾斜、跟著角度移動的反光與閃卡效果、翻面
// 互動方式參考 CardKing 的卡牌詳情（按住拖曳看反光），再加上厚度、彈簧回正、陀螺儀。
import { clamp, esc } from './ui.js';

export const FINISHES = {
  holo: { label: '彩虹閃卡' },
  gold: { label: '金屬亮面' },
  sparkle: { label: '星塵閃' },
  plain: { label: '一般' },
};

export function cardHTML(src, finish = 'holo', { big = false } = {}) {
  const f = FINISHES[finish] ? finish : 'holo';
  const edges = big ? Array.from({ length: 6 }, (_, i) => `<i class="c3-edge" style="--z:${(i - 2.5) * 0.45}px"></i>`).join('') : '';
  return `<div class="card3d f-${f}${big ? ' big' : ''}">
    <div class="c3-rot">
      ${edges}
      <div class="c3-back"><span class="c3-back-ball"></span><span class="c3-back-word">MY COLLECTION</span></div>
      <div class="c3-front">
        <img src="${esc(src)}" alt="" draggable="false">
        <div class="c3-holo"></div>
        <div class="c3-glare"></div>
      </div>
    </div>
  </div>`;
}

// 讓一張大卡片可以互動；回傳 { flip, gyro, setFinish, destroy }
export function interactive(holder) {
  const card = holder.querySelector('.card3d');
  const rot = holder.querySelector('.c3-rot');
  // 目前值與目標值（-1 ~ 1），用彈簧慢慢追上，手感比較柔
  const cur = { x: 0, y: 0, v: 0, w: 0 };
  const tgt = { x: 0, y: 0 };
  let flipped = false, flipAngle = 0, flipCur = 0;
  let dragging = false, gyroOn = false, gyroBase = null, lastInput = 0, raf = 0, alive = true;

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
    if (!gyroOn) { tgt.x = 0; tgt.y = 0; }
    card.classList.remove('active');
  };
  holder.addEventListener('pointerup', release);
  holder.addEventListener('pointercancel', release);
  holder.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') release(e); });

  const onOrient = (e) => {
    if (e.beta == null || dragging) return;
    if (!gyroBase) gyroBase = { b: e.beta, g: e.gamma };
    tgt.x = clamp((e.gamma - gyroBase.g) / 22, -1.2, 1.2);
    tgt.y = clamp((e.beta - gyroBase.b) / 22, -1.2, 1.2);
    lastInput = performance.now();
    card.classList.add('active');
  };

  const tick = (t) => {
    if (!alive) return;
    // 沒在操作時輕輕晃，看起來是立體的
    const idle = !dragging && !gyroOn && t - lastInput > 1200;
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
    async gyro() {
      if (gyroOn) {
        gyroOn = false;
        window.removeEventListener('deviceorientation', onOrient);
        tgt.x = 0; tgt.y = 0;
        card.classList.remove('active');
        return false;
      }
      const D = window.DeviceOrientationEvent;
      if (!D) return null;
      if (typeof D.requestPermission === 'function') {
        try { if ((await D.requestPermission()) !== 'granted') return null; } catch { return null; }
      }
      gyroOn = true;
      gyroBase = null;
      window.addEventListener('deviceorientation', onOrient);
      return true;
    },
    setFinish(f) {
      for (const k of Object.keys(FINISHES)) card.classList.toggle('f-' + k, k === f);
    },
    destroy() { alive = false; cancelAnimationFrame(raf); window.removeEventListener('deviceorientation', onOrient); },
  };
  return api;
}
