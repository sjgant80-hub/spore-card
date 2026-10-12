// stages.test.mjs — the stage kernel pinned: ids, keyed seed numbers, the chunk, the cumulative climb, and both
// judgements in their exact order with their exact reasons. Fast and synthetic (no germination) so the mutation gate
// can run it per mutant; tools/stage-receipt.mjs proves the same decisions on real grows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINEAGE_KEYWORD, STAGE_LINK, LIMITS, RULES, rulesFor, rootPrevText, stageSeedMaterial, seedNoFrom, splitStages,
  parseLineage, lineageText, climbs, firstEarning, judgeStructure, judgeLineage, stageCheck } from './stages.mjs';

const KEY = 'A'.repeat(42) + 'A=';
const H = (c) => c.repeat(64);
const link = (L = 39, fill = 7) => { const u = new Uint8Array(138 + L).fill(fill); u[0] = 4; u[1] = L; return u; };
const b64 = (u8) => Buffer.from(u8).toString('base64');
const cat = (...ls) => Uint8Array.from(Buffer.concat(ls.map((l) => Buffer.from(l))));
const R = RULES['funnel/1'];

test('constants and the frozen rules', () => {
  assert.equal(LINEAGE_KEYWORD, 'konomi-lineage');
  assert.equal(STAGE_LINK, 4);
  assert.deepEqual({ ...LIMITS }, { chunk: 8192, links: 9, tries: 8, seedBytes: 48, seedNoMax: 999999999 });
  assert.ok(Object.isFrozen(LIMITS) && Object.isFrozen(RULES) && Object.isFrozen(R) && Object.isFrozen(R.grow));
  assert.equal(R.rootSpore, '◊ spore.v1 funnel 11 f:fffeff3f49da3401');
  assert.deepEqual([R.recipe, R.dataTag, R.engine, R.confirmSalt, R.maxStages], ['funnel', 'b3055ee3', 'stage-grow/1', 104729, 8]);
  assert.deepEqual({ ...R.grow }, { population: 8, elites: 2, generations: 6 });
  assert.equal(R.dataSha.slice(0, 8), R.dataTag);
});

test('rulesFor: own ids only', () => {
  assert.equal(rulesFor('funnel/1'), R);
  for (const bad of ['__proto__', 'constructor', 'toString', 'Funnel/1', 'funnel/1 ', 'funnel/2', '', null, 5, {}]) assert.equal(rulesFor(bad), null, String(bad));
});

test('rootPrevText: any well-formed id, held or not — so a misrooted chain is refused even under unknown rules', () => {
  assert.equal(rootPrevText('funnel/1'), 'fallkard-rules funnel/1');
  assert.equal(rootPrevText('a-b9/42'), 'fallkard-rules a-b9/42');
  assert.equal(rootPrevText('x'.repeat(24) + '/1234'), 'fallkard-rules ' + 'x'.repeat(24) + '/1234', 'the length limits exactly');
  for (const bad of ['x'.repeat(25) + '/1', 'f/12345', 'Funnel/1', 'funnel/', '/1', 'funnel/1 ', 'funnel_1/1', 'funnel/a', '', null, 7]) {
    assert.equal(rootPrevText(bad), null, String(bad));
  }
});

test('stageSeedMaterial: the exact keyed text, tries 0..7 only', () => {
  assert.equal(stageSeedMaterial('funnel/1', H('a'), KEY, 0), 'fallkard-stage/1|funnel/1|' + H('a') + '|' + KEY + '|0');
  assert.equal(stageSeedMaterial('funnel/1', H('a'), KEY, 7), 'fallkard-stage/1|funnel/1|' + H('a') + '|' + KEY + '|7');
  for (const t of [8, -1, 1.5, '1', null]) assert.equal(stageSeedMaterial('funnel/1', H('a'), KEY, t), null, 't=' + t);
  for (const [id, prev, key] of [['Funnel/1', H('a'), KEY], ['funnel/1', H('a').slice(1), KEY], ['funnel/1', H('A'), KEY], ['funnel/1', H('a'), KEY.slice(1)],
    ['funnel/1', H('a'), 'A'.repeat(42) + 'B='], [null, H('a'), KEY], ['funnel/1', null, KEY], ['funnel/1', H('a'), null]]) {
    assert.equal(stageSeedMaterial(id, prev, key, 0), null, JSON.stringify([id, prev && prev.length, key]));
  }
});

