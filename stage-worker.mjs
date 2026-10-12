// stage-worker.mjs — every grow and re-run for card stages, off the page's main thread (a module Worker), so a tab
// never freezes. The page cancels by terminating this worker: an unfinished re-run is PENDING, never REFUSED.
// It loads the same node tools as the page (mesh-node.mjs) — the same data, the same non-extractable key from
// IndexedDB — so a stage it grows is signed by this browser's identity. Powered by the Konomi architecture, created
// by Thomas Frumkin.
import { makeTools } from './mesh-node.mjs';
import { makeRoot, growNext, structureFacts, rerunStages } from './stage-mesh.mjs';
import { parseLineage, judgeStructure, judgeLineage, rulesFor } from './stages.mjs';
import { unpack } from './envelope.mjs';
import { decodeSpore, germinate, organBody } from './spore.mjs';
import { keyOf } from './organ.mjs';
import { bytesToStr } from './spore-card.mjs';

let toolsP = null;
const tools = () => toolsP || (toolsP = makeTools());
const cache = new Map();                          // link hash → numbers computed HERE this session (memory only)
const post = (m) => self.postMessage(m);
const genomeKeyOf = (link) => { const d = decodeSpore(bytesToStr(unpack(link).seed)); return d.ok ? keyOf(d.spore.genome) : null; };

self.onmessage = async (e) => {
  const m = e.data && typeof e.data === 'object' ? e.data : {};
  try {
    const T = await tools();
    if (m.cmd === 'root') {
      const r = await makeRoot(T, T.sessions);
      if (r.ok) cache.set(await T.sha256hex(r.link), { heldMicro: unpack(r.link).aucMicro });
      post({ type: 'root', ...r });
    } else if (m.cmd === 'grow') {
      let n = 0;
      const r = await growNext(m.links, T, T.sessions, 'funnel/1', () => { n++; if (n % 6 === 0) post({ type: 'tick', n }); });
      if (r.ok) cache.set(await T.sha256hex(r.link), { heldMicro: r.heldMicro, confMicro: r.confMicro, barMicros: r.barMicros, replayGenomeKey: genomeKeyOf(r.link) });
      post({ type: 'grown', ...r });
    } else if (m.cmd === 'verify') {
      const parsed = m.chunks === 0 ? null : parseLineage(m.text);
      const facts = await structureFacts(parsed, T, { chunks: m.chunks, chunkBytes: typeof m.text === 'string' ? m.text.length : 0, band: m.band });
      const structure = judgeStructure(parsed, facts);
      post({ type: 'structure', structure, facts });
      if (structure.verdict !== 'READY') return post({ type: 'lineage', lineage: judgeLineage(structure, [], facts), results: [] });
      const dataOk = T.dataSha256Hex === rulesFor(parsed.rulesId).dataSha;
      // every stage this device re-runs is remembered for this session (memory only), keyed by its exact bytes
      const results = dataOk ? rerunStages(parsed, facts, T.sessions, { cache, onResult: (k, r) => { cache.set(facts.links[k].hashHex, r); post({ type: 'result', k, r }); } }) : [];
      post({ type: 'lineage', lineage: judgeLineage(structure, results, { ...facts, dataOk }), results, dataOk });
    } else if (m.cmd === 'model') {
      const g = germinate(T.sessions, m.seed, 'all');
      post({ type: 'model', ok: !!(g && g.ok), body: g && g.ok ? organBody(g.organ) : null, heldAuc: g && g.ok ? g.heldAuc : null });
    }
  } catch (err) {
    post({ type: 'error', why: String((err && err.message) || err) });
  }
};
post({ type: 'ready' });
