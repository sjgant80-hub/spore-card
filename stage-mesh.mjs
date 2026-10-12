// stage-mesh.mjs — the glue for card stages: it computes the FACTS (hashes, signature checks, decoded seeds, the keyed
// seed numbers, the re-runs) and hands them to stages.mjs, which decides. Tools are injected exactly as mesh.mjs takes
// them — { pubkey, sign, verify, sha256hex, dataSha256Hex } — so the same code runs in Node (node-tools.mjs) and in the
// browser (mesh-node.mjs). Orchestration, not a decision kernel; proven end to end by tools/stage-receipt.mjs --check.
// Powered by the Konomi architecture, created by Thomas Frumkin.
import { packUnsigned, attachSignature, unpack } from './envelope.mjs';
import { decodeSpore } from './spore.mjs';
import { STEM, keyOf } from './organ.mjs';
import { strToBytes, bytesToStr } from './spore-card.mjs';
import { RULES, rulesFor, rootPrevText, stageSeedMaterial, seedNoFrom, parseLineage, lineageText, climbs, firstEarning,
  judgeStructure, judgeLineage, LIMITS } from './stages.mjs';
import { ENGINE, heldMicro, checkScores, stageChampion, stageSpore } from './stage-grow.mjs';

const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));
const b64 = (u8) => btoa(Array.from(u8, (b) => String.fromCharCode(b)).join(''));
const sha = async (tools, bytes) => tools.sha256hex(bytes);

/** The keyed seed numbers t = 0..7 a key may grow after a stage whose hash is prevHex. */
export async function keyedSeedNos(tools, rulesId, prevHex, keyB64) {
  const out = [];
  for (let t = 0; t < LIMITS.tries; t++) {
    const m = stageSeedMaterial(rulesId, prevHex, keyB64, t);
    out.push(m === null ? 0 : seedNoFrom(await sha(tools, strToBytes(m))));
  }
  return out;
}

async function signLink(tools, { seed, claimMicro, dataTagHex, prev }) {
  const u = packUnsigned({ seed: strToBytes(seed), aucMicro: claimMicro, dataTag: fromHex(dataTagHex), prev, pubkey: tools.pubkey });
  if (!u.ok) return { ok: false, why: u.why };
  const s = attachSignature(u.bytes, await tools.sign(u.bytes));
  return s.ok ? { ok: true, link: s.bytes } : { ok: false, why: s.why };
}

/** Stage 0: the rules' root seed, its held-out score re-run HERE, signed by this key. */
export async function makeRoot(tools, data, rulesId = 'funnel/1') {
  const rules = rulesFor(rulesId);
  if (!rules) return { ok: false, why: 'this reader does not hold rules ' + rulesId };
  if (tools.dataSha256Hex !== rules.dataSha) return { ok: false, why: 'this device does not hold the data ' + rulesId + ' is measured on' };
  const held = heldMicro(data, rules.rootSpore);
  if (held === null) return { ok: false, why: 'the root did not germinate here' };
  const prev = fromHex(await sha(tools, strToBytes(rootPrevText(rulesId))));
  return signLink(tools, { seed: rules.rootSpore, claimMicro: held, dataTagHex: rules.dataTag, prev });
}

const genomeOf = (link) => { const u = unpack(link); const d = u.ok ? decodeSpore(bytesToStr(u.seed)) : null; return d && d.ok ? d.spore.genome : null; };

/**
 * Grow the next stage on this device under this key: try t = 0..7 in order, take the FIRST whose champion climbs
 * (only then is its held-out score measured — it never decides). { ok, link, t, seedNo, confMicro, barMicros, heldMicro }
 * or { ok:false, why, tried } when no try earned (nothing is signed).
 */
export async function growNext(links, tools, data, rulesId = 'funnel/1', tick) {
  const rules = rulesFor(rulesId);
  if (!rules) return { ok: false, why: 'this reader does not hold rules ' + rulesId };
  if (!Array.isArray(links) || links.length === 0) return { ok: false, why: 'there is no stage to grow from' };
  if (links.length >= LIMITS.links) return { ok: false, why: 'this card is at its last stage' };
  const genomes = links.map(genomeOf);
  if (genomes.some((g) => !g)) return { ok: false, why: 'a stage on this card does not decode' };
  const prevHex = await sha(tools, links[links.length - 1]);
  const seeds = await keyedSeedNos(tools, rulesId, prevHex, b64(tools.pubkey));
  const tried = [];
  for (let t = 0; t < seeds.length; t++) {
    const g = stageChampion(data, rules, seeds[t], genomes[genomes.length - 1], tick);
    const c = checkScores(data, rules, seeds[t], g, genomes);
    tried.push({ t, seedNo: seeds[t], ...c, climbs: climbs(c.confMicro, c.barMicros) });
    if (firstEarning(tried.map((x) => x.climbs)) !== t) continue;
    const spore = stageSpore(rules, seeds[t], g);
    const held = heldMicro(data, spore);
    const s = await signLink(tools, { seed: spore, claimMicro: held, dataTagHex: rules.dataTag, prev: fromHex(prevHex) });
    return s.ok ? { ok: true, link: s.link, t, seedNo: seeds[t], confMicro: c.confMicro, barMicros: c.barMicros, heldMicro: held, tried } : s;
  }
  return { ok: false, why: 'no try earned the next stage on this key — the rule held; nothing was signed', tried };
}

