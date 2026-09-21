#!/usr/bin/env node
/* PLAY REFUSES A FIELD THAT IS ONE CHARACTER OVER, AND THE COPY LIVES IN A
 * MARKDOWN FILE NOBODY MEASURES. The stated count beside the full description
 * read 1075 where the text is 1224, which is the shape of every figure a
 * person types beside prose they then edit.
 *
 * So the caps are asked rather than remembered, and the stated count is
 * asked with them.
 */
import { readFileSync, readdirSync } from 'node:fs';
const t = readFileSync('store/listing.md', 'utf8');
const FENCE = '```';
const grab = (h) => {
  const i = t.indexOf(h);
  const a = t.indexOf(FENCE, i) + FENCE.length;
  const b = t.indexOf(FENCE, a);
  return t.slice(a, b).trim();
};
const rows = [
  ['name', grab('## App name'), 30],
  ['short', grab('## Short description'), 80],
  ['full', grab('## Full description'), 4000],
];
if (!rows.length || rows.some(([, text]) => !text)) {
  console.error('listing guard: a field read empty, so nothing was measured');
  process.exit(1);
}

/* THE STATED COUNT IS PART OF THE FILE, so it is compared rather than read.
   Each block is followed by its own length in brackets. */
const stated = [...t.matchAll(/^\((\d+)\)$/gm)].map((m) => Number(m[1]));

let bad = 0;
rows.forEach(([label, text, cap], i) => {
  const ok = text.length <= cap;
  const says = stated[i];
  const agrees = says === text.length;
  if (!ok || !agrees) bad += 1;
  console.log(`listing guard: ${label.padEnd(6)} ${String(text.length).padStart(4)} / ${cap}`
    + `  ${ok ? 'ok' : 'TOO LONG'}${agrees ? '' : `, but the file says ${says}`}`);
});
/* THE SHOTS ARE A STATED CONSTANT TOO. The file says 1080x1920 and calls it
   9:16, and Play refuses anything outside that. A phone's own screen is
   1080x2400, so the shape to catch is a screenshot taken without the resize.
   Read the PNG header rather than trusting the sentence above it. */
const SHOTS = 'store/screenshots';
const RATIO = 9 / 16;
let shots = [];
try { shots = readdirSync(SHOTS).filter((f) => f.endsWith('.png')).sort(); }
catch { shots = []; }

if (shots.length < 2) {
  console.error(`listing guard: ${shots.length} screenshots in ${SHOTS}, and Play asks for 2 to 8`);
  bad += 1;
} else if (shots.length > 8) {
  console.error(`listing guard: ${shots.length} screenshots, and Play takes at most 8`);
  bad += 1;
}

for (const file of shots) {
  const png = readFileSync(`${SHOTS}/${file}`);
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  const sides = w >= 320 && h >= 320 && w <= 3840 && h <= 3840;
  const ratio = Math.abs(w / h - RATIO) < 0.001;
  const named = t.includes(`\`${file}\``);
  if (!sides || !ratio || !named) bad += 1;
  console.log(`listing guard: ${file.padEnd(20)} ${w}x${h}`
    + `  ${ratio ? '9:16' : `NOT 9:16 (${(w / h).toFixed(3)})`}`
    + `${sides ? '' : ', a side is outside 320 to 3840'}`
    + `${named ? '' : ', and the listing never names it'}`);
}

process.exit(bad ? 1 : 0);
