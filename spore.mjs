// spore.mjs — fall-spore · the digital spore (grow-not-install).
//
// Don't transmit the grown build (big) — transmit the SEED/DNA (tiny): a genome + a recipe pointer + a grow-config,
// packed in a konomi-family codec. On arrival a universal, one-time RIBOSOME reads the DNA and GROWS the working build
// locally: it differentiates the stem on the client's own sessions, then fits the organ (the body).
//
// HONESTY: germination here is DETERMINISTIC ASSEMBLY. The ribosome is a decoder plus the pattern-organs miner/evolver
// (grow + fit from organ.mjs) — it is NOT a language model. No femtoLLM runs inside the measured germination. A femtoLLM
// (a real small model) is only an OPTIONAL, non-load-bearing soft step for sensing which context to express; it is kept
// outside this kernel. Every function here is pure, deterministic and total: hostile input returns {ok:false}, never throws.
//
// The seven stem elements are the capability router's seven stages, whose basis is Thomas Frumkin's MACCubeFACE lattice.
// Powered by the Konomi architecture, created by Thomas Frumkin. The germination engine (grow/fit, the held-out protocol
// and the real UCI sessions) is reused from pattern-organs (sjgant80-hub), itself built on the Konomi architecture.

import {
  ELEMENTS, WIRINGS, FEATURES, GRID, PARAMS, STEM, VISITORS,
  TRAIN_MONTHS, HELD_MONTHS, rowsIn, split, fit, score, auc, grow,
  describeOrgan, elementsOf, settings,
} from './organ.mjs';

// ── bit width each genome field needs ──────────────────────────────────────────────────────────────────────────────
export const bitsFor = (n) => { let b = 0; while ((1 << b) < n) b++; return Math.max(1, b); };
// the genome is a fixed list of (name, width) — on (7 element bits), wiring, features (21 bits), then each param grid index
export const GENOME_FIELDS = [
  ['on', ELEMENTS.length],
  ['wiring', bitsFor(WIRINGS.length)],
  ['features', FEATURES.length],
  ...PARAMS.map((p) => [p, bitsFor(GRID[p].length)]),
];
export const GENOME_BITS = GENOME_FIELDS.reduce((s, [, w]) => s + w, 0);

// ── pack / unpack a genome to the fewest whole bytes ───────────────────────────────────────────────────────────────
export function packGenome(g) {
  const bytes = new Uint8Array(Math.ceil(GENOME_BITS / 8));
  let pos = 0;
  for (const [name, width] of GENOME_FIELDS) {
    let v = Number(g && g[name]);
    if (!Number.isInteger(v) || v <= -1) v = 0;  // a field is a non-negative integer; anything else is 0
    v &= (1 << width) - 1;                       // clamp into its width; never overflow into the next field
    for (let k = 0; k < width; k++) {
      if ((v >> k) & 1) bytes[pos >> 3] |= 1 << (pos & 7);
      pos++;
    }
  }
  return bytes;
}
export function unpackGenome(bytes) {
  const g = {};
  let pos = 0;
  for (const [name, width] of GENOME_FIELDS) {
    let v = 0;
    for (let k = 0; k < width; k++) {
      if ((bytes[pos >> 3] >> (pos & 7)) & 1) v |= 1 << k;
      pos++;
    }
    g[name] = v;
  }
  return g;
}

// ── lowercase-hex for the packed genome bytes (no deps, browser-safe, total) ────────────────────────────────────────
export const toHex = (bytes) => Array.from(bytes, (b) => (b & 255).toString(16).padStart(2, '0')).join('');
export function fromHex(str) {
  const s = String(str), bytes = [];
  for (let i = 0; i + 1 < s.length; i += 2) {
    const v = parseInt(s.slice(i, i + 2), 16);
    if (Number.isNaN(v)) break;
    bytes.push(v);
  }
  return Uint8Array.from(bytes);
}

// ── the recipes: the universal (one-time) machinery the ribosome already holds. A spore names which recipe; the recipe
//    carries the stem to grow from and the context map it can express. Holographic: every spore can express any context
//    the recipe defines; the context present at germination decides which organ grows. ─────────────────────────────────
export const RECIPES = {
  funnel: {
    label: 'funnel pattern-organ',
    stem: STEM,
    contexts: {
      all: { visitor: null, label: 'every visitor' },
      returning: { visitor: 'Returning_Visitor', label: 'returning visitors' },
      new: { visitor: 'New_Visitor', label: 'new visitors' },
    },
  },
};
const RECIPE_IDS = Object.keys(RECIPES);