test('seedNoFrom: first four bytes, mod the cap, plus one', () => {
  assert.equal(seedNoFrom(H('0')), 1);
  assert.equal(seedNoFrom(H('f')), 294967300);
  assert.equal(seedNoFrom('3b9ac9fe' + '0'.repeat(56)), 999999999, 'the largest seed number');
  assert.equal(seedNoFrom('3b9ac9ff' + '0'.repeat(56)), 1, 'the cap wraps to one');
  assert.equal(seedNoFrom('00000001' + 'f'.repeat(56)), 2, 'only the first four bytes count');
  for (const bad of [H('0').slice(1), H('F'), H('g'), '', null, 5]) assert.equal(seedNoFrom(bad), 0, String(bad));
});

test('splitStages: self-delimiting links, capped while splitting', () => {
  assert.deepEqual(splitStages(link()).links.map((l) => l.length), [177]);
  const nine = cat(...Array.from({ length: 9 }, (_, i) => link(39 + i)));
  assert.deepEqual(splitStages(nine).links.map((l) => l[1]), [39, 40, 41, 42, 43, 44, 45, 46, 47]);
  assert.deepEqual(splitStages(cat(nine, link())), { ok: false, why: 'more than 9 stages' });
  assert.equal(splitStages(link(48)).ok, true, 'the longest seed');
  assert.equal(splitStages(link(1)).ok, true, 'the shortest seed');
  assert.deepEqual(splitStages(link(49)), { ok: false, why: 'link 0: its seed length is out of range' });
  const zero = link(); zero[1] = 0;
  assert.deepEqual(splitStages(zero), { ok: false, why: 'link 0: its seed length is out of range' });
  assert.deepEqual(splitStages(link().slice(0, 176)), { ok: false, why: 'link 0: its length is not what its header says' });
  assert.deepEqual(splitStages(cat(link(), [4])), { ok: false, why: 'link 1: its seed length is out of range' }, 'a trailing byte');
  assert.deepEqual(splitStages(cat(link(), [9])), { ok: false, why: 'link 1: not a stage link' });
  const answer = link(); answer[0] = 3;
  assert.deepEqual(splitStages(answer), { ok: false, why: 'link 0: not a stage link' });
  for (const bad of [new Uint8Array(0), null, [4, 1], 'x']) assert.deepEqual(splitStages(bad), { ok: false, why: 'no stages' });
});

test('parseLineage / lineageText: plain ASCII JSON, exactly two fields, canonical base64 — and they round-trip', () => {
  const two = [link(39, 1), link(40, 2)];
  const text = lineageText('funnel/1', two);
  assert.equal(text, JSON.stringify({ rules: 'funnel/1', stages: b64(cat(...two)) }));
  const p = parseLineage(text);
  assert.deepEqual([p.ok, p.rulesId, p.links.length], [true, 'funnel/1', 2]);
  assert.deepEqual(Array.from(p.links[1]), Array.from(two[1]));
  const bad = (t, why) => assert.deepEqual(parseLineage(t), { ok: false, why }, String(t).slice(0, 40));
  bad(5, 'not plain text');
  bad('x'.repeat(8193), 'not plain text');
  bad('x'.repeat(8192), 'not JSON', 'exactly the size cap is read (and then found not to be JSON)');
  bad(text.replace('funnel', 'funn\tel'), 'not plain text');
  bad(text.replace('funnel', 'funnél'), 'not plain text');
  bad('{', 'not JSON');
  bad('[1]', 'not JSON');
  bad('null', 'not JSON');
  bad('7', 'not JSON');
  bad(JSON.stringify({ rules: 'funnel/1', stages: b64(two[0]), parents: [] }), 'unexpected field parents');
  bad(JSON.stringify({ rules: 'Funnel/1', stages: b64(two[0]) }), 'rules id is malformed');
  bad(JSON.stringify({ stages: b64(two[0]) }), 'rules id is malformed');
  bad(JSON.stringify({ rules: 'funnel/1' }), 'missing field stages');
  bad(JSON.stringify({ rules: 'funnel/1', stages: 5 }), 'missing field stages');
  bad(JSON.stringify({ rules: 'funnel/1', stages: b64(two[1]).replace(/=+$/, '') }), 'stages are not canonical base64');
  bad(JSON.stringify({ rules: 'funnel/1', stages: '!!!!' }), 'stages are not canonical base64');
  bad(JSON.stringify({ rules: 'funnel/1', stages: '' }), 'no stages');
  bad(JSON.stringify({ rules: 'funnel/1', stages: b64(cat(two[0], [9])) }), 'link 1: not a stage link');
  for (const [id, links] of [['Funnel/1', two], ['funnel/1', 'x'], ['funnel/1', [two[0], 'x']], ['funnel/1', [new Uint8Array(3)]], ['funnel/1', []]]) {
    assert.equal(lineageText(id, links), null, JSON.stringify(id));
  }
});

