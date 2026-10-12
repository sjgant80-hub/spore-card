#!/usr/bin/env node
// tools/edge-receipt.mjs — MESH_PLAN §2b done-test, as a re-runnable receipt.
//
// Two nodes, each with its own Ed25519 key and its own copy of the dataset. Node A seals a card; node B
// receives it and rules (edge.mjs). The cases are the done-test plus the edges around it:
//
//   genuine        A seals what it earned          → B accepts after REPRODUCING the score itself
//   tampered       one byte of the card changed    → B refuses at the SEAL
//   false-claim    A validly signs a score it did not earn → B refuses at the RE-RUN (a signature proves who,
//                                                    not what)
//   grow-bomb      a self-signed card whose seed is a GROW spore → refused at the SEED: a verifier never grows
//   other-data     a node that holds different data → refuses: it cannot re-run the claim
//   unsigned-v1    a bare v1 seed, no signature     → refused at PARSE
//   screenshot     the genuine card drawn, downscaled to 40% + 4 grey levels, read back off the picture
//                                                  → B still accepts
//
// Keys come from fixed seeds and Ed25519 is deterministic, so the receipt regenerates byte-for-byte:
//   node tools/edge-receipt.mjs           write receipts/edge-verify.json
//   node tools/edge-receipt.mjs --check   regenerate and demand it is identical to the committed file
//
// NOTE, plainly: both nodes run in one process here. The live two-browser run over WebRTC is mesh.html; the
// two-DEVICE receipt waits on a second device.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { nodeTools, sha256hex } from '../node-tools.mjs';
import { makeSignedCard, sealClaim, envelopeFromCells, verifyAtEdge } from '../mesh.mjs';
import { CARD_SEED, V2, frame, encodeMatrix, strToBytes } from '../spore-card.mjs';
import { renderGray, degradeGray, sampleGray } from '../spore-card-image.mjs';
import { canonicalJson } from './canonical.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV = join(ROOT, 'data', 'online_shoppers_intention.csv');
const OUT = join(ROOT, 'receipts', 'edge-verify.json');

export async function run() {
  const A = nodeTools({ seed32: new Uint8Array(32).fill(0xa1), csvPath: CSV });
  const B = nodeTools({ seed32: new Uint8Array(32).fill(0xb2), csvPath: CSV });
  const C = { ...B, dataSha256Hex: sha256hex(strToBytes('a different dataset')) };

  const genuine = await makeSignedCard(CARD_SEED, A);
  if (!genuine.ok) throw new Error('node A could not make a card: ' + genuine.why);

  const tampered = genuine.envelope.slice();
  tampered[5] ^= 0x01;                                     // one bit, inside the seed

  const lie = await sealClaim(CARD_SEED, 900000, A);       // validly signed, claims 0.900000
  const bomb = await sealClaim('◊ spore.v1 funnel 1 g:64.1.64', 900000, A);   // a self-signed GROW spore

  // the screenshot path: draw the genuine card, degrade it like a re-encode, read it back off the pixels
  const img = renderGray(genuine.cells, V2.MODULES, V2.CELL_PX, V2.QUIET);
  const deg = degradeGray(img.px, img.w, img.h, { scale: 0.4, levels: 4, blur: true });
  const fromPicture = envelopeFromCells(sampleGray(deg.px, deg.w, deg.h, V2.MODULES, V2.CELL_PX, V2.QUIET));
  if (!fromPicture.ok) throw new Error('the degraded card did not read back: ' + fromPicture.why);

  const v1 = encodeMatrix(frame(strToBytes(CARD_SEED)), V2.MODULES, V2.REPS);
  const v1read = envelopeFromCells(v1.cells);

  const cases = [
    { expect: { accept: true, stage: 'accepted' }, r: await verifyAtEdge(genuine.envelope, B, 'genuine') },
    { expect: { accept: false, stage: 'seal' }, r: await verifyAtEdge(tampered, B, 'tampered') },
    { expect: { accept: false, stage: 'rerun' }, r: await verifyAtEdge(lie.envelope, B, 'false-claim') },
    { expect: { accept: false, stage: 'seed' }, r: await verifyAtEdge(bomb.envelope, B, 'grow-bomb') },
    { expect: { accept: false, stage: 'data' }, r: await verifyAtEdge(genuine.envelope, C, 'other-data') },
    { expect: { accept: false, stage: 'parse' }, r: await verifyAtEdge(v1read.ok ? v1read.envelope : strToBytes(CARD_SEED), B, 'unsigned-v1') },
    { expect: { accept: true, stage: 'accepted' }, r: await verifyAtEdge(fromPicture.envelope, B, 'screenshot') },
  ];
  const held = cases.every(c => c.r.accept === c.expect.accept && c.r.stage === c.expect.stage);

  return {
    kind: 'spore-card-edge-verify-run',
    v: 1,
    rule: 'a signature proves who; only a re-run on the receiving node proves what (MESH_PLAN 2b)',
    seed: CARD_SEED,
    data: { file: 'data/online_shoppers_intention.csv', sha256: A.dataSha256Hex },
    nodes: { A: Buffer.from(A.pubkey).toString('hex'), B: Buffer.from(B.pubkey).toString('hex') },
    topology: 'two nodes, one process — the two-browser WebRTC run is mesh.html; two devices pending',
    tests: cases.length,
    held,
    cases: cases.map(c => ({ ...c.r, expected: c.expect })),
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url).replace(/\\/g, '/') === process.argv[1].replace(/\\/g, '/');
if (isMain) {
  const result = await run();
  const text = canonicalJson(result) + '\n';
  if (process.argv.includes('--check')) {
    let committed = '';
    try { committed = readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n'); } catch { /* none */ }
    if (committed !== text) { console.error('edge receipt does NOT reproduce — receipts/edge-verify.json differs from a fresh run'); process.exit(1); }
    console.log(`REPRODUCED — ${result.tests} cases, verdicts held: ${result.held}`);
    process.exit(result.held ? 0 : 1);
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
  for (const c of result.cases) console.log(`${c.accept ? 'ACCEPT' : 'REFUSE'}  ${String(c.case).padEnd(12)} ${c.stage.padEnd(9)} ${c.reason}`);
  console.log(`\n${result.held ? 'every verdict as expected' : 'A VERDICT DID NOT MATCH'} — ${result.tests} cases → receipts/edge-verify.json`);
  process.exit(result.held ? 0 : 1);
}
