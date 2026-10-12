// job.test.mjs — the signed job's shape, the worker's check order and the keep rule, pinned. The witness
// mutates job.mjs against this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOB_V, KINDS, CONTEXTS, CAPS, JOB_STAGES, canonical, jobSignable, growSettings, growCost, shapeOf, admissible, checkJob, earned } from './job.mjs';

const H = (c, n) => c.repeat(n);
const job = {
  v: 1, kind: 'grow', spore: '◊ spore.v1 funnel 11 g:12.2.10', context: 'all', dataTag: 'b3055ee3', maxEvals: 200,
  requester: H('a', 64), worker: H('b', 64), nonce: H('1', 16), issued: 1000, expires: 1000 + 3600, sig: H('f', 128),
};
const facts = { sigOk: true, now: 2000, self: H('b', 64), seen: false, allowed: true, dataTag: 'b3055ee3', maxEvals: 300 };

test('constants', () => {
  assert.equal(JOB_V, 1);
  assert.deepEqual([...KINDS], ['grow']);
  assert.deepEqual([...CONTEXTS], ['all'], 'v1 jobs grow for every visitor only');
  assert.deepEqual({ ...CAPS }, { maxEvals: 500, maxTtl: 604800, skew: 300, maxPopulation: 64, maxGenerations: 64 });
  assert.deepEqual([...JOB_STAGES], ['shape', 'seal', 'time', 'audience', 'replay', 'allowed', 'data', 'limits', 'accepted']);
});

test('canonical sorts keys at every depth and is total', () => {
  assert.equal(canonical({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } }), '{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}');
  assert.equal(canonical(undefined), 'null');
  assert.equal(canonical('x'), '"x"');
  const cyc = { a: 1 }; cyc.me = cyc;
  assert.equal(canonical(cyc), '{"a":1,"me":null}');
  assert.equal(canonical(5n), 'null');
  const shared = { k: 1 };
  assert.equal(canonical([shared, shared]), '[{"k":1},{"k":1}]', 'seen twice is not a cycle');
});

test('jobSignable: every field but sig, canonical; unknown fields are not signed', () => {
  const s = jobSignable(job);
  assert.ok(!s.includes('"sig"'));
  assert.ok(s.startsWith('{"context":"all","dataTag":"b3055ee3","expires":4600,'));
  assert.equal(jobSignable({ ...job, sig: 'other' }), s, 'the signature is not part of what it signs');
  assert.equal(jobSignable({ ...job, extra: 1 }), s, 'an extra field is not silently signed');
  assert.notEqual(jobSignable({ ...job, nonce: H('2', 16) }), s);
  assert.equal(jobSignable(null), '{}');
  assert.equal(jobSignable([1]), '{}');
});

test('growSettings reads a grow spore and nothing else', () => {
  assert.deepEqual(growSettings('◊ spore.v1 funnel 11 g:12.2.10'), { recipe: 'funnel', seed: 11, population: 12, elites: 2, generations: 10 });
  for (const bad of ['◊ spore.v1 funnel 11 f:579fc3f04c233901', '◊ spore.v1 funnel 0 g:1.1.1', 'spore.v1 funnel 11 g:12.2.10',
    '◊ spore.v1 Funnel 11 g:12.2.10', '◊ spore.v1 funnel 11 g:1234.2.10', '◊ spore.v1 funnel 11 g:12.2.10 ', null, 5])
    assert.equal(growSettings(bad), null, JSON.stringify(bad));
});

test('growCost = first population + later generations x newborns (fall-spore budgetOf)', () => {
  assert.equal(growCost({ population: 12, elites: 2, generations: 10 }), 102);
  assert.equal(growCost({ population: 5, elites: 1, generations: 1 }), 5);
  assert.equal(growCost({ population: 4, elites: 3, generations: 3 }), 6);
  assert.equal(growCost(null), Infinity);
  assert.equal(growCost({ population: 1.5, elites: 1, generations: 1 }), Infinity);
});

test('shapeOf accepts the reference job', () => {
  const s = shapeOf(job);
  assert.equal(s.ok, true);
  assert.equal(s.settings.population, 12);
});

