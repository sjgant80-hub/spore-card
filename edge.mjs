// ════════════════════════════════════════════════════════════════
// edge.mjs — EDGE VERIFY: a node that receives a card does not trust it; it reproduces it.
//
// The mesh's one rule (MESH_PLAN §2b): re-run beats attest. A receiving node takes the facts about a card
// and rules on them, in this order, stopping at the first that fails:
//
//   1. parse   — is it a signed spore envelope at all?
//   2. seal    — does the Ed25519 signature cover these exact bytes? (fail = "seal mismatch")
//   3. cite    — only when awaiting an answer: does it cite MY job, signed by the worker I sent it to?
//   4. seed    — is the seed a FIXED genome (cheap to re-run)? A verifier never grows.
//   5. data    — does this node hold the dataset the claim was measured on? (else the claim cannot be re-run)
//   6. re-run  — germinate the seed HERE; the held-out score must come out identical to the claim.
//
// A signature proves WHO. Only the re-run proves WHAT. So a card can be perfectly signed and still be refused
// — if its claim does not reproduce on the receiver's own machine.
//
// Pure and total: the caller does the crypto and the germination and hands in the results, so this kernel is
// gated by mutation testing with no network, no clock and no keys. Credit: the edge re-run is the-doubt's
// primitive ("a thing cannot validate itself"), after Gary W. Floyd's GEP. Powered by the Konomi
// architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════

export const STAGES = Object.freeze(['parse', 'seal', 'cite', 'seed', 'data', 'rerun', 'accepted']);

const micro = (m) => (m / 1000000).toFixed(6);

/**
 * judge({ parsed, sigOk, dataTagOk, reproducedMicro }) → { accept, stage, reason }
 *   parsed           — envelope.unpack() result
 *   sigOk            — true only if the Ed25519 signature verified over parsed.signedBytes
 *   dataTagOk        — true only if this node's dataset hashes to the card's data tag
 *   reproducedMicro  — the held-out AUC this node got by germinating the seed itself, in millionths
 *   expectCites      — true when this node is waiting for the ANSWER to a job it sent
 *   citesOk          — true only if the answer's citation equals the hash of that job
 *   signerOk         — true only if the answer is signed by the worker that job was addressed to
 *   seedOk           — true only if the seed is a FIXED genome this node will re-run (for an answer: of the same
 *                      recipe and seed number as the job). A verifier never grows: re-running must stay cheap, or a
 *                      self-signed card could make any node do unbounded work. seedWhy may say why not.
 */
export function judge(facts) {
  const f = (facts && typeof facts === 'object') ? facts : {};
  const p = f.parsed;
  if (!p || typeof p !== 'object' || p.ok !== true) {
    return { accept: false, stage: 'parse', reason: 'not a signed spore card — ' + ((p && typeof p.why === 'string') ? p.why : 'nothing readable') };
  }
  if (f.sigOk !== true) {
    return { accept: false, stage: 'seal', reason: 'seal mismatch — the Ed25519 signature does not cover these bytes' };
  }
  if (f.expectCites === true) {
    if (p.type !== 0x03) return { accept: false, stage: 'cite', reason: 'not an answer — this card cites no job' };
    if (f.citesOk !== true) return { accept: false, stage: 'cite', reason: 'this card answers a different job' };
    if (f.signerOk !== true) return { accept: false, stage: 'cite', reason: 'this answer is signed by a node the job was not sent to' };
  }
  if (f.seedOk !== true) {
    return { accept: false, stage: 'seed', reason: 'not a seed this node will re-run — ' + (typeof f.seedWhy === 'string' ? f.seedWhy : 'it is not a fixed genome') };
  }
  if (f.dataTagOk !== true) {
    return { accept: false, stage: 'data', reason: 'cannot re-run — this node does not hold the data the claim was measured on' };
  }
  if (!Number.isInteger(f.reproducedMicro)) {
    return { accept: false, stage: 'rerun', reason: 'the seed did not germinate on this node' };
  }
  if (f.reproducedMicro !== p.aucMicro) {
    return { accept: false, stage: 'rerun', reason: 'the claim does not reproduce — the card says ' + micro(p.aucMicro) + ', the re-run here gives ' + micro(f.reproducedMicro) };
  }
  return { accept: true, stage: 'accepted', reason: 'reproduced ' + micro(p.aucMicro) + ' here — the signature proves who, the re-run proved what' };
}

/**
 * The receipt a node writes for every card it judges — accepted or refused. Deterministic: the same inputs give
 * the same object, so a receipt can be regenerated and compared byte-for-byte (re-run beats attest, applied to
 * our own proof). Hashes are supplied by the caller (hex strings); this kernel computes none.
 */
export function receipt(r) {
  const o = (r && typeof r === 'object') ? r : {};
  const v = judge(o);
  const p = (o.parsed && o.parsed.ok === true) ? o.parsed : null;
  const hex = (x) => (typeof x === 'string' && /^[0-9a-f]*$/.test(x)) ? x : null;
  return {
    kind: 'spore-card-edge-verify',
    v: 1,
    case: typeof o.label === 'string' ? o.label : null,
    card: hex(o.cardHash),
    signer: p ? toHex(p.pubkey) : null,
    cites: p && p.cites instanceof Uint8Array ? toHex(p.cites) : null,
    claimed: p ? micro(p.aucMicro) : null,
    seal: o.sigOk === true ? 'verified' : (p ? 'mismatch' : 'unread'),
    data: o.dataTagOk === true ? 'held' : (o.dataTagOk === false ? 'not held' : 'unchecked'),
    reproduced: Number.isInteger(o.reproducedMicro) ? micro(o.reproducedMicro) : null,
    inputs: hex(o.inputsHash),
    outputs: hex(o.outputsHash),
    accept: v.accept,
    stage: v.stage,
    reason: v.reason,
  };
}

/** Lowercase hex of a Uint8Array; '' for anything else. */
export function toHex(bytes) {
  if (!(bytes instanceof Uint8Array)) return '';
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}
