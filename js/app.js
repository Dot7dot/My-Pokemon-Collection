import { DEX } from './dex.js';
import { $, $$, esc, pad, layer, toast, confirmBox, pickFile, closeTopLayer } from './ui.js';
import { allItems, itemsFor, saveItem, deleteItem, imageURL, forgetURLs, uid, askPersist } from './db.js';
import { processPhoto, processCard } from './image.js';
import { captureCard } from './capture.js';
import { cardHTML, interactive, FINISHES } from './card3d.js';
import { exportZip, importZip } from './backup.js';

// ───────── 基本資料 ─────────
const TOTAL = DEX.length; // 1025
const GENS = [
  { n: 1, region: '關都', from: 1, to: 151 },
  { n: 2, region: '城都', from: 152, to: 251 },
  { n: 3, region: '豐緣', from: 252, to: 386 },
  { n: 4, region: '神奧', from: 387, to: 493 },
  { n: 5, region: '合眾', from: 494, to: 649 },
  { n: 6, region: '卡洛斯', from: 650, to: 721 },
  { n: 7, region: '阿羅拉', from: 722, to: 809 },
  { n: 8, region: '伽勒爾', from: 810, to: 905 },
  { n: 9, region: '帕底亞', from: 906, to: 1025 },
];
const GEN_ZH = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
export const CATS = {
  figure: { label: '模型', icon: '🧸', hint: '公仔、絨毛娃娃、扭蛋、模型' },
  card: { label: '卡片', icon: '🃏', hint: '用 PTCG 標準尺寸拍下來，變成立體卡片' },
  shiny: { label: '色違', icon: '✨', hint: '遊戲裡抓到的色違截圖或照片' },
  art: { label: '畫圖', icon: '🎨', hint: '自己畫的或收到的圖' },
};
const CAT_KEYS = Object.keys(CATS);
const TYPES = {
  normal: ['一般', '#9fa19f'], fire: ['火', '#e62829'], water: ['水', '#2980ef'], grass: ['草', '#3fa129'],
  electric: ['電', '#e0ad00'], ice: ['冰', '#3dc7ef'], fighting: ['格鬥', '#ff8000'], poison: ['毒', '#9141cb'],
  ground: ['地面', '#915121'], flying: ['飛行', '#81b9ef'], psychic: ['超能力', '#ef4179'], bug: ['蟲', '#91a119'],
  rock: ['岩石', '#afa981'], ghost: ['幽靈', '#704170'], dragon: ['龍', '#5060e1'], dark: ['惡', '#624d4e'],
  steel: ['鋼', '#60a1b8'], fairy: ['妖精', '#ef70ef'],
};
const SPRITE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
const sprite = (id) => `${SPRITE}${id}.png`;
const shinySprite = (id) => `${SPRITE}shiny/${id}.png`;
const artwork = (id, shiny) => `${SPRITE}other/official-artwork/${shiny ? 'shiny/' : ''}${id}.png`;
const mon = (id) => {
  const [zh, en, ja, hans, genus, types, gen] = DEX[id - 1];
  return { id, zh, en, ja, hans, genus, types, gen };
};

// ───────── 收藏統計 ─────────
const counts = new Map(); // dex → { figure, card, shiny, art }
async function loadCounts() {
  counts.clear();
  for (const it of await allItems()) bump(it.dex, it.cat, 1);
}
function bump(dex, cat, d) {
  const c = counts.get(dex) || { figure: 0, card: 0, shiny: 0, art: 0 };
  c[cat] = Math.max(0, (c[cat] || 0) + d);
  if (CAT_KEYS.some((k) => c[k])) counts.set(dex, c); else counts.delete(dex);
}
const total = (dex) => { const c = counts.get(dex); return c ? CAT_KEYS.reduce((s, k) => s + c[k], 0) : 0; };

function renderProgress() {
  let photos = 0;
  for (const c of counts.values()) photos += CAT_KEYS.reduce((s, k) => s + c[k], 0);
  $('#progress').innerHTML = `已收藏 <b>${counts.size}</b> / ${TOTAL} 隻 · ${photos} 件收藏`;
  for (const g of GENS) {
    let n = 0;
    for (let i = g.from; i <= g.to; i++) if (counts.has(i)) n++;
    const el = $(`#gen${g.n} .gen-count`);
    if (el) el.textContent = `${n} / ${g.to - g.from + 1}`;
  }
}

