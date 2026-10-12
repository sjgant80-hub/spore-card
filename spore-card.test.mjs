// spore-card.test.mjs — the witness runs mutations against spore-card.mjs (the exact bit-codec). These
// assertions pin the real behaviour at the BOUNDARIES so a flipped operator breaks at least one, plus the
// never-throw fuzz boundary. The image/survival layer has its own value tests in spore-card-image.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  V1, V2, CARD_SEED, strToBytes, bytesToStr, crc16, frame, unframe,
  isFinder, dataCells, encodeMatrix, decodeMatrix, cardFrameFor, seedFromFrame,
} from './spore-card.mjs';

// ── v2: the versioned frame and the bigger grid a signed envelope needs ─────────────────────────────
test('V2 is the 63-module, version-2 shape with the same module size as V1', () => {
  assert.equal(V2.MODULES, 63);
  assert.equal(V2.VER, 2);
  assert.equal(V2.REPS, 3);
  assert.equal(V2.CELL_PX, V1.CELL_PX);
  assert.equal(V2.MAGIC, V1.MAGIC);
});
test('frame writes the version it is given; unframe reports it and returns the payload', () => {
  const p = Uint8Array.from([9, 8, 7]);
  const f2 = frame(p, 2);
  assert.equal(f2[1], 2);
  const u2 = unframe(f2);
  assert.ok(u2.ok);
  assert.equal(u2.ver, 2);
  assert.deepEqual(Array.from(u2.payload), [9, 8, 7]);
  assert.deepEqual(Array.from(u2.seed), [9, 8, 7]);
  const u1 = unframe(frame(p));
  assert.equal(u1.ver, 1, 'the default version is 1');
});
test('frame refuses to write an unknown version — it falls back to 1, never writes 9', () => {
  assert.equal(frame(Uint8Array.from([1]), 9)[1], 1);
  assert.equal(frame(Uint8Array.from([1]), 0)[1], 1);
  assert.equal(frame(Uint8Array.from([1]), 3)[1], 1);
});
test('unframe refuses versions other than 1 and 2', () => {
  for (const v of [0, 3, 9, 255]) {
    const f = frame(Uint8Array.from([1, 2]), 1);
    f[1] = v;
    assert.equal(unframe(f).ok, false, 'version ' + v + ' must be refused');
  }
});
test('seedFromFrame reads only v1 — a v2 payload is an envelope, not a string', () => {
  const r = seedFromFrame(frame(strToBytes('hello'), 2));
  assert.equal(r.ok, false);
  assert.match(r.error, /signed card/);
  assert.equal(seedFromFrame(frame(strToBytes('hello'), 1)).seed, 'hello');
});
test('a ~150-byte signed envelope fits the V2 grid and round-trips; it does not fit V1', () => {
  const env = Uint8Array.from({ length: 147 }, (_, i) => (i * 37 + 11) & 0xff);
  const fr = frame(env, 2);
  const enc = encodeMatrix(fr, V2.MODULES, V2.REPS);
  assert.ok(enc.ok);
  const dec = decodeMatrix(enc.cells, V2.MODULES, V2.REPS);
  assert.ok(dec.ok);
  assert.deepEqual(Array.from(dec.frame), Array.from(fr));
  assert.equal(encodeMatrix(fr, V1.MODULES, V1.REPS).ok, false, 'the v1 grid is too small for a signature');
});

// ── UTF-8 encode, pinned at every width boundary (kills < vs <= on 0x80/0x800/0x10000) ──────────────
test('strToBytes encodes each codepoint-width boundary at the exact byte length and value', () => {
  assert.deepEqual(Array.from(strToBytes('\u007f')), [0x7f]);                 // last 1-byte
  assert.deepEqual(Array.from(strToBytes('\u0080')), [0xc2, 0x80]);           // first 2-byte
  assert.deepEqual(Array.from(strToBytes('߿')), [0xdf, 0xbf]);           // last 2-byte
  assert.deepEqual(Array.from(strToBytes('ࠀ')), [0xe0, 0xa0, 0x80]);     // first 3-byte
  assert.deepEqual(Array.from(strToBytes('￿')), [0xef, 0xbf, 0xbf]);     // last 3-byte
  assert.deepEqual(Array.from(strToBytes('\u{10000}')), [0xf0, 0x90, 0x80, 0x80]); // first 4-byte
  assert.deepEqual(Array.from(strToBytes('◊')), [0xe2, 0x97, 0x8a]);     // ◊
});
test('strToBytes advances past a surrogate pair exactly once (◊ then ASCII survives)', () => {
  assert.equal(bytesToStr(strToBytes('￿A')), '￿A'); // U+FFFF is BMP: must NOT skip the A
  assert.equal(bytesToStr(strToBytes('\u{1f600}B')), '\u{1f600}B'); // astral: must skip exactly one unit
});
test('strToBytes treats null/undefined as empty, not the string "null"', () => {
  assert.equal(strToBytes(null).length, 0);
  assert.equal(strToBytes(undefined).length, 0);
});
test('strToBytes/bytesToStr round-trip the card seed and mixed text', () => {
  for (const s of ['', 'a', CARD_SEED, 'π≈3.14', '😀x', '\u0080߿ࠀ￿']) {
    assert.equal(bytesToStr(strToBytes(s)), s);
  }
});

