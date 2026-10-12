// wire-chunk.test.mjs — the lossless spoR chunk the browser now actually writes (it used to promise one and ship a
// plain canvas PNG), and the vendored chunk primitives it is written with, pinned byte-for-byte to fallkard-forge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { withSporeChunk, sporeChunkOf } from './spore-card-wire.mjs';
import { parseChunks, serialise } from './vendor/fallkard-forge/card.mjs';
import { cardFrameFor, seedFromFrame, CARD_SEED } from './spore-card.mjs';

const VENDORED_SHA = '736e857b1181cd1f2e5b387bf0b4ca079c000863ffc1521ebf669553b491bf55';   // fallkard-forge @ 6930c80
const tiny = () => serialise([{ type: 'IHDR', data: new Uint8Array(13) }, { type: 'IDAT', data: new Uint8Array([1, 2, 3]) }, { type: 'IEND', data: new Uint8Array(0) }]);

test('the vendored chunk primitives are fallkard-forge\'s, byte for byte', () => {
  const text = readFileSync(new URL('./vendor/fallkard-forge/card.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(text).digest('hex'), VENDORED_SHA);
});

test('the card frame goes in a spoR chunk just before IEND, and comes back exactly', () => {
  const frame = cardFrameFor(CARD_SEED);
  const png = withSporeChunk(tiny(), frame);
  const types = parseChunks(png).map((c) => c.type);
  assert.deepEqual(types, ['IHDR', 'IDAT', 'spoR', 'IEND']);
  assert.deepEqual(Array.from(sporeChunkOf(png)), Array.from(frame));
  assert.equal(seedFromFrame(sporeChunkOf(png)).seed, CARD_SEED);
});

test('writing again replaces the chunk — never two', () => {
  const png = withSporeChunk(withSporeChunk(tiny(), cardFrameFor('◊ spore.v1 funnel 7 f:0000000000000000')), cardFrameFor(CARD_SEED));
  assert.equal(parseChunks(png).filter((c) => c.type === 'spoR').length, 1);
  assert.equal(seedFromFrame(sporeChunkOf(png)).seed, CARD_SEED);
});

test('no chunk, or not a PNG at all, reads as null — never a throw', () => {
  assert.equal(sporeChunkOf(tiny()), null);
  for (const junk of [new Uint8Array(0), new Uint8Array([1, 2, 3]), null, undefined, 'png']) assert.equal(sporeChunkOf(junk), null);
});

// Found 2026-10-12 while building this: index.html put the seed read off a dropped card straight into innerHTML, so a
// card whose band carried `<img src=x onerror=…>` (with a valid CRC — anyone can compute one) ran script in the page.
// Proven on the then-live page; every card-derived string is now escaped. These pin it.
test('the grower page escapes everything a dropped card can carry', () => {
  const page = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  for (const s of ["esc(r.error)", "esc(r.via)", "<div class=\"mono\">' + esc(r.seed) + '</div>'", "esc(e.message || 'read error')", "esc(g.error || 'grow failed')", "esc(e.message || 'grow error')"]) {
    assert.ok(page.includes(s), s);
  }
  assert.ok(!page.includes("<div class=\"mono\">' + r.seed + '</div>'"), 'the unescaped seed is gone');
});