// ───────── 首頁格子 ─────────
function tileBadges(dex) {
  const c = counts.get(dex);
  if (!c) return '';
  return `<span class="dots">${CAT_KEYS.filter((k) => c[k]).map((k) => `<i class="dot d-${k}" title="${CATS[k].label} ${c[k]}"></i>`).join('')}</span>`;
}
function renderGrid() {
  $('#genNav').innerHTML = GENS.map((g) => `<button class="chip" data-gen="${g.n}">${GEN_ZH[g.n]}<small>${g.region}</small></button>`).join('')
    + '<button class="chip toggle" id="onlyMine" aria-pressed="false">只看已收藏</button>';
  $('#grid').innerHTML = GENS.map((g) => {
    let tiles = '';
    for (let id = g.from; id <= g.to; id++) {
      const m = mon(id);
      tiles += `<a class="tile${counts.has(id) ? ' has' : ''}" href="#/p/${id}" data-id="${id}">
        <img src="${sprite(id)}" alt="" loading="lazy" decoding="async" width="96" height="96" onerror="this.classList.add('broken')">
        <span class="no">#${pad(id)}</span><span class="nm">${esc(m.zh)}</span>${tileBadges(id)}</a>`;
    }
    return `<section class="gen" id="gen${g.n}" data-gen="${g.n}">
      <h2 class="gen-head"><span class="gen-num">第${GEN_ZH[g.n]}世代</span><span class="gen-region">${g.region}地區</span>
        <span class="gen-range">#${pad(g.from)}–#${pad(g.to)}</span><span class="gen-count"></span></h2>
      <div class="tiles">${tiles}</div></section>`;
  }).join('');
  renderProgress();
}
function refreshTile(dex) {
  const t = $(`.tile[data-id="${dex}"]`);
  if (!t) return;
  t.classList.toggle('has', counts.has(dex));
  t.querySelector('.dots')?.remove();
  t.insertAdjacentHTML('beforeend', tileBadges(dex));
  renderProgress();
  applyFilter();
}

