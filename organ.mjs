// organ.mjs — PATTERN ORGANS · the first organ, grown.
//
// A pattern organ reads a domain's sessions, keeps a small BOOK of patterns ("sessions like these buy at 3x the rate"),
// and scores new sessions by its book. This first one lives in funnels: the UCI Online Shoppers Purchasing Intention
// sessions (Sakar & Kastro, 2018, CC BY 4.0).
//
// It is GROWN from a stem cluster that carries the seven elements of the capability router, each a real switch on how
// the organ works:
//   prove    a pattern enters the book only if it holds on a slice of the sessions it was not found on
//   own      each kind of visitor (returning, new, other) owns a book of its own
//   shape    the organ shapes new measures from the raw ones (total pages, time per page, ...)
//   carry    each next pattern is found among the sessions the earlier ones left unexplained
//   remember older months fade from memory on a half-life
//   run      run cheaply: coarse cuts, a short book, few pairs
//   connect  a pattern may join two conditions
// Evolution chooses which elements switch on, how the book is wired into a score, which measures it reads, and every
// parameter. The same organ is also built BY HAND (a fixed design, parameters tuned with the same budget).
//
// Pure and deterministic: one seed gives the same organs, books and scores on every machine. The checked entry points
// return {ok:false, error} on garbage; they never throw.

export const ELEMENTS = ['prove', 'own', 'shape', 'carry', 'remember', 'run', 'connect'];
export const WIRINGS = ['list', 'sum', 'mean'];
export const NUMERIC = ['Administrative', 'Administrative_Duration', 'Informational', 'Informational_Duration',
  'ProductRelated', 'ProductRelated_Duration', 'BounceRates', 'ExitRates', 'PageValues', 'SpecialDay'];
export const CATEGORICAL = ['OperatingSystems', 'Browser', 'Region', 'TrafficType', 'VisitorType', 'Weekend'];
export const DERIVED = ['totalPages', 'totalDuration', 'durationPerPage', 'productShare', 'exitMinusBounce'];
export const FEATURES = [...NUMERIC, ...CATEGORICAL, ...DERIVED];
export const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, June: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
export const TRAIN_MONTHS = [2, 3, 4, 5, 6, 7, 8, 9, 10];
export const HELD_MONTHS = [11, 12];
export const VISITORS = ['New_Visitor', 'Other', 'Returning_Visitor'];

// every parameter is an index into its grid, so a genome is a short list of small integers
export const GRID = {
  bins: [3, 4, 5, 6, 8, 10, 12, 16],
  book: [2, 4, 6, 8, 12, 16, 24, 32, 40],
  minSupport: [0.002, 0.005, 0.01, 0.02, 0.04, 0.08],
  minLift: [1.1, 1.25, 1.5, 2, 2.5, 3],
  smooth: [1, 2, 5, 10, 20, 50],
  pairK: [4, 6, 8, 12, 16, 24, 30],
  proofZ: [0.5, 1, 1.5, 2, 2.5, 3],
  halfLife: [1, 2, 3, 4, 6, 9, 12],
  ownMin: [100, 250, 500, 1000, 2000, 3000],
};
export const PARAMS = Object.keys(GRID);
export const CHEAP = { bins: 4, book: 6, pairK: 6 };   // the ceilings the run element imposes

const ALL_FEATURES = 2 ** FEATURES.length - 1;
const bit = (names, list) => list.reduce((m, e) => m | (1 << names.indexOf(e)), 0);
export const elementsOf = (on) => ELEMENTS.filter((e, k) => (on >> k) & 1);
export const onOf = (list) => bit(ELEMENTS, list);
const at = (name, value) => GRID[name].indexOf(value);

// THE STEM: every element present, every measure, the middle of every grid — undifferentiated
export const STEM = {
  on: 127, wiring: 1, features: ALL_FEATURES, bins: at('bins', 8), book: at('book', 12), minSupport: at('minSupport', 0.01),
  minLift: at('minLift', 1.5), smooth: at('smooth', 10), pairK: at('pairK', 12), proofZ: at('proofZ', 1.5),
  halfLife: at('halfLife', 4), ownMin: at('ownMin', 500),
};
// THE HAND-BUILT ORGAN, designed before any session was looked at: an analyst's scorecard — shaped engagement measures,
// two-condition patterns, every pattern proven on a held-back slice, new and returning visitors each with their own book,
// evidence summed; no recency fading, no sequential covering, no cheapness ceiling. Its parameters are tuned by search.
export const HAND = {
  on: onOf(['prove', 'own', 'shape', 'connect']), wiring: 1, features: ALL_FEATURES, bins: at('bins', 10), book: at('book', 16),
  minSupport: at('minSupport', 0.01), minLift: at('minLift', 1.5), smooth: at('smooth', 10), pairK: at('pairK', 12),
  proofZ: at('proofZ', 1.5), halfLife: at('halfLife', 6), ownMin: at('ownMin', 500),
};

