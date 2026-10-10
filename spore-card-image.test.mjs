// spore-card-image.test.mjs — value tests for the visible-layer raster + the survival MEASUREMENT, and for
// the lossless PNG chunk. These pin the real numbers (not mutation-gated; see spore-card-image.mjs header).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { V1, cardFrameFor, unframe, bytesToStr, CARD_SEED, encodeMatrix } from './spore-card.mjs';
import { renderGray, sampleGray, survives } from './spore-card-image.mjs';
import { embedChunk, readChunk } from './spore-card-chunk.mjs';
import { serialise } from './png.mjs';

test('renderGray then sampleGray recovers the cells losslessly, square band', () => {
  const enc = encodeMatrix(cardFrameFor());
  const img = renderGray(enc.cells);
  const side = (V1.MODULES + 2 * V1.QUIET) * V1.CELL_PX;
  assert.equal(img.w, side);
  assert.deepEqual(Array.from(sampleGray(img.px, img.w, img.h)), Array.from(enc.cells));
});

test('the seed survives downscale to 40% + 4 grey levels (measured claim)', () => {
  const r = survives(cardFrameFor(), { scale: 0.4, levels: 4, blur: true });
  assert.equal(r.ok, true);
  assert.equal(bytesToStr(r.seed), CARD_SEED);
});
test('the seed survives a harder downscale to 30% + 3 grey levels', () => {
  assert.equal(survives(cardFrameFor(), { scale: 0.3, levels: 3, blur: true }).ok, true);
});

function tinyPng() {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  return serialise([{ type: 'IHDR', data: ihdr }, { type: 'IEND', data: Buffer.alloc(0) }]);
}
test('embedChunk then readChunk recovers the exact seed losslessly', () => {
  const fr = cardFrameFor();
  const em = embedChunk(tinyPng(), fr);
  assert.ok(em.ok);
  const rc = readChunk(em.png);
  assert.ok(rc.ok);
  assert.deepEqual(Array.from(rc.seed), Array.from(unframe(fr).seed));
});
test('readChunk returns ok:false when there is no spoR chunk', () => {
  assert.equal(readChunk(tinyPng()).ok, false);
});
