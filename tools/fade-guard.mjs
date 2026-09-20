#!/usr/bin/env node
/* EVERY PANEL THE SCRIPT HIDES FADES, AND A COMMENT COULD NOT ENFORCE IT.
 *
 * styles.css carries three selector lists: the transition, the resting
 * `opacity: 0` and the `@starting-style` entry. All three name the same ids.
 * Their comment told a reader to grep `$('#x').hidden =` in app.js before
 * adding a panel. Half the writes go through a local instead, so the grep
 * missed a rating menu and a notification's own cross. Both shipped snapping,
 * and the reader found them.
 *
 * THE MARKUP IS THE EXACT QUESTION. An element carrying a `hidden` attribute
 * in index.html is one the script shows, because a permanently hidden element
 * would not be in the page at all.
 *
 * TWO EXEMPTIONS, BOTH DECLARATIONS RATHER THAN NAMES. An `<svg>` sprite is
 * never shown. A file input is a hidden picker opened by script, and it is
 * the shape a target check already excludes for the same reason.
 *
 * AND THE THREE LISTS ARE COMPARED WITH EACH OTHER. A panel added to the
 * transition alone flips display at the far end and never moves its opacity.
 * Measured on the rating menu that way: display block through 236ms and none
 * at 283, with opacity 1 the whole run. That is a panel that still snaps.
 */
import { readFileSync } from 'node:fs';

const root = process.argv[2] || '.';
const html = readFileSync(`${root}/index.html`, 'utf8');
const css = readFileSync(`${root}/styles.css`, 'utf8');

/* NO NESTED QUANTIFIER. A pattern like `(?:#id[^{]*?)+` over a 170KB file
   backtracks for minutes, which is a guard nobody can run. Each list is found
   by the declaration that states it, and the selector is the text before the
   brace, cut at whichever of the previous rule or comment ends last. */
const before = (re, from = 0) => {
  const hit = re.exec(css.slice(from));
  if (!hit) return null;
  const at = from + hit.index;
  const open = css.lastIndexOf('{', at);
  const prev = Math.max(css.lastIndexOf('}', open), css.lastIndexOf('*/', open));
  return css.slice(prev + 1, open);
};

const startingAt = css.indexOf('@starting-style');
const lists = {
  transition: before(/transition:\s+opacity[^;}]*allow-discrete/),
  resting: before(/opacity:\s*0;?\s*\}/, css.indexOf('[hidden],')),
  entering: startingAt < 0 ? null : before(/opacity:\s*0;?\s*\}/, startingAt),
};

const sets = {};
for (const [name, text] of Object.entries(lists)) {
  if (!text) {
    console.error(`fade guard: no ${name} selector list in styles.css`);
    process.exit(1);
  }
  sets[name] = new Set([...text.matchAll(/#([A-Za-z0-9_-]+)/g)].map((m) => m[1]));
  if (!sets[name].size) {
    console.error(`fade guard: the ${name} list named no ids, so nothing was measured`);
    process.exit(1);
  }
}

/* THE THREE HOLD ONE SET. Reported before the markup comparison, because a
   panel missing from two of them still reads as a panel that fades. */
const names = Object.keys(sets);
const drift = [];
for (const a of names) {
  for (const b of names) {
    if (a === b) continue;
    for (const id of sets[a]) if (!sets[b].has(id)) drift.push(`#${id} is in the ${a} list and not the ${b} one`);
  }
}
if (drift.length) {
  for (const d of [...new Set(drift)]) console.error('fade guard: ' + d);
  process.exit(1);
}

const fading = sets.transition;

/* Each opening tag carrying a bare `hidden` attribute. A value would make it
   an attribute of another name, so the boundary is asserted on both sides. */
const tags = [...html.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*\shidden(?=[\s/>])[^>]*)>/g)];

if (!tags.length) {
  console.error('fade guard: no hidden elements read, so nothing was measured');
  process.exit(1);
}

const findings = [];
let exempt = 0;
let inherited = 0;
for (const [, tag, attrs] of tags) {
  if (tag === 'svg') { exempt += 1; continue; }
  if (tag === 'input' && /type\s*=\s*["']file["']/.test(attrs)) { exempt += 1; continue; }
  /* A CHILD OF A FADING BOX TAKES ITS PARENT'S FADE. A second one on the
     child is a second writer for one visual: the notification's cross
     outlived its own fold by 106ms that way. The marker is the exemption,
     never a name, and the verdict counts what it let through. */
  if (/\bdata-fade\s*=\s*["']parent["']/.test(attrs)) { inherited += 1; continue; }
  const id = /\bid\s*=\s*["']([^"']+)["']/.exec(attrs)?.[1];
  if (!id) { findings.push(`<${tag}> is hidden with no id, so nothing can name it`); continue; }
  if (!fading.has(id)) findings.push(`#${id} is hidden by the script and never fades`);
}

if (findings.length) {
  for (const f of findings) console.error('fade guard: ' + f);
  console.error(`fade guard: ${findings.length} of ${tags.length} hidden elements missing from the lists in styles.css`);
  process.exit(1);
}

console.log(`fade guard: ${tags.length} hidden elements, ${tags.length - exempt - inherited} fading, `
  + `${exempt} exempt by shape, ${inherited} fading with a parent, 3 lists agreeing on ${fading.size} ids`);
