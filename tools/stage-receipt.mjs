#!/usr/bin/env node
// tools/stage-receipt.mjs — card stages (CARD-SPEC §9, lineage slice 1) as a re-runnable receipt.
//
// Four nodes with fixed keys and their own copy of the data. A makes a root card; B grows stage 1 on it under B's key;
// C — who did neither — re-verifies the chain. Then every attack the design's judges named:
//
//   laundered     D takes B's stage-1 genome and signs it under D's OWN keyed seed number, with its true held-out
//                 score → refused: re-grown here for D's key, the grow does not land on that genome
//   stolen-seed   D signs B's exact stage-1 seed (B's seed number) as D's own → refused at KEY
//   flipped       one byte of the stage-1 link changed → refused at the SIGNATURE
//   spliced       B's stage 1 placed after a different root → refused at ORDER
//   false-claim   B validly signs stage 1 claiming 0.950000 → refused at HELD (the re-run gives the real number)
//   no-climb      B signs the ungrown stem at its keyed seed number → refused at CLIMB (it beats nothing)
//   wrong-band    the card's band is not its latest stage → refused at BOUND
//   two-chunks    a card carrying two histories → refused at ONCE
//   ten-links     ten links → refused while parsing, before anything else is looked at
//   unknown-rules a chain grown under rules this reader does not hold → PENDING (listed, not counted); the same chain
//                 claiming those rules but rooted in another's → refused at ORDER (computable from the id alone)
//   no-data       a reader without the data → PENDING
//   no-budget     a reader out of time before the first re-run → PENDING, nothing proven
//   stripped      a copy whose history chunk was stripped → carries no stages (its band is still one signed claim)
//
// Keys come from fixed seeds and Ed25519 is deterministic, so the receipt regenerates byte-for-byte:
//   node tools/stage-receipt.mjs           write receipts/stage-unlock.json
//   node tools/stage-receipt.mjs --check   regenerate and demand it is identical to the committed file
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { nodeTools, sha256hex } from '../node-tools.mjs';
import { parseSessions } from '../organ.mjs';
import { packUnsigned, attachSignature, unpack } from '../envelope.mjs';
import { strToBytes } from '../spore-card.mjs';
import { RULES, rootPrevText, lineageText } from '../stages.mjs';
import { heldMicro, stageSpore } from '../stage-grow.mjs';
import { makeRoot, growNext, verifyStages, keyedSeedNos } from '../stage-mesh.mjs';
import { decodeSpore } from '../spore.mjs';
import { bytesToStr } from '../spore-card.mjs';
import { canonicalJson } from './canonical.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV = join(ROOT, 'data', 'online_shoppers_intention.csv');
const OUT = join(ROOT, 'receipts', 'stage-unlock.json');
const R = RULES['funnel/1'];
const hex = (u8) => Buffer.from(u8).toString('hex');
const b64 = (u8) => Buffer.from(u8).toString('base64');

async function sign(tools, { seed, claimMicro, prev }) {
  const u = packUnsigned({ seed: strToBytes(seed), aucMicro: claimMicro, dataTag: Buffer.from(R.dataTag, 'hex'), prev, pubkey: tools.pubkey });
  return attachSignature(u.bytes, await tools.sign(u.bytes)).bytes;
}
const verdict = (v) => ({ structure: v.structure.verdict + ' · ' + v.structure.check + (v.structure.at === null ? '' : ' @' + v.structure.at),
  lineage: v.lineage.verdict, proven: v.lineage.proven, check: v.lineage.check, at: v.lineage.at, reason: v.lineage.reason });

