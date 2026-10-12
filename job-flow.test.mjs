// job-flow.test.mjs — integration: a requester signs a grow job addressed to one worker, the worker runs it, the
// requester checks the answer. Real Ed25519 (node:crypto), a real grow on the real dataset (once, shared), stubs only to
// reach branches a real grow cannot. Every attack the adversarial review confirmed has a regression test here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { nodeTools, identityFromSeed } from './node-tools.mjs';
import { makeJob, runJob, verifyAtEdge, jobHashHex, hexToBytes, envelopeFromCells, makeSignedCard, sealClaim, reRunnable } from './mesh.mjs';
import { jobSignable } from './job.mjs';
import { unpack, packUnsigned, attachSignature } from './envelope.mjs';
import { CARD_SEED, V3, strToBytes } from './spore-card.mjs';
import { toHex } from './edge.mjs';

const CSV = join(dirname(fileURLToPath(import.meta.url)), 'data', 'online_shoppers_intention.csv');
const phone = nodeTools({ seed32: new Uint8Array(32).fill(0x0a), csvPath: CSV });
const laptop = nodeTools({ seed32: new Uint8Array(32).fill(0x0b), csvPath: CSV });
const stranger = nodeTools({ seed32: new Uint8Array(32).fill(0x0c), csvPath: CSV });
const LAPTOP = toHex(laptop.pubkey);
const GROW = '◊ spore.v1 funnel 11 g:12.2.10';

const realGrow = laptop.grow(GROW);                         // one real grow, reused by stubbed workers
const fast = (t = laptop) => ({ ...t, grow: (s, p) => (Array.isArray(p) && p.length ? t.grow(s, p) : realGrow) });

const newJob = (over = {}) => makeJob({ spore: GROW, maxEvals: 200, now: 1000, nonce: '0123456789abcdef', worker: LAPTOP, ...over }, phone);
const workerFor = (job, over = {}) => {
  const mem = new Set();
  return { now: 1100, maxEvals: 300, claim: (k) => { if (mem.has(k)) return false; mem.add(k); return true; },
    allow: (r) => r === job.requester, mem, ...over };
};

test('hexToBytes reads lowercase even-length hex and nothing else', () => {
  assert.deepEqual(Array.from(hexToBytes('00ff10')), [0, 255, 16]);
  for (const bad of ['0', 'GG', '0F', null, 5, 'abc']) assert.equal(hexToBytes(bad).length, 0, String(bad));
});

test('the real grow: selected on the inner split, judged against the stem on a confirmation split', () => {
  assert.equal(realGrow.ok, true);
  assert.equal(realGrow.championSpore, CARD_SEED, 'growing seed 11 lands on the sealed fixed spore');
  assert.ok(realGrow.championFitness > realGrow.stemFitness, 'beat the stem on the confirmation split');
  assert.notEqual(realGrow.championFitness, realGrow.selectionFitness, 'the confirmation split is not the selection split');
  assert.equal(Math.round(realGrow.heldAuc * 1e6), 820498);
  assert.equal(realGrow.evals, 104, '102 grown + 2 confirmation — every evaluation counted');
});

test('a signed job names its worker and verifies over exactly its signable form', async () => {
  const job = await newJob();
  assert.equal(job.worker, LAPTOP);
  assert.ok(jobSignable(job).includes('"worker":"' + LAPTOP + '"'), 'the audience is inside the signed bytes');
  assert.equal(await phone.verify(strToBytes(jobSignable(job)), hexToBytes(job.sig), hexToBytes(job.requester)), true);
});

test('the round trip: grown, sealed as an answer citing the job, accepted by the requester after re-running', async () => {
  const job = await newJob();
  const out = await runJob(job, fast(), workerFor(job));
  assert.equal(out.ok, true);
  assert.equal(out.cells.length, V3.MODULES * V3.MODULES);
  const p = unpack(out.answer);
  assert.equal(p.type, 0x03);
  assert.deepEqual(Array.from(p.cites), Array.from(hexToBytes(await jobHashHex(job, phone))));
  const r = await verifyAtEdge(out.answer, phone, 'answer', job);
  assert.deepEqual([r.accept, r.reproduced], [true, '0.820498']);
  const back = envelopeFromCells(out.cells);
  assert.equal((await verifyAtEdge(back.envelope, phone, 'answer-from-picture', job)).accept, true);
});

