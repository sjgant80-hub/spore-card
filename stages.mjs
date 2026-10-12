// ════════════════════════════════════════════════════════════════
// stages.mjs — a card's stages: GROWN, keyed to who grew them, and re-run by whoever holds the card (CARD-SPEC §9).
//
// A card starts at stage 0: the rules' root seed. Stage k is a signed 0x04 link (envelope.mjs) whose seed is the
// champion of a grow that STARTS from stage k−1's genome, with a seed number keyed to (the rules, the hash of stage
// k−1, the grower's key, a try 0..7). The chain rides on the card in one `konomi-lineage` tEXt chunk; the card's own
// band is its latest link. Nothing on the card is believed — a holder re-checks, in order:
//
//   structure (instant: hashes and signatures only, nothing germinated) — judgeStructure
//     present → once → size → parse/links → bound → signature → order → rules → shape → key
//   lineage (the re-runs) — judgeLineage, per stage, cheapest first:
//     held   — the stage's own seed re-grows to exactly the held-out score it claims (it is MEASURED, never decides)
//     climb  — on a fresh check split, it beats STEM and EVERY genome it descends from by at least one millionth
//     replay — re-grown here from stage k−1 with its keyed seed number, the grow lands on exactly this genome
//
// Why each re-run: `held` stops a false number; `climb` makes "stronger descendant" mean something and stops a
// G → G′ → G alternation; `replay` + `key` stop a copied or hand-picked genome being passed off as one's own work —
// a signature proves WHO, only a re-run proves WHAT. The rules (data, grow config, root) live HERE, in the reader,
// under an id that never changes once sealed; a card only names them.
//
// Pure and total: no crypto, no clock, no I/O, no germination. The glue (stage-mesh.mjs) computes the facts — link
// hashes, signature checks, decoded seeds, the keyed seed numbers, the re-run results — and this file decides.
// Garbage in gives a refusal, never a throw. Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════

export const LINEAGE_KEYWORD = 'konomi-lineage';
export const STAGE_LINK = 0x04;
export const LIMITS = Object.freeze({ chunk: 8192, links: 9, tries: 8, seedBytes: 48, seedNoMax: 999999999 });
const LINK_FIXED = 2 + 4 + 4 + 32 + 32 + 64;           // type, L, claim, dataTag, prev, pubkey, sig — plus L seed bytes

/** The frozen rules a reader holds. A rules id never changes once sealed: a new engine needs a new id. */
export const RULES = Object.freeze({
  'funnel/1': Object.freeze({
    recipe: 'funnel',
    dataSha: 'b3055ee355f59134d851d32641183cb4a8b45def7124d2f50442a042f358e0d9',
    dataTag: 'b3055ee3',
    engine: 'stage-grow/1',
    rootSpore: '◊ spore.v1 funnel 11 f:fffeff3f49da3401',     // the ungrown STEM at seed 11
    grow: Object.freeze({ population: 8, elites: 2, generations: 6 }),   // 38 evaluations a stage
    confirmSalt: 104729,
    maxStages: 8,          // = LIMITS.links − 1: the link cap enforced while splitting is the stage cap
  }),
});

const RULES_ID = /^[a-z0-9-]{1,24}\/[0-9]{1,4}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const KEY_B64 = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;

/** The rules for an id this reader holds, or null (own keys only — '__proto__' is not a rules id). */
export function rulesFor(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(RULES, id) ? RULES[id] : null;
}

/** The text whose sha256 a fresh root's `prev` must be — computable for ANY well-formed id, held or not. */
export function rootPrevText(id) {
  return typeof id === 'string' && RULES_ID.test(id) ? 'fallkard-rules ' + id : null;
}

/** The text whose sha256 keys stage seed number `t` for this grower after this stage. null if anything is malformed. */
export function stageSeedMaterial(rulesId, prevHex, keyB64, t) {
  if (typeof rulesId !== 'string' || !RULES_ID.test(rulesId)) return null;
  if (typeof prevHex !== 'string' || !HEX64.test(prevHex)) return null;
  if (typeof keyB64 !== 'string' || !KEY_B64.test(keyB64)) return null;
  if (!Number.isInteger(t) || t < 0 || t >= LIMITS.tries) return null;
  return ['fallkard-stage/1', rulesId, prevHex, keyB64, t].join('|');
}