// ── the spore: {v, recipe, seed, grow:{population,elites,generations}|null, genome|null} ────────────────────────────
// A grow-spore ships the stem and a grow-config (differentiate on arrival). A fixed-spore ships a genome to express directly.
export function makeSpore({ recipe = 'funnel', seed = 1, grow: growCfg = null, genome = null } = {}) {
  return { v: 1, recipe, seed: seed >>> 0, grow: growCfg, genome };
}

export const SPORE_TAG = '◊ spore.v1';   // ◊ spore.v1
// encode: "◊ spore.v1 <recipe> <seed> <g:P.E.G | f:b64genome>"
export function encodeSpore(spore) {
  const recipe = RECIPE_IDS.includes(spore && spore.recipe) ? spore.recipe : 'funnel';
  const seed = (spore && spore.seed) >>> 0;
  let body;
  if (spore && spore.grow) {
    const { population, elites, generations } = spore.grow;
    body = 'g:' + [population, elites, generations].map((x) => x >>> 0).join('.');
  } else {
    body = 'f:' + toHex(packGenome((spore && spore.genome) || STEM));
  }
  return [SPORE_TAG, recipe, String(seed), body].join(' ');
}
export function decodeSpore(str) {
  if (typeof str !== 'string') return { ok: false, error: 'a spore is a string' };
  const parts = str.trim().split(/\s+/);
  if (parts.slice(0, 2).join(' ') !== SPORE_TAG) return { ok: false, error: 'not a fall-spore (missing ◊ spore.v1 tag)' };
  const recipe = parts[2];
  if (!RECIPE_IDS.includes(recipe)) return { ok: false, error: 'unknown recipe: ' + recipe };
  const seed = Number(parts[3]);
  if (!Number.isInteger(seed) || seed < 1) return { ok: false, error: 'seed must be a whole number ≥ 1' };
  const body = parts[4] || '';
  if (body.startsWith('g:')) {
    const [population, elites, generations] = body.slice(2).split('.').map(Number);
    if (![population, elites, generations].every((x) => Number.isInteger(x) && x >= 1)) return { ok: false, error: 'bad grow-config' };
    if (elites >= population) return { ok: false, error: 'elites must be fewer than the population' };
    return { ok: true, spore: { v: 1, recipe, seed, grow: { population, elites, generations }, genome: null } };
  }
  if (body.startsWith('f:')) {
    const genome = unpackGenome(fromHex(body.slice(2)));
    return { ok: true, spore: { v: 1, recipe, seed, grow: null, genome } };
  }
  return { ok: false, error: 'spore body must be g: (grow) or f: (fixed genome)' };
}

// ── the rows a context expresses on (a visitor-type sub-population, or all) ─────────────────────────────────────────
const ctxRows = (data, months, ctx) =>
  rowsIn(data, months).filter((i) => !ctx || !ctx.visitor || data.cols.VisitorType[i] === ctx.visitor);
// exported: the rows of one named context in one set of months (returns [] for anything unknown — total)
export function contextRows(data, months, contextName = 'all', recipeId = 'funnel') {
  const recipe = RECIPES[recipeId];
  if (!data || !recipe || !recipe.contexts[contextName] || !Array.isArray(months)) return [];
  return ctxRows(data, months, recipe.contexts[contextName]);
}

// ── GERMINATE: read the DNA, grow/fit the organ on the client's own sessions for one context. Deterministic. Total. ──
// tick() is called once per organ evaluated, so a UI can show growth.
export function germinate(data, spore, contextName = 'all', tick = () => {}) {
  if (!data || data.ok === false || !data.n) return { ok: false, error: 'germinate needs parsed sessions' };
  let S = spore;
  if (typeof spore === 'string') { const d = decodeSpore(spore); if (!d.ok) return d; S = d.spore; }
  if (!S || !RECIPES[S.recipe]) return { ok: false, error: 'spore has no known recipe' };
  const recipe = RECIPES[S.recipe];
  const ctx = recipe.contexts[contextName];
  if (!ctx) return { ok: false, error: 'unknown context: ' + contextName };
  const train = ctxRows(data, TRAIN_MONTHS, ctx);
  const held = ctxRows(data, HELD_MONTHS, ctx);
  if (!train.length || !held.length) return { ok: false, error: 'context ' + contextName + ' has no sessions in train or held-out months' };

  let genome, grownFrom;
  if (S.grow) {
    const inner = split(data, train, 1 / 3, S.seed);
    const cfg = { population: S.grow.population, elites: S.grow.elites, generations: S.grow.generations, resamples: 1 };
    if (cfg.elites >= cfg.population) return { ok: false, error: 'elites must be fewer than the population' };
    const res = grow(data, inner, S.seed, cfg, tick);
    genome = res.champion.g;
    grownFrom = { stem: true, evals: res.evals, history: res.history };
  } else {
    genome = S.genome || recipe.stem;
    grownFrom = { stem: false, evals: 0 };
  }
  const organ = fit(data, train, genome, S.seed);
  const scores = held.map((i) => score(organ, data, i));
  const y = held.map((i) => data.y[i]);
  return {
    ok: true, context: contextName, genome, organ, grownFrom,
    train: train.length, held: held.length,
    heldAuc: auc(scores, y),
    base: y.reduce((a, v) => a + v, 0) / y.length,
  };
}

