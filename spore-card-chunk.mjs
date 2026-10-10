// spore-card-chunk.mjs — the LOSSLESS layer (Node-only). Carries the exact seed bytes in a `spoR`
// ancillary PNG chunk, for a real file that travels intact (download, direct send, peer-to-peer). A
// platform that re-encodes the image strips ancillary chunks — that is what the visible band in
// spore-card.mjs is for. Kept separate because the PNG primitives use Node's Buffer; spore-card.mjs
// stays browser-safe. PNG chunk primitives vendored from sjgant80-hub/fallkard-forge (MIT), credited.
import { parseChunks, serialise } from './png.mjs';
import { unframe } from './spore-card.mjs';

const SPORE_CHUNK = 'spoR'; // ancillary (lowercase 1st letter), private (lowercase 3rd)

export function embedChunk(pngBuf, frameBytes) {
  try {
    const chunks = parseChunks(pngBuf);
    const idx = chunks.findIndex((c) => c.type === 'IEND');
    const chunk = { type: SPORE_CHUNK, data: Buffer.from(frameBytes || []) };
    if (idx < 0) chunks.push(chunk); else chunks.splice(idx, 0, chunk);
    return { ok: true, png: serialise(chunks) };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

export function readChunk(pngBuf) {
  try {
    const chunks = parseChunks(pngBuf);
    const c = chunks.find((x) => x.type === SPORE_CHUNK);
    if (!c) return { ok: false, error: 'no spoR chunk' };
    return unframe(Uint8Array.from(c.data));
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
