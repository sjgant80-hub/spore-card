// ════════════════════════════════════════════════════════════════
// mesh.mjs — the two moves a mesh node makes, with every impure step handed in.
//
//   makeSignedCard  — germinate a seed HERE, sign the claim it actually earned, draw it as a v2 card grid
//   verifyAtEdge    — take a card from someone else and refuse it unless it reproduces HERE
//
// `tools` carries the impure parts so the same code runs in Node (the committed, re-runnable receipt) and in
// a browser (the live node over WebRTC):
//   germinate(seedStr)        → { ok, heldAuc, body }   fall-spore on this node's own copy of the data
//   sign(bytes)               → Uint8Array(64)          this node's Ed25519 key
//   verify(bytes, sig, pub)   → boolean                 Ed25519 verify
//   sha256hex(bytes)          → lowercase hex
//   dataSha256Hex             — sha256 of the dataset this node holds
//   pubkey                    — this node's raw 32-byte public key
//
// The decision itself is edge.mjs (gated); the bytes are envelope.mjs and spore-card.mjs (gated).
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════

import { strToBytes, bytesToStr, frame, unframe, encodeMatrix, decodeMatrix, V2 } from './spore-card.mjs';
import { packUnsigned, attachSignature, unpack, aucToMicro, sameBytes, TAG_LEN } from './envelope.mjs';
import { receipt } from './edge.mjs';

/** The 4-byte data tag: the first 4 bytes of the dataset's sha256. */
export function tagFromHex(hex) {
  const h = typeof hex === 'string' ? hex : '';
  const out = new Uint8Array(TAG_LEN);
  for (let i = 0; i < TAG_LEN; i++) {
    const v = parseInt(h.slice(2 * i, 2 * i + 2), 16);
    out[i] = Number.isNaN(v) ? 0 : v;
  }
  return out;
}

/** Sign a claim about a seed and lay it out as a v2 card grid. Used honestly by makeSignedCard. */
export async function sealClaim(seedStr, aucMicro, tools) {
  const u = packUnsigned({ seed: strToBytes(seedStr), aucMicro, dataTag: tagFromHex(tools.dataSha256Hex), pubkey: tools.pubkey });
  if (!u.ok) return u;
  const s = attachSignature(u.bytes, await tools.sign(u.bytes));
  if (!s.ok) return s;
  const fr = frame(s.bytes, V2.VER);
  const enc = encodeMatrix(fr, V2.MODULES, V2.REPS);
  if (!enc.ok) return { ok: false, why: enc.error };
  return { ok: true, envelope: s.bytes, frame: fr, cells: enc.cells };
}

/** Germinate the seed on THIS node and sign only what it actually earned here. */
export async function makeSignedCard(seedStr, tools) {
  const g = await tools.germinate(seedStr);
  if (!g || g.ok !== true) return { ok: false, why: 'the seed did not germinate here, so there is no honest claim to sign' };
  const sealed = await sealClaim(seedStr, aucToMicro(g.heldAuc), tools);
  return sealed.ok ? { ...sealed, heldAuc: g.heldAuc } : sealed;
}

/** A picture's module grid → the signed envelope inside it (v2 only). */
export function envelopeFromCells(cells) {
  const d = decodeMatrix(cells, V2.MODULES, V2.REPS);
  if (!d.ok) return { ok: false, why: d.error };
  const u = unframe(d.frame);
  if (!u.ok) return { ok: false, why: u.error };
  if (u.ver !== V2.VER) return { ok: false, why: 'an unsigned (v1) card — there is no signature to check' };
  return { ok: true, envelope: u.payload };
}

/**
 * Edge verify. Checks the seal first and only germinates a card whose signature holds and whose data this node
 * has — nothing unverified is run. Returns the receipt (edge.receipt), accepted or refused.
 */
export async function verifyAtEdge(envelope, tools, label = null) {
  const bytes = envelope instanceof Uint8Array ? envelope : new Uint8Array(0);
  const parsed = unpack(bytes);
  const facts = { label, parsed, sigOk: false, dataTagOk: null, reproducedMicro: null,
    cardHash: await tools.sha256hex(bytes), inputsHash: null, outputsHash: null };
  if (parsed.ok) {
    let sigOk = false;
    try { sigOk = (await tools.verify(parsed.signedBytes, parsed.sig, parsed.pubkey)) === true; } catch { sigOk = false; }
    facts.sigOk = sigOk;
    if (sigOk) {
      facts.dataTagOk = sameBytes(parsed.dataTag, tagFromHex(tools.dataSha256Hex));
      if (facts.dataTagOk) {
        const seedStr = bytesToStr(parsed.seed);
        facts.inputsHash = await tools.sha256hex(strToBytes(seedStr + '|' + tools.dataSha256Hex));
        const g = await tools.germinate(seedStr);
        if (g && g.ok === true) {
          facts.reproducedMicro = aucToMicro(g.heldAuc);
          facts.outputsHash = await tools.sha256hex(strToBytes(String(g.body)));
        }
      }
    }
  }
  return receipt(facts);
}
