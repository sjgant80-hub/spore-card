// edge.test.mjs — the edge verdict's order and wording, pinned. The witness mutates edge.mjs against this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, judge, receipt, toHex } from './edge.mjs';

const parsed = { ok: true, aucMicro: 820498, pubkey: Uint8Array.from([0xab, 0x01]) };
const all = { parsed, sigOk: true, seedOk: true, dataTagOk: true, reproducedMicro: 820498 };

test('the stages, in order', () => {
  assert.deepEqual([...STAGES], ['parse', 'seal', 'cite', 'seed', 'data', 'rerun', 'accepted']);
});

test('a card that reproduces is accepted, and says why', () => {
  const v = judge(all);
  assert.equal(v.accept, true);
  assert.equal(v.stage, 'accepted');
  assert.equal(v.reason, 'reproduced 0.820498 here — the signature proves who, the re-run proved what');
});

test('parse: an unreadable envelope is refused first, carrying its own reason', () => {
  const v = judge({ ...all, parsed: { ok: false, why: 'too short' } });
  assert.deepEqual([v.accept, v.stage], [false, 'parse']);
  assert.equal(v.reason, 'not a signed spore card — too short');
  assert.equal(judge({ ...all, parsed: null }).reason, 'not a signed spore card — nothing readable');
  assert.equal(judge({ ...all, parsed: { ok: false, why: 42 } }).reason, 'not a signed spore card — nothing readable');
  assert.equal(judge({ ...all, parsed: { ok: 'yes' } }).stage, 'parse', 'ok must be literally true');
});

test('seal: anything but a literal true signature result is refused — before data or re-run', () => {
  for (const s of [false, null, undefined, 1, 'true']) {
    const v = judge({ ...all, sigOk: s });
    assert.deepEqual([v.accept, v.stage], [false, 'seal']);
  }
  assert.equal(judge({ ...all, sigOk: false }).reason, 'seal mismatch — the Ed25519 signature does not cover these bytes');
  // the seal is checked before the data: a bad seal on a node without the data still says "seal"
  assert.equal(judge({ ...all, sigOk: false, dataTagOk: false }).stage, 'seal');
});

test('data: a node without the data cannot re-run the claim — refused before the re-run', () => {
  for (const d of [false, null, undefined, 'yes']) assert.equal(judge({ ...all, dataTagOk: d }).stage, 'data');
  assert.equal(judge({ ...all, dataTagOk: false }).reason, 'cannot re-run — this node does not hold the data the claim was measured on');
  assert.equal(judge({ ...all, dataTagOk: false, reproducedMicro: 1 }).stage, 'data');
});

test('rerun: a seed that did not germinate is refused', () => {
  for (const r of [null, undefined, 0.82, '820498', NaN]) {
    const v = judge({ ...all, reproducedMicro: r });
    assert.deepEqual([v.accept, v.stage], [false, 'rerun']);
  }
  assert.equal(judge({ ...all, reproducedMicro: null }).reason, 'the seed did not germinate on this node');
});

test('rerun: a perfectly signed claim that does not reproduce is REFUSED — a signature proves who, not what', () => {
  const v = judge({ ...all, parsed: { ...parsed, aucMicro: 900000 } });
  assert.deepEqual([v.accept, v.stage], [false, 'rerun']);
  assert.equal(v.reason, 'the claim does not reproduce — the card says 0.900000, the re-run here gives 0.820498');
  assert.equal(judge({ ...all, reproducedMicro: 820497 }).accept, false, 'off by one millionth is still not a reproduction');
  assert.equal(judge({ ...all, reproducedMicro: 820499 }).accept, false);
});

test('cite: an answer must be an answer, and to MY job — checked right after the seal', () => {
  const answer = { ...parsed, type: 0x03, cites: Uint8Array.from([1, 2]) };
  const ok = judge({ ...all, parsed: answer, expectCites: true, citesOk: true, signerOk: true });
  assert.deepEqual([ok.accept, ok.stage], [true, 'accepted']);
  const plain = judge({ ...all, parsed: { ...parsed, type: 0x02 }, expectCites: true, citesOk: true, signerOk: true });
  assert.deepEqual([plain.accept, plain.stage, plain.reason], [false, 'cite', 'not an answer — this card cites no job']);
  for (const c of [false, null, undefined, 'true']) {
    const v = judge({ ...all, parsed: answer, expectCites: true, citesOk: c });
    assert.deepEqual([v.accept, v.stage, v.reason], [false, 'cite', 'this card answers a different job']);
  }
  // the seal still comes first; the citation comes before data and the re-run
  assert.equal(judge({ ...all, parsed: answer, expectCites: true, citesOk: false, sigOk: false }).stage, 'seal');
  assert.equal(judge({ ...all, parsed: answer, expectCites: true, citesOk: false, dataTagOk: false }).stage, 'cite');
  // not expecting an answer: the citation is not checked at all
  assert.equal(judge({ ...all, parsed: { ...parsed, type: 0x02 } }).accept, true);
  assert.equal(judge({ ...all, parsed: answer, expectCites: 'yes', citesOk: false }).accept, true, 'only a literal true turns the check on');
});

