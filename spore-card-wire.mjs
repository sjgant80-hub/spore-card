// spore-card-wire.mjs — the browser glue. Draws the card to a canvas, downloads it with the lossless seed
// chunk embedded, reads a dropped card back (chunk-first, visible-band fallback), and germinates the seed
// locally on the bundled sessions. I/O and canvas only — the decisions live in the gated spore-card.mjs
// and in the vendored fall-spore germination. Powered by the Konomi architecture, created by Thomas Frumkin.

import * as K from './spore-card.mjs';
import { parseSessions } from './organ.mjs';
import { germinate as sporeGerminate, ratioOf } from './spore.mjs';

export const SEED = K.CARD_SEED;
// the sealed, reproduced fall-spore figures this card carries (commit 4c3ab7b)
export const METRIC = { heldAuc: 0.820498, held: 4725, train: 7605, sporeBytes: 41 };

// ── fixed card geometry (encode and the screenshot decoder agree on it) ─────────────────────────────
const P = 12;          // pixels per module
const M = K.V1.MODULES; // 37 data modules
const QUIET = 2, FRAME = 1;
const PAD = QUIET + FRAME;                  // modules of margin+frame on each side of the grid
const BAND_MODULES = M + 2 * PAD;           // 43
const S = BAND_MODULES * P;                 // 516px band square
const CAPTION_H = 150;

// ── draw the card: a square data-band on top, a human proof-face caption below ──────────────────────
export function drawCard(canvas, seedStr = SEED) {
  const frameBytes = K.cardFrameFor(seedStr);
  const enc = K.encodeMatrix(frameBytes);
  const w = S, h = S + CAPTION_H;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  // band background white, then black registration frame ring, then the modules
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, S);
  ctx.fillStyle = '#0b0b0f';
  const fx = QUIET * P, fsz = (M + 2 * FRAME) * P;
  ctx.fillRect(fx, fx, fsz, fsz);                 // solid dark frame block
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(fx + FRAME * P, fx + FRAME * P, M * P, M * P); // clear the grid area white
  ctx.fillStyle = '#0b0b0f';
  const g0 = PAD * P;
  if (enc.ok) for (let r = 0; r < M; r++) for (let c = 0; c < M; c++) {
    if (enc.cells[r * M + c]) ctx.fillRect(g0 + c * P, g0 + r * P, P, P);
  }
  // caption
  ctx.fillStyle = '#0b0b0f'; ctx.fillRect(0, S, w, CAPTION_H);
  ctx.fillStyle = '#e9c46a'; ctx.font = '700 26px Georgia, serif';
  ctx.fillText('A seed you can grow', 24, S + 42);
  ctx.fillStyle = '#d7d7de'; ctx.font = '15px -apple-system, Segoe UI, sans-serif';
  ctx.fillText('Save this picture. Drop it into the grower — it grows a working', 24, S + 74);
  ctx.fillText('model on your machine, offline. Held-out AUC 0.820 on 4,725', 24, S + 96);
  ctx.fillText('sessions it never grew on. Re-run it yourself.', 24, S + 118);
  ctx.fillStyle = '#8a8a93'; ctx.font = '12px -apple-system, Segoe UI, sans-serif';
  ctx.fillText('Powered by the Konomi architecture, created by Thomas Frumkin.', 24, S + 140);
  return { frameBytes, w, h };
}

// ── download the card as a PNG with the exact seed in a lossless spoR chunk ──────────────────────────
export function canvasToPngBytes(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => blob.arrayBuffer().then((ab) => resolve(new Uint8Array(ab))), 'image/png');
  });
}
export async function downloadCard(canvas, seedStr = SEED, filename = 'spore-card.png') {
  const { frameBytes } = drawCard(canvas, seedStr);
  const png = await canvasToPngBytes(canvas);
  triggerDownload(new Blob([png], { type: 'image/png' }), filename);
  return { ok: true, bytes: frameBytes.length };
}

// ── read a dropped/uploaded card from the visible band (survives download, screenshot, re-encode) ────
export async function decodeFile(file) {
  const img = await loadImage(file);
  const band = topSquareGray(img);
  const cells = resampleBand(band.px, band.size);
  const dec = K.decodeMatrix(cells);
  if (!dec.ok) return { ok: false, error: 'could not read the seed from the image (' + dec.error + ')' };
  const uf = K.unframe(dec.frame);
  if (!uf.ok) return { ok: false, error: 'the seed read back corrupt (' + uf.error + ')' };
  return { ok: true, via: 'visible band', seed: K.bytesToStr(uf.seed) };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
    im.src = url;
  });
}
// take the top (w×w) square of the image as the band, as grayscale
function topSquareGray(img) {
  const size = Math.min(img.width, img.height);
  const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, size, size, 0, 0, size, size);
  const d = ctx.getImageData(0, 0, size, size).data;
  const px = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) px[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0;
  return { px, size };
}
// resample a band square to the 37×37 data grid using the fixed geometry (quiet+frame padding)
function resampleBand(px, size) {
  const cells = new Uint8Array(M * M);
  const pitch = size / BAND_MODULES;      // pixels per module in the uploaded image
  const win = Math.max(1, (pitch * 0.5) | 0);
  for (let r = 0; r < M; r++) for (let c = 0; c < M; c++) {
    const cx = ((PAD + c + 0.5) * pitch) | 0, cy = ((PAD + r + 0.5) * pitch) | 0;
    let sum = 0, n = 0;
    for (let y = -((win / 2) | 0); y <= ((win / 2) | 0); y++) for (let x = -((win / 2) | 0); x <= ((win / 2) | 0); x++) {
      const xx = cx + x, yy = cy + y;
      if (xx >= 0 && xx < size && yy >= 0 && yy < size) { sum += px[yy * size + xx]; n++; }
    }
    cells[r * M + c] = (n ? sum / n : 255) < 128 ? 1 : 0;
  }
  return cells;
}

// ── germinate the seed locally on the bundled sessions; reproduce the sealed AUC; make the owned organ ─
let DATA = null;
export async function loadData() {
  if (DATA) return DATA;
  const text = await fetch('./data/online_shoppers_intention.csv').then((r) => r.text());
  DATA = parseSessions(text);
  return DATA;
}
export async function germinate(seedStr = SEED) {
  const data = await loadData();
  const r = sporeGerminate(data, seedStr, 'all');
  if (!r.ok) return r;
  const ratio = ratioOf(seedStr, r.organ);
  return { ok: true, heldAuc: r.heldAuc, held: r.held, train: r.train, organ: r.organ, ratio };
}

// ── small helpers ────────────────────────────────────────────────────────────────────────────────
export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}