test('shapeOf refuses every malformed field, at its boundary', () => {
  const bad = (patch, why) => {
    const r = shapeOf({ ...job, ...patch });
    assert.equal(r.ok, false, JSON.stringify(patch));
    if (why) assert.match(r.why, why);
  };
  bad({ v: 2 }, /version/);
  bad({ kind: 'mint' }, /kind/);
  bad({ spore: 'nope' }, /grow spore/);
  bad({ spore: '◊ spore.v1 funnel 11 g:1.1.1' }, /population/);
  bad({ spore: '◊ spore.v1 funnel 11 g:65.2.10' }, /population/);
  bad({ spore: '◊ spore.v1 funnel 11 g:12.0.10' }, /elites/);
  bad({ spore: '◊ spore.v1 funnel 11 g:12.12.10' }, /elites/);
  bad({ spore: '◊ spore.v1 funnel 11 g:12.2.0' }, /generations/);
  bad({ spore: '◊ spore.v1 funnel 11 g:12.2.65' }, /generations/);
  bad({ context: 'everyone' }, /context/);
  bad({ context: 'returning' }, /context/);
  bad({ context: 'new' }, /context/);
  bad({ dataTag: 'B3055EE3' }, /data tag/);
  bad({ dataTag: 'b3055ee' }, /data tag/);
  bad({ maxEvals: 0 }, /maxEvals/);
  bad({ maxEvals: 501 }, /maxEvals/);
  bad({ maxEvals: 1.5 }, /maxEvals/);
  bad({ requester: H('a', 63) }, /requester/);
  bad({ requester: H('A', 64) }, /requester/);
  bad({ nonce: H('1', 15) }, /nonce/);
  bad({ worker: H('b', 63) }, /worker/);
  bad({ worker: undefined }, /worker/);
  bad({ issued: -1 }, /whole seconds/);
  bad({ issued: 1.5 }, /whole seconds/);
  bad({ expires: '4600' }, /whole seconds/);
  bad({ expires: 1000 }, /expire after/);
  bad({ expires: 999 }, /expire after/);
  bad({ expires: 1000 + 604801 }, /7 days/);
  bad({ sig: H('f', 127) }, /signature/);
  bad({ extra: true }, /unknown field: extra/);
  for (const notJob of [null, undefined, 0, 5, 'x', true, [], [job]]) {
    assert.deepEqual(shapeOf(notJob), { ok: false, why: 'not a job object' }, JSON.stringify(notJob));
  }
});

test('shapeOf accepts the exact boundaries', () => {
  for (const patch of [
    { spore: '◊ spore.v1 funnel 11 g:2.1.1' }, { spore: '◊ spore.v1 funnel 11 g:64.63.64' },
    { maxEvals: 1 }, { maxEvals: 500 }, { issued: 0, expires: 1 }, { expires: 1000 + 604800 },
  ]) assert.equal(shapeOf({ ...job, ...patch }).ok, true, JSON.stringify(patch));
});

test('checkJob accepts a good job and reports its cost', () => {
  const v = checkJob(job, facts);
  assert.deepEqual([v.accept, v.stage, v.cost], [true, 'accepted', 102]);
});

test('checkJob refuses in order: shape → seal → time → replay → allowed → data → limits', () => {
  assert.equal(checkJob({ ...job, v: 9 }, { ...facts, sigOk: false }).stage, 'shape');
  assert.equal(checkJob(job, { ...facts, sigOk: false, now: 99999 }).stage, 'seal');
  assert.equal(checkJob(job, { ...facts, now: 99999, self: 'x' }).stage, 'time');
  assert.equal(checkJob(job, { ...facts, self: 'x', seen: true }).stage, 'audience');
  assert.equal(checkJob(job, { ...facts, seen: true, allowed: false }).stage, 'replay');
  assert.equal(checkJob(job, { ...facts, allowed: false, dataTag: 'x' }).stage, 'allowed');
  assert.equal(checkJob(job, { ...facts, dataTag: 'x', maxEvals: 1 }).stage, 'data');
  assert.equal(checkJob(job, { ...facts, maxEvals: 1 }).stage, 'limits');
});

test('checkJob fails CLOSED: any fact that is not literally right refuses', () => {
  for (const s of [undefined, null, 1, 'true']) assert.equal(checkJob(job, { ...facts, sigOk: s }).stage, 'seal');
  for (const s of [undefined, null, 0, 'false']) assert.equal(checkJob(job, { ...facts, seen: s }).stage, 'replay', 'an unknown replay state is a replay');
  for (const a of [undefined, 1, 'yes']) assert.equal(checkJob(job, { ...facts, allowed: a }).stage, 'allowed');
  assert.equal(checkJob(job, { ...facts, now: undefined }).stage, 'time');
  assert.equal(checkJob(job, { ...facts, now: 2000.5 }).stage, 'time');
  assert.equal(checkJob(job, { ...facts, maxEvals: undefined }).stage, 'limits', 'a worker with no stated cap runs nothing');
  assert.equal(checkJob(job, { ...facts, maxEvals: -5 }).stage, 'limits');
  assert.equal(checkJob(job, null).stage, 'seal');
});

test('checkJob time window: skew forgives a little clock drift, never an expired job', () => {
  assert.equal(checkJob(job, { ...facts, now: 1000 - 300 }).accept, true, 'exactly at the skew edge');
  assert.equal(checkJob(job, { ...facts, now: 1000 - 301 }).reason, 'issued in the future — refused');
  assert.equal(checkJob(job, { ...facts, now: 4599 }).accept, true, 'the last second');
  assert.equal(checkJob(job, { ...facts, now: 4600 }).reason, 'expired — refused');
});