/** The facts stages.judgeStructure needs, computed on the bytes this device holds. */
export async function structureFacts(parsed, tools, { chunks = 1, chunkBytes = 0, band = null } = {}) {
  const facts = { chunks, chunkBytes, engine: ENGINE, bound: false, rootPrevHex: null, links: [] };
  if (!parsed || !parsed.ok) return facts;
  const rp = rootPrevText(parsed.rulesId);
  facts.rootPrevHex = rp ? await sha(tools, strToBytes(rp)) : null;
  const last = parsed.links[parsed.links.length - 1];
  facts.bound = band instanceof Uint8Array && band.length === last.length && band.every((b, i) => b === last[i]);
  for (let k = 0; k < parsed.links.length; k++) {
    const link = parsed.links[k], u = unpack(link);
    let sigOk = false;
    if (u.ok) { try { sigOk = (await tools.verify(u.signedBytes, u.sig, u.pubkey)) === true; } catch { sigOk = false; } }
    const seedText = u.ok ? bytesToStr(u.seed) : '';
    const d = decodeSpore(seedText);
    const prevHex = k === 0 ? null : await sha(tools, parsed.links[k - 1]);
    facts.links.push({
      sigOk, hashHex: await sha(tools, link), prevHex: u.ok && u.prev ? hex(u.prev) : null, claimMicro: u.ok ? u.aucMicro : null,
      dataTagHex: u.ok ? hex(u.dataTag) : null, seedText, genomeKey: d.ok && d.spore.genome ? keyOf(d.spore.genome) : null,
      decoded: { ok: d.ok, fixed: d.ok && !d.spore.grow && !!d.spore.genome, recipe: d.ok ? d.spore.recipe : null, seedNo: d.ok ? d.spore.seed : null, why: d.ok ? null : d.error },
      keyedSeedNos: k === 0 || !u.ok ? [] : await keyedSeedNos(tools, parsed.rulesId, prevHex, b64(u.pubkey)),
    });
  }
  return facts;
}

/**
 * Re-run each stage, cheapest check first (held, then the check split, then the replayed grow), until `shouldStop()`
 * says the budget is spent — every unreached stage stays null (PENDING, never REFUSED).
 */
export function rerunStages(parsed, facts, data, { shouldStop = () => false, tick } = {}) {
  const rules = rulesFor(parsed.rulesId);
  const genomes = parsed.links.map(genomeOf);
  const results = [];
  for (let k = 0; k < parsed.links.length; k++) {
    if (shouldStop()) break;
    const L = facts.links[k];
    const r = { heldMicro: heldMicro(data, L.seedText) };
    if (k > 0 && r.heldMicro === L.claimMicro && genomes[k]) {
      Object.assign(r, checkScores(data, rules, L.decoded.seedNo, genomes[k], genomes.slice(0, k)));
      if (climbs(r.confMicro, r.barMicros)) r.replayGenomeKey = keyOf(stageChampion(data, rules, L.decoded.seedNo, genomes[k - 1], tick));
    }
    results.push(r);
  }
  return results;
}

/** Judge a card's stages end to end: structure, then the re-runs. */
export async function verifyStages(chunkText, tools, data, { chunks = 1, band = null, shouldStop, tick } = {}) {
  const parsed = chunks === 0 ? null : parseLineage(chunkText);
  const facts = await structureFacts(parsed, tools, { chunks, chunkBytes: typeof chunkText === 'string' ? chunkText.length : 0, band });
  const structure = judgeStructure(parsed, facts);
  if (structure.verdict !== 'READY') return { structure, lineage: judgeLineage(structure, [], facts), facts };
  const dataOk = tools.dataSha256Hex === rulesFor(parsed.rulesId).dataSha;
  const results = dataOk ? rerunStages(parsed, facts, data, { shouldStop, tick }) : [];
  return { structure, lineage: judgeLineage(structure, results, { ...facts, dataOk }), facts, results };
}

export { lineageText, parseLineage, RULES, STEM };
