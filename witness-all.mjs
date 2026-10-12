#!/usr/bin/env node
// witness-all.mjs — the re-runnable mutation gate over spore-card's NEW kernel. Local and CI run the SAME
// thing: `node witness-all.mjs`. Exit 0 only if the kernel is clean (no unreviewed survivors).
//
// Gated: spore-card.mjs — the exact bit-codec (frame/CRC, the redundant module grid encode/decode, the
// majority vote). This is the load-bearing "never silently corrupt a seed" logic.
// NOT gated here, each with its reason:
//   · spore-card-image.mjs — the visible-layer raster + survival MEASUREMENT. Deterministic image
//     arithmetic, not a decision kernel: a ±1px over-read on a bounds-guarded pixel access does not flip a
//     thresholded module, so operator mutants are equivalent. Its claim (screenshot survival) is proven by
//     a deterministic VALUE test (spore-card-image.test.mjs: survives() true at a measured degrade) and by a
//     real JPEG round-trip in the browser — reproduction, not attestation.
//   · spore-card-chunk.mjs — thin Node I/O over png.mjs (the lossless layer); value-tested round-trip.
//   · spore.mjs, organ.mjs — vendored from sjgant80-hub/fall-spore, gated in their own repo (germination).
//   · png.mjs — vendored from sjgant80-hub/fallkard-forge, gated in its own repo (PNG chunk primitives).
//   · spore-card-wire.mjs — the browser glue (canvas, DOM, downloads): I/O, not a decision kernel.
//   · data/** — the sealed UCI dataset; a changed byte breaks the reproduced AUC, which the page re-derives.
// Reviewed-equivalent survivors, if any, live in witness.baseline.json with an argued reason.
import { runMutations } from './.witness/witness.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PAIRS = [
  ['spore-card.mjs', 'spore-card.test.mjs'],   // the bit codec (v1 bare seed, v2 signed envelope)
  ['envelope.mjs', 'envelope.test.mjs'],       // the signed envelope's layout
  ['edge.mjs', 'edge.test.mjs'],               // the edge verdict: parse → seal → cite → data → re-run
  ['job.mjs', 'job.test.mjs'],                 // the signed job and the worker's fail-closed check
  ['proposer.mjs', 'proposer.test.mjs'],       // the untrusted model's suggestions, parsed strictly
  ['grow-on.mjs', 'grow-on.test.mjs'],         // the worker's grow + the keep rule: a proposal must strictly win
];
// Not gated here, with the reason: mesh.mjs and node-tools.mjs are orchestration and I/O (crypto, hashing,
// germination handed in) — mesh.test.mjs runs them end to end with real Ed25519 on the real dataset, and
// tools/edge-receipt.mjs --check re-runs the whole done-test and demands a byte-identical receipt.

const only = process.argv.slice(2);
let allClean = true;
const rows = [];
for (const [src, test] of PAIRS) {
  if (only.length && !only.includes(src)) continue;
  const t0 = Date.now();
  const r = runMutations(join(HERE, src), { cwd: HERE, cap: 5000, timeout: 180000, testCmd: ['node', '--test', test] });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  rows.push({ src, killed: r.killed, total: r.total, survived: r.survived.length, ignored: r.ignored.length, capped: r.capped, secs });
  console.log(`${r.clean && !r.capped ? '✓' : '✗'} ${src.padEnd(16)} ${String(r.killed).padStart(4)}/${String(r.total).padEnd(4)} killed` +
    `${r.ignored.length ? ` · ${r.ignored.length} reviewed-equivalent` : ''}${r.capped ? ` · CAPPED at ${r.capped}` : ''} · ${secs}s  (${test})`);
  for (const s of r.survived) console.log(`    SURVIVED line ${s.line}: ${s.mutation} :: ${s.snippet}`);
  if (!r.clean || r.capped) allClean = false;
}
const k = rows.reduce((a, r) => a + r.killed, 0), n = rows.reduce((a, r) => a + r.total, 0);
console.log(`\n${allClean ? 'WITNESS CLEAN' : 'WITNESS NOT CLEAN'} — ${k}/${n} mutants killed across ${rows.length} kernel(s)`);
process.exit(allClean ? 0 : 1);
