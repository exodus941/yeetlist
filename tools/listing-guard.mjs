#!/usr/bin/env node
/* PLAY REFUSES A FIELD THAT IS ONE CHARACTER OVER, AND THE COPY LIVES IN A
 * MARKDOWN FILE NOBODY MEASURES. The stated count beside the full description
 * read 1075 where the text is 1224, which is the shape of every figure a
 * person types beside prose they then edit.
 *
 * So the caps are asked rather than remembered, and the stated count is
 * asked with them.
 */
import { readFileSync } from 'node:fs';
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
process.exit(bad ? 1 : 0);