test('REVIEW · two copies of one job delivered at once: exactly one grows', async () => {
  const job = await newJob();
  let grows = 0;
  const counting = { ...laptop, grow: () => { grows++; return realGrow; } };
  const w = workerFor(job);
  const results = await Promise.all([runJob(job, counting, w), runJob({ ...job }, counting, w), runJob({ ...job }, counting, w)]);
  assert.equal(grows, 1);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.filter((r) => r.verdict.stage === 'replay').length, 2);
});

test('REVIEW · a job addressed to another worker is refused, and does not touch that worker’s replay memory', async () => {
  const job = await newJob({ worker: toHex(stranger.pubkey) });
  const w = workerFor(job);
  const r = await runJob(job, fast(), w);
  assert.deepEqual([r.ok, r.verdict.stage], [false, 'audience']);
  assert.equal(w.mem.size, 0);
});

test('a junk or unsigned job is refused before anything is claimed', async () => {
  const job = await newJob();
  const w = workerFor(job);
  await runJob({ ...job, maxEvals: 201 }, fast(), w);                 // tampered → seal
  await runJob({ requester: { toString: 5 }, nonce: 'x' }, fast(), w); // hostile shape
  assert.equal(w.mem.size, 0, 'nothing claimed for jobs that were not admissible');
});

test('a claim that cannot be recorded means the job does not run', async () => {
  const job = await newJob();
  let grows = 0;
  const r = await runJob(job, { ...laptop, grow: () => { grows++; return realGrow; } }, workerFor(job, { claim: () => { throw new Error('disk full'); } }));
  assert.deepEqual([r.ok, r.verdict.stage, grows], [false, 'replay', 0]);
});

test('one changed byte in the job is refused at the seal — cleanly, never a throw', async () => {
  const job = await newJob();
  for (const tamper of [{ maxEvals: 201 }, { nonce: '0123456789abcdee' }, { spore: '◊ spore.v1 funnel 12 g:12.2.10' }, { worker: toHex(phone.pubkey) }, { sig: '0' + job.sig.slice(1) }]) {
    let r;
    await assert.doesNotReject(async () => { r = await runJob({ ...job, ...tamper }, fast(), workerFor(job)); });
    assert.equal(r.ok, false);
    assert.ok(['seal', 'audience'].includes(r.verdict.stage), JSON.stringify(tamper) + ' → ' + r.verdict.stage);
  }
});

test('the worker refuses expired, not-allowed, wrong-data and over-budget jobs', async () => {
  const job = await newJob();
  assert.equal((await runJob(job, fast(), workerFor(job, { now: 1000 + 3600 }))).verdict.stage, 'time');
  assert.equal((await runJob(job, fast(), workerFor(job, { allow: () => false }))).verdict.stage, 'allowed');
  const otherData = { ...fast(), dataSha256Hex: 'ffffffff' + laptop.dataSha256Hex.slice(8) };
  assert.equal((await runJob(job, otherData, workerFor(job))).verdict.stage, 'data');
  assert.equal((await runJob(job, fast(), workerFor(job, { maxEvals: 150 }))).verdict.stage, 'limits');
  const tight = await newJob({ maxEvals: 103 });
  assert.equal((await runJob(tight, fast(), workerFor(tight))).verdict.reason, 'the grow needs 104 evaluations; the job allows 103', 'the confirmation counts');
});

test('REVIEW · model proposals are capped so every evaluation fits the job’s limit', async () => {
  const job = await newJob({ maxEvals: 106 });
  const seenProposals = [];
  const watching = { ...laptop, grow: (s, p) => { seenProposals.push(p.length); return realGrow; } };
  const many = Array.from({ length: 8 }, () => ({ ...realGrow }));
  const r = await runJob(job, watching, workerFor(job, { proposals: many }));
  assert.equal(r.ok, true);
  assert.deepEqual(seenProposals, [2], '106 − 102 grown − 2 confirmation leaves room for 2');
});

test('a champion that only ties the stem earned nothing — nothing is sealed', async () => {
  const job = await newJob();
  const r = await runJob(job, { ...laptop, grow: () => ({ ...realGrow, championFitness: realGrow.stemFitness }) }, workerFor(job));
  assert.deepEqual([r.ok, r.verdict.stage, r.answer], [false, 'earned', undefined]);
});

