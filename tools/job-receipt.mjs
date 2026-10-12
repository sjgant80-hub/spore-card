#!/usr/bin/env node
// tools/job-receipt.mjs — MESH_PLAN step 1 done-test, as a re-runnable receipt.
//
// A requester (node A, "the phone") signs a GROW job; a worker (node B, "the laptop") checks it, grows the seed,
// keeps the champion only if it beat the stem on the grow's inner split, and seals it as an answer card citing the
// job's full hash. A checks the answer: seal → cite → data → re-run. Cases:
//
//   round-trip      → B grows and seals; A re-runs the answer and accepts it
//   tampered-job    → one byte of the job changed: B refuses at the SEAL, cleanly
//   replay          → the same job again: B refuses it (remembered before the grow ran)
//   expired         → B refuses on time
//   not-allowed     → B never agreed to work for this requester
//   addressed-elsewhere → a job addressed to another worker: B refuses it (audience)
//   wrong-job       → an answer to a different job: A refuses at the CITE, nothing re-run
//   lying-worker    → a worker that inflates its champion's score: A refuses at the RE-RUN
//   from-picture    → the answer drawn, downscaled to 40% + 4 grey levels, read back: A still accepts
//
// Keys from fixed seeds, a fixed clock and nonces, a deterministic grow: the receipt regenerates byte-for-byte.
//   node tools/job-receipt.mjs           write receipts/job-roundtrip.json
//   node tools/job-receipt.mjs --check   regenerate and demand it is identical
// Both nodes run in one process here; the live two-browser hand-off is mesh.html.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { nodeTools } from '../node-tools.mjs';
import { makeJob, runJob, verifyAtEdge, jobHashHex, envelopeFromCells } from '../mesh.mjs';
import { V3 } from '../spore-card.mjs';
import { renderGray, degradeGray, sampleGray } from '../spore-card-image.mjs';
import { canonicalJson } from './canonical.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV = join(ROOT, 'data', 'online_shoppers_intention.csv');
const OUT = join(ROOT, 'receipts', 'job-roundtrip.json');
const GROW = '◊ spore.v1 funnel 11 g:12.2.10';

