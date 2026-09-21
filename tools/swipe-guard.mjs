#!/usr/bin/env node
/* A SWIPE CHANGES TABS, AND IT MUST NOT DO ANYTHING ELSE.
 *
 * Their instruction, 22 September 2026: swipe between tabs horizontally,
 * anywhere on the screen. They added "i believe it would not interfere with
 * any of its other operations. correct me if i am wrong."
 *
 * THEY WERE RIGHT ABOUT THE LAYOUT AND WRONG ABOUT TWO CLICKS. Measured in
 * the app at 375px: no sideways page scroll, and 0 boxes that can scroll
 * sideways. But a browser fires a click when the press and the release share
 * a target, whatever distance the pointer covered. A 70px drag across a
 * rating took a row from 0.5 stars to 5, and a click anywhere on a row opens
 * its link.
 *
 * SO THIS GUARD ASKS TWO QUESTIONS. Does the gesture test accept a swipe and
 * refuse a scroll? And is every competing gesture still excluded?
 *
 * IT EVALUATES THE REAL THRESHOLDS AND THE REAL DECISION, sliced out of
 * app.js, so a rewrite of either fails this rather than leaving a copy
 * agreeing with itself.
 */
import { readFileSync } from 'node:fs';
import { appSource, slice as sliceOne } from './slice-app.mjs';

const src = appSource();
const slice = (name) => sliceOne(src, name);

const app = new Function([
  slice('SWIPE_MIN'), slice('SWIPE_RATIO'), slice('SWIPE_MS'),
  slice('SWIPE_NEVER'), slice('SWIPE_CLICK_MS'),
  /* THE DECISION, LIFTED OUT OF THE LISTENER. The listener needs a DOM, and
     the arithmetic in it does not, so the three tests are asked here exactly
     as the handler asks them. A change to any threshold moves these. */
  `const takes = (dx, dy, held) =>
     Math.abs(dx) >= SWIPE_MIN
     && Math.abs(dx) >= Math.abs(dy) * SWIPE_RATIO
     && held <= SWIPE_MS;`,
  'return { SWIPE_MIN, SWIPE_RATIO, SWIPE_MS, SWIPE_NEVER, SWIPE_CLICK_MS, takes };',
].join('\n\n'))();

const cases = [];
const ok = (name, pass, note = '') => cases.push({ name, pass, note });

/* -- 1. A swipe is taken --------------------------------------------------- */
ok('a flat swipe right is taken', app.takes(80, 4, 180));
ok('a flat swipe left is taken', app.takes(-80, 4, 180));
ok('a swipe exactly at the floor is taken', app.takes(app.SWIPE_MIN, 0, 100));
ok('a long fast swipe is taken', app.takes(300, 20, 120));

/* A FINGER IS NOT A RULER, so a swipe that wanders is still a swipe. At the
   bar it may drift up to half its own length. */
ok('a swipe drifting a third of its length is taken', app.takes(120, 40, 200));

/* -- 2. A scroll is refused ------------------------------------------------ */
ok('a vertical scroll is refused', app.takes(6, 300, 300) === false);
ok('a scroll wandering sideways is refused', app.takes(30, 200, 300) === false);
ok('a diagonal drag is refused', app.takes(100, 100, 200) === false);
ok('a tap is refused', app.takes(0, 0, 60) === false);
ok('a tap that drifted is refused', app.takes(8, 3, 90) === false);
ok('a swipe one pixel short is refused', app.takes(app.SWIPE_MIN - 1, 0, 100) === false);
ok('a slow drag is refused', app.takes(200, 10, app.SWIPE_MS + 1) === false);
ok('a drag at the time limit is taken', app.takes(200, 10, app.SWIPE_MS));

/* -- 3. The thresholds are numbers a person chose -------------------------- */
ok('the distance clears Android slop', app.SWIPE_MIN >= 24, String(app.SWIPE_MIN));
ok('and is reachable on the narrowest width shipped', app.SWIPE_MIN <= 296 / 2,
  String(app.SWIPE_MIN));
ok('the ratio favours the horizontal', app.SWIPE_RATIO >= 2, String(app.SWIPE_RATIO));
ok('the time allows a real flick', app.SWIPE_MS >= 300 && app.SWIPE_MS <= 1000,
  String(app.SWIPE_MS));
