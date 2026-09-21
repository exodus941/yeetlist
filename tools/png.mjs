/* ONE PNG ENCODER, EVERY CALLER. The launcher icons and the store graphic are
 * different shapes of one job, and a second copy of a CRC table is a second
 * thing to get wrong.
 *
 * NO DEPENDENCY, BECAUSE THIS REPO HAS NONE. A PNG is a zlib stream of
 * filtered scanlines plus three chunks, and `node:zlib` is built in.
 *
 * WIDTH AND HEIGHT, NEVER ONE SIZE. The first version took a square because
 * every icon is one, and a 1024x500 feature graphic is not.
 */
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};

/** @param {Buffer} rgba width * height * 4 bytes */
export function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) {
    throw new Error(`encodePng: ${rgba.length} bytes for ${width}x${height}, wanted ${width * height * 4}`);
  }
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* THE TOKENS ARE READ, NEVER TYPED. An image drawn in a colour the app does
   not ship is a second brand nobody chose. It refuses rather than inventing
   one, because a default here is invisible until somebody compares the two. */
export function token(css, name) {
  const hit = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6}|\\d+)(?:px)?\\s*;`).exec(css);
  if (!hit) throw new Error(`styles.css declares no --${name}`);
  return hit[1];
}

export const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
