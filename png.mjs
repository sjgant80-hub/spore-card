// ════════════════════════════════════════════════════════════════
// png.mjs · PNG chunk primitives — the one implementation
//
// Extracted so forge.mjs (which writes card chunks) and art.mjs (which writes a fresh raster)
// can share it without importing each other. A circular import between those two deadlocks
// under top-level await, and duplicating the chunk code would invite exactly the copy-paste
// drift that a single shared module avoids. One module, two consumers, no cycle.
//
// Zero dependencies.
// ════════════════════════════════════════════════════════════════

export const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// CRC-32 (IEEE), the PNG chunk checksum. Table built once, deterministically.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function parseChunks(png) {
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG (bad signature)');
  const chunks = [];
  let off = 8;
  while (off + 8 <= png.length) {
    const length = png.readUInt32BE(off);
    const type = png.toString('latin1', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + length);
    chunks.push({ type, data });
    off += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}

export function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

export function serialise(chunks) {
  return Buffer.concat([PNG_SIG, ...chunks.map(c => makeChunk(c.type, c.data))]);
}