ok('the click window is bounded', app.SWIPE_CLICK_MS > 0 && app.SWIPE_CLICK_MS <= 1000,
  String(app.SWIPE_CLICK_MS));

/* -- 4. Every competing gesture is excluded -------------------------------- */
/* EACH ENTRY IS A GESTURE SOMEBODY ELSE OWNS, and each was found by asking
   the live DOM rather than by reading. A field and the note body take a drag
   to move the caret. The rating reads a horizontal position, and 12 of them
   sit on one screen at 375. The note editor is full screen. */
for (const need of ['input', 'textarea', '[contenteditable]', '[role="slider"]', '#noteEditor']) {
  ok(`the swipe never starts in ${need}`, app.SWIPE_NEVER.includes(need), app.SWIPE_NEVER);
}

/* -- 5. The listener asks what this file asked ----------------------------- */
const blank = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
const code = blank(src);

/* ASK EACH HANDLER, NOT THE FILE. Both gate on the pointer type, so a scan
   of the whole file passes while either gate is gone. Proven by mutation:
   deleting the one in `pointerdown` left this quiet, because the one in
   `pointerup` still carried the string. */
const handler = (mark) => {
  const at = code.indexOf(mark);
  if (at < 0) return '';
  return code.slice(at, code.indexOf('}, true)', at) + 8);
};
const onDown = handler("addEventListener('pointerdown', (event) => {\n  swipe = null;");
const decide = code.slice(code.indexOf('const takeSwipe = (event) => {'),
  code.indexOf('addEventListener(\'pointermove\', takeSwipe'));

ok('the pointerdown handler was found', onDown.length > 100, String(onDown.length));
ok('the decision was found', decide.length > 200, String(decide.length));
ok('the press is touch only', /pointerType !== 'touch'/.test(onDown));
ok('the decision is touch only', /pointerType !== 'touch'/.test(decide));
ok('and only the primary pointer', /!event\.isPrimary/.test(onDown));
ok('the excluded set is read, never restated', /closest\?\.\(SWIPE_NEVER\)/.test(code));

/* THE DECISION IS ON `pointermove`, NEVER ONLY ON `pointerup`. That was the
   fault they reported: every synthetic test passed and the phone did nothing.
   A browser owns a touch gesture until something says otherwise, and once it
   starts scrolling it fires `pointercancel` and sends nothing further. */
ok('the decision runs on a move', /addEventListener\('pointermove', takeSwipe/.test(code));
ok('and on the release too, for a flick too short to move',
  /addEventListener\('pointerup', takeSwipe/.test(code));
ok('and one function decides for both',
  (code.match(/addEventListener\('pointer(?:move|up)', takeSwipe/g) || []).length === 2);

/* A CANCELLED GESTURE IS OVER, or a later event from the same press acts on a
   press the browser already took. */
ok('a cancel clears the gesture',
  /addEventListener\('pointercancel', \(\) => \{ swipe = null; \}/.test(code));

/* ONE STEP PER GESTURE. A finger travelling 300px crosses the threshold on
   every frame after the first, so the state is cleared before the step. */
/* READ THE REGION BETWEEN THE LAST TEST AND THE STEP, not the whole
   function. The time test also clears the gesture, so `lastIndexOf` found
   that one and this passed with the clear deleted. Proven by mutation. */
/* START AFTER THE TIME TEST'S OWN BRACE. That test also clears the gesture,
   so a region opened at the test itself contains its clear and passed with
   the real one deleted. Twice blind in one guard, the same way both times:
   a region wider than the question. */
{
  const test = decide.indexOf('SWIPE_MS)');
  const after = test > -1 ? decide.indexOf('}', test) + 1 : -1;
  const step = decide.indexOf('stepTab(dx > 0');
  const between = after > 0 && step > after ? decide.slice(after, step) : '';
  ok('the region before the step was found', between.length > 0, String(between.length));
  ok('the gesture is cleared in it', between.includes('swipe = null;'),
    between.replace(/\s+/g, ' ').slice(0, 90));
}

/* AND THE STYLESHEET DECLARES THE AXIS SPLIT, which is the other half. This
   one cannot be tested from a synthetic event at all, which is exactly why it
   needs asserting rather than remembering. */
{
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const rules = [...css.matchAll(/touch-action:\s*([^;}]+)/g)].map((m) => m[1].trim());
  ok('touch-action is declared', rules.length >= 2, rules.join(' | '));
  ok('it keeps vertical scrolling', rules.every((r) => /\bpan-y\b/.test(r)), rules.join(' | '));
  ok('and it keeps pinch zoom', rules.every((r) => /\bpinch-zoom\b/.test(r)), rules.join(' | '));
  ok('it never says none', !rules.some((r) => /\bnone\b/.test(r)), rules.join(' | '));
  /* THE LIST IS ITS OWN SCROLLER, so a rule on the body does not reach a
     gesture beginning inside it. Read the selector each declaration sits on,
     rather than building a pattern per name. */
  const on = [...css.matchAll(/([^{}]+)\{[^}]*touch-action[^}]*\}/g)]
    .map((m) => m[1].trim().split('\n').pop().trim());
  for (const sel of ['body', '.table-wrap']) {
    ok(`the axis split reaches ${sel}`, on.some((s) => s.includes(sel)), on.join(' | '));
  }
}

/* A BOX THAT CAN ACTUALLY SCROLL SIDEWAYS OWNS THE GESTURE, and a box that
   merely declares it does not. Six declare `overflow-x: auto` at 375 and
   none of them overflows, so the declaration alone would refuse the swipe
   over every open menu. */
ok('a sideways scroller is asked as a declaration AND a measurement',
  /overflowX\)[\s\S]{0,80}scrollWidth > el\.clientWidth/.test(code));

