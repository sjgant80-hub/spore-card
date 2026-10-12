// stage-grow.mjs — the stage engine: a grow that STARTS from the stage it grows from, and the numbers a holder
// re-computes to check a stage (held, the check-split scores, the replayed champion).
//
// Deterministic arithmetic over the vendored germination engine, not a decision kernel: every decision is made by
// stages.mjs from these numbers. It is value-tested — tools/stage-receipt.mjs --check re-runs every case and demands
// a byte-identical receipt — the same "gate the decisions, value-test the heavy maths" split as spore-card-image.mjs.
//
// growFrom is organ.mjs's grow with one change: the population starts from `first` (the previous stage's genome)
// instead of the stem. Everything else — the random stream, selection, crossing, mutation — is the engine's own,
// imported, so the vendored engine is not patched. Powered by the Konomi architecture, created by Thomas Frumkin;
// the grow is fall-spore / pattern-organs.
import { split, assess, STEM, TRAIN_MONTHS, rng, draw, randomGenome, cross, mutate, observe, coin, better, keyOf } from './organ.mjs';
import { germinate, encodeSpore, makeSpore, contextRows } from './spore.mjs';
import { aucToMicro } from './envelope.mjs';

export const ENGINE = 'stage-grow/1';

/** organ.grow, starting from `first` instead of STEM. Same random stream (seed·7919+1), same moves. */
export function growFrom(data, inner, seed, c, first, tick = () => {}) {
  const r = rng(seed * 7919 + 1);
  let born = 0;
  const live = (g) => { tick(); return { g, n: born++, ...assess(data, inner, g, seed, true) }; };
  let pop = [first, ...Array.from({ length: c.population - 1 }, () => randomGenome(r))].map(live);
  const best = () => pop.reduce((a, b) => (better(b, a) ? b : a));
  for (let gen = 1; gen < c.generations; gen++) {
    const battle = () => { const a = pop[draw(r, pop.length)], b = pop[draw(r, pop.length)]; return better(b, a) ? b : a; };
    const next = [...pop].sort((a, b) => (better(a, b) ? -1 : 1)).slice(0, c.elites);
    while (next.length < c.population) {
      const a = battle(), b = battle();
      const child = cross(a.g, b.g, r);
      next.push(live(coin(r) ? observe(child, a.look, r) : mutate(child, r)));
    }
    pop = next;
  }
  return { evals: born, champion: best() };
}

const trainOf = (data, rules) => contextRows(data, TRAIN_MONTHS, 'all', rules.recipe);

/** The held-out score of a fixed seed, in millionths (null if it does not germinate). */
export function heldMicro(data, seedStr) {
  const g = germinate(data, seedStr, 'all');
  return g && g.ok ? aucToMicro(g.heldAuc) : null;
}

/**
 * The check-split scores at seed number `seedNo`: the candidate's, and the bar — one score per distinct genome it
 * must beat (STEM and every ancestor). Integers (millionths), as stages.climbs compares them.
 */
export function checkScores(data, rules, seedNo, genome, ancestors) {
  const confirm = split(data, trainOf(data, rules), 1 / 3, seedNo + rules.confirmSalt);
  const score = (g) => aucToMicro(assess(data, confirm, g, seedNo, false).fitness);
  const seen = new Set(), bar = [];
  for (const g of [STEM, ...ancestors]) { const k = keyOf(g); if (!seen.has(k)) { seen.add(k); bar.push(score(g)); } }
  return { confMicro: score(genome), barMicros: bar };
}

/** The champion of the keyed grow for seed number `seedNo`, starting from `first`. */
export function stageChampion(data, rules, seedNo, first, tick) {
  const inner = split(data, trainOf(data, rules), 1 / 3, seedNo);
  return growFrom(data, inner, seedNo, rules.grow, first, tick).champion.g;
}

/** The fixed spore a stage carries. */
export const stageSpore = (rules, seedNo, genome) => encodeSpore(makeSpore({ recipe: rules.recipe, seed: seedNo, genome }));
