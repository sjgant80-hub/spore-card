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

import { strToBytes, bytesToStr, frame, unframe, encodeMatrix, decodeMatrix, V2, V3 } from './spore-card.mjs';
import { packUnsigned, attachSignature, unpack, aucToMicro, sameBytes, TAG_LEN, ANSWER_TYPE } from './envelope.mjs';
import { receipt, toHex } from './edge.mjs';
import { canonical, jobSignable, shapeOf, admissible, checkJob, earned, growSettings, growCost, JOB_V } from './job.mjs';
import { decodeSpore } from './spore.mjs';
import { extraEvals } from './grow-on.mjs';

/** hex → bytes; anything that is not even-length lowercase hex gives an empty array. */
export function hexToBytes(h) {
  if (typeof h !== 'string' || h.length % 2 !== 0 || !/^[0-9a-f]*$/.test(h)) return new Uint8Array(0);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}

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

/**
 * A picture's module grid → the signed envelope inside it. The geometry is chosen by the grid's own size
 * (63×63 = a signed card, 69×69 = a signed answer); the frame's version must agree with it.
 */
export function envelopeFromCells(cells) {
  const n = cells && Number.isInteger(cells.length) ? cells.length : 0;
  const geo = n === V3.MODULES * V3.MODULES ? V3 : V2;
  const d = decodeMatrix(cells, geo.MODULES, geo.REPS);
  if (!d.ok) return { ok: false, why: d.error };
  const u = unframe(d.frame);
  if (!u.ok) return { ok: false, why: u.error };
  if (u.ver === 1) return { ok: false, why: 'an unsigned (v1) card — there is no signature to check' };
  if (u.ver !== geo.VER) return { ok: false, why: 'the frame version does not match the card shape' };
  return { ok: true, envelope: u.payload };
}

/**
 * Edge verify. Checks the seal first and only germinates a card whose signature holds, whose citation (for an
 * answer) is to the job this node sent, and whose data this node has — nothing unverified is run. Pass `job`
 * when this node is waiting for the answer to a job. Returns the receipt (edge.receipt), accepted or refused.
 */
export async function verifyAtEdge(envelope, tools, label = null, job = null) {
  const bytes = envelope instanceof Uint8Array ? envelope : new Uint8Array(0);
  const parsed = unpack(bytes);
  const facts = { label, parsed, sigOk: false, dataTagOk: null, reproducedMicro: null,
    cardHash: await tools.sha256hex(bytes), inputsHash: null, outputsHash: null,
    expectCites: job !== null, citesOk: null, signerOk: null, seedOk: null, seedWhy: null };
  if (parsed.ok) {
    let sigOk = false;
    try { sigOk = (await tools.verify(parsed.signedBytes, parsed.sig, parsed.pubkey)) === true; } catch { sigOk = false; }
    facts.sigOk = sigOk;
    if (sigOk && job !== null) {
      facts.citesOk = parsed.type === ANSWER_TYPE && sameBytes(parsed.cites, hexToBytes(await jobHashHex(job, tools)));
      facts.signerOk = toHex(parsed.pubkey) === String(job && job.worker);
    }
    if (sigOk && (job === null || (facts.citesOk === true && facts.signerOk === true))) {
      const seedStr = bytesToStr(parsed.seed);
      const s = reRunnable(seedStr, job);
      facts.seedOk = s.ok; facts.seedWhy = s.why;
      if (s.ok) {
        facts.dataTagOk = sameBytes(parsed.dataTag, tagFromHex(tools.dataSha256Hex));
        if (facts.dataTagOk) {
          facts.inputsHash = await tools.sha256hex(strToBytes(seedStr + '|' + tools.dataSha256Hex));
          const g = await tools.germinate(seedStr);
          if (g && g.ok === true) {
            facts.reproducedMicro = aucToMicro(g.heldAuc);
            facts.outputsHash = await tools.sha256hex(strToBytes(String(g.body)));
          }
        }
      }
    }
  }
  return receipt(facts);
}

/**
 * Will this node re-run this seed? Only a FIXED genome — re-running one is a single cheap fit. A grow spore would
 * make the verifier do the grow itself (unbounded work, at the say-so of whoever signed the card), so it is refused.
 * For an answer, the genome must also belong to the job's own recipe and seed number.
 */
export function reRunnable(seedStr, job = null) {
  const d = decodeSpore(seedStr);
  if (!d.ok) return { ok: false, why: 'the seed does not decode' };
  if (d.spore.grow || !d.spore.genome) return { ok: false, why: 'it is a grow spore — a verifier re-runs a fixed genome and never grows' };
  if (job !== null) {
    const g = growSettings(job && job.spore);
    if (!g || g.recipe !== d.spore.recipe || g.seed !== d.spore.seed) return { ok: false, why: 'the genome is not of the seed the job asked to grow' };
  }
  return { ok: true, why: null };
}