test('climbs: integers only, and the BEST of everything it descends from sets the bar', () => {
  assert.equal(climbs(5, [4]), true);
  assert.equal(climbs(4, [4]), false, 'a tie earns nothing');
  assert.equal(climbs(5, [4, 6]), false, 'a later ancestor can set the bar');
  assert.equal(climbs(5, [6, 4]), false, 'an earlier ancestor can set the bar');
  assert.equal(climbs(7, [4, 6]), true);
  for (const [c, b] of [[5, []], [5.5, [4]], ['5', [4]], [5, [4.5]], [5, [4, '3']], [5, null], [null, [4]]]) assert.equal(climbs(c, b), false, JSON.stringify([c, b]));
});

test('firstEarning: the first try that earned, among the eight', () => {
  assert.equal(firstEarning([false, true, true]), 1);
  assert.equal(firstEarning([true]), 0);
  assert.equal(firstEarning([false, false]), -1);
  assert.equal(firstEarning([...Array(8).fill(false), true]), -1, 'a ninth try does not count');
  assert.equal(firstEarning([...Array(7).fill(false), true]), 7);
  for (const bad of [null, 'true', {}]) assert.equal(firstEarning(bad), -1);
});

// a well-formed two-stage history and its facts; tests override one fact at a time
const goodParsed = () => ({ ok: true, rulesId: 'funnel/1', links: [link(39, 1), link(47, 2)] });
const goodFacts = () => ({
  chunks: 1, chunkBytes: 520, bound: true, rootPrevHex: H('r'), engine: 'stage-grow/1',
  links: [
    { sigOk: true, hashHex: H('a'), prevHex: H('r'), claimMicro: 811890, dataTagHex: 'b3055ee3', seedText: R.rootSpore, genomeKey: 'g0', keyedSeedNos: [],
      decoded: { ok: true, fixed: true, recipe: 'funnel', seedNo: 11, why: null } },
    { sigOk: true, hashHex: H('b'), prevHex: H('a'), claimMicro: 827420, dataTagHex: 'b3055ee3', seedText: '◊ spore.v1 funnel 936206151 f:x', genomeKey: 'g1',
      keyedSeedNos: [5, 6, 936206151, 8, 9, 10, 11, 12], decoded: { ok: true, fixed: true, recipe: 'funnel', seedNo: 936206151, why: null } },
  ],
});
const at = (patch) => { const f = goodFacts(); patch(f); const j = judgeStructure(goodParsed(), f); return [j.verdict, j.check, j.at, j.reason]; };

test('judgeStructure: a whole, signed history is READY, with the try each stage used', () => {
  const j = judgeStructure(goodParsed(), goodFacts());
  assert.deepEqual(j, { verdict: 'READY', check: 'structure', at: null, reason: 'the history is whole and signed — 1 stage to re-run', claimed: 1, tries: [null, 2] });
  const three = goodParsed(); three.links.push(link(40, 3));
  const f3 = goodFacts(); f3.links.push({ ...f3.links[1], hashHex: H('c'), prevHex: H('b') });
  assert.equal(judgeStructure(three, f3).reason, 'the history is whole and signed — 2 stages to re-run');
  const one = { ok: true, rulesId: 'funnel/1', links: [link(39, 1)] }; const f1 = goodFacts(); f1.links = [f1.links[0]];
  assert.deepEqual(judgeStructure(one, f1), { verdict: 'READY', check: 'structure', at: null, reason: 'the history is whole and signed — 0 stages to re-run', claimed: 0, tries: [null] });
});