/** A sha256 hex digest → a seed number 1..999,999,999 (its first 4 bytes, big-endian, mod the cap, plus one); 0 if malformed. */
export function seedNoFrom(hex) {
  if (typeof hex !== 'string' || !HEX64.test(hex)) return 0;
  return 1 + (parseInt(hex.slice(0, 8), 16) % LIMITS.seedNoMax);
}

// ── base64 (canonical: what decodes must re-encode to exactly the same text) ───────────────────────────────────────
const toB64 = (u8) => btoa(Array.from(u8, (b) => String.fromCharCode(b)).join(''));
function fromB64(text) {
  let bin;
  try { bin = atob(text); } catch { return null; }
  const u8 = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return toB64(u8) === text ? u8 : null;
}

/** Cut the concatenated links into links — each self-delimiting by its own header. Refuses before any other work. */
export function splitStages(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return { ok: false, why: 'no stages' };
  const links = [];
  let o = 0;
  while (o < bytes.length) {
    if (links.length === LIMITS.links) return { ok: false, why: 'more than ' + LIMITS.links + ' stages' };
    const k = links.length;
    if (bytes[o] !== STAGE_LINK) return { ok: false, why: 'link ' + k + ': not a stage link' };
    const L = bytes[o + 1];
    if (!(L >= 1 && L <= LIMITS.seedBytes)) return { ok: false, why: 'link ' + k + ': its seed length is out of range' };
    const end = o + LINK_FIXED + L;
    if (end > bytes.length) return { ok: false, why: 'link ' + k + ': its length is not what its header says' };
    links.push(bytes.slice(o, end));
    o = end;
  }
  return { ok: true, links };
}

/** The chunk text → { ok, rulesId, links } or { ok:false, why }. Plain printable ASCII, exactly two fields. */
export function parseLineage(text) {
  if (typeof text !== 'string' || text.length > LIMITS.chunk) return { ok: false, why: 'not plain text' };
  if (!/^[\x20-\x7e]*$/.test(text)) return { ok: false, why: 'not plain text' };
  let o;
  try { o = JSON.parse(text); } catch { return { ok: false, why: 'not JSON' }; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, why: 'not JSON' };
  const extra = Object.keys(o).filter((k) => k !== 'rules' && k !== 'stages');
  if (extra.length) return { ok: false, why: 'unexpected field ' + extra[0] };
  if (typeof o.rules !== 'string' || !RULES_ID.test(o.rules)) return { ok: false, why: 'rules id is malformed' };
  if (typeof o.stages !== 'string') return { ok: false, why: 'missing field stages' };
  const bytes = fromB64(o.stages);
  if (!bytes) return { ok: false, why: 'stages are not canonical base64' };
  const s = splitStages(bytes);
  if (!s.ok) return { ok: false, why: s.why };
  return { ok: true, rulesId: o.rules, links: s.links };
}

/** The chunk text for these links — exactly what parseLineage reads back. null if anything is malformed. */
export function lineageText(rulesId, links) {
  if (typeof rulesId !== 'string' || !RULES_ID.test(rulesId) || !Array.isArray(links)) return null;
  if (!links.every((l) => l instanceof Uint8Array)) return null;
  const all = new Uint8Array(links.reduce((n, l) => n + l.length, 0));
  let o = 0;
  for (const l of links) { all.set(l, o); o += l.length; }
  const text = JSON.stringify({ rules: rulesId, stages: toB64(all) });
  const back = parseLineage(text);
  return back.ok && back.links.length === links.length ? text : null;
}

/** Integers only: the stage's check-split score must beat the best of everything it descends from. */
export function climbs(confMicro, barMicros) {
  if (!Number.isInteger(confMicro) || !Array.isArray(barMicros) || barMicros.length === 0) return false;
  if (!barMicros.every(Number.isInteger)) return false;
  return confMicro > Math.max(...barMicros);
}