// ── jobs: "grow this seed on your machine and send me back the champion, signed" ───────────────────────

/** The job's full hash: sha256 of its canonical form, signature included — what an answer must cite. */
export async function jobHashHex(job, tools) {
  return tools.sha256hex(strToBytes(canonical(job)));
}

/** The requester signs a grow job addressed to ONE worker (its public key, hex). `nonce`: 16 hex chars, never reused. */
export async function makeJob({ spore, maxEvals, now, nonce, worker, ttl = 3600 }, tools) {
  const job = { v: JOB_V, kind: 'grow', spore, context: 'all', dataTag: tools.dataSha256Hex.slice(0, 8), maxEvals,
    requester: toHex(tools.pubkey), worker, nonce, issued: now, expires: now + ttl };
  job.sig = toHex(await tools.sign(strToBytes(jobSignable(job))));
  return job;
}

/**
 * The worker. `worker` = { now, claim(key, expires), allow(requesterHex), maxEvals, proposals? }.
 *
 * claim(key, expires) must be an ATOMIC insert-if-absent: true only if it recorded this key just now (an in-memory
 * Set: `if (s.has(k)) return false; s.add(k); return true;` — IndexedDB add(), a file opened 'wx'). It is called only
 * after the job is admissible (shape, seal, time, addressed to this worker) and BEFORE anything else is awaited for
 * it, so two copies of one job delivered at once cannot both run. A worker that cannot record the claim does not run
 * the job. Then: grow (tools.grow, proposals capped so every evaluation fits the job's limit), seal only an EARNED
 * champion, as an answer citing the job's full hash.
 */
export async function runJob(job, tools, worker) {
  const w = (worker && typeof worker === 'object') ? worker : {};
  const self = toHex(tools.pubkey);
  let sigOk = false;
  if (shapeOf(job).ok) {
    try { sigOk = (await tools.verify(strToBytes(jobSignable(job)), hexToBytes(job.sig), hexToBytes(job.requester))) === true; } catch { sigOk = false; }
  }
  const pre = admissible(job, { sigOk, now: w.now, self });
  if (!pre.accept) return { ok: false, verdict: pre };
  let claimed = false;
  try { claimed = (await w.claim(job.requester + ':' + job.nonce, job.expires)) === true; } catch { claimed = false; }
  // cap the model's proposals so the grow, the confirmation and every proposal fit inside the job's limit
  const room = Math.max(0, job.maxEvals - growCost(pre.settings) - extraEvals(0));
  const proposals = (Array.isArray(w.proposals) ? w.proposals : []).slice(0, room);
  let allowed = false;
  try { allowed = (await w.allow(job.requester)) === true; } catch { allowed = false; }
  const verdict = checkJob(job, { sigOk, now: w.now, self, seen: !claimed, allowed, dataTag: tools.dataSha256Hex.slice(0, 8),
    maxEvals: w.maxEvals, extra: extraEvals(proposals.length) });
  if (!verdict.accept) return { ok: false, verdict };
  const g = await tools.grow(job.spore, proposals);
  if (!g || g.ok !== true) return { ok: false, verdict: { accept: false, stage: 'grow', reason: 'the seed did not grow here' + (g && g.why ? ' — ' + g.why : '') } };
  if (!earned(g.championFitness, g.stemFitness)) {
    return { ok: false, verdict: { accept: false, stage: 'earned', reason: 'the grow found nothing better than the stem — nothing was earned, nothing is sealed' }, grow: g };
  }
  const u = packUnsigned({ seed: strToBytes(g.championSpore), aucMicro: aucToMicro(g.heldAuc), dataTag: tagFromHex(tools.dataSha256Hex),
    cites: hexToBytes(await jobHashHex(job, tools)), pubkey: tools.pubkey });
  if (!u.ok) return { ok: false, verdict: { accept: false, stage: 'seal', reason: u.why } };
  const s = attachSignature(u.bytes, await tools.sign(u.bytes));
  if (!s.ok) return { ok: false, verdict: { accept: false, stage: 'seal', reason: s.why } };
  const enc = encodeMatrix(frame(s.bytes, V3.VER), V3.MODULES, V3.REPS);
  if (!enc.ok) return { ok: false, verdict: { accept: false, stage: 'seal', reason: enc.error } };
  return { ok: true, verdict, answer: s.bytes, cells: enc.cells, grow: g };
}