/* THE CLICK IS SWALLOWED ON THE CAPTURE PHASE, or it reaches the row handler
   and the rating before this one runs. */
const clicker = code.slice(code.indexOf("addEventListener('click', (event) => {\n  if (!swiped"));
ok('the click is swallowed in the capture phase', /\}, true\)/.test(clicker.slice(0, 260)));
ok('and both halves are stopped',
  /preventDefault\(\)[\s\S]{0,40}stopPropagation\(\)/.test(clicker.slice(0, 260)));

/* RECOGNISED, NOT MOVED. A swipe past the last tab moves nothing and is
   still a swipe, so its click is still swallowed. */
/* A MISSING NEEDLE RETURNS -1, AND -1 IS BEFORE EVERYTHING. So the first
   version of this passed on a file with the assignment deleted. Ask that both
   exist before comparing where they sit. */
{
  const set = code.indexOf('swiped = event.timeStamp');
  const step = code.indexOf('stepTab(dx > 0');
  ok('the flag is set at all', set > -1);
  ok('the tab step is there', step > -1);
  ok('and the flag is set before the step', set > -1 && step > -1 && set < step,
    `${set} against ${step}`);
}

/* AND THE FLAG EXPIRES, or a swipe ending over dead space leaves it set and
   swallows something else entirely. */
ok('the flag expires on a clock', /event\.timeStamp - swiped > SWIPE_CLICK_MS/.test(code));

/* ONE WRITER FOR WHICH TAB IS NEXT. The arrows and the swipe read the strip's
   own order, so a fourth tab needs no edit in either. */
ok('the arrows and the swipe share one stepper',
  /function stepTab\(by\)/.test(code) && (code.match(/stepTab\(/g) || []).length >= 2);
ok('and it reads the strip rather than a list of names',
  /function stepTab[\s\S]{0,200}\$\$\('\.tab'\)/.test(code));

/* -- 6. The markup still has three tabs to step between -------------------- */
{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const tabs = (html.match(/class="tab"/g) || []).length;
  ok('the strip holds more than one tab', tabs >= 2, String(tabs));
}

/* -- Verdict --------------------------------------------------------------- */
let bad = 0;
for (const c of cases) {
  if (!c.pass) { bad += 1; console.log(`swipe guard: FAIL ${c.name} - ${c.note}`); }
}
if (!cases.length) {
  console.error('swipe guard: no cases ran, so nothing was measured');
  process.exit(1);
}
console.log(`swipe guard: ${cases.length - bad} of ${cases.length} cases hold`);
process.exit(bad ? 1 : 0);