export async function run() {
  const A = nodeTools({ seed32: new Uint8Array(32).fill(0xa5), csvPath: CSV });
  const B = nodeTools({ seed32: new Uint8Array(32).fill(0x5b), csvPath: CSV });
  const mem = new Set();
  const worker = (over = {}) => ({ now: 1760000100, maxEvals: 300, claim: (k) => { if (mem.has(k)) return false; mem.add(k); return true; },
    allow: (r) => r === Buffer.from(A.pubkey).toString('hex'), ...over });
  const job = await makeJob({ spore: GROW, maxEvals: 200, now: 1760000000, nonce: '00a1b2c3d4e5f607', ttl: 3600, worker: Buffer.from(B.pubkey).toString('hex') }, A);
  const jobHash = await jobHashHex(job, A);

  const t0 = process.hrtime.bigint();
  const run1 = await runJob(job, B, worker());
  const growMs = Number(process.hrtime.bigint() - t0) / 1e6;
  if (!run1.ok) throw new Error('the round trip did not run: ' + run1.verdict.reason);
  const accept = await verifyAtEdge(run1.answer, A, 'round-trip', job);

  const tamperedJob = { ...job, maxEvals: 201 };
  const tampered = await runJob(tamperedJob, B, worker());
  const replay = await runJob(job, B, worker());
  const job2 = await makeJob({ spore: GROW, maxEvals: 200, now: 1760000000, nonce: '1111111111111111', ttl: 60, worker: Buffer.from(B.pubkey).toString('hex') }, A);
  const expired = await runJob(job2, B, worker({ now: 1760000060 }));
  const job3 = await makeJob({ spore: GROW, maxEvals: 200, now: 1760000000, nonce: '2222222222222222', ttl: 3600, worker: Buffer.from(B.pubkey).toString('hex') }, A);
  const notAllowed = await runJob(job3, B, worker({ allow: () => false }));
  const C = nodeTools({ seed32: new Uint8Array(32).fill(0x77), csvPath: CSV });
  const jobForC = await makeJob({ spore: GROW, maxEvals: 200, now: 1760000000, nonce: '5555555555555555', ttl: 3600, worker: Buffer.from(C.pubkey).toString('hex') }, A);
  const otherWorker = await runJob(jobForC, B, worker());

  const job4 = await makeJob({ spore: GROW, maxEvals: 200, now: 1760000000, nonce: '3333333333333333', ttl: 3600, worker: Buffer.from(B.pubkey).toString('hex') }, A);
  const other = await runJob(job4, B, worker());
  const wrongJob = await verifyAtEdge(other.answer, A, 'wrong-job', job);

  const job5 = await makeJob({ spore: GROW, maxEvals: 200, now: 1760000000, nonce: '4444444444444444', ttl: 3600, worker: Buffer.from(B.pubkey).toString('hex') }, A);
  const liar = { ...B, grow: (s, p) => ({ ...B.grow(s, p), heldAuc: 0.95 }) };
  const lie = await runJob(job5, liar, worker());
  const lying = await verifyAtEdge(lie.answer, A, 'lying-worker', job5);

  const img = renderGray(run1.cells, V3.MODULES, V3.CELL_PX, V3.QUIET);
  const deg = degradeGray(img.px, img.w, img.h, { scale: 0.4, levels: 4, blur: true });
  const back = envelopeFromCells(sampleGray(deg.px, deg.w, deg.h, V3.MODULES, V3.CELL_PX, V3.QUIET));
  if (!back.ok) throw new Error('the degraded answer did not read back: ' + back.why);
  const fromPicture = await verifyAtEdge(back.envelope, A, 'from-picture', job);

  const worked = (label, r, expect) => ({ case: label, side: 'worker', ok: r.ok, stage: r.verdict.stage, reason: r.verdict.reason, expected: expect });
  const judged = (r, expect) => ({ ...r, side: 'requester', expected: expect });
  const cases = [
    worked('round-trip (worker)', run1, 'accepted'),
    judged(accept, 'accepted'),
    worked('tampered-job', tampered, 'seal'),
    worked('replay', replay, 'replay'),
    worked('expired', expired, 'time'),
    worked('not-allowed', notAllowed, 'allowed'),
    worked('addressed-elsewhere', otherWorker, 'audience'),
    judged(wrongJob, 'cite'),
    judged(lying, 'rerun'),
    judged(fromPicture, 'accepted'),
  ];
  const held = cases.every((c) => c.stage === c.expected);
  return {
    kind: 'spore-card-job-roundtrip',
    v: 1,
    rule: 'growing is the worker’s expensive work; checking the grown answer is cheap — and a signature proves who, only the re-run proves what',
    job: { ...job, hash: jobHash },
    grow: { evals: run1.grow.evals, champion: run1.grow.championSpore, selectionFitness: Math.round(run1.grow.selectionFitness * 1e6) / 1e6, championConfirmFitness: Math.round(run1.grow.championFitness * 1e6) / 1e6,
      stemConfirmFitness: Math.round(run1.grow.stemFitness * 1e6) / 1e6, heldAuc: Math.round(run1.grow.heldAuc * 1e6) / 1e6,
      keepRule: 'selected on the grow’s inner split; sealed only because it then beat the stem on a separate confirmation split of the training months (overlapping rows: this reduces selection bias, it does not remove it); held-out months were measured, never used to decide' },
    nodes: { requester: job.requester, worker: Buffer.from(B.pubkey).toString('hex') },
    data: { file: 'data/online_shoppers_intention.csv', sha256: A.dataSha256Hex },
    topology: 'two nodes, one process — the live two-browser hand-off is mesh.html',
    honestLimit: 'the re-run proves the answer’s claim is true; it does not prove the worker returned the BEST genome its grow found',
    tests: cases.length,
    held,
    cases,
    timingNote: 'not part of the receipt bytes: the grow took ~' + Math.round(growMs / 1000) + ' s on the generating machine',
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url).replace(/\\/g, '/') === process.argv[1].replace(/\\/g, '/');
if (isMain) {
  const result = await run();
  const { timingNote, ...stable } = result;
  const text = canonicalJson(stable) + '\n';
  if (process.argv.includes('--check')) {
    let committed = '';
    try { committed = readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n'); } catch { /* none */ }
    if (committed !== text) { console.error('job receipt does NOT reproduce — receipts/job-roundtrip.json differs from a fresh run'); process.exit(1); }
    console.log(`REPRODUCED — ${result.tests} cases, verdicts held: ${result.held}`);
    process.exit(result.held ? 0 : 1);
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
  for (const c of result.cases) console.log(`${c.side.padEnd(9)} ${String(c.case).padEnd(22)} ${String(c.stage).padEnd(9)} ${c.reason}`);
  console.log(`\n${result.held ? 'every verdict as expected' : 'A VERDICT DID NOT MATCH'} — ${result.tests} cases → receipts/job-roundtrip.json (${timingNote})`);
  process.exit(result.held ? 0 : 1);
}