// ── UTF-8 decode edges (kills the i+1<n / i+2<n continuation guards and the lead-byte ranges) ───────
test('bytesToStr skips a lone lead byte instead of decoding garbage', () => {
  assert.equal(bytesToStr(Uint8Array.from([0xc2])), '');           // 2-byte lead, no continuation
  assert.equal(bytesToStr(Uint8Array.from([0xe0, 0xa0])), '');     // 3-byte lead, one short
  assert.equal(bytesToStr(Uint8Array.from([0xf0, 0x90, 0x80])), ''); // 4-byte lead, one short
});
test('bytesToStr decodes a complete 2-byte char that ends the buffer', () => {
  assert.equal(bytesToStr(Uint8Array.from([0xc2, 0x80])), '\u0080');
});
test('bytesToStr treats 0xc0 as a 2-byte lead (kills x>=0xc0 vs x>0xc0)', () => {
  // 0xc0 is the lowest 2-byte lead; a valid encoding never emits it, so only a direct test pins the boundary
  assert.equal(bytesToStr(Uint8Array.from([0xc0, 0x80])), '\u0000');
});

// ── CRC-16 ───────────────────────────────────────────────────────────────────────────────────────
test('crc16 is the CCITT-FALSE check value for "123456789"', () => {
  assert.equal(crc16(strToBytes('123456789')), 0x29b1);
});
test('crc16 changes when any byte changes, and honours start/end slicing', () => {
  assert.notEqual(crc16(strToBytes('hello')), crc16(strToBytes('hellp')));
  const b = strToBytes('ABCD');
  assert.equal(crc16(b, 1, 3), crc16(strToBytes('BC'))); // slice [1,3) == "BC"
  assert.notEqual(crc16(b, 0, 4), crc16(b, 1, 3));
});

// ── frame / unframe ──────────────────────────────────────────────────────────────────────────────
test('frame then unframe recovers the exact seed bytes, header shaped correctly', () => {
  const seed = strToBytes(CARD_SEED);
  const fr = frame(seed);
  assert.equal(fr[0], V1.MAGIC);
  assert.equal(fr[1], V1.VER);
  assert.equal(fr.length, 4 + seed.length + 2);
  assert.equal((fr[2] << 8) | fr[3], seed.length); // length field is big-endian and exact
  const uf = unframe(fr);
  assert.ok(uf.ok);
  assert.deepEqual(Array.from(uf.seed), Array.from(seed));
});
test('an empty-seed frame is exactly 6 bytes and round-trips (kills n<6 vs n<=6)', () => {
  const fr = frame(new Uint8Array(0));
  assert.equal(fr.length, 6);
  const uf = unframe(fr);
  assert.ok(uf.ok);
  assert.equal(uf.seed.length, 0);
});
test('unframe rejects a flipped payload byte (crc catches it)', () => {
  const fr = frame(strToBytes(CARD_SEED));
  fr[5] ^= 0x01;
  assert.equal(unframe(fr).ok, false);
});
test('unframe rejects a flipped crc byte', () => {
  const fr = frame(strToBytes('abc'));
  fr[fr.length - 1] ^= 0x01;
  assert.equal(unframe(fr).ok, false);
});
test('unframe rejects bad magic, bad version, an overrunning length, and a 5-byte buffer', () => {
  const fr = frame(strToBytes('abc'));
  const m = Uint8Array.from(fr); m[0] = 0x00; assert.equal(unframe(m).ok, false);
  const v = Uint8Array.from(fr); v[1] = 0x09; assert.equal(unframe(v).ok, false);
  const l = Uint8Array.from(fr); l[3] = 0xff; assert.equal(unframe(l).ok, false);
  assert.equal(unframe(Uint8Array.from([0x53, 1, 0, 0, 0])).ok, false);
});