// ───────── 搜尋 ─────────
const kata = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const searchIndex = DEX.map(([zh, en, ja, hans]) => `${zh}|${en.toLowerCase()}|${ja}|${hans}`);
let onlyMine = false;
function matches(q) {
  if (!q) return null;
  const num = q.replace(/^#|^no\.?/i, '');
  if (/^\d+$/.test(num)) {
    const n = String(parseInt(num, 10));
    const out = new Set();
    for (let i = 1; i <= TOTAL; i++) if (String(i).includes(n)) out.add(i);
    return out;
  }
  const k = kata(q.toLowerCase());
  const out = new Set();
  searchIndex.forEach((s, i) => { if (s.includes(k)) out.add(i + 1); });
  return out;
}
function applyFilter() {
  const q = $('#q').value.trim();
  $('#qClear').hidden = !q;
  const set = matches(q);
  let shown = 0;
  for (const g of GENS) {
    const sec = $(`#gen${g.n}`);
    let n = 0;
    for (const t of sec.querySelectorAll('.tile')) {
      const id = +t.dataset.id;
      const ok = (!set || set.has(id)) && (!onlyMine || counts.has(id));
      t.hidden = !ok;
      if (ok) n++;
    }
    sec.hidden = n === 0;
    shown += n;
  }
  document.body.classList.toggle('filtering', !!q || onlyMine);
  const nr = $('#noResult');
  nr.hidden = shown > 0;
  if (!shown) nr.textContent = q ? `找不到「${q}」，試試編號、中文、英文或日文名稱。` : '還沒有任何收藏，點一隻寶可夢開始新增吧！';
  return set;
}

// ───────── 寶可夢頁面 ─────────
let currentDex = 0;
let gridScroll = 0; // 打開寶可夢頁面前的捲動位置，回來時還原
let detailItems = [];
async function openDetail(id, { replace = false } = {}) {
  id = Math.min(TOTAL, Math.max(1, id | 0));
  const target = `#/p/${id}`;
  if (location.hash !== target) {
    if (replace) history.replaceState(history.state, '', target); else location.hash = target;
  }
  currentDex = id;
  const m = mon(id);
  const d = $('#detail');
  const t1 = TYPES[m.types[0]]?.[1] || '#888', t2 = TYPES[m.types[1] || m.types[0]]?.[1] || t1;
  d.style.setProperty('--t1', t1);
  d.style.setProperty('--t2', t2);
  d.innerHTML = `<div class="d-bar">
      <button class="icon-btn" data-back aria-label="回到圖鑑">←</button>
      <span class="d-title">#${pad(id)} ${esc(m.zh)}</span>
      <button class="icon-btn" data-go="${id - 1}" ${id <= 1 ? 'disabled' : ''} aria-label="上一隻">‹</button>
      <button class="icon-btn" data-go="${id + 1}" ${id >= TOTAL ? 'disabled' : ''} aria-label="下一隻">›</button>
    </div>
    <div class="d-scroll">
      <div class="hero">
        <button class="hero-art" data-shiny aria-label="切換色違樣子">
          <img src="${artwork(id)}" alt="${esc(m.zh)}" onerror="this.src='${sprite(id)}'">
          <span class="shiny-tip">✨ 點一下看色違</span>
        </button>
        <div class="hero-info">
          <p class="hero-no">No. ${pad(id)} · 第${GEN_ZH[m.gen]}世代</p>
          <h2 class="hero-name">${esc(m.zh)}</h2>
          <p class="hero-alt">${esc(m.en)} · ${esc(m.ja)}</p>
          ${m.genus ? `<p class="hero-genus">${esc(m.genus)}</p>` : ''}
          <p class="types">${m.types.map((t) => `<span class="type" style="--c:${TYPES[t][1]}">${TYPES[t][0]}</span>`).join('')}</p>
        </div>
      </div>
      <div class="cat-tabs" role="tablist">${CAT_KEYS.map((k) => `<a class="cat-tab c-${k}" href="#sec-${k}" data-jump="${k}">${CATS[k].icon} ${CATS[k].label}<b data-count="${k}">0</b></a>`).join('')}</div>
      <div class="sections">${CAT_KEYS.map((k) => `<section class="cat c-${k}" id="sec-${k}">
        <header class="cat-head">
          <h3>${CATS[k].icon} ${CATS[k].label}</h3>
          ${k === 'shiny' ? `<img class="shiny-ref" src="${shinySprite(id)}" alt="色違參考圖" loading="lazy">` : ''}
          <button class="btn small primary" data-add="${k}">＋ 新增</button>
        </header>
        <div class="items" data-items="${k}"></div>
      </section>`).join('')}</div>
    </div>`;
  if (d.hidden) {
    gridScroll = window.scrollY;
    d.hidden = false;
    document.body.classList.add('locked');
    requestAnimationFrame(() => d.classList.add('in'));
  }
  $('.d-scroll', d).scrollTop = 0;
  await renderItems();
}
function closeDetail() {
  const d = $('#detail');
  if (d.hidden) return;
  d.classList.remove('in');
  currentDex = 0;
  setTimeout(() => { if (!currentDex) { d.hidden = true; d.innerHTML = ''; } }, 230);
  document.body.classList.remove('locked');
  window.scrollTo(0, gridScroll);
}

async function renderItems() {
  const dex = currentDex;
  const items = await itemsFor(dex);
  if (dex !== currentDex) return;
  detailItems = items;
  for (const k of CAT_KEYS) {
    const list = items.filter((it) => it.cat === k);
    $(`[data-count="${k}"]`).textContent = list.length;
    const box = $(`[data-items="${k}"]`);
    const add = `<button class="add-tile" data-add="${k}"><span>＋</span>${list.length ? '再新增' : `新增${CATS[k].label}`}<small>${CATS[k].hint}</small></button>`;
    box.innerHTML = list.map((it) => k === 'card'
      ? `<button class="item card-item" data-item="${it.id}" aria-label="看卡片">${cardHTML('', it.finish)}${it.note ? `<span class="item-note">${esc(it.note)}</span>` : ''}</button>`
      : `<button class="item photo-item" data-item="${it.id}" aria-label="看照片"><img alt="" loading="lazy">${it.note ? `<span class="item-note">${esc(it.note)}</span>` : ''}</button>`).join('') + add;
    for (const it of list) {
      const url = await imageURL(it.id, 'thumb');
      const img = box.querySelector(`[data-item="${it.id}"] img`);
      if (img) img.src = url;
    }
  }
}

// ───────── 新增收藏 ─────────
async function addFlow(cat, source) {
  const dex = currentDex;
  let data;
  try {
    if (cat === 'card') {
      const canvas = await captureCard({ source });
      if (!canvas) return;
      data = await processCard(canvas);
    } else {
      const file = await pickFile(source === 'camera');
      if (!file) return;
      data = await processPhoto(file);
    }
  } catch (err) {
    console.error(err);
    toast('讀取照片失敗，換一張試試');
    return;
  }
  editSheet({ dex, cat, data });
}

function chooseSource(cat) {
  const el = layer(`<div class="sheet" role="dialog" aria-modal="true">
    <h3 class="sheet-title">${CATS[cat].icon} 新增${CATS[cat].label}</h3>
    <p class="sheet-hint">${CATS[cat].hint}</p>
    <div class="source-btns">
      <button class="source" data-src="camera"><span>📷</span>${cat === 'card' ? '拍卡片' : '拍照'}<small>${cat === 'card' ? '有 63 × 88 mm 取景框' : '打開相機'}</small></button>
      <button class="source" data-src="pick"><span>🖼️</span>上傳照片<small>${cat === 'card' ? '選照片後裁成卡片大小' : '從相簿選'}</small></button>
    </div>
    <button class="btn ghost wide" data-close>取消</button>
  </div>`, { cls: 'sheet-layer' });
  el.addEventListener('click', (e) => {
    if (e.target === el) el.close();
    const b = e.target.closest('[data-src]');
    if (b) { el.close(); addFlow(cat, b.dataset.src); }
  });
}

// 新增或編輯：預覽＋介紹文字
function editSheet({ dex, cat, data, item }) {
  const isNew = !item;
  const previewURL = data ? URL.createObjectURL(data.full) : '';
  let finish = item?.finish || 'holo';
  const el = layer(`<div class="sheet tall" role="dialog" aria-modal="true">
    <h3 class="sheet-title">${CATS[cat].icon} ${isNew ? '新增' : '編輯'}${CATS[cat].label} · ${esc(mon(dex).zh)}</h3>
    <div class="edit-preview ${cat === 'card' ? 'is-card' : ''}"></div>
    ${cat === 'card' ? `<div class="finish-row" role="radiogroup" aria-label="卡面效果">${Object.entries(FINISHES).map(([k, f]) => `<button class="finish ${k === finish ? 'on' : ''}" data-finish="${k}" role="radio">${f.label}</button>`).join('')}</div>` : ''}
    <label class="field">介紹
      <textarea rows="4" maxlength="2000" placeholder="例如：在哪裡買的、哪一套卡、什麼時候抓到、畫的心得…">${esc(item?.note || '')}</textarea>
    </label>
    <div class="row-btns">
      <button class="btn ghost" data-close>取消</button>
      <button class="btn primary" data-save>${isNew ? '加入收藏' : '儲存'}</button>
    </div>
  </div>`, { cls: 'sheet-layer', onClose: () => { if (previewURL) URL.revokeObjectURL(previewURL); api?.destroy(); } });
  const pv = $('.edit-preview', el);
  let api = null;
  (async () => {
    const src = previewURL || await imageURL(item.id, 'full');
    if (cat === 'card') { pv.innerHTML = cardHTML(src, finish, { big: true }); api = interactive(pv); }
    else pv.innerHTML = `<img src="${src}" alt="">`;
  })();
  el.addEventListener('click', (e) => {
    const f = e.target.closest('[data-finish]');
    if (f) {
      finish = f.dataset.finish;
      $$('.finish', el).forEach((b) => b.classList.toggle('on', b === f));
      api?.setFinish(finish);
    }
  });
  $('[data-save]', el).onclick = async () => {
    const note = $('textarea', el).value.trim();
    const now = Date.now();
    const next = isNew
      ? { id: uid(), dex, cat, note, created: now, updated: now, w: data.w, h: data.h, ...(cat === 'card' ? { finish } : {}) }
      : { ...item, note, updated: now, ...(cat === 'card' ? { finish } : {}) };
    try {
      await saveItem(next, isNew ? { full: data.full, thumb: data.thumb } : null);
    } catch (err) {
      console.error(err);
      toast(err?.name === 'QuotaExceededError' ? '儲存空間不足，先備份並刪掉一些照片' : '儲存失敗');
      return;
    }
    if (isNew) { bump(dex, cat, 1); refreshTile(dex); askPersist(); }
    el.close();
    toast(isNew ? `已加入 ${mon(dex).zh} 的${CATS[cat].label}收藏` : '已儲存');
    if (currentDex === dex) renderItems();
  };
}

// ───────── 觀看收藏 ─────────
function viewItem(id) {
  const item = detailItems.find((it) => it.id === id);
  if (!item) return;
  const list = detailItems.filter((it) => it.cat === item.cat);
  let idx = list.indexOf(item);
  let api = null;
  const el = layer(`<div class="viewer ${item.cat === 'card' ? 'v-card' : 'v-photo'}" role="dialog" aria-modal="true">
    <div class="v-top">
      <button class="btn round dark" data-close aria-label="關閉">✕</button>
      <span class="v-count"></span>
      <button class="btn round dark" data-menu aria-label="更多">⋯</button>
    </div>
    <div class="v-stage"></div>
    <div class="v-tools" ${item.cat === 'card' ? '' : 'hidden'}>
      <button class="btn chip-btn" data-flip>🔄 翻面</button>
      <button class="btn chip-btn" data-gyro>📱 晃手機看反光</button>
    </div>
    <p class="v-note"></p>
    <button class="v-nav prev" data-step="-1" aria-label="上一張">‹</button>
    <button class="v-nav next" data-step="1" aria-label="下一張">›</button>
  </div>`, { cls: 'full dark-layer', onClose: () => api?.destroy() });
  const stage = $('.v-stage', el);
  const show = async () => {
    const it = list[idx];
    api?.destroy(); api = null;
    $('.v-count', el).textContent = `${CATS[it.cat].icon} ${CATS[it.cat].label} ${idx + 1} / ${list.length}`;
    $('.v-note', el).textContent = it.note || '';
    $('.v-note', el).hidden = !it.note;
    $$('.v-nav', el).forEach((b) => { b.hidden = list.length < 2; });
    const src = await imageURL(it.id, 'full');
    if (it.cat === 'card') {
      stage.innerHTML = `<div class="v-card-holder">${cardHTML(src, it.finish, { big: true })}</div>
        <p class="v-hint">按住卡片拖曳看反光 · 點兩下翻面</p>`;
      api = interactive($('.v-card-holder', stage));
      $('[data-gyro]', el).classList.remove('on');
    } else {
      stage.innerHTML = `<img class="v-img" src="${src}" alt="">`;
    }
  };
  show();
  el.addEventListener('click', async (e) => {
    const step = e.target.closest('[data-step]');
    if (step) { idx = (idx + +step.dataset.step + list.length) % list.length; show(); return; }
    if (e.target.closest('[data-flip]')) api?.flip();
    const g = e.target.closest('[data-gyro]');
    if (g && api) {
      const on = await api.gyro();
      if (on === null) toast('這台裝置不支援陀螺儀，或沒有允許權限');
      g.classList.toggle('on', !!on);
    }
    if (e.target.closest('[data-menu]')) itemMenu(list[idx], el);
  });
  // 照片左右滑動切換
  let sx = null;
  stage.addEventListener('touchstart', (e) => { if (item.cat !== 'card') sx = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (sx == null || list.length < 2) return;
    const dx = e.changedTouches[0].clientX - sx;
    sx = null;
    if (Math.abs(dx) > 60) { idx = (idx + (dx < 0 ? 1 : -1) + list.length) % list.length; show(); }
  });
}

function itemMenu(it, viewer) {
  const el = layer(`<div class="sheet small" role="dialog" aria-modal="true">
    <button class="menu-row" data-act="edit">✏️ 編輯介紹${it.cat === 'card' ? '／卡面效果' : ''}</button>
    <button class="menu-row" data-act="save">💾 存到手機</button>
    <button class="menu-row danger" data-act="del">🗑️ 刪除這件收藏</button>
    <button class="btn ghost wide" data-close>取消</button>
  </div>`, { cls: 'sheet-layer' });
  el.addEventListener('click', async (e) => {
    if (e.target === el) el.close();
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    el.close();
    if (act === 'edit') { viewer.close(); editSheet({ dex: it.dex, cat: it.cat, item: it }); }
    if (act === 'save') {
      const a = document.createElement('a');
      a.href = await imageURL(it.id, 'full');
      a.download = `${pad(it.dex)}-${mon(it.dex).zh}-${CATS[it.cat].label}.jpg`;
      a.click();
    }
    if (act === 'del' && await confirmBox('確定要刪除這件收藏嗎？刪除後無法復原。', '刪除', true)) {
      await deleteItem(it.id);
      forgetURLs(it.id);
      bump(it.dex, it.cat, -1);
      refreshTile(it.dex);
      viewer.close();
      toast('已刪除');
      renderItems();
    }
  });
}

// ───────── 選單：備份／匯入 ─────────
async function openMenu() {
  let usage = '';
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage != null) usage = `目前用了 ${(est.usage / 1048576).toFixed(1)} MB`;
  } catch { /* 略過 */ }
  const el = layer(`<div class="sheet" role="dialog" aria-modal="true">
    <h3 class="sheet-title">收藏庫</h3>
    <p class="sheet-hint">收藏的照片只存在這台裝置的瀏覽器裡${usage ? `（${usage}）` : ''}。換手機或清除瀏覽器資料前，記得先匯出備份。</p>
    <button class="menu-row" data-act="export">📦 匯出備份（.zip）</button>
    <button class="menu-row" data-act="import">📥 匯入備份</button>
    <button class="menu-row" data-act="random">🎲 隨機看一隻寶可夢</button>
    <button class="btn ghost wide" data-close>關閉</button>
  </div>`, { cls: 'sheet-layer' });
  el.addEventListener('click', async (e) => {
    if (e.target === el) el.close();
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    el.close();
    if (act === 'random') openDetail(1 + Math.floor(Math.random() * TOTAL));
    if (act === 'export') {
      toast('正在打包…');
      try {
        const { blob, count } = await exportZip();
        if (!count) { toast('還沒有收藏可以備份'); return; }
        const name = `my-pokemon-collection-${new Date().toISOString().slice(0, 10)}.zip`;
        const file = new File([blob], name, { type: 'application/zip' });
        if (navigator.canShare?.({ files: [file] }) && /Mobi|Android|iPhone|iPad/.test(navigator.userAgent)) {
          await navigator.share({ files: [file], title: name }).catch(() => {});
        } else {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = name;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        }
        toast(`已匯出 ${count} 件收藏`);
      } catch (err) { console.error(err); toast('匯出失敗'); }
    }
    if (act === 'import') {
      const input = $('#fileZip');
      input.value = '';
      input.onchange = async () => {
        const f = input.files?.[0];
        if (!f) return;
        try {
          toast('匯入中…');
          const n = await importZip(f);
          await loadCounts();
          renderGrid();
          applyFilter();
          toast(`已匯入 ${n} 件收藏`);
          askPersist();
        } catch (err) { console.error(err); toast(err.message || '匯入失敗'); }
      };
      input.click();
    }
  });
}

