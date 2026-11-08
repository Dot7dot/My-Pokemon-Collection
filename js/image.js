// 照片處理：讀檔、縮圖、轉成 JPEG
export const CARD_W = 900;                       // 卡片輸出寬度（px）
export const CARD_H = Math.round(CARD_W * 88 / 63); // PTCG 標準 63 × 88 mm
export const CARD_RATIO = 63 / 88;

export async function loadBitmap(src) {
  // createImageBitmap 預設會照 EXIF 轉正；不支援時退回 <img>
  if (src instanceof Blob && 'createImageBitmap' in window) {
    try { return await createImageBitmap(src, { imageOrientation: 'from-image' }); } catch { /* 往下退回 */ }
  }
  const url = src instanceof Blob ? URL.createObjectURL(src) : src;
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    if (src instanceof Blob) setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export const sizeOf = (img) => ({ w: img.width || img.naturalWidth || img.videoWidth, h: img.height || img.naturalHeight || img.videoHeight });

export function toBlob(canvas, quality = 0.88) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality));
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// 等比縮小到最長邊 max
export async function resized(img, max, quality) {
  const { w, h } = sizeOf(img);
  const k = Math.min(1, max / Math.max(w, h));
  const c = makeCanvas(Math.round(w * k), Math.round(h * k));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { blob: await toBlob(c, quality), w: c.width, h: c.height };
}

// 一般照片：原圖最長 1800、縮圖 480
export async function processPhoto(file) {
  const img = await loadBitmap(file);
  const full = await resized(img, 1800, 0.88);
  const thumb = await resized(img, 480, 0.8);
  img.close?.();
  return { full: full.blob, thumb: thumb.blob, w: full.w, h: full.h };
}

// 卡片：已經是 63:88 的 canvas
export async function processCard(canvas) {
  const thumb = await resized(canvas, 420, 0.82);
  return { full: await toBlob(canvas, 0.9), thumb: thumb.blob, w: canvas.width, h: canvas.height };
}
