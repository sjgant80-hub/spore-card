// ════════════════════════════════════════════════════════════════
// envelope.mjs — the SIGNED spore: the seed, the claim it makes, and who vouches for it.
//
// A v1 card carries a bare seed: it proves nothing about who sent it or what it is supposed to do. A v2 card
// carries this envelope, which binds four things under one Ed25519 signature:
//
//   [0]            type            0x02
//   [1]            seedLen         1..200
//   [2 .. 2+L)     seed            the fall-spore seed string, UTF-8
//   [+0 .. +4)     claim           held-out AUC in millionths, uint32 big-endian (0.820498 → 820498)
//   [+4 .. +8)     dataTag         the first 4 bytes of sha256(the dataset the claim was measured on)
//   [+8 .. +40)    pubkey          the signer's raw 32-byte Ed25519 public key
//   [+40 .. +104)  sig             Ed25519 over every byte before it — type, seed, claim, dataTag AND pubkey
//
// Because the key is inside the signed bytes, swapping in another key breaks the signature too.
//
// ⚑ A SIGNATURE PROVES WHO, NEVER WHAT. A receiving node must still re-run the seed and reproduce the claim
// (edge.mjs). This file only packs and unpacks — it does no crypto and makes no decision. Pure, total.
//
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════

export const ENVELOPE_TYPE = 0x02;
export const MAX_SEED = 200;
export const TAG_LEN = 4, PUBKEY_LEN = 32, SIG_LEN = 64, CLAIM_LEN = 4;
export const MAX_MICRO = 1000000;

const isBytes = (v) => v instanceof Uint8Array;
const tailLen = CLAIM_LEN + TAG_LEN + PUBKEY_LEN;          // claim + dataTag + pubkey: the signed tail after the seed

/** AUC → integer millionths, clamped to [0, 1e6]. Non-numbers become 0. */
export function aucToMicro(auc) {
  const x = typeof auc === 'number' && Number.isFinite(auc) ? auc : 0;
  return Math.min(MAX_MICRO, Math.max(0, Math.round(x * MAX_MICRO)));
}

/** Byte-exact equality of two Uint8Arrays. */
export function sameBytes(a, b) {
  if (!isBytes(a) || !isBytes(b) || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/** The bytes a signer signs: everything except the signature. {ok:false} on any malformed field. */
export function packUnsigned(opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const { seed, aucMicro, dataTag, pubkey } = o;
  if (!isBytes(seed) || seed.length < 1 || seed.length > MAX_SEED) return { ok: false, why: 'the seed must be 1–200 bytes' };
  if (!Number.isInteger(aucMicro) || aucMicro < 0 || aucMicro > MAX_MICRO) return { ok: false, why: 'the claim must be an integer number of millionths, 0–1000000' };
  if (!isBytes(dataTag) || dataTag.length !== TAG_LEN) return { ok: false, why: 'the data tag must be exactly 4 bytes' };
  if (!isBytes(pubkey) || pubkey.length !== PUBKEY_LEN) return { ok: false, why: 'the public key must be exactly 32 bytes' };
  const out = new Uint8Array(2 + seed.length + tailLen);
  out[0] = ENVELOPE_TYPE;
  out[1] = seed.length;
  out.set(seed, 2);
  let p = 2 + seed.length;
  out[p] = (aucMicro >>> 24) & 0xff; out[p + 1] = (aucMicro >>> 16) & 0xff; out[p + 2] = (aucMicro >>> 8) & 0xff; out[p + 3] = aucMicro & 0xff;
  out.set(dataTag, p + CLAIM_LEN);
  out.set(pubkey, p + CLAIM_LEN + TAG_LEN);
  return { ok: true, bytes: out };
}

/** Append a 64-byte signature to unsigned envelope bytes. */
export function attachSignature(unsigned, sig) {
  if (!isBytes(unsigned) || unsigned.length < 2 + 1 + tailLen) return { ok: false, why: 'not an unsigned envelope' };
  if (!isBytes(sig) || sig.length !== SIG_LEN) return { ok: false, why: 'the signature must be exactly 64 bytes' };
  const out = new Uint8Array(unsigned.length + SIG_LEN);
  out.set(unsigned, 0);
  out.set(sig, unsigned.length);
  return { ok: true, bytes: out };
}

/**
 * Read an envelope back. Returns every field plus `signedBytes` — exactly what the signature must cover —
 * so the verifier checks the signature over the same bytes the signer signed, never a re-encoding of them.
 */
export function unpack(bytes) {
  if (!isBytes(bytes)) return { ok: false, why: 'not bytes' };
  if (bytes.length < 2) return { ok: false, why: 'too short to be an envelope' };
  if (bytes[0] !== ENVELOPE_TYPE) return { ok: false, why: 'not a signed spore envelope' };
  const L = bytes[1];
  if (L < 1 || L > MAX_SEED) return { ok: false, why: 'the declared seed length is out of range' };
  const want = 2 + L + tailLen + SIG_LEN;
  if (bytes.length !== want) return { ok: false, why: 'the envelope is ' + bytes.length + ' bytes; its own header says ' + want };
  const p = 2 + L;
  const aucMicro = ((bytes[p] << 24) >>> 0) + (bytes[p + 1] << 16) + (bytes[p + 2] << 8) + bytes[p + 3];
  if (aucMicro > MAX_MICRO) return { ok: false, why: 'the claim is above 1.0 — not an AUC' };
  return {
    ok: true,
    seed: bytes.slice(2, p),
    aucMicro,
    dataTag: bytes.slice(p + CLAIM_LEN, p + CLAIM_LEN + TAG_LEN),
    pubkey: bytes.slice(p + CLAIM_LEN + TAG_LEN, p + tailLen),
    sig: bytes.slice(p + tailLen, want),
    signedBytes: bytes.slice(0, p + tailLen),
  };
}