// ── module grid ────────────────────────────────────────────────────────────────────────────────────
test('isFinder marks exactly the three corners, not the fourth or the centre', () => {
  const M = V1.MODULES;
  assert.equal(isFinder(0, 0, M), true);        // TL
  assert.equal(isFinder(0, M - 1, M), true);    // TR
  assert.equal(isFinder(M - 1, 0, M), true);    // BL
  assert.equal(isFinder(M - 1, M - 1, M), false); // BR is NOT a finder
  assert.equal(isFinder(2, 2, M), true);        // inside TL
  assert.equal(isFinder(3, 3, M), false);       // just outside TL
  assert.equal(isFinder(0, M - 4, M), false);   // just left of TR
});
test('dataCells excludes exactly the 27 finder modules', () => {
  assert.equal(dataCells(V1.MODULES).length, V1.MODULES * V1.MODULES - 27);
});
test('encodeMatrix round-trips through decodeMatrix and leaves finder cells reserved (blank)', () => {
  const fr = cardFrameFor();
  const enc = encodeMatrix(fr);
  assert.ok(enc.ok);
  const M = V1.MODULES;
  // the three finder corners carry no data — the codec reserves them (the image layer draws them)
  assert.equal(enc.cells[0], 0);
  assert.equal(enc.cells[M - 1], 0);
  assert.equal(enc.cells[(M - 1) * M], 0);
  const dec = decodeMatrix(enc.cells);
  assert.ok(dec.ok);
  assert.deepEqual(Array.from(dec.frame), Array.from(fr));
});
test('decodeMatrix majority-vote recovers the frame despite flipping one whole copy of many bits', () => {
  const fr = cardFrameFor();
  const enc = encodeMatrix(fr);
  const M = V1.MODULES, cells = Uint8Array.from(enc.cells);
  const list = dataCells(M);
  const base = 16 * V1.REPS;
  for (let b = 0; b < 60; b++) { const rc = list[base + b]; cells[rc[0] * M + rc[1]] ^= 1; } // damage copy 0
  const dec = decodeMatrix(cells);
  assert.ok(dec.ok);
  assert.deepEqual(Array.from(dec.frame), Array.from(fr));
});
test('decodeMatrix rejects an all-blank grid (implausible header length)', () => {
  const blank = new Uint8Array(V1.MODULES * V1.MODULES);
  assert.equal(decodeMatrix(blank).ok, false);
});
test('a minimal 6-byte frame (empty seed) round-trips through the matrix (kills flen<6 vs <=6)', () => {
  const fr = frame(new Uint8Array(0)); // length exactly 6
  const enc = encodeMatrix(fr);
  assert.ok(enc.ok);
  const dec = decodeMatrix(enc.cells);
  assert.ok(dec.ok);
  assert.deepEqual(Array.from(dec.frame), Array.from(fr));
});
test('encodeMatrix fits a payload that just fits and refuses one byte more', () => {
  // capacity: 48 header cells + frameBytes*8*3 payload cells <= dataCells (1342) -> frame <= 53 bytes,
  // i.e. seed <= 47 (frame adds a 6-byte envelope). seed 47 -> frame 53 fits; seed 48 -> frame 54 overflows.
  assert.equal(encodeMatrix(frame(new Uint8Array(47))).ok, true);
  assert.equal(encodeMatrix(frame(new Uint8Array(48))).ok, false);
});
test('seedFromFrame reads the seed string back, and rejects a broken frame', () => {
  assert.equal(seedFromFrame(cardFrameFor()).seed, CARD_SEED);
  assert.equal(seedFromFrame(Uint8Array.from([1, 2, 3])).ok, false);
});

// ── the never-throw fuzz boundary ───────────────────────────────────────────────────────────────────
test('every exported codec function returns safely on hostile input, never throws', () => {
  const hostile = [null, undefined, NaN, Infinity, -1, {}, [], '', 'xx', 1e9, Symbol.iterator, () => {}, new Uint8Array(0), 0x10ffff];
  const call = (fn, ...a) => { try { fn(...a); return true; } catch { return false; } };
  for (const h of hostile) {
    for (const fn of [strToBytes, bytesToStr, crc16, frame, unframe, encodeMatrix, decodeMatrix, dataCells, seedFromFrame, cardFrameFor]) {
      assert.ok(call(fn, h), fn.name + ' threw on ' + String(h));
    }
    assert.ok(call(isFinder, h, h, h), 'isFinder threw on ' + String(h));
  }
});
