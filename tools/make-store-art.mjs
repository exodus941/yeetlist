#!/usr/bin/env node
/* THE FEATURE GRAPHIC, 1024x500, FROM THE SAME TOKENS AS EVERYTHING ELSE.
 *
 * Play shows this banner above the listing and writes the app's name over it
 * itself, so the drawing carries no words. That is also the one thing a
 * generator without a font renderer cannot do honestly.
 *
 * THE COMPOSITION IS THE HEADER'S, ENLARGED. The page colour as ground, the
 * brand mark at its own proportions, and a bar in the accent along the foot.
 * Nothing here is a value somebody typed: the two colours, the corner and the
 * bar's height all come out of styles.css.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { encodePng, token, rgb } from './png.mjs';
import { inMark, SPAN, CENTRE, MARK_ANY } from './brand-mark.mjs';

const root = process.argv[2] || '.';
const css = readFileSync(`${root}/styles.css`, 'utf8');

const read = (name) => {
  try { return token(css, name); }
  catch (error) { console.error('make-store-art: ' + error.message); process.exit(1); }
};

const BG = rgb(read('bg'));
const ACCENT = rgb(read('accent'));
const INK = rgb(read('accent-ink'));
const CORNER = Number(read('radius-lg')) / 28;

const W = 1024;
const H = 500;

/* The mark takes a third of the height, which is the header's own ratio of
   mark to bar carried up to this size. */
const MARK = Math.round(H / 3);
const MARK_X = Math.round(W / 2 - MARK / 2);
const MARK_Y = Math.round(H / 2 - MARK / 2);

/* The accent bar is one hairline scaled by the same factor the mark was, so
   the banner keeps the page's own weight rather than inventing one. */
const BAR = Math.round(H / 100);

/* The mark sits in its square at the launcher icon's own share. */
const K = (MARK_ANY * MARK) / SPAN;
const MID_X = MARK_X + MARK / 2;
const MID_Y = MARK_Y + MARK / 2;

const inSquare = (px, py, x0, y0, size, corner) => {
  const r = corner * size;
  const lx = px - x0;
  const ly = py - y0;
  if (lx < 0 || ly < 0 || lx > size || ly > size) return false;
  const cx = Math.min(Math.max(lx, r), size - r);
  const cy = Math.min(Math.max(ly, r), size - r);
  return (lx - cx) ** 2 + (ly - cy) ** 2 <= r * r + 1e-9;
};


const SS = 4;
const px = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let square = 0;
    let mark = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const fx = x + (sx + 0.5) / SS;
        const fy = y + (sy + 0.5) / SS;
        if (inSquare(fx, fy, MARK_X, MARK_Y, MARK, CORNER)) square += 1;
        if (inMark((fx - MID_X) / K + CENTRE, (fy - MID_Y) / K + CENTRE)) mark += 1;
      }
    }
    const n = SS * SS;
    const s = square / n;
    const m = Math.min(mark / n, s);
    const bar = y >= H - BAR ? 1 : 0;

    const o = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) {
      /* Ground, then the square over it, then the glyph, then the bar. Each
         layer paints over what is under it rather than adding to it. */
      let v = BG[c] * (1 - s) + ACCENT[c] * (s - m) + INK[c] * m;
      v = v * (1 - bar) + ACCENT[c] * bar;
      px[o + c] = Math.round(v);
    }
    px[o + 3] = 255;
  }
}

mkdirSync(`${root}/store`, { recursive: true });
const bytes = encodePng(W, H, px);
writeFileSync(`${root}/store/feature-1024x500.png`, bytes);
console.log(`make-store-art: feature-1024x500.png ${W}x${H} ${bytes.length}b, mark ${MARK}px, bar ${BAR}px`);
