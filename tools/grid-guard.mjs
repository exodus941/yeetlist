/* Every authored length is a whole number and a multiple of 4, unless a
   marker beside it says otherwise. Their instruction, 17 September 2026:

     can we make sure that as many measurements (particularly matters of
     padding) of the UI are WHOLE NUMBERS that are multiples of 4?

   A rule in prose is a rule the next declaration breaks, so this reads the
   stylesheet on every `npm run check` and exits non-zero on a finding.

   WHAT IT ASKS ABOUT is the set of properties that place or size a box. A
   font size, a leading and a tracking answer to the type scale instead, and
   they said so: "font sizes don't necessarily have to be".

   TWO VALUES PASS WITHOUT A MARKER. Zero, and 1px, which is a hairline by
   definition. A radius of 900px or more is "as round as it goes" and answers
   to no grid.

   ANYTHING ELSE NEEDS A MARKER IN A COMMENT ON ITS OWN LINE. A name list
   approves whatever nobody thought of, so the exemption is a word the author
   types rather than a selector this file remembers. There are two, and each
   one names what it permits.

   `half-step` TAKES A MULTIPLE OF 2, AND NOTHING ELSE. Their correction,
   17 September 2026:

     you can switch to multiples of 2 instead of multiples of 4 for areas
     that seem too tight or too spacious compared to what we had before

   So the marker cannot let an arbitrary number through: an odd value carrying
   it still exits 1. The stylesheet states where a half-step is legal.

   `optical` TAKES ANY VALUE, because a correction measured against painted
   ink answers to the ink rather than to either grid. Two marks carry it, and
   each drops onto a cap band. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('grid guard: no file given');
  process.exit(1);
}

const LAYOUT = [
  'padding', 'padding-block', 'padding-inline',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'padding-block-start', 'padding-block-end',
  'padding-inline-start', 'padding-inline-end',
  'margin', 'margin-block', 'margin-inline',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'margin-block-start', 'margin-block-end',
  'margin-inline-start', 'margin-inline-end',
  'gap', 'row-gap', 'column-gap',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'inset', 'inset-block', 'inset-inline',
  'inset-block-start', 'inset-block-end',
  'inset-inline-start', 'inset-inline-end',
  'top', 'right', 'bottom', 'left',
  'border-radius', 'flex-basis',
];

/* `outline-offset` is not here. An outline is out of flow, so its offset
   places a ring against a box rather than sizing one, and -1 to -3 is where
   a ring sits inside a border. */

const DECL = new RegExp(
  `(^|[;{\\s])(${LAYOUT.join('|')})\\s*:\\s*([^;}]*)`,
  'g',
);

/* A token that names a length is the other half: one declaration read in
   twenty places. Type and tracking are excluded by name, because those are
   the two the instruction lets off. */
/* `--mark` is in the list because a mark is sized against the label beside
   it, which is why it reads 14 rather than 16. Their number. */
const TYPE_TOKEN = /^--(text|track|font|leading|lead|cap|icon-stroke|mark)$|^--(text|track|font|leading|lead|cap)-/;

let findings = 0;
/* The verdict names its own denominator AND how many half-steps it let
   through. A marker nobody counts is a marker that spreads unnoticed. */
let halves = 0;
let checked = 0;

for (const file of files) {
  const path = resolve(file);
  const raw = readFileSync(path, 'utf8');

  /* Blank the comments rather than deleting them, or every line number below
     the first comment shifts and a finding points at the wrong rule. */
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const rawLines = raw.split('\n');
  const lineAt = (index) => src.slice(0, index).split('\n').length;
  const exempt = (line) => /optical/i.test(rawLines[line - 1] || '');
  /* A half-step is a multiple of 2, so the marker can only ever admit one.
     Asking the value as well as the word is what stops it becoming a way to
     type any number at all. */
  const halfStep = (px, line) => px % 2 === 0 && /half-step/i.test(rawLines[line - 1] || '');

  const off = [];

  let match;
  while ((match = DECL.exec(src)) !== null) {
    const prop = match[2];
    const value = match[3];
    const line = lineAt(match.index);

    for (const hit of value.matchAll(/(-?\d*\.?\d+)px/g)) {
      checked += 1;
      const px = Math.abs(Number(hit[1]));
      if (px === 0 || px === 1 || px >= 900) continue;
      if (px % 4 === 0) continue;
      if (halfStep(px, line)) { halves += 1; continue; }
      if (exempt(line)) continue;
      off.push(`${file}:${line}  ${prop}: ${value.trim().replace(/\s+/g, ' ')}   [${hit[0]}]`);
    }
  }

  for (const hit of src.matchAll(/(--[a-z0-9-]+)\s*:\s*(-?\d*\.?\d+)px\s*(?=[;}])/g)) {
    const name = hit[1];
    const line = lineAt(hit.index);
    checked += 1;
    if (TYPE_TOKEN.test(name)) continue;
    const px = Math.abs(Number(hit[2]));
    if (px === 0 || px === 1 || px >= 900) continue;
    if (px % 4 === 0) continue;
    if (halfStep(px, line)) { halves += 1; continue; }
    if (exempt(line)) continue;
    off.push(`${file}:${line}  ${name}: ${hit[2]}px`);
  }

  findings += off.length;
  for (const line of off) console.log(line);
}

/* A run that measured nothing is not a pass, and has to say so. */
if (checked === 0) {
  console.error(`grid guard: read ${files.length} file(s) and found no length at all`);
  process.exit(1);
}

if (findings) {
  console.error(`grid guard: ${findings} length(s) off the 4px grid, of ${checked} read`);
  process.exit(1);
}

console.log(`grid guard: ${checked} lengths read, ${halves} marked half-step, the rest on the 4px grid`);
