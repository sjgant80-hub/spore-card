// node-tools.mjs — the impure tools a mesh node needs, for Node (the browser node builds the same shape from
// WebCrypto). Ed25519 via node:crypto, sha256, and germination on THIS node's own copy of the dataset through
// the vendored fall-spore engine. Keys can come from a fixed 32-byte seed so a receipt regenerates byte-for-byte.
import { readFileSync } from 'node:fs';
import { createHash, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto';
import { parseSessions } from './organ.mjs';
import { germinate as sporeGerminate, organBody } from './spore.mjs';

export { growOn } from './grow-on.mjs';
import { growOn } from './grow-on.mjs';

const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');

export const sha256hex = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');

/** An Ed25519 identity from a fixed 32-byte seed (deterministic) — signatures are deterministic too. */
export function identityFromSeed(seed32) {
  const priv = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, Buffer.from(seed32)]), format: 'der', type: 'pkcs8' });
  const pubkey = new Uint8Array(Buffer.from(createPublicKey(priv).export({ format: 'jwk' }).x, 'base64url'));
  return { pubkey, sign: (bytes) => new Uint8Array(edSign(null, Buffer.from(bytes), priv)) };
}

/** Ed25519 verify over raw bytes with a raw 32-byte key. Total: malformed input is false. */
export function verify(bytes, sig, pubkey) {
  try {
    if (!(pubkey instanceof Uint8Array) || pubkey.length !== 32) return false;
    if (!(sig instanceof Uint8Array) || sig.length !== 64) return false;
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(pubkey).toString('base64url') }, format: 'jwk' });
    return edVerify(null, Buffer.from(bytes), key, Buffer.from(sig));
  } catch { return false; }
}

/** A node: its identity, its own copy of the data, and the tools mesh.mjs expects. */
export function nodeTools({ seed32, csvPath }) {
  const csv = readFileSync(csvPath);
  const data = parseSessions(csv.toString('utf8'));
  const id = identityFromSeed(seed32);
  return {
    pubkey: id.pubkey,
    sign: id.sign,
    verify,
    sha256hex,
    dataSha256Hex: sha256hex(csv),
    germinate(seedStr) {
      const r = sporeGerminate(data, seedStr, 'all');
      if (!r || !r.ok) return { ok: false };
      return { ok: true, heldAuc: r.heldAuc, body: JSON.stringify(organBody(r.organ)) };
    },
    grow(sporeStr, proposals = []) { return growOn(data, sporeStr, proposals); },
  };
}