test('cite: an answer signed by a node the job was not sent to is refused (review finding)', () => {
  const answer = { ...parsed, type: 0x03, cites: Uint8Array.from([1]) };
  for (const s of [false, null, undefined, 'true']) {
    const v = judge({ ...all, parsed: answer, expectCites: true, citesOk: true, signerOk: s });
    assert.deepEqual([v.accept, v.stage, v.reason], [false, 'cite', 'this answer is signed by a node the job was not sent to']);
  }
  assert.equal(judge({ ...all, parsed: answer, expectCites: true, citesOk: false, signerOk: false }).reason, 'this card answers a different job', 'the citation is checked first');
});

test('seed: a verifier re-runs only a fixed genome — anything else is refused before data or the re-run (review finding)', () => {
  for (const s of [false, null, undefined, 1, 'true']) {
    const v = judge({ ...all, seedOk: s });
    assert.deepEqual([v.accept, v.stage], [false, 'seed']);
  }
  assert.equal(judge({ ...all, seedOk: false, seedWhy: 'it is a grow spore' }).reason, 'not a seed this node will re-run — it is a grow spore');
  assert.equal(judge({ ...all, seedOk: false }).reason, 'not a seed this node will re-run — it is not a fixed genome');
  assert.equal(judge({ ...all, seedOk: false, seedWhy: 7 }).reason, 'not a seed this node will re-run — it is not a fixed genome');
  assert.equal(judge({ ...all, seedOk: false, dataTagOk: false }).stage, 'seed', 'the seed is checked before the data');
  assert.equal(judge({ ...all, seedOk: false, sigOk: false }).stage, 'seal', 'the seal still comes first');
});

test('receipt carries the citation of an answer in hex', () => {
  const r = receipt({ ...all, parsed: { ...parsed, type: 0x03, cites: Uint8Array.from([0x0a, 0xff]) }, expectCites: true, citesOk: true, signerOk: true });
  assert.equal(r.cites, '0aff');
  assert.equal(r.accept, true);
});

test('judge never throws and refuses garbage at parse', () => {
  for (const g of [null, undefined, 0, '', 'x', [], Symbol('s'), 10n]) {
    let v; assert.doesNotThrow(() => { v = judge(g); });
    assert.equal(v.accept, false); assert.equal(v.stage, 'parse');
  }
});

test('receipt records the verdict and every fact, exactly', () => {
  const r = receipt({ ...all, label: 'genuine', cardHash: 'aa11', inputsHash: 'bb22', outputsHash: 'cc33' });
  assert.deepEqual(r, {
    kind: 'spore-card-edge-verify', v: 1, case: 'genuine', card: 'aa11', signer: 'ab01', cites: null, claimed: '0.820498',
    seal: 'verified', data: 'held', reproduced: '0.820498', inputs: 'bb22', outputs: 'cc33',
    accept: true, stage: 'accepted',
    reason: 'reproduced 0.820498 here — the signature proves who, the re-run proved what',
  });
});

test('receipt says what was and was not checked on a refusal', () => {
  const sealFail = receipt({ ...all, sigOk: false, dataTagOk: null, reproducedMicro: null });
  assert.equal(sealFail.seal, 'mismatch');
  assert.equal(sealFail.data, 'unchecked');
  assert.equal(sealFail.reproduced, null);
  const dataFail = receipt({ ...all, dataTagOk: false, reproducedMicro: null });
  assert.equal(dataFail.data, 'not held');
  const unread = receipt({ parsed: { ok: false, why: 'x' } });
  assert.equal(unread.seal, 'unread');
  assert.equal(unread.signer, null);
  assert.equal(unread.claimed, null);
  assert.equal(unread.case, null);
});

test('receipt only carries lowercase-hex hashes — anything else is null', () => {
  const r = receipt({ ...all, cardHash: 'ABCD', inputsHash: 'x1', outputsHash: 42 });
  assert.equal(r.card, null); assert.equal(r.inputs, null); assert.equal(r.outputs, null);
  assert.equal(receipt({ ...all, cardHash: '0f' }).card, '0f');
  assert.equal(receipt({ ...all, label: 7 }).case, null, 'a non-string label is dropped');
});

test('toHex pads every byte to two lowercase digits', () => {
  assert.equal(toHex(Uint8Array.from([0, 1, 15, 16, 255])), '00010f10ff');
  assert.equal(toHex(new Uint8Array(0)), '');
  assert.equal(toHex([1, 2]), '');
  assert.equal(toHex(null), '');
});

test('receipt never throws', () => {
  for (const g of [null, undefined, 0, 'x', [], {}]) assert.doesNotThrow(() => receipt(g));
});