test('judgeStructure refuses in order, with exact reasons — the earlier check wins', () => {
  assert.deepEqual(judgeStructure(null, { chunks: 0 }), { verdict: 'NONE', check: 'present', at: null, reason: 'carries no stages (a stripped copy proves none)' });
  assert.deepEqual(at((f) => { f.chunks = 2; f.bound = false; }), ['REFUSED', 'once', null, 'two histories on one card']);
  assert.deepEqual(at((f) => { f.chunks = undefined; }), ['REFUSED', 'once', null, 'two histories on one card']);
  assert.deepEqual(at((f) => { f.chunkBytes = 8193; }), ['REFUSED', 'size', null, 'the history is over 8 KiB — refused unread']);
  assert.equal(at((f) => { f.chunkBytes = 8192; })[0], 'READY', 'exactly the size cap');
  assert.deepEqual(at((f) => { f.chunkBytes = '520'; }), ['REFUSED', 'size', null, 'the history is over 8 KiB — refused unread']);
  assert.deepEqual(judgeStructure({ ok: false, why: 'more than 9 stages' }, goodFacts()).reason, 'the stages riding on this card are unreadable — more than 9 stages');
  assert.deepEqual(judgeStructure(null, goodFacts()).reason, 'the stages riding on this card are unreadable — nothing readable');
  assert.deepEqual(at((f) => { f.links.pop(); }), ['REFUSED', 'parse', null, 'the stages riding on this card are unreadable — the facts do not match the links']);
  assert.deepEqual(at((f) => { f.bound = 'yes'; f.links[0].sigOk = false; }), ['REFUSED', 'bound', null, 'the stages do not end at this card — its band carries a different latest stage']);
  assert.deepEqual(at((f) => { f.links[1].sigOk = false; f.links[0].prevHex = H('x'); }), ['REFUSED', 'signature', 1, 'stage 1 is not signed by the key it names']);
  assert.deepEqual(at((f) => { f.links[0].sigOk = 1; }), ['REFUSED', 'signature', 0, 'stage 0 is not signed by the key it names']);
  assert.deepEqual(at((f) => { f.links[0].prevHex = H('x'); f.engine = 'other'; }), ['REFUSED', 'order', 0, 'the first stage does not start from the rules it names']);
  assert.deepEqual(at((f) => { f.links[1].prevHex = H('z'); }), ['REFUSED', 'order', 1, 'stage 1 does not follow stage 0 — a stage was spliced in, reordered or dropped']);
  const unknown = goodParsed(); unknown.rulesId = 'funnel/9';
  assert.deepEqual(Object.values(judgeStructure(unknown, goodFacts())).slice(0, 4), ['PENDING', 'rules', null, 'grown by rules this reader does not hold (funnel/9) — stages listed, not counted']);
  assert.deepEqual(at((f) => { f.engine = 'stage-grow/2'; f.links[1].decoded.fixed = false; }), ['PENDING', 'rules', null, 'this reader\'s engine is not the one funnel/1 was sealed with — stages listed, not counted']);
  const shape = (patch, k, why) => assert.deepEqual(at(patch), ['REFUSED', 'shape', k, 'stage ' + k + ' is not a seed this reader will re-run — ' + why]);
  shape((f) => { f.links[1].decoded = { ok: false, why: 'a genome setting is past the end of its grid' }; }, 1, 'a genome setting is past the end of its grid');
  shape((f) => { f.links[1].decoded = { ok: false }; }, 1, 'it does not decode');
  shape((f) => { f.links[1].decoded = null; }, 1, 'it does not decode');
  shape((f) => { f.links[0].decoded.fixed = 'yes'; }, 0, 'a grow seed');
  shape((f) => { f.links[1].decoded.recipe = 'other'; }, 1, 'another recipe');
  shape((f) => { f.links[1].dataTagHex = 'ffffffff'; }, 1, 'measured on other data');
  shape((f) => { f.links[0].seedText = '◊ spore.v1 funnel 11 f:579fc3f04c233901'; }, 0, 'not the starting model');
  assert.equal(at((f) => { f.links[1].seedText = 'anything'; })[0], 'READY', 'only stage 0 must be the starting model');
  assert.deepEqual(at((f) => { f.links[1].keyedSeedNos = [1, 2, 3, 4, 5, 6, 7, 8]; }), ['REFUSED', 'key', 1, 'stage 1\'s seed number is not one its key may grow — copied or hand-picked']);
  assert.deepEqual(at((f) => { f.links[1].keyedSeedNos = [1, 2, 3, 4, 5, 6, 7, 8, 936206151]; })[1], 'key', 'a ninth keyed number does not count');
  assert.deepEqual(at((f) => { f.links[1].keyedSeedNos = 'x'; })[1], 'key');
  const first = goodFacts(); first.links[1].keyedSeedNos = [936206151, 1, 2, 3, 4, 5, 6, 7];
  assert.deepEqual(judgeStructure(goodParsed(), first).tries, [null, 0], 'the first try is a real try');
  assert.deepEqual(judgeStructure(goodParsed(), goodFacts().links ? { ...goodFacts(), links: [goodFacts().links[0], { ...goodFacts().links[1], keyedSeedNos: [9, 9, 9, 9, 9, 9, 9, 936206151] }] } : null).tries, [null, 7], 'the last try');
});

