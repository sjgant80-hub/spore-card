// mesh-node.mjs — the browser mesh node: WebCrypto tools, signed cards and job answers as pictures, cards and jobs
// moved over a direct WebRTC link with no server. The decisions live in the gated kernels (spore-card.mjs,
// envelope.mjs, edge.mjs, job.mjs, proposer.mjs); the moves in mesh.mjs; the grow in grow-on.mjs; the link is fall-os
// webrtc.mjs and the invite check is fall-federate signaling.mjs (both vendored, credited). Powered by the Konomi
// architecture, created by Thomas Frumkin.
import { CARD_SEED, V2, V3, frame, encodeMatrix } from './spore-card.mjs';
import { makeSignedCard, sealClaim, envelopeFromCells, verifyAtEdge, makeJob, runJob, jobHashHex } from './mesh.mjs';
import { parseSessions } from './organ.mjs';
import { germinate as sporeGerminate, organBody } from './spore.mjs';
import { growOn } from './grow-on.mjs';
import { makeLink } from './vendor/fall-os/webrtc.mjs';
import { makeInvite, readInvite } from './vendor/fall-federate/signaling.mjs';

export { CARD_SEED, makeLink, makeInvite, readInvite, makeSignedCard, sealClaim, verifyAtEdge, makeJob, runJob, jobHashHex };
export const GROW_SPORE = '◊ spore.v1 funnel 11 g:12.2.10';

// ── encodings ───────────────────────────────────────────────────────────────────────────────────────
const subtle = globalThis.crypto && globalThis.crypto.subtle;
export const toHex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
export const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(String(s)), (c) => c.charCodeAt(0));
const b64url = (u8) => b64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const inviteId = (pubkey) => b64url(pubkey);                // fall-federate's invite id: the key, base64url
export function keyHexFromInviteId(id) {
  try { const s = String(id).replace(/-/g, '+').replace(/_/g, '/'); const u = unb64(s + '='.repeat((4 - s.length % 4) % 4)); return u.length === 32 ? toHex(u) : null; } catch { return null; }
}
export const randomNonce = () => toHex(globalThis.crypto.getRandomValues(new Uint8Array(8)));

export async function sha256hex(bytes) {
  return toHex(new Uint8Array(await subtle.digest('SHA-256', bytes instanceof Uint8Array ? bytes : new Uint8Array(0))));
}