/** The first try (0..7) that earned, or -1. */
export function firstEarning(earnedFlags) {
  return Array.isArray(earnedFlags) ? earnedFlags.slice(0, LIMITS.tries).indexOf(true) : -1;
}

const micro = (m) => (m / 1e6).toFixed(6);
const no = (check, at, reason) => ({ verdict: 'REFUSED', check, at, reason });
const wait = (check, at, reason) => ({ verdict: 'PENDING', check, at, reason });

/**
 * The instant half. parsed = parseLineage(chunkText) (or null when the card carries no chunk). facts:
 *   chunks        — how many konomi-lineage chunks the card carries (tEXt or zTXt)
 *   chunkBytes    — the size of the one chunk's text
 *   bound         — true when the card's own band (and spoR) is byte-equal to the last link
 *   rootPrevHex   — sha256 of rootPrevText(rulesId)
 *   engine        — the stage engine this reader runs (stage-grow.mjs ENGINE)
 *   links[k]      — { sigOk, hashHex, prevHex, claimMicro, dataTagHex, seedText, keyedSeedNos[8],
 *                     decoded: { ok, fixed, recipe, seedNo, why } }
 * → { verdict: 'NONE' | 'READY' | 'PENDING' | 'REFUSED', check, at, reason, claimed, tries }
 */
export function judgeStructure(parsed, facts) {
  const f = facts && typeof facts === 'object' ? facts : {};
  if (f.chunks === 0) return { verdict: 'NONE', check: 'present', at: null, reason: 'carries no stages (a stripped copy proves none)' };
  if (f.chunks !== 1) return no('once', null, 'two histories on one card');
  if (!Number.isInteger(f.chunkBytes) || f.chunkBytes > LIMITS.chunk) return no('size', null, 'the history is over 8 KiB — refused unread');
  if (!parsed || parsed.ok !== true) return no('parse', null, 'the stages riding on this card are unreadable — ' + (parsed && typeof parsed.why === 'string' ? parsed.why : 'nothing readable'));
  const n = parsed.links.length;
  const L = Array.isArray(f.links) ? f.links : [];
  if (L.length !== n) return no('parse', null, 'the stages riding on this card are unreadable — the facts do not match the links');
  if (f.bound !== true) return no('bound', null, 'the stages do not end at this card — its band carries a different latest stage');
  for (let k = 0; k < n; k++) {
    if (!L[k] || L[k].sigOk !== true) return no('signature', k, 'stage ' + k + ' is not signed by the key it names');
  }
  if (L[0].prevHex !== f.rootPrevHex) return no('order', 0, 'the first stage does not start from the rules it names');
  for (let k = 1; k < n; k++) {
    if (L[k].prevHex !== L[k - 1].hashHex) return no('order', k, 'stage ' + k + ' does not follow stage ' + (k - 1) + ' — a stage was spliced in, reordered or dropped');
  }
  const rules = rulesFor(parsed.rulesId);
  if (!rules) return wait('rules', null, 'grown by rules this reader does not hold (' + parsed.rulesId + ') — stages listed, not counted');
  if (f.engine !== rules.engine) return wait('rules', null, 'this reader\'s engine is not the one ' + parsed.rulesId + ' was sealed with — stages listed, not counted');
  const tries = [];
  for (let k = 0; k < n; k++) {
    const d = L[k].decoded && typeof L[k].decoded === 'object' ? L[k].decoded : {};
    const why = d.ok !== true ? (typeof d.why === 'string' ? d.why : 'it does not decode')
      : d.fixed !== true ? 'a grow seed'
      : d.recipe !== rules.recipe ? 'another recipe'
      : L[k].dataTagHex !== rules.dataTag ? 'measured on other data'
      : k === 0 && L[k].seedText !== rules.rootSpore ? 'not the starting model'
      : null;
    if (why) return no('shape', k, 'stage ' + k + ' is not a seed this reader will re-run — ' + why);
    if (k === 0) { tries.push(null); continue; }
    const t = Array.isArray(L[k].keyedSeedNos) ? L[k].keyedSeedNos.slice(0, LIMITS.tries).indexOf(d.seedNo) : -1;
    if (t < 0) return no('key', k, 'stage ' + k + '\'s seed number is not one its key may grow — copied or hand-picked');
    tries.push(t);
  }
  return { verdict: 'READY', check: 'structure', at: null, reason: 'the history is whole and signed — ' + (n - 1) + ' stage' + (n === 2 ? '' : 's') + ' to re-run', claimed: n - 1, tries };
}

