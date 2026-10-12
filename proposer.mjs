// ════════════════════════════════════════════════════════════════
// proposer.mjs — an OPTIONAL model that suggests genomes for a grow. Never trusted, never in charge.
//
// MESH_PLAN step 4: the laptop runs the job; a model (local Qwen/Llama, or the user's own key) may PROPOSE extra
// genomes. The seed stays the instruction layer and the gate stays the authority: each proposal is scored on the
// grow's own inner split, and is kept only if it beats the grown champion there (node-tools growOn). Without a
// model the grow still runs and still passes — the model can only ever add candidates.
//
// A model's reply is untrusted input. parseProposals reads it strictly: every element, wiring, measure and setting
// must be one fall-spore already defines; a field that is present but not a real value DROPS the genome — nothing
// is "repaired". A setting the model leaves out means "as the stem" (a stated default, not a guess). Pure, total.
//
// Powered by the Konomi architecture, created by Thomas Frumkin. Genome design: fall-spore / pattern-organs.
// ════════════════════════════════════════════════════════════════

import { ELEMENTS, WIRINGS, FEATURES, GRID, PARAMS, STEM } from './organ.mjs';

export const MAX_PROPOSALS = 8;
const ALL = 2 ** FEATURES.length - 1;

/**
 * One well-formed proposal, shown to the model so it answers with single VALUES. Measured: llama3.2:1b, given only
 * the option lists, copied the lists back as values — every proposal invalid. Built from the grid, so it is always
 * a real genome (proposer.test pins that).
 */
export const EXAMPLE = Object.fromEntries([
  ['elements', ELEMENTS.slice(0, 3)], ['wiring', WIRINGS[0]], ['measures', 'all'],
  ...PARAMS.map((p) => [p, GRID[p][Math.floor(GRID[p].length / 2)]]),
]);

/** The instruction a model gets. It names VALUES (not indices) so a model can reason about them. */
export function proposalPrompt(k = 4) {
  const n = Number.isInteger(k) && k > 0 ? Math.min(k, MAX_PROPOSALS) : 4;
  return [
    'Propose ' + n + ' settings for a small rule-learning model that predicts whether an online shopping session ends in a purchase.',
    'Each proposal is a JSON object with these keys:',
    '  "elements": a non-empty list chosen from ' + JSON.stringify(ELEMENTS),
    '  "wiring": one of ' + JSON.stringify(WIRINGS),
    '  "measures": "all", or a non-empty list chosen from ' + JSON.stringify(FEATURES),
    ...PARAMS.map((p) => '  "' + p + '": one of ' + JSON.stringify(GRID[p])),
    'Every value except "elements" and "measures" is ONE choice, never a list. One valid object, for example:',
    '  ' + JSON.stringify(EXAMPLE),
    'Make each of your ' + n + ' objects different from this example and from each other.',
    'Any key you leave out keeps its default. Reply with ONLY a JSON array of ' + n + ' objects.',
  ].join('\n');
}

/**
 * The proposals in a reply: its OUTERMOST JSON value — whichever bracket opens first. An array is the list; a lone
 * object is one proposal (measured: llama3.2:1b answers a request for an array with a single object, and reading
 * "the first '['" then picked up that object's own "elements" list). Anything that does not parse is null. No guard
 * for a missing closing bracket: the slice is then empty or one character, which JSON.parse refuses — the catch is it.
 */
function proposalsIn(text) {
  if (typeof text !== 'string') return null;
  const open = /[[{]/.exec(text);
  if (!open) return null;
  const close = open[0] === '{' ? '}' : ']';
  try {
    const v = JSON.parse(text.slice(open.index, text.lastIndexOf(close) + 1));
    if (Array.isArray(v)) return v;
    // JSON modes force a top-level object, so a model may wrap its list — {"proposals":[{…},…]}. A list of OBJECTS
    // inside is that list; otherwise the object is itself one proposal (its "elements" list is names, not objects).
    return Object.values(v).find((x) => Array.isArray(x) && x.some((o) => o && typeof o === 'object')) || [v];
  } catch { return null; }
}

/** One proposal object → a genome, or null if any present field is not a real value. */
export function toGenome(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const g = { ...STEM };
  if ('elements' in o) {
    if (!Array.isArray(o.elements) || o.elements.length === 0) return null;
    let on = 0;
    for (const e of o.elements) { const k = ELEMENTS.indexOf(e); if (k < 0) return null; on |= 1 << k; }
    g.on = on;
  }
  if ('wiring' in o) { const w = WIRINGS.indexOf(o.wiring); if (w < 0) return null; g.wiring = w; }
  if ('measures' in o) {
    if (o.measures === 'all') g.features = ALL;
    else {
      if (!Array.isArray(o.measures) || o.measures.length === 0) return null;
      let f = 0;
      for (const m of o.measures) { const k = FEATURES.indexOf(m); if (k < 0) return null; f |= 1 << k; }
      g.features = f;
    }
  }
  for (const p of PARAMS) {
    if (!(p in o)) continue;
    const idx = GRID[p].indexOf(o[p]);
    if (idx < 0) return null;
    g[p] = idx;
  }
  return g;
}

const keyOf = (g) => [g.on, g.wiring, g.features, ...PARAMS.map((p) => g[p])].join('.');

/** A model's reply → at most MAX_PROPOSALS distinct, valid genomes, and how many it offered that were dropped. */
export function parseProposals(text) {
  const arr = proposalsIn(text);
  if (!arr) return { genomes: [], offered: 0, dropped: 0, why: 'no JSON proposals in the reply' };
  const genomes = [], seen = new Set();
  let dropped = 0;
  for (const o of arr.slice(0, MAX_PROPOSALS)) {
    const g = toGenome(o);
    if (!g) { dropped++; continue; }
    const k = keyOf(g);
    if (seen.has(k)) { dropped++; continue; }
    seen.add(k); genomes.push(g);
  }
  return { genomes, offered: Math.min(arr.length, MAX_PROPOSALS), dropped, why: null };
}
