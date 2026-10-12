// envelope.test.mjs — the signed envelope's layout and every boundary, pinned so a flipped operator breaks
// a test. The witness mutates envelope.mjs against this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENVELOPE_TYPE, MAX_SEED, TAG_LEN, PUBKEY_LEN, SIG_LEN, CLAIM_LEN, MAX_MICRO,
  aucToMicro, sameBytes, packUnsigned, attachSignature, unpack,
} from './envelope.mjs';

const seed = Uint8Array.from([0x41, 0x42, 0x43]);                 // "ABC"
const dataTag = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
const pubkey = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const sig = Uint8Array.from({ length: 64 }, (_, i) => 200 - i);
const good = { seed, aucMicro: 820498, dataTag, pubkey };

test('constants', () => {
  assert.equal(ENVELOPE_TYPE, 0x02);
  assert.equal(MAX_SEED, 200);
  assert.equal(TAG_LEN, 4); assert.equal(PUBKEY_LEN, 32); assert.equal(SIG_LEN, 64); assert.equal(CLAIM_LEN, 4);
  assert.equal(MAX_MICRO, 1000000);
});

test('aucToMicro rounds to millionths and clamps to [0, 1e6]', () => {
  assert.equal(aucToMicro(0.8204977611516077), 820498);
  assert.equal(aucToMicro(0.5), 500000);
  assert.equal(aucToMicro(0), 0);
  assert.equal(aucToMicro(1), 1000000);
  assert.equal(aucToMicro(1.5), 1000000, 'above 1 clamps to 1e6');
  assert.equal(aucToMicro(-0.2), 0, 'below 0 clamps to 0');
  assert.equal(aucToMicro(0.0000004), 0);
  assert.equal(aucToMicro(0.0000006), 1);
  for (const junk of [NaN, Infinity, '0.8', null, undefined, {}]) assert.equal(aucToMicro(junk), 0);
});

test('sameBytes is exact', () => {
  assert.equal(sameBytes(Uint8Array.from([1, 2]), Uint8Array.from([1, 2])), true);
  assert.equal(sameBytes(Uint8Array.from([1, 2]), Uint8Array.from([1, 3])), false);
  assert.equal(sameBytes(Uint8Array.from([1, 2]), Uint8Array.from([1, 2, 3])), false);
  assert.equal(sameBytes(new Uint8Array(0), new Uint8Array(0)), true);
  assert.equal(sameBytes([1, 2], Uint8Array.from([1, 2])), false, 'a plain array is not bytes');
  assert.equal(sameBytes(Uint8Array.from([1]), null), false);
});

test('packUnsigned lays out every field at its exact offset', () => {
  const r = packUnsigned(good);
  assert.ok(r.ok);
  const b = r.bytes;
  assert.equal(b.length, 2 + 3 + 4 + 4 + 32);
  assert.equal(b[0], 0x02);
  assert.equal(b[1], 3);
  assert.deepEqual(Array.from(b.slice(2, 5)), [0x41, 0x42, 0x43]);
  // 820498 = 0x000C8512 big-endian
  assert.deepEqual(Array.from(b.slice(5, 9)), [0x00, 0x0c, 0x85, 0x12]);
  assert.deepEqual(Array.from(b.slice(9, 13)), [0xde, 0xad, 0xbe, 0xef]);
  assert.deepEqual(Array.from(b.slice(13, 45)), Array.from(pubkey));
});

test('packUnsigned encodes the full 32-bit claim range big-endian', () => {
  const r = packUnsigned({ ...good, aucMicro: 1000000 });        // 0x000F4240
  assert.deepEqual(Array.from(r.bytes.slice(5, 9)), [0x00, 0x0f, 0x42, 0x40]);
  const z = packUnsigned({ ...good, aucMicro: 0 });
  assert.deepEqual(Array.from(z.bytes.slice(5, 9)), [0, 0, 0, 0]);
});

test('packUnsigned refuses every malformed field, at the exact boundary', () => {
  assert.equal(packUnsigned({ ...good, seed: new Uint8Array(0) }).ok, false, 'empty seed');
  assert.equal(packUnsigned({ ...good, seed: new Uint8Array(1) }).ok, true, 'a 1-byte seed is fine');
  assert.equal(packUnsigned({ ...good, seed: new Uint8Array(200) }).ok, true, '200 bytes is the max');
  assert.equal(packUnsigned({ ...good, seed: new Uint8Array(201) }).ok, false, '201 is over');
  assert.equal(packUnsigned({ ...good, seed: [1, 2] }).ok, false, 'a plain array is not a seed');
  assert.equal(packUnsigned({ ...good, aucMicro: -1 }).ok, false);
  assert.equal(packUnsigned({ ...good, aucMicro: 1000001 }).ok, false);
  assert.equal(packUnsigned({ ...good, aucMicro: 1000000 }).ok, true);
  assert.equal(packUnsigned({ ...good, aucMicro: 0 }).ok, true);
  assert.equal(packUnsigned({ ...good, aucMicro: 0.5 }).ok, false, 'not an integer');
  assert.equal(packUnsigned({ ...good, dataTag: new Uint8Array(3) }).ok, false);
  assert.equal(packUnsigned({ ...good, dataTag: new Uint8Array(5) }).ok, false);
  assert.equal(packUnsigned({ ...good, pubkey: new Uint8Array(31) }).ok, false);
  assert.equal(packUnsigned({ ...good, pubkey: new Uint8Array(33) }).ok, false);
  assert.match(packUnsigned({ ...good, seed: new Uint8Array(0) }).why, /seed/);
  assert.match(packUnsigned({ ...good, aucMicro: -1 }).why, /claim/);
  assert.match(packUnsigned({ ...good, dataTag: new Uint8Array(3) }).why, /data tag/);
  assert.match(packUnsigned({ ...good, pubkey: new Uint8Array(3) }).why, /public key/);
});