// ── the sessions ─────────────────────────────────────────────────────────────────────────────────────────────────────
const NUM = /^-?\d+(\.\d+)?(E-?\d+)?$/i;

export function parseSessions(text) {
  if (typeof text !== 'string') return { ok: false, error: 'the sessions must be CSV text' };
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = String(lines[0]).split(',');
  const missing = [...NUMERIC, ...CATEGORICAL, 'Month', 'Revenue'].filter((c) => !head.includes(c));
  if (missing.length) return { ok: false, error: 'missing columns: ' + missing.join(', ') };
  const n = lines.length - 1;
  if (n < 1) return { ok: false, error: 'no sessions' };
  const cols = {};
  for (const f of [...NUMERIC, ...DERIVED]) cols[f] = new Float64Array(n);
  for (const f of CATEGORICAL) cols[f] = [];
  const y = new Uint8Array(n), month = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const cells = lines[i + 1].split(',');
    if (cells.length !== head.length) return { ok: false, error: 'session ' + (i + 1) + ' has ' + cells.length + ' cells, not ' + head.length };
    const cell = (c) => cells[head.indexOf(c)];
    for (const f of NUMERIC) {
      if (!NUM.test(cell(f))) return { ok: false, error: 'session ' + (i + 1) + ': ' + f + ' is not a number' };
      cols[f][i] = Number(cell(f));
    }
    for (const f of CATEGORICAL) cols[f].push(cell(f));
    const m = MONTHS[cell('Month')];
    if (!Number.isInteger(m)) return { ok: false, error: 'session ' + (i + 1) + ': unknown month' };
    month[i] = m;
    if (!['TRUE', 'FALSE'].includes(cell('Revenue'))) return { ok: false, error: 'session ' + (i + 1) + ': Revenue is not TRUE or FALSE' };
    y[i] = Number(cell('Revenue') === 'TRUE');
    const pages = cols.Administrative[i] + cols.Informational[i] + cols.ProductRelated[i];
    const time = cols.Administrative_Duration[i] + cols.Informational_Duration[i] + cols.ProductRelated_Duration[i];
    cols.totalPages[i] = pages;
    cols.totalDuration[i] = time;
    cols.durationPerPage[i] = pages > 0 ? time / pages : 0;
    cols.productShare[i] = pages > 0 ? cols.ProductRelated[i] / pages : 0;
    cols.exitMinusBounce[i] = cols.ExitRates[i] - cols.BounceRates[i];
  }
  // each measure's sessions in rising order, once — a subset's cut points are then a walk, not a sort
  const order = Object.fromEntries([...NUMERIC, ...DERIVED].map((f) => [f, Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => cols[f][a] - cols[f][b])]));
  return { ok: true, n, cols, y, month, order };
}

export const rowsIn = (data, months) => Array.from({ length: data.n }, (_, i) => i).filter((i) => months.includes(data.month[i]));

// ── randomness, one seeded stream ────────────────────────────────────────────────────────────────────────────────────
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const draw = (r, k) => Math.floor(r() * k);

