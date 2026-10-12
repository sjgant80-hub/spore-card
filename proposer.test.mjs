// proposer.test.mjs — the untrusted-model parser, pinned. The witness mutates proposer.mjs against this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PROPOSALS, EXAMPLE, proposalPrompt, toGenome, parseProposals } from './proposer.mjs';
import { STEM, ELEMENTS, FEATURES, GRID } from './organ.mjs';

test('MAX_PROPOSALS is 8', () => assert.equal(MAX_PROPOSALS, 8));

test('the prompt names every key with its real values, and asks for k objects', () => {
  const p = proposalPrompt(3);
  assert.match(p, /^Propose 3 settings/);
  assert.match(p, /JSON array of 3 objects/);
  for (const e of ELEMENTS) assert.ok(p.includes('"' + e + '"'));
  assert.ok(p.includes('"bins": one of [3,4,5,6,8,10,12,16]'));
  assert.match(proposalPrompt(99), /^Propose 8 /, 'capped at MAX_PROPOSALS');
  assert.match(proposalPrompt(8), /^Propose 8 /);
  assert.match(proposalPrompt(0), /^Propose 4 /, 'a bad k falls back to 4');
  assert.match(proposalPrompt(-1), /^Propose 4 /);
  assert.match(proposalPrompt(2.5), /^Propose 4 /);
  assert.match(proposalPrompt(1), /^Propose 1 /);
});

test('the prompt shows one real proposal with single values, so a small model does not copy the lists back', () => {
  const g = toGenome(EXAMPLE);
  assert.ok(g, 'the example is a valid genome');
  assert.notDeepEqual(g, STEM, 'and not just the stem');
  assert.ok(proposalPrompt(4).includes(JSON.stringify(EXAMPLE)));
  assert.match(proposalPrompt(4), /ONE choice, never a list/);
  assert.match(proposalPrompt(3), /each of your 3 objects different/);
  for (const v of Object.values(EXAMPLE)) assert.ok(!Array.isArray(v) || v.every((x) => typeof x === 'string'), 'only the name lists are lists');
});

test('an empty object is the stem — leaving everything out means "as the stem"', () => {
  assert.deepEqual(toGenome({}), STEM);
});

test('every field maps to the exact genome value', () => {
  const g = toGenome({ elements: ['prove', 'connect'], wiring: 'mean', measures: [FEATURES[0], FEATURES[3]], bins: 16, book: 2, minSupport: 0.08,
    minLift: 3, smooth: 1, pairK: 30, proofZ: 0.5, halfLife: 12, ownMin: 100 });
  assert.equal(g.on, (1 << 0) | (1 << 6));
  assert.equal(g.wiring, 2);
  assert.equal(g.features, (1 << 0) | (1 << 3));
  assert.deepEqual([g.bins, g.book, g.minSupport, g.minLift, g.smooth, g.pairK, g.proofZ, g.halfLife, g.ownMin],
    [GRID.bins.length - 1, 0, GRID.minSupport.length - 1, GRID.minLift.length - 1, 0, GRID.pairK.length - 1, 0, GRID.halfLife.length - 1, 0]);
  assert.equal(toGenome({ measures: 'all' }).features, 2 ** FEATURES.length - 1);
  assert.equal(toGenome({ wiring: 'list' }).wiring, 0);
});

test('a field that is present but not a real value DROPS the genome — nothing is repaired', () => {
  for (const bad of [
    { elements: [] }, { elements: ['fly'] }, { elements: 'prove' }, { elements: ['prove', 'fly'] },
    { wiring: 'product' }, { wiring: 1 },
    { measures: [] }, { measures: ['nonsense'] }, { measures: 'some' },
    { bins: 7 }, { bins: '8' }, { minLift: 1.6 }, { ownMin: null },
  ]) assert.equal(toGenome(bad), null, JSON.stringify(bad));
  for (const j of [null, undefined, 5, 'x', [], [{}]]) assert.equal(toGenome(j), null);
});

test('parseProposals finds the JSON array in a chatty reply', () => {
  const r = parseProposals('Sure! Here you go:\n[{"wiring":"sum"},{"bins":3}]\nHope that helps.');
  assert.equal(r.genomes.length, 2);
  assert.equal(r.offered, 2);
  assert.equal(r.dropped, 0);
  assert.equal(r.why, null);
});

test('parseProposals drops invalid and duplicate genomes and counts them', () => {
  const r = parseProposals(JSON.stringify([{ wiring: 'mean' }, { wiring: 'mean' }, { bins: 7 }, {}, { book: 40 }]));
  assert.equal(r.genomes.length, 3, 'mean, stem, book 40');
  assert.equal(r.dropped, 2, 'one duplicate, one invalid');
  assert.equal(r.offered, 5);
  // the stem's own wiring is "sum", so {wiring:"sum"} IS the stem — a duplicate of {}
  const s = parseProposals(JSON.stringify([{}, { wiring: 'sum' }]));
  assert.equal(s.genomes.length, 1);
  assert.equal(s.dropped, 1);
});

test('parseProposals caps at MAX_PROPOSALS offered', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ book: GRID.book[i % GRID.book.length], bins: GRID.bins[i % GRID.bins.length] }));
  const r = parseProposals(JSON.stringify(many));
  assert.equal(r.offered, 8);
  assert.ok(r.genomes.length <= 8);
  assert.equal(r.genomes.length + r.dropped, 8);
});

test('parseProposals refuses a reply with no JSON proposals', () => {
  for (const t of ['no json here', '] [', '} {', '[not json]', '{not json}', null, 5, '']) {
    const r = parseProposals(t);
    assert.deepEqual([r.genomes.length, r.offered, r.dropped], [0, 0, 0], String(t));
    assert.equal(r.why, 'no JSON proposals in the reply');
  }
  // a model that wraps its list in an object (as JSON modes force) still gets read — and junk inside is still dropped
  const wrapped = parseProposals('{"proposals":[{"wiring":"mean"},7]}');
  assert.deepEqual([wrapped.genomes.length, wrapped.offered, wrapped.dropped], [1, 2, 1]);
});

test('a lone object is ONE proposal — its own "elements" list is never read as the list (measured on llama3.2:1b)', () => {
  const reply = '{"elements":["prove","own","shape","carry","remember","run","connect"],"wiring":"list","measures":"all","bins":8,"book":12,'
    + '"minSupport":0.005,"minLift":1.25,"smooth":10,"pairK":12,"proofZ":2,"halfLife":6,"ownMin":2000}';
  const r = parseProposals(reply);
  assert.deepEqual([r.genomes.length, r.offered, r.dropped, r.why], [1, 1, 0, null]);
  assert.equal(r.genomes[0].wiring, 0, '"list" is wiring 0');
  const chatty = parseProposals('Sure: {"bins":3} — enjoy');
  assert.deepEqual([chatty.genomes.length, chatty.genomes[0].bins], [1, 0]);
  // the echo the 1B gave without an example: a list where one value belongs → one proposal, dropped, nothing invented
  const echo = parseProposals('{"wiring":"sum","bins":[3,4,5]}');
  assert.deepEqual([echo.genomes.length, echo.offered, echo.dropped], [0, 1, 1]);
  // an array that comes first is the list, even with an object after it
  assert.equal(parseProposals('[{"wiring":"mean"},{"bins":3}] then {"book":2}').genomes.length, 2);
});

test('nothing here throws', () => {
  for (const h of [null, undefined, 0, 'x', [], {}, NaN, Symbol('s'), 10n]) {
    assert.doesNotThrow(() => { proposalPrompt(h); toGenome(h); parseProposals(h); });
  }
});