test('attachSignature appends exactly 64 bytes, and refuses anything else', () => {
  const u = packUnsigned(good).bytes;
  const s = attachSignature(u, sig);
  assert.ok(s.ok);
  assert.equal(s.bytes.length, u.length + 64);
  assert.deepEqual(Array.from(s.bytes.slice(0, u.length)), Array.from(u));
  assert.deepEqual(Array.from(s.bytes.slice(u.length)), Array.from(sig));
  assert.equal(attachSignature(u, new Uint8Array(63)).ok, false);
  assert.equal(attachSignature(u, new Uint8Array(65)).ok, false);
  assert.equal(attachSignature(new Uint8Array(42), sig).ok, false, 'shorter than the smallest unsigned envelope');
  assert.equal(attachSignature(new Uint8Array(43), sig).ok, true, '2 + 1-byte seed + 40 is the smallest');
  assert.equal(attachSignature([1], sig).ok, false);
});

test('unpack recovers every field and the exact signed bytes', () => {
  const u = packUnsigned(good).bytes;
  const e = attachSignature(u, sig).bytes;
  const r = unpack(e);
  assert.ok(r.ok);
  assert.deepEqual(Array.from(r.seed), [0x41, 0x42, 0x43]);
  assert.equal(r.aucMicro, 820498);
  assert.deepEqual(Array.from(r.dataTag), Array.from(dataTag));
  assert.deepEqual(Array.from(r.pubkey), Array.from(pubkey));
  assert.deepEqual(Array.from(r.sig), Array.from(sig));
  assert.deepEqual(Array.from(r.signedBytes), Array.from(u), 'the signature covers exactly the unsigned bytes — pubkey included');
});

test('unpack reads a claim with the top bit of a byte set (unsigned arithmetic)', () => {
  const e = attachSignature(packUnsigned({ ...good, aucMicro: 999999 }).bytes, sig).bytes;   // 0x000F423F
  assert.equal(unpack(e).aucMicro, 999999);
  const e2 = attachSignature(packUnsigned({ ...good, aucMicro: 128 }).bytes, sig).bytes;
  assert.equal(unpack(e2).aucMicro, 128);
  const e3 = attachSignature(packUnsigned({ ...good, aucMicro: 65536 }).bytes, sig).bytes;
  assert.equal(unpack(e3).aucMicro, 65536);
});

test('unpack refuses a wrong type, a bad seed length, a length mismatch and a claim above 1.0', () => {
  const e = attachSignature(packUnsigned(good).bytes, sig).bytes;
  const t = e.slice(); t[0] = 0x01; assert.equal(unpack(t).ok, false);
  const z = e.slice(); z[1] = 0; assert.equal(unpack(z).ok, false, 'seed length 0');
  const big = e.slice(); big[1] = 201; assert.equal(unpack(big).ok, false, 'seed length 201');
  assert.equal(unpack(e.slice(0, e.length - 1)).ok, false, 'one byte short');
  assert.equal(unpack(Uint8Array.from([...e, 0])).ok, false, 'one byte long');
  const hi = e.slice(); hi[5] = 0xff; assert.equal(unpack(hi).ok, false, 'claim above 1e6');
  assert.match(unpack(hi).why, /above 1\.0/);
  assert.equal(unpack(new Uint8Array(1)).ok, false);
  assert.equal(unpack(new Uint8Array(0)).ok, false);
  assert.match(unpack(e.slice(0, e.length - 1)).why, /its own header says/);
});

test('unpack accepts the boundary seed lengths 1 and 200 (and refuses 0 and 201 for the RIGHT reason)', () => {
  for (const n of [1, 200]) {
    const s = Uint8Array.from({ length: n }, (_, i) => (i % 26) + 65);
    const e = attachSignature(packUnsigned({ ...good, seed: s }).bytes, sig).bytes;
    const r = unpack(e);
    assert.equal(r.ok, true, 'a ' + n + '-byte seed must unpack');
    assert.equal(r.seed.length, n);
  }
  const e = attachSignature(packUnsigned(good).bytes, sig).bytes;
  const z = e.slice(); z[1] = 0;
  assert.equal(unpack(z).why, 'the declared seed length is out of range', 'length 0 is refused by the range check itself');
  const big = e.slice(); big[1] = 201;
  assert.equal(unpack(big).why, 'the declared seed length is out of range', 'length 201 is refused by the range check itself');
});

test('a 2-byte buffer passes the "too short" guard and is refused by the length check', () => {
  assert.match(unpack(Uint8Array.from([0x02, 5])).why, /its own header says/);
  assert.equal(unpack(Uint8Array.from([0x02])).why, 'too short to be an envelope');
});

test('unpack accepts the boundary claims 0 and exactly 1e6', () => {
  for (const m of [0, 1000000]) {
    const e = attachSignature(packUnsigned({ ...good, aucMicro: m }).bytes, sig).bytes;
    assert.equal(unpack(e).aucMicro, m);
  }
});

test('nothing here ever throws on hostile input', () => {
  const hostile = [null, undefined, NaN, 0, -1, '', 'x', {}, [], new Uint8Array(0), new Uint8Array(500), Symbol('s'), 10n, () => {}];
  for (const h of hostile) {
    assert.doesNotThrow(() => { aucToMicro(h); sameBytes(h, h); packUnsigned(h); attachSignature(h, h); unpack(h); });
    assert.doesNotThrow(() => packUnsigned({ seed: h, aucMicro: h, dataTag: h, pubkey: h }));
  }
});
