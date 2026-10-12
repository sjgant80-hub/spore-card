// mesh-node.mjs — the browser mesh node: WebCrypto tools, the v2 (signed) card as a picture, and cards moved
// over a direct WebRTC link with no server. The decisions live in the gated kernels (spore-card.mjs,
// envelope.mjs, edge.mjs); the moves in mesh.mjs; the link is fall-os webrtc.mjs and the invite check is
// fall-federate signaling.mjs (both vendored, credited). Powered by the Konomi architecture, created by
// Thomas Frumkin.
import { CARD_SEED, V2 } from './spore-card.mjs';
import { makeSignedCard, sealClaim, envelopeFromCells, verifyAtEdge } from './mesh.mjs';
import { parseSessions } from './organ.mjs';
import { germinate as sporeGerminate, organBody } from './spore.mjs';
import { makeLink } from './vendor/fall-os/webrtc.mjs';
import { makeInvite, readInvite } from './vendor/fall-federate/signaling.mjs';
import { frame, encodeMatrix } from './spore-card.mjs';

export { CARD_SEED, makeLink, makeInvite, readInvite };

// ── WebCrypto tools (the browser twin of node-tools.mjs) ───────────────────────────────────────────
const subtle = globalThis.crypto && globalThis.crypto.subtle;
export const toHex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
export const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(String(s)), (c) => c.charCodeAt(0));
const b64url = (u8) => b64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function sha256hex(bytes) {
  return toHex(new Uint8Array(await subtle.digest('SHA-256', bytes instanceof Uint8Array ? bytes : new Uint8Array(0))));
}

// one Ed25519 identity per browser, kept in this browser only
export async function loadIdentity() {
  const KEY = 'spore-mesh-identity';
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) {
      const j = JSON.parse(stored);
      const priv = await subtle.importKey('jwk', j.priv, { name: 'Ed25519' }, false, ['sign']);
      return { pubkey: unb64(j.pub), sign: async (bytes) => new Uint8Array(await subtle.sign({ name: 'Ed25519' }, priv, bytes)) };
    }
  } catch { /* fall through and make a fresh one */ }
  const kp = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pubkey = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
  try { localStorage.setItem(KEY, JSON.stringify({ pub: b64(pubkey), priv: await subtle.exportKey('jwk', kp.privateKey) })); } catch { /* private window: this session only */ }
  return { pubkey, sign: async (bytes) => new Uint8Array(await subtle.sign({ name: 'Ed25519' }, kp.privateKey, bytes)) };
}

export async function webVerify(bytes, sig, pubkey) {
  try {
    if (!(pubkey instanceof Uint8Array) || pubkey.length !== 32 || !(sig instanceof Uint8Array) || sig.length !== 64) return false;
    const key = await subtle.importKey('raw', pubkey, { name: 'Ed25519' }, false, ['verify']);
    return await subtle.verify({ name: 'Ed25519' }, key, sig, bytes);
  } catch { return false; }
}

/** This node's tools: its own identity, its own copy of the data, germination on it. */
export async function makeTools() {
  const csv = new Uint8Array(await (await fetch('./data/online_shoppers_intention.csv')).arrayBuffer());
  const data = parseSessions(new TextDecoder().decode(csv));
  const id = await loadIdentity();
  return {
    pubkey: id.pubkey,
    sign: id.sign,
    verify: webVerify,
    sha256hex,
    dataSha256Hex: await sha256hex(csv),
    germinate(seedStr) {
      const r = sporeGerminate(data, seedStr, 'all');
      if (!r || !r.ok) return { ok: false };
      return { ok: true, heldAuc: r.heldAuc, body: JSON.stringify(organBody(r.organ)) };
    },
  };
}
export const inviteId = (pubkey) => b64url(pubkey);   // fall-federate's invite id: the key, base64url

// ── the signed card as a picture: a 63×63 band on top, a caption below ─────────────────────────────
const P = 12, QUIET = 2, FRAME = 1, PAD = QUIET + FRAME, M = V2.MODULES;
const BAND = M + 2 * PAD, S = BAND * P, CAPTION = 170;