function shuffled(list, r) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = draw(r, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// stratified: the same share of buyers and of non-buyers goes to the held slice
export function split(data, rows, share, seed) {
  const r = rng(seed);
  const held = [];
  for (const cls of [1, 0]) {
    const group = shuffled(rows.filter((i) => data.y[i] === cls), r);
    held.push(...group.slice(0, Math.floor(group.length * share)));
  }
  const set = new Set(held);
  return { held: [...set].sort((p, q) => p - q), rest: rows.filter((i) => !set.has(i)) };
}

// ── a frame: sessions as bitsets, each month a word-aligned block so a month's weight applies to whole words ───────
const pc = (x) => {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return Math.imul((x + (x >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24;
};
export const popcount = pc;

export function frame(data, rows, weightOf, feats) {
  const months = [...new Set(rows.map((i) => data.month[i]))].sort((p, q) => p - q);
  const blocks = [];
  let words = 0;
  for (const m of months) {
    const list = rows.filter((i) => data.month[i] === m);
    blocks.push({ list, lo: words, hi: words + Math.ceil(list.length / 32), w: weightOf(m) });
    words += Math.ceil(list.length / 32);
  }
  const F = { words, blocks, at: new Int32Array(words * 32).fill(-1), all: new Uint32Array(words), Y: new Uint32Array(words), cols: {} };
  for (const b of blocks) {
    b.list.forEach((i, k) => {
      const pos = b.lo * 32 + k;
      F.at[pos] = i;
      F.all[pos >>> 5] |= 1 << (pos & 31);
      F.Y[pos >>> 5] |= data.y[i] << (pos & 31);
    });
  }
  // the frame's own copy of each measure in bit order (padding reads undefined; every count is taken within F.all)
  for (const f of feats) {
    const src = data.cols[f], col = [];
    for (const i of F.at) col.push(src[i]);
    F.cols[f] = col;
  }
  return F;
}
// weighted [sessions, buyers] of mask M within the residual R
export function weigh(F, M, R) {
  let s = 0, b = 0;
  for (const k of F.blocks) {
    let c = 0, d = 0;
    for (let j = k.lo; j < k.hi; j++) { const x = M[j] & R[j]; c += pc(x); d += pc(x & F.Y[j]); }
    s += k.w * c;
    b += k.w * d;
  }
  return [s, b];
}
const and = (a, b) => a.map((x, j) => x & b[j]);
// a condition's sessions in the frame, read from the frame's own copy of the measure (padding never holds)
export function condMask(F, c) {
  const m = new Uint32Array(F.words);
  F.cols[c.f].forEach((x, b) => { if (holds(c, x)) m[b >>> 5] |= 1 << (b & 31); });
  return m;
}

// ── conditions and patterns ──────────────────────────────────────────────────────────────────────────────────────────
export const holds = (c, x) => (c.op === '=' ? x === c.v : (x > c.v) === (c.op === '>'));
export const fires = (p, data, i) => p.conds.every((c) => holds(c, data.cols[c.f][i]));

export function conditions(data, rows, feats, bins) {
  const out = [], member = new Uint8Array(data.n);
  for (const i of rows) member[i] = 1;
  for (const f of feats) {
    if (CATEGORICAL.includes(f)) {
      for (const v of [...new Set(rows.map((i) => data.cols[f][i]))].sort()) out.push({ f, op: '=', v });
      continue;
    }
    const xs = [];
    for (const i of data.order[f]) if (member[i]) xs.push(data.cols[f][i]);
    const cuts = new Set(), top = xs[xs.length - 1];
    for (let k = 1; k < bins; k++) cuts.add(xs[Math.floor((k * xs.length) / bins)]);
    // a cut at the top would split nothing off
    for (const v of [...cuts].filter((v) => v !== top)) out.push({ f, op: '>', v }, { f, op: '<=', v });
  }
  return out;
}

// Wilson score bound of a rate: side -1 the lower, +1 the upper
export function wilson(b, s, z, side) {
  const p = b / s, z2 = z * z;
  const half = z * Math.sqrt((p * (1 - p)) / s + z2 / (4 * s * s));
  return (p + z2 / (2 * s) + side * half) / (1 + z2 / s);
}

// the book: mine the frame's patterns, keep the strongest that qualify (and, with prove, hold on the proof frame)
export function mine(data, F, P, conds, o) {
  const [T, B] = weigh(F, F.all, F.all);
  if (!(B > 0 && B < T)) return { base: T > 0 ? B / T : 0, patterns: [], degenerate: true };
  const base = B / T, minS = o.minSupport * T;
  const judge = (mask, R) => {
    const [s, b] = weigh(F, mask, R);
    const rate = (b + o.smooth * base) / (s + o.smooth);
    return { s, b, rate, lift: rate / base, z: (b - s * base) / Math.sqrt(Math.max(s, 1e-9) * base * (1 - base)) };
  };
  // a pattern is UP (buyers above the base) or DOWN (below it) by at least the lift asked for
  const up = (j) => j.lift >= o.minLift;
  const qualifies = (j) => j.s >= minS && (up(j) || j.lift * o.minLift <= 1);
  const singles = conds.map((c) => ({ conds: [c], mask: condMask(F, c) }));
  const cands = [...singles];
  if (o.connect) {
    const top = singles.map((p, k) => ({ p, k, z: Math.abs(judge(p.mask, F.all).z) }))
      .sort((x, y) => y.z - x.z).slice(0, o.pairK).map((x) => x.p);
    top.forEach((a, k) => top.slice(k + 1).forEach((b) => {
      if (a.conds[0].f !== b.conds[0].f) cands.push({ conds: [a.conds[0], b.conds[0]], mask: and(a.mask, b.mask) });
    }));
  }
  const proofs = new Map();
  const proven = (k, j) => {
    if (!P) return true;
    if (!proofs.has(k)) proofs.set(k, weigh(P, cands[k].conds.map((c) => condMask(P, c)).reduce(and), P.all));
    const [s, b] = proofs.get(k);   // nothing on the proof slice proves nothing: its bound is NaN and NaN compares false
    return up(j) ? wilson(b, s, o.proofZ, -1) > base : wilson(b, s, o.proofZ, 1) < base;
  };
  const entry = (k, j) => ({ conds: cands[k].conds, up: up(j), rate: j.rate, lift: j.lift, support: j.s, buys: j.b, z: j.z });
  const book = [];
  if (o.carry) {
    let R = F.all;
    while (book.length < o.book) {
      let best = null;
      cands.forEach((p, k) => {
        const j = judge(p.mask, R);
        if (qualifies(j) && (!best || Math.abs(j.z) > Math.abs(best.j.z)) && proven(k, j)) best = { k, j };
      });
      if (!best) break;
      book.push(entry(best.k, best.j));
      R = R.map((x, w) => x & ~cands[best.k].mask[w]);
    }
    return { base, patterns: book };
  }
  const ranked = cands.map((p, k) => ({ k, j: judge(p.mask, F.all) })).filter((x) => qualifies(x.j))
    .sort((x, y) => Math.abs(y.j.z) - Math.abs(x.j.z));
  for (const x of ranked) {
    if (book.length === o.book) break;
    if (proven(x.k, x.j)) book.push(entry(x.k, x.j));
  }
  return { base, patterns: book.sort((x, y) => y.rate - x.rate) };
}

// ── the organ: a genome becomes books ───────────────────────────────────────────────────────────────────────────────
export function settings(g) {
  const has = (e) => ((g.on >> ELEMENTS.indexOf(e)) & 1) === 1;
  const v = Object.fromEntries(PARAMS.map((p) => [p, GRID[p][g[p]]]));
  if (has('run')) for (const p of Object.keys(CHEAP)) v[p] = Math.min(v[p], CHEAP[p]);
  for (const e of ELEMENTS) v[e] = has(e);
  v.wiring = WIRINGS[g.wiring];
  v.features = FEATURES.filter((f, k) => ((g.features >> k) & 1) === 1 && (v.shape || !DERIVED.includes(f)));
  return v;
}

export function fit(data, rows, genome, seed) {
  const o = settings(genome);
  const last = Math.max(...rows.map((i) => data.month[i]));
  const weightOf = o.remember ? (m) => 0.5 ** ((last - m) / o.halfLife) : () => 1;
  const grow = (rs) => {
    const parts = o.prove ? split(data, rs, 1 / 3, seed) : { held: null, rest: rs };
    const F = frame(data, parts.rest, weightOf, o.features);
    const P = parts.held && frame(data, parts.held, weightOf, o.features);
    return mine(data, F, P, conditions(data, parts.rest, o.features, o.bins), o);
  };
  const organ = { genome, wiring: o.wiring, global: grow(rows), segments: new Map() };
  if (o.own) {
    for (const v of VISITORS) {
      const rs = rows.filter((i) => data.cols.VisitorType[i] === v);
      if (rs.length < o.ownMin) continue;
      const book = grow(rs);
      if (!book.degenerate) organ.segments.set(v, book);
    }
  }
  return organ;
}

export function score(organ, data, i) {
  const book = organ.segments.get(data.cols.VisitorType[i]) || organ.global;
  const fired = book.patterns.filter((p) => fires(p, data, i));
  if (organ.wiring === 'list') return fired.length ? fired[0].rate : book.base;
  const shift = book === organ.global ? 0 : Math.log(book.base / organ.global.base);
  const sum = fired.reduce((a, p) => a + Math.log(p.lift), 0);
  return shift + (organ.wiring === 'sum' ? sum : sum / Math.max(1, fired.length));
}

// ── grading: area under the ROC curve (ties count half), with optional resampling multiplicities ───────────────────
export function ranker(scores) {
  const order = scores.map((_, i) => i).sort((a, b) => scores[a] - scores[b]);
  const groups = [];
  for (const i of order) {
    const g = groups[groups.length - 1];
    if (g && scores[g[0]] === scores[i]) g.push(i);
    else groups.push([i]);
  }
  return groups;
}
export function aucOf(groups, y, mult) {
  let below = 0, sum = 0, pos = 0, neg = 0;
  for (const g of groups) {
    let gp = 0, gn = 0;
    for (const i of g) { const c = mult ? mult[i] : 1; if (y[i]) gp += c; else gn += c; }
    sum += gp * (below + gn / 2);
    below += gn;
    pos += gp;
    neg += gn;
  }
  return pos > 0 && neg > 0 ? sum / (pos * neg) : 0.5;
}
export const auc = (scores, y) => aucOf(ranker(scores), y);

// share of all buyers found in the top tenth of sessions by score (ties broken by session order)
export function topTenth(scores, y) {
  const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a] || a - b);
  const all = y.reduce((a, v) => a + v, 0);
  const got = order.slice(0, Math.ceil(scores.length / 10)).reduce((a, i) => a + y[i], 0);
  return all > 0 ? got / all : 0;
}

// paired bootstrap of AUC(a) − AUC(b) over the same sessions: the 2.5% and 97.5% points
export function bootstrap(a, b, y, times, seed) {
  const r = rng(seed), ga = ranker(a), gb = ranker(b), diffs = [];
  for (let t = 0; t < times; t++) {
    const mult = new Uint32Array(y.length);
    for (let k = 0; k < y.length; k++) mult[draw(r, y.length)] += 1;
    diffs.push(aucOf(ga, y, mult) - aucOf(gb, y, mult));
  }
  diffs.sort((p, q) => p - q);
  return { lo: diffs[Math.floor(times * 0.025)], hi: diffs[Math.ceil(times * 0.975) - 1] };
}

// ── fitness, and the organ's look at itself ─────────────────────────────────────────────────────────────────────────
const ys = (data, rows) => rows.map((i) => data.y[i]);

// the buyers its own book missed (no pattern above the base rate fired) and the unread measure that best tells
// them apart from the non-buyers — the self-look costs no evaluation and sees no held-out session
export function selfLook(organ, data, rows) {
  const o = settings(organ.genome);
  const missed = rows.filter((i) => data.y[i] === 1 && !(organ.segments.get(data.cols.VisitorType[i]) || organ.global)
    .patterns.some((p) => p.up && fires(p, data, i)));
  const nonBuyers = rows.filter((i) => data.y[i] === 0);
  let suggest = -1, best = 0;
  // (with nobody missed a share is 0/0 = NaN, which never beats the best — nothing is suggested)
  FEATURES.forEach((f, k) => {
    if (o.features.includes(f)) return;
    for (const c of conditions(data, rows, [f], o.bins)) {
      const share = (list) => list.filter((i) => holds(c, data.cols[f][i])).length / list.length;
      const gap = Math.abs(share(missed) - share(nonBuyers));
      if (gap > best) { best = gap; suggest = k; }
    }
  });
  return { missed: missed.length, suggest };
}

export function assess(data, inner, genome, seed, look) {
  const organ = fit(data, inner.rest, genome, seed);
  const fitness = auc(inner.held.map((i) => score(organ, data, i)), ys(data, inner.held));
  return look ? { fitness, look: selfLook(organ, data, inner.rest) } : { fitness };
}

// ── genomes: draw, cross, mutate, observe ────────────────────────────────────────────────────────────────────────────
export function randomGenome(r) {
  const g = { on: draw(r, 128), wiring: draw(r, WIRINGS.length), features: draw(r, ALL_FEATURES + 1) };
  for (const p of PARAMS) g[p] = draw(r, GRID[p].length);
  return g;
}
export function withParams(g, r) {
  const out = { ...g };
  for (const p of PARAMS) out[p] = draw(r, GRID[p].length);
  return out;
}
// a fair coin as a whole draw, never a float compare
export const coin = (r) => draw(r, 2) === 0;
const crossBits = (a, b, width, r) => {
  let m = 0;
  for (let k = 0; k < width; k++) m |= ((coin(r) ? a : b) >> k & 1) << k;
  return m;
};
export function cross(a, b, r) {
  const g = { on: crossBits(a.on, b.on, ELEMENTS.length, r), wiring: (coin(r) ? a : b).wiring, features: crossBits(a.features, b.features, FEATURES.length, r) };
  for (const p of PARAMS) g[p] = (coin(r) ? a : b)[p];
  return g;
}
// one change: a slot is an element, the wiring, a measure, or a parameter (a step up or down)
export const SLOTS = ELEMENTS.length + 1 + FEATURES.length + PARAMS.length;
export function mutate(g, r) {
  const out = { ...g };
  const s = draw(r, SLOTS);
  if (s < ELEMENTS.length) out.on ^= 1 << s;
  else if (s === ELEMENTS.length) out.wiring = (g.wiring + 1 + draw(r, WIRINGS.length - 1)) % WIRINGS.length;
  else if (s < ELEMENTS.length + 1 + FEATURES.length) out.features ^= 1 << (s - ELEMENTS.length - 1);
  else {
    const p = PARAMS[s - ELEMENTS.length - 1 - FEATURES.length];
    const top = GRID[p].length - 1;
    const step = coin(r) ? -1 : 1;
    out[p] = g[p] + step < 0 || g[p] + step > top ? g[p] - step : g[p] + step;
  }
  return out;
}
// the observed change: switch on the measure the organ's own look suggested (and shape, if it is a shaped measure)
export function observe(g, look, r) {
  if (look.suggest < 0) return mutate(g, r);
  const out = { ...g, features: g.features | (1 << look.suggest) };
  if (DERIVED.includes(FEATURES[look.suggest])) out.on |= 1 << ELEMENTS.indexOf('shape');
  return out;
}
export const keyOf = (g) => [g.on, g.wiring, g.features, ...PARAMS.map((p) => g[p])].join('.');

// ── the three arms, each with exactly `budget` organ evaluations on the same split ─────────────────────────────────
// the fitter, or on a tie the earlier born
export const better = (a, b) => a.fitness > b.fitness || (a.fitness === b.fitness && a.n < b.n);
export const budgetOf = (c) => c.population + (c.generations - 1) * (c.population - c.elites);

// GROWN: the stem plus random differentiations, then battles, births (crossover, then one observed or blind change)
export function grow(data, inner, seed, c, tick = () => {}) {
  const r = rng(seed * 7919 + 1);
  let born = 0;
  const live = (g) => { tick(); return { g, n: born++, ...assess(data, inner, g, seed, true) }; };
  let pop = [STEM, ...Array.from({ length: c.population - 1 }, () => randomGenome(r))].map(live);
  const history = [];
  const best = () => pop.reduce((a, b) => (better(b, a) ? b : a));
  history.push(best().fitness);
  for (let gen = 1; gen < c.generations; gen++) {
    const battle = () => { const a = pop[draw(r, pop.length)], b = pop[draw(r, pop.length)]; return better(b, a) ? b : a; };
    const next = [...pop].sort((a, b) => (better(a, b) ? -1 : 1)).slice(0, c.elites);
    while (next.length < c.population) {
      const a = battle(), b = battle();
      const child = cross(a.g, b.g, r);
      next.push(live(coin(r) ? observe(child, a.look, r) : mutate(child, r)));
    }
    pop = next;
    history.push(best().fitness);
  }
  return { evals: born, champion: best(), history };
}
// SEARCH: a list of genomes evaluated in order — the hand-built design with tuned parameters, or random genomes
export function search(data, inner, seed, c, first, next, tick = () => {}) {
  const r = rng(seed * 7919 + 2);
  let champion = null;
  for (let n = 0; n < budgetOf(c); n++) {
    tick();
    const g = n === 0 ? first : next(r);
    const a = { g, n, ...assess(data, inner, g, seed, false) };
    if (!champion || a.fitness > champion.fitness) champion = a;
  }
  return { evals: budgetOf(c), champion };
}

// ── reading a book ───────────────────────────────────────────────────────────────────────────────────────────────────
const num = (v) => String(Math.round(v * 1e4) / 1e4);
export const describeCondition = (c) => c.f + (c.op === '=' ? ' = ' + c.v : (c.op === '>' ? ' > ' : ' ≤ ') + num(c.v));
export function describeBook(book) {
  return book.patterns.map((p) => ({
    when: p.conds.map(describeCondition).join(' and '),
    bought: Math.round(p.rate * 1000) / 10,
    lift: Math.round(p.lift * 100) / 100,
  }));
}
export function describeOrgan(organ) {
  return {
    elements: elementsOf(organ.genome.on),
    wiring: organ.wiring,
    measures: settings(organ.genome).features.length,
    settings: Object.fromEntries(PARAMS.map((p) => [p, settings(organ.genome)[p]])),
    books: [['everyone', organ.global], ...organ.segments].map(([who, b]) => ({ who, base: Math.round(b.base * 1000) / 10, patterns: describeBook(b) })),
  };
}

// ── one seed of the experiment: three arms on the same split, each champion refit on all training sessions and
//    graded ONCE on the held-out months ────────────────────────────────────────────────────────────────────────────
const r6 = (v) => Math.round(v * 1e6) / 1e6;
export function checkConfig(c) {
  const ints = ['population', 'elites', 'generations', 'resamples'];
  if (!c || typeof c !== 'object') return 'the configuration must be an object';
  for (const k of ints) if (!Number.isInteger(c[k]) || c[k] < 1) return k + ' must be a whole number ≥ 1';
  if (c.elites >= c.population) return 'elites must be fewer than the population';
  return null;
}
export function runSeed(data, seed, c, tick) {
  const train = rowsIn(data, TRAIN_MONTHS), held = rowsIn(data, HELD_MONTHS);
  const inner = split(data, train, 1 / 3, seed);
  const arms = {
    grown: grow(data, inner, seed, c, tick),
    hand: search(data, inner, seed, c, HAND, (r) => withParams(HAND, r), tick),
    random: search(data, inner, seed, c, STEM, randomGenome, tick),
  };
  const yh = ys(data, held);
  const out = { seed, arms: {} };
  const scoresOf = {};
  for (const [arm, res] of Object.entries(arms)) {
    const organ = fit(data, train, res.champion.g, seed);
    scoresOf[arm] = held.map((i) => score(organ, data, i));
    out.arms[arm] = {
      evals: res.evals, champion: keyOf(res.champion.g), born: res.champion.n, fitness: r6(res.champion.fitness),
      heldAuc: r6(auc(scoresOf[arm], yh)), topTenth: r6(topTenth(scoresOf[arm], yh)), organ: describeOrgan(organ),
      ...(res.history ? { history: res.history.map(r6) } : {}),
    };
  }
  const b = bootstrap(scoresOf.grown, scoresOf.hand, yh, c.resamples, seed);
  out.grownMinusHand = { auc: r6(out.arms.grown.heldAuc - out.arms.hand.heldAuc), lo: r6(b.lo), hi: r6(b.hi) };
  return out;
}

// the one-measure reference: rank held-out sessions by PageValues alone
export function reference(data) {
  const held = rowsIn(data, HELD_MONTHS);
  return { measure: 'PageValues', heldAuc: r6(auc(held.map((i) => data.cols.PageValues[i]), ys(data, held))) };
}

// checked entry point: CSV text + seeds + configuration → the whole record, or {ok:false}
export function experiment(text, seeds, c, tick) {
  const data = parseSessions(text);
  if (!data.ok) return data;
  const bad = checkConfig(c);
  if (bad) return { ok: false, error: bad };
  if (!Array.isArray(seeds) || !seeds.length || !seeds.every((s) => Number.isInteger(s) && s > 0)) return { ok: false, error: 'seeds must be whole numbers ≥ 1' };
  if (!rowsIn(data, TRAIN_MONTHS).length || !rowsIn(data, HELD_MONTHS).length) return { ok: false, error: 'need sessions in both the training and the held-out months' };
  return { ok: true, sessions: data.n, budget: budgetOf(c), reference: reference(data), seeds: seeds.map((s) => runSeed(data, s, c, tick)) };
}
