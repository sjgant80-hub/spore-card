// ════════════════════════════════════════════════════════════════
// spore-card.mjs — the card CODEC (the exact bit-level logic). A PNG card that IS a seed.
//
// The fold: you don't send the build, you send a picture — and the picture carries the seed, and saving
// the picture grows a sovereign Didy locally. This file is the load-bearing part: turning a tiny verified
// seed into the redundant module grid that rides inside the image, and reading it back exactly or refusing.
// It must NEVER silently corrupt a seed — so the mutation gate runs against THIS file, and it stays clean.
//
// The seed is drawn as a redundant module grid: three copies of every bit, a self-describing length header,
// and a CRC-16 that refuses a corrupt read rather than growing the wrong thing. Majority vote + big modules
// are what let a downscaled screenshot still read back — that resilience is MEASURED in spore-card-image.mjs
// (renderGray/degradeGray/survives) and proven again by a real JPEG round-trip in the browser; this file is
// the exact codec those rest on. The lossless PNG-chunk fast-path lives in spore-card-chunk.mjs (Node).
//
// Every function is pure, deterministic and TOTAL: hostile input returns {ok:false} or a safe value, never
// a throw. No Node-only globals here — this file runs unchanged in the browser.
//
// Germination is fall-spore (vendored, credited). Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════

// ── geometry: the reader knows each version's shape ─────────────────────────────────────────────────
// v1 carries a bare seed. v2 carries a SIGNED envelope (seed + claim + Ed25519 key + signature, envelope.mjs),
// which needs ~150 bytes, so its grid is 63×63: the same module size, so the same downscale survival.
export const V1 = Object.freeze({ MODULES: 37, REPS: 3, CELL_PX: 12, QUIET: 4, MAGIC: 0x53, VER: 1 });
export const V2 = Object.freeze({ MODULES: 63, REPS: 3, CELL_PX: 12, QUIET: 4, MAGIC: 0x53, VER: 2 });
// v3 carries a signed ANSWER — a v2 envelope that also cites the full 32-byte hash of the job it answers. The
// citation is never truncated to fit a smaller grid, so the grid grows instead: 69×69, same module size.
export const V3 = Object.freeze({ MODULES: 69, REPS: 3, CELL_PX: 12, QUIET: 4, MAGIC: 0x53, VER: 3 });
const VERSIONS = [V1.VER, V2.VER, V3.VER];
// the sealed, reproduced funnel seed this card version carries (fall-spore, commit 4c3ab7b, held-out AUC 0.820498)
export const CARD_SEED = '◊ spore.v1 funnel 11 f:579fc3f04c233901';

// ── UTF-8 (manual, total, no global dependency) ─────────────────────────────────────────────────────
export function strToBytes(s) {
  const str = typeof s === 'string' ? s : (s == null ? '' : String(s));
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.codePointAt(i);
    if (c > 0xffff) i++; // surrogate pair consumed one extra unit
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
}
export function bytesToStr(bytes) {
  const b = bytes || [];
  const n = b.length | 0;
  let out = '';
  for (let i = 0; i < n;) {
    const x = b[i] & 0xff;
    if (x < 0x80) { out += String.fromCodePoint(x); i += 1; }
    else if (x >= 0xc0 && x < 0xe0 && i + 1 < n) { out += String.fromCodePoint(((x & 0x1f) << 6) | (b[i + 1] & 0x3f)); i += 2; }
    else if (x >= 0xe0 && x < 0xf0 && i + 2 < n) { out += String.fromCodePoint(((x & 0x0f) << 12) | ((b[i + 1] & 0x3f) << 6) | (b[i + 2] & 0x3f)); i += 3; }
    else if (x >= 0xf0 && i + 3 < n) {
      const cp = ((x & 0x07) << 18) | ((b[i + 1] & 0x3f) << 12) | ((b[i + 2] & 0x3f) << 6) | (b[i + 3] & 0x3f);
      // a 4-byte form can spell a value past U+10FFFF, where fromCodePoint throws — that is malformed: skip it
      if (cp <= 0x10ffff) out += String.fromCodePoint(cp);
      i += 4;
    }
    else { i += 1; } // a malformed lead/continuation byte is skipped, never decoded
  }
  return out;
}