test('REVIEW · a self-signed GROW-spore card is refused at the seed — the verifier never grows', async () => {
  let germinated = 0;
  const watched = { ...phone, germinate: (s) => { germinated++; return phone.germinate(s); } };
  const bomb = await sealClaim('◊ spore.v1 funnel 1 g:64.1.64', 900000, stranger);
  const r = await verifyAtEdge(bomb.envelope, watched, 'grow-bomb');
  assert.deepEqual([r.accept, r.stage], [false, 'seed']);
  assert.match(r.reason, /grow spore/);
  assert.equal(germinated, 0);
  assert.equal(reRunnable('not a spore').ok, false);
  assert.equal(reRunnable(CARD_SEED).ok, true);
});

test('REVIEW · an answer signed by someone other than the addressed worker is refused at the cite', async () => {
  const job = await newJob();
  // the stranger answers the job properly — right citation, true claim — but it was not the worker the job named
  const jh = hexToBytes(await jobHashHex(job, phone));
  const u = packUnsigned({ seed: strToBytes(CARD_SEED), aucMicro: 820498, dataTag: hexToBytes(stranger.dataSha256Hex.slice(0, 8)), cites: jh, pubkey: stranger.pubkey });
  const forged = attachSignature(u.bytes, stranger.sign(u.bytes)).bytes;
  const r = await verifyAtEdge(forged, phone, 'stranger-answer', job);
  assert.deepEqual([r.accept, r.stage, r.reason], [false, 'cite', 'this answer is signed by a node the job was not sent to']);
});

test('REVIEW · an answer whose genome is not of the job’s seed is refused at the seed', async () => {
  const job = await newJob();
  const jh = hexToBytes(await jobHashHex(job, phone));
  const foreign = '◊ spore.v1 funnel 12 f:579fc3f04c233901';   // a real fixed genome, but seed 12, not 11
  const u = packUnsigned({ seed: strToBytes(foreign), aucMicro: 820498, dataTag: hexToBytes(laptop.dataSha256Hex.slice(0, 8)), cites: jh, pubkey: laptop.pubkey });
  const r = await verifyAtEdge(attachSignature(u.bytes, laptop.sign(u.bytes)).bytes, phone, 'foreign-genome', job);
  assert.deepEqual([r.accept, r.stage, r.reason], [false, 'seed', 'not a seed this node will re-run — the genome is not of the seed the job asked to grow']);
});

test('the requester refuses an answer to a DIFFERENT job, and a plain card offered as an answer', async () => {
  const job = await newJob();
  const other = await newJob({ nonce: 'fedcba9876543210' });
  const out = await runJob(other, fast(), workerFor(other));
  const r = await verifyAtEdge(out.answer, phone, 'wrong-job', job);
  assert.deepEqual([r.accept, r.stage, r.reproduced], [false, 'cite', null]);
  const plain = await makeSignedCard(CARD_SEED, laptop);
  const p = await verifyAtEdge(plain.envelope, phone, 'plain-as-answer', job);
  assert.deepEqual([p.accept, p.stage, p.reason], [false, 'cite', 'not an answer — this card cites no job']);
});

test('a worker that lies about its champion’s score is refused at the re-run', async () => {
  const job = await newJob();
  const out = await runJob(job, { ...laptop, grow: () => ({ ...realGrow, heldAuc: 0.95 }) }, workerFor(job));
  assert.equal(out.ok, true, 'the worker happily seals its lie');
  const r = await verifyAtEdge(out.answer, phone, 'lying-worker', job);
  assert.deepEqual([r.accept, r.stage, r.reproduced], [false, 'rerun', '0.820498']);
});

test('runJob never throws on junk', async () => {
  for (const j of [null, undefined, 0, 'x', [], {}, { requester: { toString: 5 } }]) {
    let r;
    await assert.doesNotReject(async () => { r = await runJob(j, fast(), { now: 1, maxEvals: 10, claim: () => true, allow: () => true }); });
    assert.deepEqual([r.ok, r.verdict.stage], [false, 'shape']);
  }
  assert.equal((await runJob(await newJob(), fast(), null)).ok, false);
});