// ── identity: one Ed25519 key per browser, NON-EXTRACTABLE, in IndexedDB ──────────────────────────
// The private key is created non-extractable and kept as a CryptoKey in IndexedDB: page script can ask it to sign
// but can never read its bytes, so it cannot be copied off this device. HONEST LIMIT: this page lives on a shared
// origin (sjgant80-hub.github.io), and any page on that origin could open the same database and ASK the key to sign.
// A node that must not share an origin should be served from its own domain. A key from the old version (kept in
// plain localStorage) is moved into IndexedDB as non-extractable and the old copy deleted.
const DB = 'spore-card-mesh', STORE = 'identity';
function idb() {
  return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
const idbGet = (db, k) => new Promise((res, rej) => { const t = db.transaction(STORE).objectStore(STORE).get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
const idbPut = (db, k, v) => new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite').objectStore(STORE).put(v, k); t.onsuccess = () => res(); t.onerror = () => rej(t.error); });
const signerFor = (priv) => async (bytes) => new Uint8Array(await subtle.sign({ name: 'Ed25519' }, priv, bytes));

export async function loadIdentity() {
  let db = null;
  try { db = await idb(); const got = await idbGet(db, 'node'); if (got && got.priv && got.pub) return { pubkey: new Uint8Array(got.pub), sign: signerFor(got.priv), stored: 'indexeddb' }; } catch { db = null; }
  let priv, pubkey;
  try {
    const old = localStorage.getItem('spore-mesh-identity');
    if (old) {
      const j = JSON.parse(old);
      priv = await subtle.importKey('jwk', j.priv, { name: 'Ed25519' }, false, ['sign']);
      pubkey = unb64(j.pub);
    }
  } catch { priv = null; }
  if (!priv) {
    const kp = await subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
    priv = kp.privateKey;
    pubkey = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
  }
  let stored = 'this session only';
  if (db) { try { await idbPut(db, 'node', { priv, pub: pubkey }); stored = 'indexeddb'; localStorage.removeItem('spore-mesh-identity'); } catch { /* keep in memory */ } }
  return { pubkey, sign: signerFor(priv), stored };
}

/** A throwaway key for the demo "false claim": a lie is never signed with the visitor's real identity. */
export async function demoIdentity() {
  const kp = await subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
  return { pubkey: new Uint8Array(await subtle.exportKey('raw', kp.publicKey)), sign: signerFor(kp.privateKey) };
}

export async function webVerify(bytes, sig, pubkey) {
  try {
    if (!(pubkey instanceof Uint8Array) || pubkey.length !== 32 || !(sig instanceof Uint8Array) || sig.length !== 64) return false;
    const key = await subtle.importKey('raw', pubkey, { name: 'Ed25519' }, false, ['verify']);
    return await subtle.verify({ name: 'Ed25519' }, key, sig, bytes);
  } catch { return false; }
}

/** This node's tools: its own identity, its own copy of the data, germination and growth on it. */
export async function makeTools() {
  const csv = new Uint8Array(await (await fetch('./data/online_shoppers_intention.csv')).arrayBuffer());
  const data = parseSessions(new TextDecoder().decode(csv));
  const id = await loadIdentity();
  const dataSha256Hex = await sha256hex(csv);
  const tools = {
    pubkey: id.pubkey, sign: id.sign, keyStored: id.stored, verify: webVerify, sha256hex, dataSha256Hex,
    germinate(seedStr) {
      const r = sporeGerminate(data, seedStr, 'all');
      if (!r || !r.ok) return { ok: false };
      return { ok: true, heldAuc: r.heldAuc, body: JSON.stringify(organBody(r.organ)) };
    },
    grow(sporeStr, proposals = []) { return growOn(data, sporeStr, proposals); },
  };
  tools.demo = async () => { const d = await demoIdentity(); return { ...tools, pubkey: d.pubkey, sign: d.sign }; };
  return tools;
}

// ── replay memory for a browser worker: claims persist with their expiry ────────────────────────────
// claim() reads, checks and writes in one synchronous step, so within this tab it is an atomic insert-if-absent.
// HONEST LIMIT: two tabs of this page on one browser share the store but not a lock; run one worker tab at a time.
export function makeClaims(storeKey = 'spore-mesh-claims') {
  const load = () => { try { return JSON.parse(localStorage.getItem(storeKey) || '{}') || {}; } catch { return {}; } };
  return (key, expires) => {
    const now = Math.floor(Date.now() / 1000);
    const m = load();
    for (const k of Object.keys(m)) if (!(m[k] > now)) delete m[k];
    if (Object.prototype.hasOwnProperty.call(m, key)) return false;
    m[key] = Number.isInteger(expires) ? expires : now + 7 * 24 * 3600;
    localStorage.setItem(storeKey, JSON.stringify(m));      // a failed write throws → the job is not run
    return true;
  };
}

// ── signed cards and answers as pictures: the band on top, a caption below ───────────────────────────
const P = 12, QUIET = 2, FRAME = 1, PAD = QUIET + FRAME, CAPTION = 170;
const geom = (M) => ({ M, BAND: M + 2 * PAD, S: (M + 2 * PAD) * P });

export function drawSignedCard(canvas, cells, info = {}) {
  const M = cells && cells.length === V3.MODULES * V3.MODULES ? V3.MODULES : V2.MODULES;
  const { S } = geom(M);
  canvas.width = S; canvas.height = S + CAPTION;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#0b0b0f'; ctx.fillRect(QUIET * P, QUIET * P, (M + 2 * FRAME) * P, (M + 2 * FRAME) * P);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(PAD * P, PAD * P, M * P, M * P);
  ctx.fillStyle = '#0b0b0f';
  for (let r = 0; r < M; r++) for (let c = 0; c < M; c++) if (cells[r * M + c]) ctx.fillRect((PAD + c) * P, (PAD + r) * P, P, P);
  ctx.fillStyle = '#0b0b0f'; ctx.fillRect(0, S, S, CAPTION);
  ctx.fillStyle = '#e9c46a'; ctx.font = '700 30px Georgia, serif';
  ctx.fillText(info.title || 'A signed seed', 28, S + 46);
  ctx.fillStyle = '#d7d7de'; ctx.font = '17px -apple-system, Segoe UI, sans-serif';
  ctx.fillText('Claims held-out AUC ' + (info.claim || '?') + ' — refused by any node where that', 28, S + 82);
  ctx.fillText('does not reproduce. Signed by ' + (info.signer || '?') + '.', 28, S + 106);
  ctx.fillStyle = '#8a8a93'; ctx.font = '14px -apple-system, Segoe UI, sans-serif';
  ctx.fillText('Powered by the Konomi architecture, created by Thomas Frumkin.', 28, S + 146);
  return canvas;
}
export const canvasPng = (canvas) => new Promise((resolve) => canvas.toBlob((b) => b.arrayBuffer().then((ab) => resolve(new Uint8Array(ab))), 'image/png'));

// ── pictures are untrusted: check the declared size from the header BEFORE anything decodes it ─────────
export const MAX_PICTURE_BYTES = 8 * 1024 * 1024, MAX_PICTURE_SIDE = 4096;
export function pictureSize(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
  const u32 = (o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[12] === 0x49 && b[13] === 0x48 && b[14] === 0x44 && b[15] === 0x52) {
    return { kind: 'png', width: u32(16), height: u32(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const marker = b[o + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue; }
      const len = (b[o + 2] << 8) + b[o + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { kind: 'jpeg', height: (b[o + 5] << 8) + b[o + 6], width: (b[o + 7] << 8) + b[o + 8] };
      }
      if (len < 2) return null;
      o += 2 + len;
    }
  }
  return null;
}

/** A picture of a card → its signed envelope: size-checked, then read at the v3 (answer) or v2 (card) shape. */
export async function envelopeFromPicture(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_PICTURE_BYTES) return { ok: false, why: 'the picture is over 8 MB' };
  const dims = pictureSize(bytes);
  if (!dims) return { ok: false, why: 'not a PNG or JPEG this node can read the size of' };
  if (!(dims.width > 0 && dims.height > 0) || dims.width > MAX_PICTURE_SIDE || dims.height > MAX_PICTURE_SIDE) {
    return { ok: false, why: 'the picture declares ' + dims.width + '×' + dims.height + ' — over ' + MAX_PICTURE_SIDE + ' px, refused before decoding' };
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: dims.kind === 'png' ? 'image/png' : 'image/jpeg' }));
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('not an image')); i.src = url; });
    const size = Math.min(img.width, img.height);
    const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, size, size, 0, 0, size, size);
    const d = ctx.getImageData(0, 0, size, size).data;
    let last = { ok: false, why: 'no signed card in this picture' };
    for (const M of [V3.MODULES, V2.MODULES]) {
      const { BAND } = geom(M);
      const pitch = size / BAND, half = Math.max(0, Math.floor(pitch * 0.25));
      const cells = new Uint8Array(M * M);
      for (let r = 0; r < M; r++) for (let c = 0; c < M; c++) {
        const cx = Math.floor((PAD + c + 0.5) * pitch), cy = Math.floor((PAD + r + 0.5) * pitch);
        let sum = 0, n = 0;
        for (let y = cy - half; y <= cy + half; y++) for (let x = cx - half; x <= cx + half; x++) {
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const k = (y * size + x) * 4; sum += d[k] * 0.299 + d[k + 1] * 0.587 + d[k + 2] * 0.114; n++;
        }
        cells[r * M + c] = (n ? sum / n : 255) < 128 ? 1 : 0;
      }
      const got = envelopeFromCells(cells);
      if (got.ok) return got;
      last = got;
    }
    return last;
  } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
  finally { URL.revokeObjectURL(url); }
}

