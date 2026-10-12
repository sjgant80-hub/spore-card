// ════════════════════════════════════════════════════════════════
// job.mjs — a SIGNED JOB: "grow this seed on your machine and send me back the champion, signed."
//
// MESH_PLAN step 1. A phone can ask; a laptop can grow. The asker signs a job; the worker refuses it unless
// every check passes, grows the seed, keeps the champion only if it EARNED its place, and seals it as an answer
// card (envelope 0x03) that cites this job's full hash. The asker then re-runs the answer (edge.mjs) — growing is
// expensive, checking the grown result is cheap.
//
//   {
//     v: 1, kind: 'grow',
//     spore:    '◊ spore.v1 <recipe> <seed> g:<population>.<elites>.<generations>'   what to grow
//     context:  'all' | 'returning' | 'new'                                         which visitors it grows for
//     dataTag:  8 hex chars    — the data the answer must be measured on (first 4 bytes of its sha256)
//     maxEvals: integer        — the most organ evaluations the asker will let the worker spend
//     requester: 64 hex chars  — the asker's raw Ed25519 public key
//     worker:   64 hex chars   — the ONE worker this job is addressed to (its raw public key). Inside the signed
//                                bytes, so a captured job cannot be replayed on another worker, and the asker
//                                accepts an answer only from this key.
//     nonce:    16 hex chars   — never reused by a requester (the worker refuses a replay)
//     issued, expires: integer seconds since the epoch
//     sig:      128 hex chars  — Ed25519 by `requester` over jobSignable(job)
//   }
//
// The worker checks, in order: shape → seal → time → audience → replay → allowed → data → limits. The first four
// are `admissible`. A worker runs checkJob once with seen=false BEFORE claiming, and claims the job's nonce (an
// ATOMIC insert-if-absent) only if everything else passes — so a refused job never consumes or probes its replay
// memory — then runs checkJob again with the claim's result. Pure and total: the caller does the crypto, the clock and the replay
// memory and hands in the facts. Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════

export const JOB_V = 1;
export const KINDS = Object.freeze(['grow']);
// v1 jobs grow for every visitor only: an answer card does not record a context, so a card grown for one
// sub-population could not be re-run correctly by a third party later. Other contexts need that field first.
export const CONTEXTS = Object.freeze(['all']);
export const CAPS = Object.freeze({ maxEvals: 500, maxTtl: 7 * 24 * 3600, skew: 300, maxPopulation: 64, maxGenerations: 64 });
export const JOB_STAGES = Object.freeze(['shape', 'seal', 'time', 'audience', 'replay', 'allowed', 'data', 'limits', 'accepted']);

const FIELDS = ['v', 'kind', 'spore', 'context', 'dataTag', 'maxEvals', 'requester', 'worker', 'nonce', 'issued', 'expires', 'sig'];
const hex = (n) => new RegExp('^[0-9a-f]{' + n + '}$');
const HEX8 = hex(8), HEX16 = hex(16), HEX64 = hex(64), HEX128 = hex(128);
const GROW = /^◊ spore\.v1 ([a-z]+) ([1-9][0-9]{0,8}) g:([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/;

/** Canonical JSON: keys sorted at every depth. Total — anything JSON cannot say becomes null. */
export function canonical(v, seen) {
  try {
    if (v === null || typeof v !== 'object') { const s = JSON.stringify(v); return s === undefined ? 'null' : s; }
    const held = seen || new Set();
    if (held.has(v)) return 'null';
    held.add(v);
    const out = Array.isArray(v) ? '[' + v.map((x) => canonical(x, held)).join(',') + ']'
      : '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k], held)).join(',') + '}';
    held.delete(v);
    return out;
  } catch { return 'null'; }
}

/** The string the requester signs: the job without its signature, canonical. */
export function jobSignable(job) {
  const j = (job && typeof job === 'object' && !Array.isArray(job)) ? job : {};
  const out = {};
  for (const k of FIELDS) if (k !== 'sig' && k in j) out[k] = j[k];
  return canonical(out);
}

/** Read a grow spore's settings, or null. */
export function growSettings(spore) {
  const m = typeof spore === 'string' ? GROW.exec(spore) : null;
  if (!m) return null;
  const [population, elites, generations] = [m[3], m[4], m[5]].map(Number);
  return { recipe: m[1], seed: Number(m[2]), population, elites, generations };
}

/** Organ evaluations a grow costs: the first population, then every later generation's newborns. */
export function growCost(s) {
  if (!s || typeof s !== 'object') return Infinity;
  const { population: p, elites: e, generations: g } = s;
  if (![p, e, g].every(Number.isInteger)) return Infinity;
  return p + (g - 1) * (p - e);
}

/** Every field present, the right type and range, nothing extra. {ok, why}. */
export function shapeOf(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) return { ok: false, why: 'not a job object' };
  const extra = Object.keys(job).filter((k) => !FIELDS.includes(k));
  if (extra.length) return { ok: false, why: 'unknown field: ' + extra[0] };
  if (job.v !== JOB_V) return { ok: false, why: 'unsupported job version' };
  if (!KINDS.includes(job.kind)) return { ok: false, why: 'unknown job kind' };
  const s = growSettings(job.spore);
  if (!s) return { ok: false, why: 'the spore is not a grow spore' };
  if (s.population < 2 || s.population > CAPS.maxPopulation) return { ok: false, why: 'population must be 2–' + CAPS.maxPopulation };
  if (s.elites < 1 || s.elites >= s.population) return { ok: false, why: 'elites must be at least 1 and fewer than the population' };
  if (s.generations < 1 || s.generations > CAPS.maxGenerations) return { ok: false, why: 'generations must be 1–' + CAPS.maxGenerations };
  if (!CONTEXTS.includes(job.context)) return { ok: false, why: 'unknown context' };
  if (typeof job.dataTag !== 'string' || !HEX8.test(job.dataTag)) return { ok: false, why: 'the data tag must be 8 lowercase hex characters' };
  if (!Number.isInteger(job.maxEvals) || job.maxEvals < 1 || job.maxEvals > CAPS.maxEvals) return { ok: false, why: 'maxEvals must be 1–' + CAPS.maxEvals };
  if (typeof job.requester !== 'string' || !HEX64.test(job.requester)) return { ok: false, why: 'the requester must be a 32-byte key in hex' };
  if (typeof job.worker !== 'string' || !HEX64.test(job.worker)) return { ok: false, why: 'the worker must be a 32-byte key in hex' };
  if (typeof job.nonce !== 'string' || !HEX16.test(job.nonce)) return { ok: false, why: 'the nonce must be 16 hex characters' };
  if (!Number.isInteger(job.issued) || !Number.isInteger(job.expires) || job.issued < 0) return { ok: false, why: 'issued and expires must be whole seconds' };
  if (job.expires <= job.issued) return { ok: false, why: 'a job must expire after it is issued' };
  if (job.expires - job.issued > CAPS.maxTtl) return { ok: false, why: 'a job may live at most 7 days' };
  if (typeof job.sig !== 'string' || !HEX128.test(job.sig)) return { ok: false, why: 'the signature must be 64 bytes in hex' };
  return { ok: true, settings: s };
}

