#!/usr/bin/env node
/* THE LAUNCHER ICON IS THE BRAND MARK, DRAWN FROM THE SAME NUMBERS.
 *
 * The header paints a rounded square in `--accent` carrying the `#i-brand`
 * mark in `--accent-ink`. The mark's shape comes from tools/brand-mark.mjs. Both the colours and the corner are read out of
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
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { encodePng, token as readToken, rgb } from './png.mjs';
import { inMark, SPAN, CENTRE, MARK_ANY } from './brand-mark.mjs';

const root = process.argv[2] || '.';
const css = readFileSync(`${root}/styles.css`, 'utf8');

/* One reader for the tokens, shared with the store graphic. */
const token = (name) => {
  try { return readToken(css, name); }
  catch (error) { console.error('make-icons: ' + error.message); process.exit(1); }
};

const accent = token('accent');
const ink = token('accent-ink');
const radiusAt28 = Number(token('radius-lg'));

const ACCENT = rgb(accent);
const INK = rgb(ink);

/* The header's own proportions: a 28px square with an 8px corner. The corner
   is stated as a share of the box so it holds at any size. */
const CORNER = radiusAt28 / 28;

/* HOW BIG THE MARK SITS: its ring's outer edge spans this share of the
   square. 64% matches the header, which draws the mark in 64% of its box.
   Android crops a maskable icon to a circle 80% wide at worst, and a ring 60%
   wide sits inside that with room, so the fill can reach every edge. */
const MARK_MASKABLE = 0.6;

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
  /* Canvas pixels per unit of the mark's own 512 square. */
  const k = ((maskable ? MARK_MASKABLE : MARK_ANY) * size) / SPAN;

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
          if (inMark((fx - size / 2) / k + CENTRE, (fy - size / 2) / k + CENTRE)) fg += 1;
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

mkdirSync(`${root}/icons`, { recursive: true });

const wanted = [
  { file: 'icons/icon-192.png', size: 192, maskable: false },
  { file: 'icons/icon-512.png', size: 512, maskable: false },
  { file: 'icons/icon-maskable-512.png', size: 512, maskable: true },
  /* THE PHONE'S LAUNCHER, FOR ANDROID BEFORE 8. From 8 on the launcher draws
     the adaptive icon, which is a vector made from the same numbers. */
  { file: 'android/app/src/main/res/mipmap-mdpi/ic_launcher.png', size: 48, maskable: false },
  { file: 'android/app/src/main/res/mipmap-hdpi/ic_launcher.png', size: 72, maskable: false },
  { file: 'android/app/src/main/res/mipmap-xhdpi/ic_launcher.png', size: 96, maskable: false },
  { file: 'android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png', size: 144, maskable: false },
  { file: 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', size: 192, maskable: false },
  /* Play's own listing icon is a full square, which Play rounds itself. */
  { file: 'android/store_icon.png', size: 512, maskable: true },
];

const written = [];
for (const { file, size, maskable } of wanted) {
  const bytes = encodePng(size, size, draw(size, { maskable }));
  writeFileSync(`${root}/${file}`, bytes);
  written.push(`${file.split('/').pop()} ${size}x${size}`);
}

console.log(`make-icons: ${accent} on ${ink}, corner ${(CORNER * 100).toFixed(1)}% — ${written.join(', ')}`);