/** Re-draw a card from an envelope (the tampered demo: the frame CRC is honest, the signature catches it). */
export function cellsForEnvelope(envelope, geo = V2) {
  const enc = encodeMatrix(frame(envelope, geo.VER), geo.MODULES, geo.REPS);
  return enc.ok ? enc.cells : null;
}

// ── moving a card over the link: chunked, bounded, hash-checked on arrival ─────────────────────────────
// A paired peer is still untrusted input: at most 4 cards in flight, at most 64 parts each, parts no longer than
// one chunk, 3 MB per card; the oldest unfinished card is dropped first.
const CHUNK = 12000, MAX_INFLIGHT = 4, MAX_PARTS = 64, MAX_CARD_B64 = 3 * 1024 * 1024;
export async function cardMessages(png, label, extra = {}) {
  const id = randomNonce();
  const all = b64(png), n = Math.ceil(all.length / CHUNK), sha = await sha256hex(png);
  const out = [];
  for (let i = 0; i < n; i++) out.push({ t: 'card', id, i, n, sha, label, ...extra, part: all.slice(i * CHUNK, (i + 1) * CHUNK) });
  return out;
}
export function makeAssembler(onCard) {
  const pending = new Map();                                  // insertion order = age
  return async (msg) => {
    if (!msg || msg.t !== 'card' || typeof msg.id !== 'string' || msg.id.length > 32) return;
    if (!Number.isInteger(msg.n) || msg.n < 1 || msg.n > MAX_PARTS) return;
    if (!Number.isInteger(msg.i) || msg.i < 0 || msg.i >= msg.n || typeof msg.part !== 'string' || msg.part.length > CHUNK) return;
    let p = pending.get(msg.id);
    if (!p) {
      while (pending.size >= MAX_INFLIGHT) pending.delete(pending.keys().next().value);
      p = { n: msg.n, got: new Map(), bytes: 0, sha: String(msg.sha || ''), label: msg.label, jobHash: msg.jobHash };
      pending.set(msg.id, p);
    }
    if (p.n !== msg.n || p.got.has(msg.i)) return;
    p.bytes += msg.part.length;
    if (p.bytes > MAX_CARD_B64) { pending.delete(msg.id); return; }
    p.got.set(msg.i, msg.part);
    if (p.got.size !== p.n) return;
    pending.delete(msg.id);
    let png;
    try { png = unb64([...Array(p.n).keys()].map((i) => p.got.get(i)).join('')); } catch { return; }
    const sha = await sha256hex(png);
    onCard({ png, label: typeof p.label === 'string' ? p.label.slice(0, 40) : 'card', jobHash: typeof p.jobHash === 'string' ? p.jobHash : null,
      sentSha: p.sha, sha, intact: sha === p.sha });
  };
}