const ready = () => judgeStructure(goodParsed(), goodFacts());
const lf = (patch = () => {}) => { const f = { dataOk: true, links: [{ claimMicro: 811890, genomeKey: 'g0' }, { claimMicro: 827420, genomeKey: 'g1' }] }; patch(f); return f; };
const res = () => [{ heldMicro: 811890 }, { heldMicro: 827420, confMicro: 944672, barMicros: [929568, 900000], replayGenomeKey: 'g1' }];
const lin = (r, f = lf()) => { const j = judgeLineage(ready(), r, f); return [j.verdict, j.proven, j.check, j.at, j.reason]; };

test('judgeLineage: every stage re-ran — PASS, with the last stage proven', () => {
  assert.deepEqual(lin(res()), ['PASS', 1, 'lineage', null, 'stages 0–1 re-ran here: the signatures prove who, the re-runs proved what']);
  const one = judgeStructure({ ok: true, rulesId: 'funnel/1', links: [link(39, 1)] }, { ...goodFacts(), links: [goodFacts().links[0]] });
  assert.deepEqual(Object.values(judgeLineage(one, [{ heldMicro: 811890 }], lf())), ['PASS', 0, 'lineage', null, 'stages 0–0 re-ran here: the signatures prove who, the re-runs proved what']);
});

test('judgeLineage passes a structure verdict through, and never re-runs what did not stand', () => {
  assert.deepEqual(judgeLineage({ verdict: 'NONE', check: 'present', at: null, reason: 'r' }, [], {}), { verdict: 'PASS', proven: -1, check: 'present', at: null, reason: 'r' });
  assert.deepEqual(judgeLineage({ verdict: 'PENDING', check: 'rules', at: null, reason: 'r' }, res(), lf()), { verdict: 'PENDING', proven: -1, check: 'rules', at: null, reason: 'r' });
  assert.deepEqual(judgeLineage({ verdict: 'REFUSED', check: 'key', at: 1, reason: 'r' }, res(), lf()), { verdict: 'REFUSED', proven: -1, check: 'key', at: 1, reason: 'r' });
  assert.deepEqual(judgeLineage(null, res(), lf()), { verdict: 'REFUSED', proven: -1, check: 'structure', at: null, reason: 'the history was not judged' });
});