export async function run() {
  const data = parseSessions(readFileSync(CSV, 'utf8'));
  const [A, B, C, D] = [0x41, 0x42, 0x43, 0x44].map((b) => nodeTools({ seed32: new Uint8Array(32).fill(b), csvPath: CSV }));
  const C2 = { ...C, dataSha256Hex: sha256hex(strToBytes('a different dataset')) };

  const root = (await makeRoot(A, data)).link;
  const s1 = await growNext([root], B, data);
  if (!s1.ok) throw new Error('B could not grow stage 1: ' + s1.why);
  const chain = [root, s1.link];
  const card = (links, band = links[links.length - 1], rules = 'funnel/1') => ({ text: lineageText(rules, links), band });
  const judge = async (c, tools = C, opts = {}) => verdict(await verifyStages(c.text, tools, data, { band: c.band, ...opts }));

  const rootHash = Buffer.from(sha256hex(root), 'hex');
  const genomeB = decodeSpore(bytesToStr(unpack(s1.link).seed)).spore.genome;

  // D launders B's genome under D's own keyed seed number, with the TRUE held-out score of that seed
  const dSeeds = await keyedSeedNos(D, 'funnel/1', hex(rootHash), b64(D.pubkey));
  const launderedSeed = stageSpore(R, dSeeds[0], genomeB);
  const laundered = await sign(D, { seed: launderedSeed, claimMicro: heldMicro(data, launderedSeed), prev: rootHash });
  const stolen = await sign(D, { seed: bytesToStr(unpack(s1.link).seed), claimMicro: s1.heldMicro, prev: rootHash });
  const flipped = s1.link.slice(); flipped[10] ^= 0x01;
  const otherRoot = (await makeRoot(C, data)).link;
  const lie = await sign(B, { seed: bytesToStr(unpack(s1.link).seed), claimMicro: 950000, prev: rootHash });
  const bSeeds = await keyedSeedNos(B, 'funnel/1', hex(rootHash), b64(B.pubkey));
  const stemSeed = stageSpore(R, bSeeds[0], decodeSpore(R.rootSpore).spore.genome);
  const noClimb = await sign(B, { seed: stemSeed, claimMicro: heldMicro(data, stemSeed), prev: rootHash });
  // a chain under rules this reader does not hold — rooted correctly for those rules, and one that is not
  const prev9 = Buffer.from(sha256hex(strToBytes(rootPrevText('funnel/9'))), 'hex');
  const root9 = await sign(A, { seed: R.rootSpore, claimMicro: heldMicro(data, R.rootSpore), prev: prev9 });

  const cases = [
    { case: 'root-only', expect: 'PASS', v: await judge(card([root])) },
    { case: 'stage-1', expect: 'PASS', v: await judge(card(chain)) },
    { case: 'laundered', expect: 'REFUSED', v: await judge(card([root, laundered])) },
    { case: 'stolen-seed', expect: 'REFUSED', v: await judge(card([root, stolen])) },
    { case: 'flipped', expect: 'REFUSED', v: await judge(card([root, flipped])) },
    { case: 'spliced', expect: 'REFUSED', v: await judge(card([otherRoot, s1.link])) },
    { case: 'false-claim', expect: 'REFUSED', v: await judge(card([root, lie])) },
    { case: 'no-climb', expect: 'REFUSED', v: await judge(card([root, noClimb])) },
    { case: 'wrong-band', expect: 'REFUSED', v: await judge(card(chain, root)) },
    { case: 'two-chunks', expect: 'REFUSED', v: await judge(card(chain), C, { chunks: 2 }) },
    { case: 'ten-links', expect: 'REFUSED', v: verdict(await verifyStages(JSON.stringify({ rules: 'funnel/1', stages: Buffer.concat(Array(10).fill(Buffer.from(root))).toString('base64') }), C, data, { band: root })) },
    { case: 'unknown-rules', expect: 'PENDING', v: await judge(card([root9], root9, 'funnel/9')) },
    { case: 'unknown-rules-misrooted', expect: 'REFUSED', v: await judge(card([root], root, 'funnel/9')) },
    { case: 'no-data', expect: 'PENDING', v: await judge(card(chain), C2) },
    { case: 'no-budget', expect: 'PENDING', v: await judge(card(chain), C, { shouldStop: () => true }) },
    { case: 'stripped', expect: 'PASS', v: await judge({ text: null, band: s1.link }, C, { chunks: 0 }) },
  ];
  const held = cases.every((c) => c.v.lineage === c.expect);
  return {
    kind: 'spore-card-stage-unlock-run', v: 1,
    rule: 'a stage is grown, keyed to who grew it, and re-run by whoever holds the card: the signature proves who, the re-runs (held, climb, replay) prove what',
    rules: { id: 'funnel/1', ...R },
    nodes: { A: hex(A.pubkey), B: hex(B.pubkey), C: hex(C.pubkey), D: hex(D.pubkey) },
    grown: { by: 'B', t: s1.t, seedNo: s1.seedNo, confMicro: s1.confMicro, barMicros: s1.barMicros, heldMicro: s1.heldMicro,
      rootHeldMicro: unpack(root).aucMicro, rootBytes: root.length, stageBytes: s1.link.length, chunkChars: card(chain).text.length },
    tests: cases.length, held,
    cases: cases.map((c) => ({ case: c.case, expected: c.expect, ...c.v })),
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url).replace(/\\/g, '/') === process.argv[1].replace(/\\/g, '/');
if (isMain) {
  const result = await run();
  const text = canonicalJson(result) + '\n';
  if (process.argv.includes('--check')) {
    let committed = '';
    try { committed = readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n'); } catch { /* none */ }
    if (committed !== text) { console.error('stage receipt does NOT reproduce — receipts/stage-unlock.json differs from a fresh run'); process.exit(1); }
    console.log(`REPRODUCED — ${result.tests} cases, verdicts held: ${result.held}`);
    process.exit(result.held ? 0 : 1);
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
  for (const c of result.cases) console.log(`${c.lineage.padEnd(8)} ${String(c.case).padEnd(24)} ${String(c.check).padEnd(10)} ${c.reason}`);
  console.log(`\n${result.held ? 'every verdict as expected' : 'A VERDICT DID NOT MATCH'} — ${result.tests} cases → receipts/stage-unlock.json`);
  process.exit(result.held ? 0 : 1);
}
