// mesh.test.mjs — integration: two nodes, real Ed25519 (node:crypto), real germination on the real dataset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { nodeTools, identityFromSeed, verify, sha256hex } from './node-tools.mjs';
import { makeSignedCard, sealClaim, envelopeFromCells, verifyAtEdge, tagFromHex } from './mesh.mjs';
import { CARD_SEED, V1, frame, encodeMatrix, strToBytes } from './spore-card.mjs';

const CSV = join(dirname(fileURLToPath(import.meta.url)), 'data', 'online_shoppers_intention.csv');
const A = nodeTools({ seed32: new Uint8Array(32).fill(1), csvPath: CSV });
const B = nodeTools({ seed32: new Uint8Array(32).fill(2), csvPath: CSV });

test('tagFromHex takes the first 4 bytes of a hex digest', () => {
  assert.deepEqual(Array.from(tagFromHex('deadbeef00112233')), [0xde, 0xad, 0xbe, 0xef]);
  assert.deepEqual(Array.from(tagFromHex('zz')), [0, 0, 0, 0]);
  assert.deepEqual(Array.from(tagFromHex(null)), [0, 0, 0, 0]);
});

test('identity from a seed is deterministic, and its signatures verify', () => {
  const a = identityFromSeed(new Uint8Array(32).fill(9)), b = identityFromSeed(new Uint8Array(32).fill(9));
  assert.deepEqual(Array.from(a.pubkey), Array.from(b.pubkey));
  const msg = strToBytes('hello');
  assert.deepEqual(Array.from(a.sign(msg)), Array.from(b.sign(msg)));
  assert.equal(verify(msg, a.sign(msg), a.pubkey), true);
  assert.equal(verify(strToBytes('hellO'), a.sign(msg), a.pubkey), false);
  assert.equal(verify(msg, a.sign(msg), B.pubkey), false);
  assert.equal(verify(msg, null, a.pubkey), false);
});

test('node A seals only what it earned; node B accepts after reproducing it', async () => {
  const card = await makeSignedCard(CARD_SEED, A);
  assert.ok(card.ok);
  assert.equal(Math.round(card.heldAuc * 1e6), 820498);
  const r = await verifyAtEdge(card.envelope, B, 'genuine');
  assert.equal(r.accept, true);
  assert.equal(r.reproduced, '0.820498');
  assert.equal(r.signer, Buffer.from(A.pubkey).toString('hex'), 'the receipt names the signer');
});

test('a tampered byte is refused at the seal, before anything is germinated', async () => {
  const card = await makeSignedCard(CARD_SEED, A);
  const bad = card.envelope.slice(); bad[bad.length - 70] ^= 0x80;     // inside the signed tail (the key)
  let germinated = 0;
  const watched = { ...B, germinate: (s) => { germinated++; return B.germinate(s); } };
  const r = await verifyAtEdge(bad, watched, 'tampered');
  assert.equal(r.stage, 'seal');
  assert.equal(germinated, 0, 'nothing unverified is run');
});

test('a validly signed lie is refused at the re-run', async () => {
  const lie = await sealClaim(CARD_SEED, 950000, A);
  const r = await verifyAtEdge(lie.envelope, B, 'false-claim');
  assert.equal(r.seal, 'verified', 'the signature is genuine');
  assert.equal(r.accept, false);
  assert.equal(r.stage, 'rerun');
});

test('a card read back off its own grid verifies; a v1 grid has no envelope', async () => {
  const card = await makeSignedCard(CARD_SEED, A);
  const back = envelopeFromCells(card.cells);
  assert.ok(back.ok);
  assert.equal((await verifyAtEdge(back.envelope, B)).accept, true);
  const v1 = encodeMatrix(frame(strToBytes(CARD_SEED)), 63, 3);
  assert.match(envelopeFromCells(v1.cells).why, /unsigned \(v1\)/);
  assert.equal(envelopeFromCells(new Uint8Array(10)).ok, false);
  assert.equal(V1.VER, 1);
});

test('verifyAtEdge never throws on junk', async () => {
  for (const j of [null, undefined, new Uint8Array(0), 'x', {}]) {
    const r = await verifyAtEdge(j, B);
    assert.equal(r.accept, false);
    assert.equal(r.stage, 'parse');
  }
  assert.equal(sha256hex(new Uint8Array(0)), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});
