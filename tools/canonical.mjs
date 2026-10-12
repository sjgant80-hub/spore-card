// canonical.mjs — canonical JSON for receipts: keys sorted at every depth, two-space indent, so a regenerated
// receipt compares byte-for-byte with the committed one.
export function canonicalJson(v) {
  const sort = (x) => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, sort(x[k])]));
    return x;
  };
  return JSON.stringify(sort(v), null, 2);
}
