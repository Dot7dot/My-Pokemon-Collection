export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pad = (n) => String(n).padStart(4, '0');

// 疊在畫面最上層的視窗（全螢幕或底部抽屜）。回傳元素，el.close() 關閉。
// 開著視窗時歷史紀錄多一筆，Android 返回鍵／瀏覽器上一頁會先關掉最上層的視窗。
const stack = [];
let backTimer = 0;
const syncLock = () => document.body.classList.toggle('locked', stack.length > 0 || !document.getElementById('detail').hidden);
export function layer(html, { cls = '', onClose } = {}) {
  const el = document.createElement('div');
  el.className = 'layer ' + cls;
  el.innerHTML = html;
  document.getElementById('layers').append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  clearTimeout(backTimer);
  if (!history.state?.layer) history.pushState({ ...(history.state || {}), layer: 1 }, '');
  stack.push(el);
  syncLock();
  let closed = false;
  el.close = (fromPop = false) => {
    if (closed) return;
    closed = true;
    stack.splice(stack.indexOf(el), 1);
    el.classList.remove('in');
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
    syncLock();
    // 視窗接著開下一個（例如拍照 → 裁切）時沿用同一筆歷史紀錄
    if (!fromPop && !stack.length) backTimer = setTimeout(() => { if (!stack.length && history.state?.layer) history.back(); }, 400);
    onClose?.();
  };
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) el.close(); });
  return el;
}
export const topLayer = () => stack[stack.length - 1];
// popstate 時呼叫：有視窗就關掉最上層並回傳 true
export function closeTopLayer() {
  const el = topLayer();
  if (!el) return false;
  el.close(true);
  if (stack.length) history.pushState({ ...(history.state || {}), layer: 1 }, '');
  return true;
}

export function toast(msg, ms = 2200) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.getElementById('toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

export function confirmBox(msg, okText = '確定', danger = false) {
  return new Promise((resolve) => {
    let v = false;
    const el = layer(`<div class="sheet small" role="dialog" aria-modal="true">
      <p class="confirm-msg">${esc(msg)}</p>
      <div class="row-btns">
        <button class="btn ghost" data-close>取消</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okText)}</button>
      </div></div>`, { cls: 'sheet-layer', onClose: () => resolve(v) });
    el.querySelector('[data-ok]').onclick = () => { v = true; el.close(); };
    el.addEventListener('click', (e) => { if (e.target === el) el.close(); });
  });
}

// 開檔：capture=true 時手機會直接開相機
export function pickFile(capture) {
  const input = document.getElementById(capture ? 'fileCam' : 'filePick');
  return new Promise((resolve) => {
    input.value = '';
    const done = () => { window.removeEventListener('focus', onFocus); resolve(input.files?.[0] || null); };
    const onFocus = () => setTimeout(() => { if (!input.files?.length) done(); }, 800);
    input.onchange = done;
    input.oncancel = done;
    window.addEventListener('focus', onFocus, { once: true });
    input.click();
  });
}
