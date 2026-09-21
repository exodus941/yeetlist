#!/usr/bin/env node
/* THE LAUNCHER ICON IS THE BRAND MARK, DRAWN FROM THE SAME NUMBERS.
 *
 * The header paints a rounded square in `--accent` carrying the `#i-play`
 * glyph in `--accent-ink`. Both the colours and the corner are read out of
 * styles.css rather than typed here, so a token change moves the icon too.
 *
 * NO DEPENDENCY, BECAUSE THIS REPO HAS NONE. A PNG is a zlib stream of filtered
 * scanlines plus three chunks, and `node:zlib` is built in. Anti-aliasing comes
 * from 4x supersampling, which is enough at 192px and up.
 *
 * TWO PURPOSES, AND THEY ARE DIFFERENT DRAWINGS. The `any` icon is the square
 * as the header draws it, corner and all. A `maskable` icon is cropped by the
 * launcher to whatever shape the device uses, so it bleeds to every edge and
 * keeps its glyph inside the central 80% that Android promises to preserve.
 */
import { deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = process.argv[2] || '.';
const css = readFileSync(`${root}/styles.css`, 'utf8');

/* Read the tokens, and refuse rather than invent one. An icon drawn in a
   colour the app does not ship is a second brand nobody chose. */
const token = (name) => {
  const hit = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6}|\\d+)(?:px)?\\s*;`).exec(css);
  if (!hit) {
    console.error(`make-icons: styles.css declares no --${name}`);
    process.exit(1);
  }
  return hit[1];
};

const accent = token('accent');
const ink = token('accent-ink');
const radiusAt28 = Number(token('radius-lg'));

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const ACCENT = rgb(accent);
const INK = rgb(ink);

/* The header's own proportions: a 28px square with an 8px corner. The corner
   is stated as a share of the box so it holds at any size. */
const CORNER = radiusAt28 / 28;

/* The glyph is `#i-play` on a 24 unit viewBox: M6 3 L20 12 L6 21 Z. */
const TRI = [[6, 3], [20, 12], [6, 21]];
const VIEW = 24;

/* HOW BIG THE GLYPH SITS. The header renders a 14px mark in a 28px square, so
   the mark's BOX is half the square and the triangle inside it spans 14 of 24
   units: 29% of the canvas. That reads as a speck in a launcher, so the icon
   gives the glyph 44% of the canvas and keeps the shape exactly. */
const GLYPH_ANY = 0.44;
/* Android crops a maskable icon to the central 80% at worst, so the glyph
   stays inside that and the fill reaches every edge. */
const GLYPH_MASKABLE = 0.36;

const inside = (px, py, pts) => {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

/* A rounded square, by distance to the corner circle's centre. */
const inSquare = (px, py, size, corner) => {
  const r = corner * size;
  const cx = Math.min(Math.max(px, r), size - r);
  const cy = Math.min(Math.max(py, r), size - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r + 1e-9;
};

function draw(size, { maskable }) {
  const SS = 4;
  const corner = maskable ? 0 : CORNER;
  const glyph = (maskable ? GLYPH_MASKABLE : GLYPH_ANY) * size;
  const scale = glyph / (14 / VIEW * VIEW); // the triangle spans 14 of 24 units
  const tri = TRI.map(([x, y]) => [
    (x - 6) * (glyph / 14) + (size - glyph) / 2,
    (y - 3) * (glyph / 14) + (size - (18 * glyph) / 14) / 2,
  ]);
  void scale;

  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;
          if (inSquare(fx, fy, size, corner)) bg += 1;
          if (inside(fx, fy, tri)) fg += 1;
        }
      }
      const n = SS * SS;
      const a = bg / n;
      const t = fg / n;
      const o = (y * size + x) * 4;
      /* The glyph paints over the fill, so the colour is a mix and the alpha
         is the square's. A triangle outside the square paints nothing. */
      const mix = Math.min(t, a);
      for (let c = 0; c < 3; c++) {
        px[o + c] = Math.round(ACCENT[c] * (a - mix) + INK[c] * mix + 0 * (1 - a));
      }
      px[o + 3] = Math.round(a * 255);
    }
  }
  return px;
}

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

function png(size, px) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // no filter
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(`${root}/icons`, { recursive: true });

const wanted = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
];

const written = [];
for (const { file, size, maskable } of wanted) {
  const bytes = png(size, draw(size, { maskable }));
  writeFileSync(`${root}/icons/${file}`, bytes);
  written.push(`${file} ${size}x${size} ${bytes.length}b`);
}

console.log(`make-icons: ${accent} on ${ink}, corner ${(CORNER * 100).toFixed(1)}% — ${written.join(', ')}`);