export function drawSignedCard(canvas, cells, info = {}) {
  canvas.width = S; canvas.height = S + CAPTION;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#0b0b0f';
  ctx.fillRect(QUIET * P, QUIET * P, (M + 2 * FRAME) * P, (M + 2 * FRAME) * P);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(PAD * P, PAD * P, M * P, M * P);
  ctx.fillStyle = '#0b0b0f';
  for (let r = 0; r < M; r++) for (let c = 0; c < M; c++) if (cells[r * M + c]) ctx.fillRect((PAD + c) * P, (PAD + r) * P, P, P);
  ctx.fillStyle = '#0b0b0f'; ctx.fillRect(0, S, S, CAPTION);
  ctx.fillStyle = '#e9c46a'; ctx.font = '700 30px Georgia, serif';
  ctx.fillText('A signed seed', 28, S + 46);
  ctx.fillStyle = '#d7d7de'; ctx.font = '17px -apple-system, Segoe UI, sans-serif';
  ctx.fillText('Claims held-out AUC ' + (info.claim || '?') + ' — and is refused by any node where that', 28, S + 82);
  ctx.fillText('does not reproduce. Signed by ' + (info.signer || '?') + '.', 28, S + 106);
  ctx.fillStyle = '#8a8a93'; ctx.font = '14px -apple-system, Segoe UI, sans-serif';
  ctx.fillText('Powered by the Konomi architecture, created by Thomas Frumkin.', 28, S + 146);
  return canvas;
}

export const canvasPng = (canvas) => new Promise((resolve) =>
  canvas.toBlob((b) => b.arrayBuffer().then((ab) => resolve(new Uint8Array(ab))), 'image/png'));

/** A picture of a card → its signed envelope, by reading the top-square band at the v2 geometry. */
export async function envelopeFromPicture(bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('not an image')); i.src = url; });
    const size = Math.min(img.width, img.height);
    const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, size, size, 0, 0, size, size);
    const d = ctx.getImageData(0, 0, size, size).data;
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
    return envelopeFromCells(cells);
  } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
  finally { URL.revokeObjectURL(url); }
}

/** Re-draw a card from an envelope (used to make the tampered demo card — the frame CRC is honest, the
 *  signature is what catches it). */
export function cellsForEnvelope(envelope) {
  const enc = encodeMatrix(frame(envelope, V2.VER), V2.MODULES, V2.REPS);
  return enc.ok ? enc.cells : null;
}

// ── moving a card over the link: chunked, hash-checked on arrival ──────────────────────────────────
const CHUNK = 12000;
export async function cardMessages(png, label) {
  const id = Math.random().toString(36).slice(2, 10);
  const all = b64(png), n = Math.ceil(all.length / CHUNK), sha = await sha256hex(png);
  const out = [];
  for (let i = 0; i < n; i++) out.push({ t: 'card', id, i, n, sha, label, part: all.slice(i * CHUNK, (i + 1) * CHUNK) });
  return out;
}
export function makeAssembler(onCard) {
  const parts = new Map();
  return async (msg) => {
    if (!msg || msg.t !== 'card' || typeof msg.id !== 'string' || !Number.isInteger(msg.n) || msg.n < 1 || msg.n > 200) return;
    const p = parts.get(msg.id) || { n: msg.n, got: new Map(), sha: msg.sha, label: msg.label };
    if (Number.isInteger(msg.i) && msg.i >= 0 && msg.i < p.n && typeof msg.part === 'string') p.got.set(msg.i, msg.part);
    parts.set(msg.id, p);
    if (p.got.size !== p.n) return;
    parts.delete(msg.id);
    let png;
    try { png = unb64([...Array(p.n).keys()].map((i) => p.got.get(i)).join('')); } catch { return; }
    const sha = await sha256hex(png);
    onCard({ png, label: typeof p.label === 'string' ? p.label : 'card', sentSha: p.sha, sha, intact: sha === p.sha });
  };
}

export { makeSignedCard, sealClaim, verifyAtEdge };
