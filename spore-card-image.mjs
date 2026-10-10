// spore-card-image.mjs — the VISIBLE-layer raster and the survival MEASUREMENT.
//
// Renders the codec's module grid to grayscale pixels, degrades it the way a lossy re-encode would, samples
// it back, and reports whether the seed still reads. These are deterministic image-arithmetic helpers, not a
// decision kernel: the claim they support — "a downscaled screenshot still reads back" — is proven two ways
// that mutation-testing operators cannot (a ±1px over-read on a bounds-guarded pixel access does not flip a
// thresholded module): a deterministic VALUE test here (`survives` must be true at a measured degrade), and a
// real JPEG round-trip in the browser. The exact bit-codec they rest on is spore-card.mjs, which IS mutation-
// gated. Pure, deterministic, total. Powered by the Konomi architecture, created by Thomas Frumkin.

import { V1, encodeMatrix, decodeMatrix, unframe } from './spore-card.mjs';

const clampPx = (p) => Math.min(64, Math.max(1, Number.isFinite(+p) ? Math.trunc(+p) : 1));
const clampQ = (q) => Math.min(64, Math.max(0, Number.isFinite(+q) ? Math.trunc(+q) : 0));

export function renderGray(cells, M = V1.MODULES, cellPx = V1.CELL_PX, quiet = V1.QUIET) {
  const m = Math.min(256, Math.max(0, Number.isFinite(+M) ? Math.trunc(+M) : 0));
  const cp = clampPx(cellPx), q = clampQ(quiet);
  const side = (m + 2 * q) * cp;
  const px = new Uint8Array(side * side).fill(255);
  if (!cells || cells.length < m * m) return { ok: true, w: side, h: side, px };
  for (let r = 0; r < m; r++) for (let c = 0; c < m; c++) {
    if (!cells[r * m + c]) continue;
    const x0 = (q + c) * cp, y0 = (q + r) * cp;
    for (let y = 0; y < cp; y++) for (let x = 0; x < cp; x++) px[(y0 + y) * side + (x0 + x)] = 0;
  }
  return { ok: true, w: side, h: side, px };
}

export function sampleGray(px, w, h, M = V1.MODULES, cellPx = V1.CELL_PX, quiet = V1.QUIET) {
  const m = Math.min(256, Math.max(0, Number.isFinite(+M) ? Math.trunc(+M) : 0));
  const cp = clampPx(cellPx), q = clampQ(quiet);
  const cells = new Uint8Array(m * m);
  if (!px || w <= 0 || h <= 0) return cells;
  const win = Math.max(1, (cp / 2) | 0), off = ((cp - win) / 2) | 0;
  for (let r = 0; r < m; r++) for (let c = 0; c < m; c++) {
    const x0 = (q + c) * cp + off, y0 = (q + r) * cp + off;
    let sum = 0, n = 0;
    for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) {
      const xx = x0 + x, yy = y0 + y;
      if (xx >= 0 && xx < w && yy >= 0 && yy < h) { sum += px[yy * w + xx] & 0xff; n++; }
    }
    cells[r * m + c] = (n ? sum / n : 255) < 128 ? 1 : 0;
  }
  return cells;
}

// box-downscale to `scale`, requantize to `levels`, nearest-upscale back. The honest in-kernel stand-in for a
// lossy re-encode; the browser runs a REAL JPEG round-trip too.
export function degradeGray(px, w, h, opts = {}) {
  const W = w | 0, H = h | 0;
  if (!px || W <= 0 || H <= 0) return { w: W, h: H, px: px || new Uint8Array(0) };
  const s = Math.min(1, Math.max(0.05, +opts.scale || 0.4));
  const levels = opts.levels == null ? 4 : opts.levels;
  const blur = opts.blur == null ? true : opts.blur;
  const dw = Math.max(1, Math.round(W * s)), dh = Math.max(1, Math.round(H * s));
  const small = new Uint8Array(dw * dh);
  for (let dy = 0; dy < dh; dy++) for (let dx = 0; dx < dw; dx++) {
    const sx0 = Math.floor((dx * W) / dw), sx1 = Math.max(sx0 + 1, Math.floor(((dx + 1) * W) / dw));
    const sy0 = Math.floor((dy * H) / dh), sy1 = Math.max(sy0 + 1, Math.floor(((dy + 1) * H) / dh));
    let sum = 0, n = 0;
    for (let y = sy0; y < sy1 && y < H; y++) for (let x = sx0; x < sx1 && x < W; x++) { sum += px[y * W + x] & 0xff; n++; }
    small[dy * dw + dx] = n ? Math.round(sum / n) : 255;
  }
  const L = Math.max(2, levels | 0), step = 255 / (L - 1);
  for (let i = 0; i < small.length; i++) small[i] = Math.round(Math.round(small[i] / step) * step);
  let work = small;
  if (blur) {
    const out = new Uint8Array(work.length);
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      let sum = 0, n = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const xx = x + i, yy = y + j;
        if (xx >= 0 && xx < dw && yy >= 0 && yy < dh) { sum += work[yy * dw + xx]; n++; }
      }
      out[y * dw + x] = n ? Math.round(sum / n) : work[y * dw + x];
    }
    work = out;
  }
  const up = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = Math.min(dw - 1, Math.floor((x * dw) / W)), sy = Math.min(dh - 1, Math.floor((y * dh) / H));
    up[y * W + x] = work[sy * dw + sx];
  }
  return { w: W, h: H, px: up };
}

// the end-to-end MEASUREMENT — encode -> render -> degrade -> sample -> decode -> compare bytes.
export function survives(frameBytes, opts = {}) {
  const fb = frameBytes || [];
  const cellPx = opts.cellPx || V1.CELL_PX, quiet = opts.quiet == null ? V1.QUIET : opts.quiet;
  const enc = encodeMatrix(fb, V1.MODULES, V1.REPS);
  if (!enc.ok) return { ok: false, error: enc.error };
  const img = renderGray(enc.cells, V1.MODULES, cellPx, quiet);
  const deg = degradeGray(img.px, img.w, img.h, { scale: opts.scale, levels: opts.levels, blur: opts.blur });
  const cells = sampleGray(deg.px, deg.w, deg.h, V1.MODULES, cellPx, quiet);
  const dec = decodeMatrix(cells, V1.MODULES, V1.REPS);
  if (!dec.ok) return { ok: false, error: dec.error };
  const uf = unframe(dec.frame);
  if (!uf.ok) return { ok: false, error: uf.error };
  const orig = unframe(fb);
  const same = orig.ok && uf.seed.length === orig.seed.length && uf.seed.every((v, i) => v === orig.seed[i]);
  return { ok: same, seed: uf.seed, bytes: uf.seed.length };
}