/**
 * Is this job one a worker may even CLAIM? shape → seal → time → audience. A worker claims the nonce only after
 * this passes, so a malformed, unsigned, stale or mis-addressed job never touches its replay memory. facts:
 *   sigOk — true only if `sig` verified over jobSignable(job) with `requester`
 *   now   — the worker's clock, seconds
 *   self  — the worker's own public key, hex
 */
export function admissible(job, facts) {
  const f = (facts && typeof facts === 'object') ? facts : {};
  const shape = shapeOf(job);
  if (!shape.ok) return { accept: false, stage: 'shape', reason: 'malformed job — ' + shape.why };
  if (f.sigOk !== true) return { accept: false, stage: 'seal', reason: 'seal mismatch — the requester did not sign this job' };
  if (!Number.isInteger(f.now)) return { accept: false, stage: 'time', reason: 'this worker has no clock to check the job against' };
  if (f.now + CAPS.skew < job.issued) return { accept: false, stage: 'time', reason: 'issued in the future — refused' };
  if (f.now >= job.expires) return { accept: false, stage: 'time', reason: 'expired — refused' };
  if (f.self !== job.worker) return { accept: false, stage: 'audience', reason: 'this job is addressed to another worker' };
  return { accept: true, stage: 'admissible', reason: 'well-formed, signed, current, and addressed to this worker', settings: shape.settings };
}

/**
 * The worker's full verdict. admissible() first, then:
 *   seen      — must be literally false: the result of an ATOMIC claim that inserted this requester's nonce just now
 *   allowed   — true if this worker agreed to run this requester's jobs
 *   dataTag   — the worker's own data tag (8 hex)
 *   maxEvals  — the most evaluations this worker will spend (≤ CAPS.maxEvals)
 *   extra     — evaluations beyond the grow itself (confirmation, model proposals), counted against the job's limit
 */
export function checkJob(job, facts) {
  const pre = admissible(job, facts);
  if (!pre.accept) return pre;
  const f = facts;   // admissible accepts only when facts.sigOk is literally true, so facts is a real object from here on
  if (f.seen !== false) return { accept: false, stage: 'replay', reason: 'this job was already run here — a replay is refused' };
  if (f.allowed !== true) return { accept: false, stage: 'allowed', reason: 'this worker has not agreed to run jobs from this requester' };
  if (f.dataTag !== job.dataTag) return { accept: false, stage: 'data', reason: 'this worker does not hold the data the job names' };
  // A cap of zero or less refuses every job (shapeOf demands maxEvals ≥ 1); a non-integer cap (Infinity, NaN) is 0.
  const cap = Number.isInteger(f.maxEvals) ? Math.min(f.maxEvals, CAPS.maxEvals) : 0;
  if (job.maxEvals > cap) return { accept: false, stage: 'limits', reason: 'the job asks for more evaluations than this worker allows' };
  const extra = Number.isInteger(f.extra) ? Math.max(0, f.extra) : 0;   // extra work can only ADD to the cost
  const cost = growCost(pre.settings) + extra;
  if (cost > job.maxEvals) return { accept: false, stage: 'limits', reason: 'the grow needs ' + cost + ' evaluations; the job allows ' + job.maxEvals };
  return { accept: true, stage: 'accepted', reason: 'a well-formed, signed, current, first-time job from an allowed requester, within limits', cost };
}

/** The worker's keep rule: seal the grown champion only if it EARNED its place over the ungrown stem — judged on a
 *  CONFIRMATION split of the training months that the grow never selected on (so selection alone cannot make the
 *  champion look better), and never on the held-out months the answer's claim will report. */
export function earned(championFitness, stemFitness) {
  // Number.isFinite never coerces: a string, null or object is not finite, so no separate type check is needed.
  if (!Number.isFinite(championFitness) || !Number.isFinite(stemFitness)) return false;
  return championFitness > stemFitness;
}
