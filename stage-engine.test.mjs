// stage-engine.test.mjs — a rules id is a promise: once 'funnel/1' is sealed, the engine that grows and replays its
// stages must never change under it, or an old card's stages would silently mean something else. This pins the engine
// source; changing it fails here, and the honest fix is a NEW rules id (keeping the old engine to judge old cards).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { RULES } from './stages.mjs';
import { ENGINE } from './stage-grow.mjs';
import { aucToMicro } from './envelope.mjs';

const ENGINE_FILES = ['organ.mjs', 'spore.mjs', 'stage-grow.mjs'];
const FUNNEL_1_ENGINE_SHA = '02016f41a204d7759c4ae68b1f456d241b12c8fbf72922842efb9f3f6bbe30a8';

test('the engine funnel/1 was sealed with has not changed', () => {
  const h = createHash('sha256');
  for (const f of ENGINE_FILES) h.update(readFileSync(new URL('./' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
  assert.equal(h.digest('hex'), FUNNEL_1_ENGINE_SHA, 'the stage engine changed — give it a new rules id instead');
  assert.equal(ENGINE, RULES['funnel/1'].engine);
});

test('the score unit the stages compare is millionths, rounded', () => {
  assert.equal(aucToMicro(0.8204977611516077), 820498);
  assert.equal(aucToMicro(0.9245555), 924556);
});