test('checkJob limits: the job cap, the worker cap, and the grow cost', () => {
  assert.equal(checkJob({ ...job, maxEvals: 300 }, { ...facts, maxEvals: 300 }).accept, true);
  assert.equal(checkJob({ ...job, maxEvals: 301 }, { ...facts, maxEvals: 300 }).stage, 'limits');
  assert.equal(checkJob({ ...job, maxEvals: 500 }, { ...facts, maxEvals: 900 }).accept, true, 'a worker cap above CAPS is clamped to it');
  assert.equal(checkJob({ ...job, maxEvals: 102 }, facts).accept, true, 'exactly the grow cost');
  const short = checkJob({ ...job, maxEvals: 101 }, facts);
  assert.equal(short.stage, 'limits');
  assert.equal(short.reason, 'the grow needs 102 evaluations; the job allows 101');
  assert.equal(checkJob({ ...job, maxEvals: 101 }, facts).accept, false);
  for (const cap of [Infinity, NaN, 300.5, '300', null, 0, -1]) {
    assert.equal(checkJob(job, { ...facts, maxEvals: cap }).stage, 'limits', 'a worker cap of ' + String(cap) + ' allows nothing');
  }
});

test('checkJob reasons are exact', () => {
  assert.equal(checkJob(job, { ...facts, sigOk: false }).reason, 'seal mismatch — the requester did not sign this job');
  assert.equal(checkJob(job, { ...facts, seen: true }).reason, 'this job was already run here — a replay is refused');
  assert.equal(checkJob(job, { ...facts, allowed: false }).reason, 'this worker has not agreed to run jobs from this requester');
  assert.equal(checkJob(job, { ...facts, dataTag: 'x' }).reason, 'this worker does not hold the data the job names');
  assert.equal(checkJob(job, { ...facts, now: undefined }).reason, 'this worker has no clock to check the job against');
  assert.equal(checkJob(job, { ...facts, maxEvals: 100 }).reason, 'the job asks for more evaluations than this worker allows');
  assert.match(checkJob({ ...job, v: 2 }, facts).reason, /^malformed job — /);
});

test('admissible: shape → seal → time → audience, and nothing past it (review finding: claim only after this)', () => {
  const a = admissible(job, facts);
  assert.deepEqual([a.accept, a.stage], [true, 'admissible']);
  assert.equal(a.settings.population, 12);
  assert.equal(admissible({ ...job, v: 2 }, facts).stage, 'shape');
  assert.equal(admissible(job, { ...facts, sigOk: false }).stage, 'seal');
  assert.equal(admissible(job, { ...facts, now: 99999 }).stage, 'time');
  const other = admissible(job, { ...facts, self: H('c', 64) });
  assert.deepEqual([other.accept, other.stage, other.reason], [false, 'audience', 'this job is addressed to another worker']);
  assert.equal(admissible(job, { ...facts, self: undefined }).stage, 'audience', 'a worker with no identity is not the audience');
  // admissible never looks at replay, allowance, data or limits
  assert.equal(admissible(job, { sigOk: true, now: 2000, self: H('b', 64), seen: true, allowed: false, dataTag: 'x', maxEvals: 0 }).accept, true);
  assert.equal(admissible(null, null).stage, 'shape');
  for (const noFacts of [null, undefined, 5, 'sigOk']) {
    assert.equal(admissible(job, noFacts).stage, 'seal', 'a well-formed job with no facts (' + String(noFacts) + ') is refused, not thrown on');
    assert.equal(checkJob(job, noFacts).stage, 'seal');
  }
});

test('checkJob counts evaluations beyond the grow against the job’s limit (review finding)', () => {
  assert.equal(checkJob({ ...job, maxEvals: 104 }, { ...facts, extra: 2 }).accept, true, '102 + 2 confirmation = 104');
  const over = checkJob({ ...job, maxEvals: 104 }, { ...facts, extra: 3 });
  assert.deepEqual([over.stage, over.reason], ['limits', 'the grow needs 105 evaluations; the job allows 104']);
  assert.equal(checkJob({ ...job, maxEvals: 102 }, { ...facts, extra: -5 }).accept, true, 'a negative extra counts as none');
  assert.equal(checkJob({ ...job, maxEvals: 102 }, { ...facts, extra: 1.5 }).accept, true, 'a fractional extra counts as none');
  assert.equal(checkJob(job, { ...facts, extra: 4 }).cost, 106);
});

test('earned: the champion must strictly beat the stem on the inner split', () => {
  assert.equal(earned(0.81, 0.80), true);
  assert.equal(earned(0.80, 0.80), false, 'a tie is not earned — the grow found nothing better');
  assert.equal(earned(0.79, 0.80), false);
  for (const [a, b] of [[NaN, 0.5], [0.5, NaN], [Infinity, 0.5], [0.5, -Infinity], ['0.9', 0.5], [0.9, null]]) assert.equal(earned(a, b), false);
});

test('nothing here throws', () => {
  for (const h of [null, undefined, 0, 'x', [], {}, NaN, Symbol('s'), 10n]) {
    assert.doesNotThrow(() => { canonical(h); jobSignable(h); growSettings(h); growCost(h); shapeOf(h); checkJob(h, h); earned(h, h); });
  }
});