// ───────── 路由與事件 ─────────
function route() {
  const m = location.hash.match(/^#\/p\/(\d+)/);
  if (m) { const id = +m[1]; if (id !== currentDex) openDetail(id, { replace: true }); }
  else closeDetail();
}

function bind() {
  // 世代標題要黏在頂端列下面
  const top = $('.top');
  new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', top.offsetHeight + 'px')).observe(top);
  let timer = 0;
  $('#q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { applyFilter(); window.scrollTo({ top: 0 }); }, 90); });
  $('#q').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    clearTimeout(timer);
    applyFilter();
    const first = $$('.tile').find((t) => !t.hidden && !t.closest('.gen').hidden);
    if (first && $('#q').value.trim()) { $('#q').blur(); openDetail(+first.dataset.id); }
  });
  $('#qClear').onclick = () => { $('#q').value = ''; applyFilter(); $('#q').focus(); };
  $('#menuBtn').onclick = openMenu;
  $('#genNav').addEventListener('click', (e) => {
    if (e.target.closest('#onlyMine')) {
      onlyMine = !onlyMine;
      e.target.closest('#onlyMine').setAttribute('aria-pressed', onlyMine);
      applyFilter();
      window.scrollTo({ top: 0 });
      return;
    }
    const b = e.target.closest('[data-gen]');
    if (!b) return;
    const sec = $(`#gen${b.dataset.gen}`);
    if (sec.hidden) { $('#q').value = ''; onlyMine = false; $('#onlyMine').setAttribute('aria-pressed', false); applyFilter(); }
    const top = sec.getBoundingClientRect().top + window.scrollY - $('.top').offsetHeight + 1;
    window.scrollTo({ top, behavior: 'smooth' });
  });
  // 捲動時標示目前世代
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) {
      $$('#genNav [data-gen]').forEach((c) => c.classList.toggle('on', c.dataset.gen === en.target.dataset.gen));
      // 不用 scrollIntoView：它會連整頁一起捲，打斷點世代按鈕時的平滑捲動
      const chip = $(`#genNav [data-gen="${en.target.dataset.gen}"]`), nav = $('#genNav');
      if (chip) nav.scrollTo({ left: chip.offsetLeft - nav.clientWidth / 2 + chip.offsetWidth / 2, behavior: 'smooth' });
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  $$('.gen').forEach((s) => io.observe(s));

  $('#detail').addEventListener('click', (e) => {
    if (e.target.closest('[data-back]')) { history.length > 1 && history.state?.fromGrid ? history.back() : (location.hash = '#/'); return; }
    const go = e.target.closest('[data-go]');
    if (go) { openDetail(+go.dataset.go, { replace: true }); return; }
    const sh = e.target.closest('[data-shiny]');
    if (sh) {
      const on = sh.classList.toggle('shiny');
      sh.querySelector('img').src = artwork(currentDex, on);
      sh.querySelector('.shiny-tip').textContent = on ? '✨ 色違' : '✨ 點一下看色違';
      return;
    }
    const jump = e.target.closest('[data-jump]');
    if (jump) { e.preventDefault(); $(`#sec-${jump.dataset.jump}`).scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const add = e.target.closest('[data-add]');
    if (add) { chooseSource(add.dataset.add); return; }
    const it = e.target.closest('[data-item]');
    if (it) viewItem(it.dataset.item);
  });
  // 點格子：記下是從圖鑑進來的，返回時用瀏覽器上一頁保留捲動位置
  $('#grid').addEventListener('click', (e) => {
    const t = e.target.closest('.tile');
    if (!t) return;
    e.preventDefault();
    history.pushState({ fromGrid: true }, '', t.getAttribute('href'));
    openDetail(+t.dataset.id);
  });
  // 左右滑動換上一隻／下一隻
  let sx = null, sy = 0;
  $('#detail').addEventListener('touchstart', (e) => {
    if (e.target.closest('.items, .cat-tabs')) { sx = null; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, { passive: true });
  $('#detail').addEventListener('touchend', (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 2) {
      const n = currentDex + (dx < 0 ? 1 : -1);
      if (n >= 1 && n <= TOTAL) openDetail(n, { replace: true });
    }
  });
  window.addEventListener('popstate', () => { if (!closeTopLayer()) route(); });
  window.addEventListener('hashchange', route);
}

async function init() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  try { await loadCounts(); } catch (err) { console.error(err); toast('無法開啟收藏資料庫（無痕模式可能不支援）'); }
  renderGrid();
  bind();
  applyFilter();
  route();
}
init();
