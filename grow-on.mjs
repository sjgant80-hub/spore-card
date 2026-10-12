// grow-on.mjs — the worker's grow, pure: the same code in Node (node-tools.mjs) and in the browser (mesh-node.mjs).
//
// Grows a grow-spore exactly as fall-spore's germinate does (same inner split of the training months, same config),
// so growing seed 11 lands on the sealed fixed spore. Then decides whether the champion EARNED its place:
//
//   • the champion is SELECTED on the grow's inner split (fall-spore's own objective);
//   • it is JUDGED against the ungrown stem on a separate CONFIRMATION split — a re-partition of the training months
//     with a different seed, both genomes refit there — so the champion is not scored on the exact objective it was
//     chosen by. HONEST LIMIT: those rows overlap the ones the grow saw; this reduces selection bias, it does not
//     remove it. The held-out months are never used to decide anything — they are only measured, for the claim.
//
// Model proposals (proposer.mjs) are validated by an exact pack/unpack round-trip (a genome the card format cannot
// carry is skipped — never sealed as something other than what was scored), scored on the selection split, and one
// replaces the champion only if it beats it there. Every evaluation is counted. Powered by the Konomi architecture,
// created by Thomas Frumkin; the grow is fall-spore / pattern-organs.
import { split, assess, STEM, TRAIN_MONTHS, grow as organGrow, keyOf } from './organ.mjs';
import { germinate, decodeSpore, encodeSpore, makeSpore, contextRows, packGenome, unpackGenome } from './spore.mjs';

const CONFIRM_SALT = 104729;   // a fixed offset so the confirmation split never equals the selection split

/**
 * True only for a genome the card format carries exactly (pack/unpack is the identity on it). No separate type guard:
 * a non-genome either fails the round-trip or throws, and the catch is the guard (measured on 5, 'x', [], true, {}).
 */
export function carriable(g) {
  try { return keyOf(unpackGenome(packGenome(g))) === keyOf(g); } catch { return false; }
}

export function growOn(data, sporeStr, proposals = []) {
  const d = decodeSpore(sporeStr);
  if (!d.ok || !d.spore.grow) return { ok: false, why: 'not a grow spore' };
  const S = d.spore;
  const train = contextRows(data, TRAIN_MONTHS, 'all', S.recipe);
  if (!train.length) return { ok: false, why: 'no training sessions' };
  const inner = split(data, train, 1 / 3, S.seed);
  const res = organGrow(data, inner, S.seed, { ...S.grow, resamples: 1 });
  let evals = res.evals;

  let best = { g: res.champion.g, fitness: res.champion.fitness }, proposedWon = false, scored = 0, skipped = 0;
  for (const g of Array.isArray(proposals) ? proposals : []) {
    if (!carriable(g)) { skipped++; continue; }
    const a = assess(data, inner, g, S.seed, false);
    evals++; scored++;
    if (Number.isFinite(a.fitness) && a.fitness > best.fitness) { best = { g, fitness: a.fitness }; proposedWon = true; }
  }

  const confirm = split(data, train, 1 / 3, S.seed + CONFIRM_SALT);
  const championConfirm = assess(data, confirm, best.g, S.seed, false).fitness;
  const stemConfirm = assess(data, confirm, STEM, S.seed, false).fitness;
  evals += 2;

  const championSpore = encodeSpore(makeSpore({ recipe: S.recipe, seed: S.seed, genome: best.g }));
  const held = germinate(data, championSpore, 'all');
  if (!held.ok) return { ok: false, why: 'the champion did not germinate' };
  return { ok: true, championSpore, championFitness: championConfirm, stemFitness: stemConfirm, selectionFitness: best.fitness,
    heldAuc: held.heldAuc, evals, proposed: scored, skipped, proposedWon };
}

/** Evaluations a grow costs beyond growCost: the two confirmation assessments plus one per proposal. */
export const extraEvals = (proposalCount) => 2 + (Number.isInteger(proposalCount) ? Math.max(0, proposalCount) : 0);