/**
 * The re-run half. results[k] = { heldMicro, confMicro, barMicros, replayGenomeKey } for each stage re-run so far
 * (null from the first stage the time budget did not reach). facts: { dataOk, links[k]: { claimMicro, genomeKey } }.
 * → { verdict: 'PASS' | 'PENDING' | 'REFUSED', proven, check, at, reason }   proven = the last stage that re-ran (−1: none)
 */
export function judgeLineage(structure, results, facts) {
  const s = structure && typeof structure === 'object' ? structure : {};
  if (s.verdict !== 'READY') return { verdict: s.verdict === 'NONE' ? 'PASS' : (s.verdict === 'PENDING' ? 'PENDING' : 'REFUSED'), proven: -1, check: s.check || 'structure', at: s.at === undefined ? null : s.at, reason: s.reason || 'the history was not judged' };
  const f = facts && typeof facts === 'object' ? facts : {};
  if (f.dataOk !== true) return { verdict: 'PENDING', proven: -1, check: 'data', at: null, reason: 'cannot re-run here — this device does not hold the data these stages were measured on' };
  const L = Array.isArray(f.links) ? f.links : [];
  const R = Array.isArray(results) ? results : [];
  const n = s.claimed + 1;
  for (let k = 0; k < n; k++) {
    const r = R[k];
    if (!r || typeof r !== 'object') return { verdict: 'PENDING', proven: k - 1, check: 'budget', at: k, reason: 're-running stopped at stage ' + k + ' (time budget) — stages from ' + k + ' on are not proven here' };
    const claim = L[k] ? L[k].claimMicro : undefined;
    if (!Number.isInteger(r.heldMicro)) return { verdict: 'REFUSED', proven: k - 1, check: 'held', at: k, reason: 'stage ' + k + ' did not germinate here' };
    if (r.heldMicro !== claim) return { verdict: 'REFUSED', proven: k - 1, check: 'held', at: k, reason: 'stage ' + k + ' does not reproduce — the card says ' + (Number.isInteger(claim) ? micro(claim) : '?') + ', the re-run here gives ' + micro(r.heldMicro) };
    if (k === 0) continue;
    if (!climbs(r.confMicro, r.barMicros)) {
      const bar = Array.isArray(r.barMicros) && r.barMicros.every(Number.isInteger) && r.barMicros.length ? Math.max(...r.barMicros) : null;
      return { verdict: 'REFUSED', proven: k - 1, check: 'climb', at: k, reason: 'stage ' + k + ' does not beat everything it grew from on its own check split — it needs more than ' + (bar === null ? '?' : micro(bar)) + '; the re-run here gives ' + (Number.isInteger(r.confMicro) ? micro(r.confMicro) : '?') };
    }
    // L[k] exists here: a stage with no facts has no claim, so the held check above already refused it
    if (typeof r.replayGenomeKey !== 'string' || r.replayGenomeKey !== L[k].genomeKey) {
      return { verdict: 'REFUSED', proven: k - 1, check: 'replay', at: k, reason: 'stage ' + k + ' is not what its keyed grow makes — re-grown here from stage ' + (k - 1) + ' for this key, the grow lands on a different model' };
    }
  }
  return { verdict: 'PASS', proven: n - 1, check: 'lineage', at: null, reason: 'stages 0–' + (n - 1) + ' re-ran here: the signatures prove who, the re-runs proved what' };
}

/** A claimed stage against what re-ran here. */
export function stageCheck(claimed, proven, verdict) {
  if (verdict === 'PENDING') return 'pending';
  if (verdict !== 'PASS' || !Number.isInteger(claimed) || !Number.isInteger(proven)) return 'overclaim';
  return ['underclaim', 'earned', 'overclaim'][Math.sign(claimed - proven) + 1];
}
