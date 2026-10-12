// grow-on.test.mjs — the worker's grow and the rule that a model may only PROPOSE: a suggestion replaces the grown
// champion only if it strictly beats it on the grow's own selection split. Real data, tiny grow configs (each grow
// well under a second) so the mutation gate can run this file per mutant. The pinned numbers are measured on the
// sealed dataset; a changed byte of data or a changed split moves them, which is the point.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSessions, STEM, keyOf, GRID, WIRINGS } from './organ.mjs';
import { decodeSpore } from './spore.mjs';
import { growOn, carriable, extraEvals } from './grow-on.mjs';
import { CARD_SEED } from './spore-card.mjs';

const CSV = join(dirname(fileURLToPath(import.meta.url)), 'data', 'online_shoppers_intention.csv');
const text = readFileSync(CSV, 'utf8');
const data = parseSessions(text);
const TINY = '◊ spore.v1 funnel 11 g:2.1.1';      // stem + one random genome, one generation: the stem wins
const SMALL = '◊ spore.v1 funnel 11 g:3.1.2';     // a champion that wins selection but not confirmation
const SEALED = decodeSpore(CARD_SEED).spore.genome;

const base = growOn(data, TINY);

test('carriable: only a genome the card format carries exactly and a verifier would accept', () => {
  assert.equal(carriable(STEM), true);
  assert.equal(carriable(SEALED), true);
  for (const bad of [null, undefined, 5, 'x', [], true, {}, { ...STEM, bins: 99 }]) assert.equal(carriable(bad), false, String(bad));
  // the bit fields hold more values than the grids have: an index one past the end packs exactly but is refused
  assert.equal(carriable({ ...STEM, book: GRID.book.length }), false, 'book index = grid length');
  assert.equal(carriable({ ...STEM, book: GRID.book.length - 1 }), true, 'the last real book setting');
  assert.equal(carriable({ ...STEM, wiring: WIRINGS.length }), false, 'wiring index = number of wirings');
});

test('a fixed seed with a setting past its grid is refused at decoding — nothing germinates it', () => {
  const hostile = '◊ spore.v1 funnel 1 f:c6feffff5fda3500';     // book 15 of 9, pairK 7 of 7: a ~125 s re-run before
  assert.deepEqual(decodeSpore(hostile), { ok: false, error: 'a genome setting is past the end of its grid' });
  assert.equal(decodeSpore(CARD_SEED).ok, true, 'the sealed seed still decodes');
});

test('extraEvals: two confirmation assessments, one per proposal, and one spare when there are proposals', () => {
  assert.equal(extraEvals(0), 2);
  assert.equal(extraEvals(1), 4);
  assert.equal(extraEvals(3), 6);
  for (const bad of [-1, 1.5, 'x', null, NaN]) assert.equal(extraEvals(bad), 2, String(bad));
});

test('refuses anything that is not a grow spore, and an empty dataset', () => {
  assert.deepEqual(growOn(data, CARD_SEED), { ok: false, why: 'not a grow spore' });
  assert.deepEqual(growOn(data, 'not a spore'), { ok: false, why: 'not a grow spore' });
  const empty = parseSessions(text.slice(0, text.indexOf('\n') + 1));
  assert.deepEqual(growOn(empty, TINY), { ok: false, why: 'no training sessions' });
});

test('no proposals: the grown champion, every evaluation counted', () => {
  assert.equal(base.ok, true);
  assert.equal(base.championSpore, '◊ spore.v1 funnel 11 f:fffeff3f49da3401');
  assert.equal(keyOf(decodeSpore(base.championSpore).spore.genome), keyOf(STEM), 'the stem won this tiny grow');
  assert.equal(base.evals, 4, 'two grow evaluations + two confirmation assessments');
  assert.deepEqual([base.proposed, base.skipped, base.proposedWon], [0, 0, false]);
  assert.equal(base.selectionFitness, 0.9172023671385472);
  assert.equal(base.championFitness, 0.9188993966117429);
  assert.equal(base.stemFitness, base.championFitness, 'the champion IS the stem, so they tie on confirmation');
  assert.equal(base.heldAuc, 0.8118898646196363);
  assert.deepEqual(growOn(data, TINY, 'not a list'), base, 'a non-list of proposals is no proposals');
});

test('a TIE does not replace the champion — a proposal must strictly beat it', () => {
  const r = growOn(data, TINY, [STEM]);
  assert.equal(r.proposedWon, false);
  assert.equal(r.championSpore, base.championSpore);
  assert.deepEqual([r.proposed, r.skipped, r.evals], [1, 0, 5]);
});

test('a better proposal replaces the champion — and the answer is exactly what was scored', () => {
  const r = growOn(data, TINY, [SEALED]);
  assert.equal(r.proposedWon, true);
  assert.equal(r.championSpore, CARD_SEED, 'the sealed genome, carried exactly');
  assert.equal(r.heldAuc, 0.8204977611516077);
  assert.ok(r.selectionFitness > base.selectionFitness);
  assert.ok(r.championFitness > r.stemFitness, 'it also beats the stem on the confirmation split');
  assert.deepEqual([r.proposed, r.skipped, r.evals], [1, 0, 5]);
});

test('a weaker proposal after a better one does not undo it; junk is skipped, not scored', () => {
  const r = growOn(data, TINY, [{}, null, 5, SEALED, STEM, { ...STEM, bins: 99 }]);
  assert.equal(r.championSpore, CARD_SEED);
  assert.equal(r.proposedWon, true);
  assert.deepEqual([r.proposed, r.skipped, r.evals], [2, 4, 6]);
});

test('a proposal that wins selection but fails confirmation is dropped — the model can never take a pass away', () => {
  // the SMALL grow's champion beats the tiny grow's champion on the shared inner split, then loses to the stem on
  // confirmation: offered as a proposal, it must not replace the grown champion in the answer
  const overfit = decodeSpore(growOn(data, SMALL).championSpore).spore.genome;
  const r = growOn(data, TINY, [overfit]);
  assert.equal(r.proposedWon, false, 'dropped after failing confirmation');
  assert.equal(r.championSpore, base.championSpore, 'the answer is exactly the model-free answer');
  assert.equal(r.championFitness, base.championFitness);
  assert.equal(r.selectionFitness, base.selectionFitness, 'the champion reported is the grown one, with its own selection score');
  assert.equal(r.heldAuc, base.heldAuc);
  assert.deepEqual([r.proposed, r.evals], [1, base.evals + 2], 'one evaluation for the proposal, one to re-judge the grown champion');
});

test('selection is not proof: a champion can win its own split and lose the confirmation split', () => {
  const r = growOn(data, SMALL);
  assert.equal(r.ok, true);
  assert.ok(r.selectionFitness > base.selectionFitness, 'it won selection');
  assert.equal(r.championFitness, 0.9081268855883036);
  assert.equal(r.stemFitness, 0.9188993966117429);
  assert.ok(r.championFitness < r.stemFitness, 'and lost to the stem on confirmation — this job would not be earned');
  assert.equal(r.evals, 7);
});
