#!/usr/bin/env node
// tools/byok-receipt.mjs — MESH_PLAN step 4 done-test: the same job run WITH and WITHOUT a model proposer.
//
// The worker grows the job's seed either way. With a proposer, a model (here a LOCAL model through Ollama; with
// --byok, any OpenAI-compatible endpoint the user controls, key from the environment only) suggests extra genomes;
// each is scored on the grow's inner split and kept only if it beats the grown champion there. Both answers are
// sealed, and the requester re-runs both. The model-free path must pass on its own — the seed, not the model, is
// the instruction layer.
//
//   node tools/byok-receipt.mjs [--model llama3.2:1b]   call the model, record its suggestions, write the receipt
//   node tools/byok-receipt.mjs --check                 re-run everything from the RECORDED suggestions (no model
//                                                       call) and demand a byte-identical receipt
// A model's sampling is not something CI can re-run, so its raw reply is recorded as an input; everything after it —
// parsing the reply, the inner-split scores, the keep rule, both seals, both re-runs — is re-run.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { nodeTools } from '../node-tools.mjs';
import { makeJob, runJob, verifyAtEdge } from '../mesh.mjs';
import { proposalPrompt, parseProposals } from '../proposer.mjs';
import { canonicalJson } from './canonical.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV = join(ROOT, 'data', 'online_shoppers_intention.csv');
const OUT = join(ROOT, 'receipts', 'byok-roundtrip.json');
const GROW = '◊ spore.v1 funnel 11 g:12.2.10';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

async function askLocal(model, prompt) {
  const r = await fetch('http://localhost:11434/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: true, keep_alive: '10m', options: { temperature: 0, seed: 42, num_predict: 900 } }) });
  if (!r.ok || !r.body) throw new Error('the local model did not answer: HTTP ' + r.status);
  const dec = new TextDecoder(); let buf = '', text = '';
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let nl; while ((nl = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (l) text += JSON.parse(l).response || ''; }
  }
  return text;
}
// BYOK: the user's own OpenAI-compatible endpoint. The key is read from the environment and never written anywhere.
async function askByok(prompt) {
  const url = process.env.BYOK_URL, key = process.env.BYOK_KEY, model = process.env.BYOK_MODEL;
  if (!url || !key || !model) throw new Error('--byok needs BYOK_URL, BYOK_KEY and BYOK_MODEL in the environment');
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({ model, temperature: 0, messages: [{ role: 'user', content: prompt }] }) });
  if (!r.ok) throw new Error('the BYOK endpoint did not answer: HTTP ' + r.status);
  const j = await r.json();
  return String(j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '');
}

export async function run(recorded) {
  const A = nodeTools({ seed32: new Uint8Array(32).fill(0x3c), csvPath: CSV });
  const B = nodeTools({ seed32: new Uint8Array(32).fill(0xc3), csvPath: CSV });
  const mem = new Set();
  const worker = (proposals) => ({ now: 1760000100, maxEvals: 300, claim: (k) => { if (mem.has(k)) return false; mem.add(k); return true; },
    allow: () => true, proposals });

  // The model's raw reply is the ONE input CI cannot re-create, so it is recorded verbatim; everything after it — the
  // parse (offered / dropped / kept), the scores, the keep rule, both seals, both re-runs — is re-run from it.
  const prompt = proposalPrompt(4);
  let model, reply;
  if (recorded) {
    if (!recorded || typeof recorded.reply !== 'string' || sha(recorded.reply) !== recorded.replySha256) throw new Error('the recorded reply is missing or does not match its sha256');
    model = recorded.model; reply = recorded.reply;
  } else {
    const byok = process.argv.includes('--byok');
    model = byok ? 'byok:' + process.env.BYOK_MODEL : arg('--model', 'llama3.2:1b');
    reply = byok ? await askByok(prompt) : await askLocal(model, prompt);
  }
  const parsed = parseProposals(reply);
  const proposer = { model, promptSha256: sha(prompt), reply, replySha256: sha(reply), offered: parsed.offered, dropped: parsed.dropped, genomes: parsed.genomes };

  const jobFree = await makeJob({ spore: GROW, maxEvals: 120, now: 1760000000, nonce: 'aaaa000000000001', ttl: 3600, worker: Buffer.from(B.pubkey).toString('hex') }, A);
  const jobModel = await makeJob({ spore: GROW, maxEvals: 120, now: 1760000000, nonce: 'aaaa000000000002', ttl: 3600, worker: Buffer.from(B.pubkey).toString('hex') }, A);
  const free = await runJob(jobFree, B, worker([]));
  const withModel = await runJob(jobModel, B, worker(proposer.genomes));
  if (!free.ok) throw new Error('the model-free job did not run: ' + free.verdict.reason);
  const vFree = await verifyAtEdge(free.answer, A, 'model-free', jobFree);
  const vModel = withModel.ok ? await verifyAtEdge(withModel.answer, A, 'with-proposer', jobModel) : null;
  const g = (r) => r && r.grow ? { champion: r.grow.championSpore, selectionFitness: Math.round(r.grow.selectionFitness * 1e6) / 1e6, championConfirmFitness: Math.round(r.grow.championFitness * 1e6) / 1e6,
    stemConfirmFitness: Math.round(r.grow.stemFitness * 1e6) / 1e6, heldAuc: Math.round(r.grow.heldAuc * 1e6) / 1e6,
    evals: r.grow.evals, proposed: r.grow.proposed, skipped: r.grow.skipped, proposalWon: r.grow.proposedWon } : null;
  // a model may only ADD candidates: whenever the model-free job passes, the job with the model must pass too
  const held = vFree.accept === true && withModel.ok === true && !!vModel && vModel.accept === true;
  return {
    kind: 'spore-card-byok-roundtrip', v: 1,
    rule: 'a model may only PROPOSE; each proposal is scored on the grow’s inner split and kept only if it beats the grown champion there AND the stem on confirmation; the requester re-runs every answer; whenever the job passes without a model it passes with one',
    job: { spore: GROW, requester: jobFree.requester, worker: Buffer.from(B.pubkey).toString('hex') },
    proposer,
    modelFree: { grow: g(free), requester: vFree },
    withProposer: { grow: g(withModel), requester: vModel, worker: withModel.ok ? 'sealed' : withModel.verdict },
    modelFreePasses: vFree.accept === true,
    held,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url).replace(/\\/g, '/') === process.argv[1].replace(/\\/g, '/');
if (isMain) {
  if (process.argv.includes('--check')) {
    let committed = '';
    try { committed = readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n'); } catch { console.error('no committed receipt to check'); process.exit(1); }
    const result = await run(JSON.parse(committed).proposer);
    if (canonicalJson(result) + '\n' !== committed) { console.error('byok receipt does NOT reproduce from its recorded reply'); process.exit(1); }
    console.log(`REPRODUCED — model-free passes: ${result.modelFreePasses}; ${result.proposer.genomes.length} recorded proposals re-scored; held: ${result.held}`);
    process.exit(result.held ? 0 : 1);
  }
  const result = await run(null);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, canonicalJson(result) + '\n');
  console.log(JSON.stringify({ proposer: { model: result.proposer.model, offered: result.proposer.offered, valid: result.proposer.genomes.length, dropped: result.proposer.dropped },
    modelFree: result.modelFree.grow, withProposer: result.withProposer.grow, modelFreeAccepted: result.modelFree.requester.accept,
    withProposerAccepted: result.withProposer.requester && result.withProposer.requester.accept, held: result.held }, null, 2));
  process.exit(result.held ? 0 : 1);
}