// ── CRC-16/CCITT-FALSE (init 0xFFFF, poly 0x1021) — integrity, refuses a corrupt read ───────────────
export function crc16(bytes, start, end) {
  const b = bytes || [];
  const n = b.length | 0;
  let crc = 0xffff;
  const s = Math.max(0, start == null ? 0 : start | 0);
  const e = Math.min(n, end == null ? n : end | 0);
  for (let i = s; i < e; i++) {
    crc ^= (b[i] & 0xff) << 8;
    for (let k = 0; k < 8; k++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc & 0xffff;
}

// ── frame: [MAGIC, VER, LEN_hi, LEN_lo, ...payload, CRC_hi, CRC_lo]; CRC over everything before the CRC ──
// VER says what the payload is: 1 = a bare seed string, 2 = a signed envelope. Any other version is refused.
export function frame(payloadBytes, ver = V1.VER) {
  const seed = payloadBytes || [];
  const sn = seed.length | 0;
  const len = sn & 0xffff;
  const v = VERSIONS.includes(ver) ? ver : V1.VER;
  const out = new Uint8Array(4 + len + 2);
  out[0] = V1.MAGIC; out[1] = v; out[2] = (len >> 8) & 0xff; out[3] = len & 0xff;
  out.set(Uint8Array.from({ length: len }, (_, i) => seed[i] & 0xff), 4);
  const c = crc16(out, 0, 4 + len);
  out[4 + len] = (c >> 8) & 0xff; out[4 + len + 1] = c & 0xff;
  return out;
}
export function unframe(bytes) {
  const b = bytes || [];
  const n = b.length | 0;
  if (n < 6) return { ok: false, error: 'frame too short' };
  if ((b[0] & 0xff) !== V1.MAGIC) return { ok: false, error: 'bad magic' };
  const ver = b[1] & 0xff;
  if (!VERSIONS.includes(ver)) return { ok: false, error: 'unsupported version' };
  const len = ((b[2] & 0xff) << 8) | (b[3] & 0xff);
  if (4 + len + 2 > n) return { ok: false, error: 'declared length overruns frame' };
  const want = ((b[4 + len] & 0xff) << 8) | (b[4 + len + 1] & 0xff);
  const got = crc16(b, 0, 4 + len);
  if (want !== got) return { ok: false, error: 'crc mismatch' };
  const seed = Uint8Array.from({ length: len }, (_, i) => b[4 + i] & 0xff);
  return { ok: true, ver, seed, payload: seed };
}

// ── module grid ─────────────────────────────────────────────────────────────────────────────────────
// geometry is bounded: a card is a small grid of small cells. Clamping keeps every function total even
// when a hostile caller asks for a billion-module grid (which would otherwise loop forever).
const toInt = (v) => {
  const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : NaN);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const clampM = (M) => Math.min(256, Math.max(0, toInt(M)));

export function isFinder(r, c, M) {
  const m = clampM(M), rr = toInt(r), cc = toInt(c);
  const tl = rr < 3 && cc < 3;
  const tr = rr < 3 && cc >= m - 3;
  const bl = rr >= m - 3 && cc < 3;
  return tl || tr || bl;
}
// the ordered list of (r,c) data cells (row-major, finders skipped) — encode and decode build it identically
export function dataCells(M) {
  const m = clampM(M), out = [];
  for (let r = 0; r < m; r++) for (let c = 0; c < m; c++) if (!isFinder(r, c, m)) out.push([r, c]);
  return out;
}
const HEADER_BITS = 16; // frame byte-length, stored with REPS-fold redundancy ahead of the payload

// encodeMatrix(frameBytes) -> {ok, cells:Uint8Array(M*M of 0/1)} ; {ok:false} if it will not fit
export function encodeMatrix(frameBytes, M = V1.MODULES, reps = V1.REPS) {
  // the majority vote is over exactly three copies; any other count is refused, never allocated
  if (reps !== V1.REPS) return { ok: false, error: 'only ' + V1.REPS + ' copies are supported' };
  const fb = frameBytes || [];
  const m = clampM(M);
  const cells = new Uint8Array(m * m); // finder corners are drawn by the image layer; the codec ignores them
  const cellsList = dataCells(m);
  const flen = (fb.length | 0) & 0xffff;
  const payloadBits = flen * 8;
  const need = HEADER_BITS * reps + payloadBits * reps;
  if (need > cellsList.length) return { ok: false, error: 'payload exceeds card capacity' };
  // a running pointer over the data cells: header (reps copies) then payload (reps copies), in order. An
  // off-by-one in a bit bound shifts every later cell, so the round-trip breaks — the mutant cannot hide.
  // The copy count is an array iteration (not a C-for) so there is no bound to flip into an unused extra copy.
  let p = 0;
  const put = (bit) => { const rc = cellsList[p++]; if (rc) cells[rc[0] * m + rc[1]] = bit ? 1 : 0; };
  const copies = Array.from({ length: reps });
  copies.forEach(() => { for (let b = 0; b < HEADER_BITS; b++) put((flen >> b) & 1); });
  copies.forEach(() => { for (let b = 0; b < payloadBits; b++) put((fb[b >> 3] >> (b & 7)) & 1); });
  return { ok: true, cells, modules: m };
}

const majority = (a, b, c) => ((a + b + c) >= 2 ? 1 : 0);

// decodeMatrix(cells, M) -> {ok, frame:Uint8Array} ; total, CRC-verified via unframe downstream
export function decodeMatrix(cells, M = V1.MODULES, reps = V1.REPS) {
  if (reps !== V1.REPS) return { ok: false, error: 'only ' + V1.REPS + ' copies are supported' };
  const m = clampM(M);
  if (!cells || (cells.length | 0) < m * m) return { ok: false, error: 'cell grid too small' };
  const cellsList = dataCells(m);
  let p = 0;
  const get = () => { const rc = cellsList[p++]; return rc && cells[rc[0] * m + rc[1]] ? 1 : 0; };
  // a running pointer reads the copies in the SAME order encode wrote them; an off-by-one in a bit bound
  // shifts every later read, corrupting the majority so the decode fails rather than hiding. Copy count and
  // the majority combine are array iterations (no C-for bound to flip into an unused extra copy / masked bit).
  const hdr = Array.from({ length: reps }, () => { const row = []; for (let b = 0; b < HEADER_BITS; b++) row.push(get()); return row; });
  let flen = 0;
  hdr[0].forEach((_, b) => { if (majority(hdr[0][b], hdr[1][b], hdr[2][b])) flen |= (1 << b); });
  flen &= 0xffff;
  const payloadBits = flen * 8;
  if (flen < 6 || HEADER_BITS * reps + payloadBits * reps > cellsList.length) return { ok: false, error: 'header length implausible' };
  const pay = Array.from({ length: reps }, () => { const row = []; for (let b = 0; b < payloadBits; b++) row.push(get()); return row; });
  const out = new Uint8Array(flen);
  pay[0].forEach((_, b) => { if (majority(pay[0][b], pay[1][b], pay[2][b])) out[b >> 3] |= (1 << (b & 7)); });
  return { ok: true, frame: out };
}

// ── the two calls the card builder uses ─────────────────────────────────────────────────────────────
export function cardFrameFor(seedStr = CARD_SEED) {
  return frame(strToBytes(seedStr));
}
export function seedFromFrame(frameBytes) {
  const uf = unframe(frameBytes);
  if (!uf.ok) return uf;
  if (uf.ver !== V1.VER) return { ok: false, error: 'a signed card — its payload is an envelope, read it with envelope.mjs' };
  return { ok: true, seed: bytesToStr(uf.seed) };
}