// ── the grown body: what you would deploy to score sessions (the fitted books). This is the "forest". ───────────────
export function organBody(organ) {
  const book = (b) => ({
    base: round6(b.base),
    patterns: b.patterns.map((p) => ({
      conds: p.conds.map((c) => ({ f: c.f, op: c.op, v: round6(c.v) })),
      up: p.up, rate: round6(p.rate), lift: round6(p.lift),
    })),
  });
  return {
    genome: organ.genome, wiring: organ.wiring,
    global: book(organ.global),
    segments: [...organ.segments].map(([k, b]) => [k, book(b)]),
  };
}
const round6 = (v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
export const utf8Bytes = (s) => { let n = 0; for (const ch of String(s)) { const c = ch.codePointAt(0); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; } return n; };

// ── the ratio: tiny spore vs the grown body it grows into ──────────────────────────────────────────────────────────
export function ratioOf(spore, organ) {
  const sporeStr = typeof spore === 'string' ? spore : encodeSpore(spore);
  const sporeBytes = utf8Bytes(sporeStr);
  const bodyStr = JSON.stringify(organBody(organ));
  const grownBytes = utf8Bytes(bodyStr);
  return { sporeBytes, grownBytes, ratio: sporeBytes > 0 ? round6(grownBytes / sporeBytes) : 0 };
}

// ── OFFLINE PROBE: run a function with the network globals trapped. Proves germination touches no network. Total. ───
export function probeOffline(fn) {
  const g = globalThis;
  const saved = { fetch: g.fetch, XMLHttpRequest: g.XMLHttpRequest, WebSocket: g.WebSocket, importScripts: g.importScripts };
  let touched = false;
  const mark = (name) => { touched = true; throw new Error('network blocked during germination: ' + name); };
  try {
    g.fetch = (...a) => mark('fetch');
    g.XMLHttpRequest = function () { mark('XMLHttpRequest'); };
    g.WebSocket = function () { mark('WebSocket'); };
    g.importScripts = (...a) => mark('importScripts');
    let ok = true, error = null, result = null;
    try { result = fn(); } catch (e) { ok = false; error = String((e && e.message) || e); }
    return { ok, networkTouched: touched, error, result };
  } finally {
    g.fetch = saved.fetch; g.XMLHttpRequest = saved.XMLHttpRequest; g.WebSocket = saved.WebSocket; g.importScripts = saved.importScripts;
  }
}

// ── DIFFERENTIATION: the same spore in two contexts grows two organs. Matched = the organ graded on its OWN context's
//    held-out; crossed = the FOREIGN organ graded on that same held-out. If matched beats crossed, the differentiation
//    is functional, not cosmetic. Total. ─────────────────────────────────────────────────────────────────────────────
export function differentiate(data, spore, a = 'returning', b = 'new', tick = () => {}) {
  const ga = germinate(data, spore, a, tick);
  const gb = germinate(data, spore, b, tick);
  if (!ga.ok) return ga;
  if (!gb.ok) return gb;
  const ctxA = RECIPES[(typeof spore === 'string' ? decodeSpore(spore).spore : spore).recipe].contexts[a];
  const ctxB = RECIPES[(typeof spore === 'string' ? decodeSpore(spore).spore : spore).recipe].contexts[b];
  const heldA = ctxRows(data, HELD_MONTHS, ctxA), heldB = ctxRows(data, HELD_MONTHS, ctxB);
  const on = (organ, rows) => auc(rows.map((i) => score(organ, data, i)), rows.map((i) => data.y[i]));
  const aucA = { matched: round6(on(ga.organ, heldA)), crossed: round6(on(gb.organ, heldA)) };
  const aucB = { matched: round6(on(gb.organ, heldB)), crossed: round6(on(ga.organ, heldB)) };
  return {
    ok: true,
    a: { context: a, genome: ga.genome, elements: elementsOf(ga.genome.on), ...aucA, gain: round6(aucA.matched - aucA.crossed) },
    b: { context: b, genome: gb.genome, elements: elementsOf(gb.genome.on), ...aucB, gain: round6(aucB.matched - aucB.crossed) },
    sameGenome: JSON.stringify(ga.genome) === JSON.stringify(gb.genome),
  };
}
// (the single-measure PageValues reference is organ.mjs's `reference` — reused, not duplicated here, so the inlined
//  page module has one definition of it.)