test('judgeLineage refuses at the first stage that fails, cheapest check first, with exact reasons', () => {
  assert.deepEqual(lin(res(), lf((f) => { f.dataOk = 'yes'; })), ['PENDING', -1, 'data', null, 'cannot re-run here — this device does not hold the data these stages were measured on']);
  assert.deepEqual(lin([res()[0]]), ['PENDING', 0, 'budget', 1, 're-running stopped at stage 1 (time budget) — stages from 1 on are not proven here']);
  assert.deepEqual(lin([]), ['PENDING', -1, 'budget', 0, 're-running stopped at stage 0 (time budget) — stages from 0 on are not proven here']);
  assert.deepEqual(lin('x'), ['PENDING', -1, 'budget', 0, 're-running stopped at stage 0 (time budget) — stages from 0 on are not proven here']);
  assert.deepEqual(lin([null, res()[1]])[2], 'budget', 'a null result is not a result');
  assert.deepEqual(lin([5, res()[1]])[2], 'budget', 'nor is a number');
  assert.deepEqual(Object.values(judgeLineage(ready(), res(), null)).slice(0, 3), ['PENDING', -1, 'data'], 'no facts: no data — refused politely, never thrown on');
  assert.deepEqual(lin([{ heldMicro: null }, res()[1]]), ['REFUSED', -1, 'held', 0, 'stage 0 did not germinate here']);
  assert.deepEqual(lin([{ heldMicro: 811891 }, res()[1]]), ['REFUSED', -1, 'held', 0, 'stage 0 does not reproduce — the card says 0.811890, the re-run here gives 0.811891']);
  const r1 = (patch) => { const r = res(); patch(r[1]); return r; };
  assert.deepEqual(lin(r1((x) => { x.heldMicro = 950000; x.confMicro = 1; })), ['REFUSED', 0, 'held', 1, 'stage 1 does not reproduce — the card says 0.827420, the re-run here gives 0.950000']);
  assert.deepEqual(lin(res(), lf((f) => { f.links[1].claimMicro = 'x'; })), ['REFUSED', 0, 'held', 1, 'stage 1 does not reproduce — the card says ?, the re-run here gives 0.827420']);
  assert.deepEqual(lin(r1((x) => { x.confMicro = 929568; x.replayGenomeKey = 'nope'; })), ['REFUSED', 0, 'climb', 1, 'stage 1 does not beat everything it grew from on its own check split — it needs more than 0.929568; the re-run here gives 0.929568']);
  assert.deepEqual(lin(r1((x) => { x.barMicros = [900000, 950000]; })), ['REFUSED', 0, 'climb', 1, 'stage 1 does not beat everything it grew from on its own check split — it needs more than 0.950000; the re-run here gives 0.944672']);
  assert.deepEqual(lin(r1((x) => { x.barMicros = []; })), ['REFUSED', 0, 'climb', 1, 'stage 1 does not beat everything it grew from on its own check split — it needs more than ?; the re-run here gives 0.944672']);
  assert.deepEqual(lin(r1((x) => { x.confMicro = undefined; })), ['REFUSED', 0, 'climb', 1, 'stage 1 does not beat everything it grew from on its own check split — it needs more than 0.929568; the re-run here gives ?']);
  assert.deepEqual(lin(r1((x) => { x.barMicros = [1.5]; }))[4], 'stage 1 does not beat everything it grew from on its own check split — it needs more than ?; the re-run here gives 0.944672');
  assert.deepEqual(lin(r1((x) => { x.replayGenomeKey = 'g0'; })), ['REFUSED', 0, 'replay', 1, 'stage 1 is not what its keyed grow makes — re-grown here from stage 0 for this key, the grow lands on a different model']);
  assert.deepEqual(lin(r1((x) => { delete x.replayGenomeKey; }))[2], 'replay');
  assert.deepEqual(lin(r1((x) => { delete x.replayGenomeKey; }), lf((f) => { delete f.links[1].genomeKey; }))[2], 'replay', 'no replay at all is never a match, even against a missing key');
  assert.deepEqual(lin(res(), lf((f) => { f.links[1] = null; }))[2], 'held', 'no facts for a stage: its claim is unknown, so nothing reproduces it');
  assert.deepEqual(lin([{ heldMicro: 811890, confMicro: 1, barMicros: [999999], replayGenomeKey: 'zz' }, res()[1]])[0], 'PASS', 'stage 0 is never climbed or replayed');
});

test('stageCheck: a claimed stage against what re-ran here', () => {
  assert.equal(stageCheck(2, 2, 'PASS'), 'earned');
  assert.equal(stageCheck(3, 2, 'PASS'), 'overclaim');
  assert.equal(stageCheck(1, 2, 'PASS'), 'underclaim');
  assert.equal(stageCheck(2, 1, 'PENDING'), 'pending');
  assert.equal(stageCheck(2, 2, 'REFUSED'), 'overclaim');
  for (const [c, p] of [[1.5, 1], [1, '1'], [null, 0]]) assert.equal(stageCheck(c, p, 'PASS'), 'overclaim', JSON.stringify([c, p]));
});

test('nothing here throws', () => {
  for (const h of [null, undefined, 0, NaN, 'x', [], {}, Symbol('s'), 10n, () => 1, new Proxy({}, {})]) {
    assert.doesNotThrow(() => { rulesFor(h); rootPrevText(h); stageSeedMaterial(h, h, h, h); seedNoFrom(h); splitStages(h); parseLineage(h); lineageText(h, h);
      climbs(h, h); firstEarning(h); judgeStructure(h, h); judgeLineage(h, h, h); stageCheck(h, h, h); }, String(typeof h));
  }
});
