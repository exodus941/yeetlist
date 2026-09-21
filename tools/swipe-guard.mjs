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
ok('and the release decides where it lands',
  /addEventListener\('pointerup', dropSwipe/.test(code));
ok('one function moves it and one lands it',
  /addEventListener\('pointermove', takeSwipe/.test(code)
  && /addEventListener\('pointerup', dropSwipe/.test(code));

/* A CANCELLED GESTURE IS OVER, AND THE PAGES STILL HAVE TO GO HOME. The
   browser takes a gesture the moment it decides to scroll and sends nothing
   further, so a drag left mid-travel would stay there. */
ok('a cancel clears the gesture', /addEventListener\('pointercancel'[\s\S]{0,140}swipe = null/.test(code));
ok('and it sends the pages home',
  /addEventListener\('pointercancel'[\s\S]{0,140}endDrag\(false\)/.test(code));

/* ONE PICK-UP PER GESTURE. Every frame after the first crosses the same
   threshold, so the drag is started once and then only moved. */
ok('the drag is started once', /if \(!drag\) \{[\s\S]{0,400}beginDrag\(dx\)/.test(decide));
ok('and afterwards it is only moved', /moveDrag\(dx\);\n\};/.test(decide));

/* THE GESTURE KEEPS THE DIRECTION IT STARTED IN. A finger that comes back
   past its own start has no second page on that side, so the offset is
   clamped rather than allowed to cross zero. */
ok('the travel cannot cross its own start',
  /drag\.sign > 0 \? Math\.max\(0, raw\) : Math\.min\(0, raw\)/.test(code));

/* AND THE STYLESHEET DECLARES THE AXIS SPLIT, which is the other half. This
   one cannot be tested from a synthetic event at all, which is exactly why it
   needs asserting rather than remembering. */
{
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  /* AT REST ONLY. A drag in flight takes both axes on purpose, and that rule
     names the state it belongs to, so it is read separately rather than
     being allowed to widen this answer. Without the split the `none` it
     declares would have silenced the whole question. */
  const blocks = [...css.matchAll(/([^{}]+)\{([^}]*touch-action[^}]*)\}/g)]
    .map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const value = (b) => /touch-action:\s*([^;}]+)/.exec(b.body)[1].trim();
  const rest = blocks.filter((b) => !b.sel.includes('[data-drag]')).map(value);
  const dragging = blocks.filter((b) => b.sel.includes('[data-drag]')).map(value);

  ok('touch-action is declared', rest.length >= 2, rest.join(' | '));
  ok('it keeps vertical scrolling', rest.every((r) => /\bpan-y\b/.test(r)), rest.join(' | '));
  ok('and it keeps pinch zoom', rest.every((r) => /\bpinch-zoom\b/.test(r)), rest.join(' | '));
  ok('it never says none at rest', !rest.some((r) => /\bnone\b/.test(r)), rest.join(' | '));

  /* AND A DRAG IN FLIGHT TAKES BOTH AXES, or a finger travelling diagonally
     scrolls the list it is dragging away. */
  const held = blocks.filter((b) => b.sel.includes('[data-drag]'));
  ok('a drag in flight takes both axes', dragging.length >= 1, dragging.join(' | '));
  ok('and it says so by naming none',
    dragging.length > 0 && dragging.every((r) => r === 'none'), dragging.join(' | '));
  for (const sel of ['body', '.table-wrap']) {
    ok(`and it reaches ${sel} while dragging`,
      held.some((b) => b.sel.includes(sel)), held.map((b) => b.sel).join(' | '));
  }
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
  const set = code.indexOf('swiped = event.timeStamp;\n  endDrag(');
  /* A DECLARATION READS LIKE A CALL. `function endDrag(commit) {` holds the
     same text, and it comes first, so the first version of this compared the
     flag against the declaration and reported it late. */
  const step = code.indexOf('endDrag(commit);');
  ok('the flag is set at all', set > -1);
  ok('the landing is there', step > -1);
  ok('and the flag is set before the landing', set > -1 && step > -1 && set < step + 1,
    `${set} against ${step}`);
}

/* AND THE FLAG EXPIRES, or a swipe ending over dead space leaves it set and
   swallows something else entirely. */
ok('the flag expires on a clock', /event\.timeStamp - swiped > SWIPE_CLICK_MS/.test(code));

/* ONE WRITER FOR WHICH TAB IS NEXT. The arrows and the swipe read the strip's
   own order, so a fourth tab needs no edit in either. */
/* THE STEPPER IS GONE, AND ITS ONE CALLER IS WHY. It existed for the swipe,
   and the drag reads the strip itself. A function nobody calls reads as a
   second way to change tabs. */
ok('nothing is left of the old stepper', !/stepTab/.test(code));
ok('the drag reads the strip rather than a list of names',
  /function neighbourTab\(by\)[\s\S]{0,200}\$\$\('\.tab'\)/.test(code));
ok('and it refuses to step off the end',
  /function neighbourTab[\s\S]{0,260}to < 0 \|\| to >= order\.length \? null/.test(code));

/* -- 6. The finger's direction is the strip's direction -------------------- */
/* Their report, 22 September 2026: "the scroll direction is wrong, it's going
   left when it's supposed to go right (and vice versa), it's completely
   counterintuitive." I shipped the carousel reading, where the content
   follows the finger. Theirs is the other convention and it is their app. */
ok('a swipe right steps forward', /const sign = dx > 0 \? 1 : -1;/.test(code),
  (code.match(/const sign = dx[^;]*/) || ['none'])[0]);
ok('and the tab it lands on is that step', /const to = neighbourTab\(sign\);/.test(code));

/* AND A SWIPE CROSS-FADES AT THE SHORT STEP. Two reports, and the second
   corrected my answer to the first.

   22 September 2026: "i can't swipe rapidly between tabs, there is a
   1-2-second gap after swiping to a new tab during which additional swipes
   are not accepted. that needs to go." I answered it by switching the
   animation off for a swipe, and this check pinned that.

   Then: "the mobile app has no crossfade transitions when swiping between
   tabs!" The LENGTH was the fault, never the fade. A switch runs two view
   transitions at the fold duration, 500ms each, and 500ms on a repeated
   gesture reads as a blocked swipe.

   MEASURED WITH THE FADE BACK ON: two switches 60ms apart both land, and the
   tab ends where the second sent it. A second `startViewTransition` while one
   runs is skipped and its callback still runs, so nothing is dropped. */
/* AND THE DRAG REPLACED BOTH OF THOSE ANSWERS. Their ask, 22 September 2026:
   "make the slide actually stay responsive under the finger."

   A VIEW TRANSITION TAKES ONE PICTURE AND PLAYS A FIXED ANIMATION, so nothing
   in it can read a finger. The drag mounts the old page itself and moves the
   pair, which is why the swipe no longer asks showTab to animate. A click and
   the arrow keys still do, because neither has a finger to follow. */
ok('the drag switches the tab without an animation',
  /showTab\(to, \{ animate: false \}\)/.test(code));
ok('and it puts the old tab back the same way',
  /showTab\(from, \{ animate: false \}\)/.test(code));

/* -- 7. The pages follow the finger, and the release decides -------------- */

/* THE OLD PAGE IS A COPY, MOUNTED FOR THE GESTURE AND REMOVED AFTER IT. Two
   lists mounted at rest is the shape that makes a tool measure the surface
   that is leaving. */
ok('the old page is a copy of the panel', /panel\.cloneNode\(true\)/.test(code));
ok('it is out of the accessibility tree', /ghost\.setAttribute\('aria-hidden', 'true'\)/.test(code));
ok('and it takes no pointer events',
  /\.panel-ghost \{[\s\S]{0,260}pointer-events: none/.test(
    readFileSync(new URL('../styles.css', import.meta.url), 'utf8')));
ok('and every ending removes it', (code.match(/ghost\?\.remove\(\)/g) || []).length >= 1);

/* THE RELEASE IS A SHARE OF THE PANEL, NEVER A DISTANCE. A quarter of the
   screen means the same thing on every phone. A fast flick commits under it,
   because a reader who throws the page has decided. */
ok('the threshold is a share of the width', /Math\.abs\(drag\.dx\) >= drag\.w \* DRAG_COMMIT/.test(code));
ok('and a flick commits under it', /speed >= DRAG_FLICK/.test(code));
ok('and the end of the strip can only snap back', /Boolean\(drag\.to\)\s*\n?\s*&&/.test(code));

/* AND THE SETTLE READS THE STYLESHEET'S OWN CURVE, so a change there moves
   the drag with the click. A second copy of a curve drifts. */
ok('the curve is read, never restated', /getPropertyValue\('--ease-slide'\)/.test(code));
ok('and the stylesheet declares it',
  /--ease-slide: cubic-bezier\(0, 0, \.1, 1\)/.test(
    readFileSync(new URL('../styles.css', import.meta.url), 'utf8')));
ok('and the panel slide uses it',
  /animation-timing-function: var\(--ease-slide\)/.test(
    readFileSync(new URL('../styles.css', import.meta.url), 'utf8')));

/* THE SETTLE IS AS LONG AS THE DISTANCE LEFT, bounded. A page released one
   pixel from home does not need the full run to travel that pixel. */
ok('the settle is bounded at both ends',
  /Math\.min\(DRAG_MS_MAX, Math\.max\(DRAG_MS_MIN/.test(code));
ok('and reduced motion skips it', /calmly\(\) \? 0/.test(code));

/* A FILLED ANIMATION OUTLIVES THE STYLE IT REPLACED, AND IT PINNED THE WHOLE
   LIST OFF SCREEN. `fill: 'forwards'` holds the end frame, which is what
   stops a snap at the far end, and it also beats the inline transform.
   Clearing that alone left the panel where the animation had put it.

   A SNAP-BACK ENDS A WHOLE WIDTH AWAY, so it was invisible on a commit and
   total on a cancel. Measured at 375: the panel sat at x -327 with the right
   tab selected, so the reader had the correct tab and an empty screen.

   AND THE PROBE HAD CALLED IT CLEAN, because it read `style.transform`. An
   animation writes neither the inline style nor the stylesheet, so only the
   computed value answers. */
ok('the settle is cancelled once it lands', /runs\.forEach\(\(a\) => a\.cancel\(\)\)/.test(code));
{
  const end = code.indexOf('runs.forEach((a) => a.cancel())');
  const clear = code.indexOf("panel.style.transform = ''");
  ok('and before the inline transform is cleared', end > -1 && clear > end, `${end} against ${clear}`);
}

/* THE MARK CARRIES THE DIRECTION, because CSS cannot know which way the
   reader went. The strip reads left to right, so a later tab is 'next'. */
ok('the mark is the direction',
  /order\.indexOf\(tab\) > order\.indexOf\(was\) \? 'next' : 'prev'/.test(code));
ok('and the old tab is read before it is overwritten', /const was = tab;\s*\n\s*tab = next;/.test(code));
ok('dissolve is told which', /dissolve\([^)]*, kind\)/.test(code));

{
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

  /* ── THE LISTS SLIDE PAST EACH OTHER ──────────────────────────────────
   *
   * Their ask, 22 September 2026: "any chance we can have a left/right
   * sliding animation between the tabs instead of crossfading?"
   *
   * A SLIDE HAS TO NAME ITS OWN ANIMATION. The browser's default for these
   * two pseudo-elements is opacity, which is the cross-fade this replaces,
   * so a rule that set only a duration would still fade. */
  const slide = css.slice(css.indexOf('@keyframes tab-leave-left'),
    css.indexOf('@media (prefers-reduced-motion: reduce)') > css.indexOf('@keyframes tab-leave-left')
      ? css.indexOf('@media (prefers-reduced-motion: reduce)') : css.length);
  ok('the four travels are declared',
    ['tab-leave-left', 'tab-enter-right', 'tab-leave-right', 'tab-enter-left']
      .every((k) => css.includes(`@keyframes ${k}`)));
  /* ── ONLY THE PANEL MOVES ──────────────────────────────────────────────
   *
   * Their report, 22 September 2026: "why is it sliding the entire page? i
   * only want the section BELOW THE TABS to slide, not everything!"
   *
   * The name was on the ROOT, which is the whole document, so the title bar,
   * the tab strip and the footer travelled with the list. */
  const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  ok('the panel carries the name', /\.list-panel \{ view-transition-name: list-panel \}/.test(css));
  ok('and the markup has one', /id="listPanel" class="list-panel"/.test(markup));
  /* ── AN ABSENT MARKER IS NOT AN EARLY ONE ─────────────────────────────
   *
   * This compared two offsets. `indexOf` answers -1 when it finds nothing,
   * and -1 is before everything, so deleting the panel's closing tag passed
   * the check that exists to catch exactly that. Proven by removing it: the
   * run stayed green. Ask that each marker EXISTS, then compare. */
  const shuts = markup.indexOf('</div><!-- /#listPanel -->');
  const opens = markup.indexOf('id="listPanel"');
  const strip = markup.indexOf('class="tabs"');
  const foot = markup.indexOf('<footer id="sync-note">');
  ok('the panel opens and closes', opens >= 0 && shuts > opens, `${opens} then ${shuts}`);
  ok('the tab strip is outside it', strip >= 0 && strip < opens, `${strip} then ${opens}`);

  /* ── THE FOOTER TRAVELS WITH THE LIST ──────────────────────────────────
   *
   * I put it outside on the grounds that its words never change. That was
   * true and it was not the question: its POSITION changes, because it sits
   * under a panel whose height is different on every tab.
   *
   * Outside, it belonged to the picture that does not move. Measured at
   * 375x812 with no notes: it held at 2541 for the whole slide, then jumped
   * 1688px to 853. Their report: "the footer snaps up when the swipe is
   * completed on the empty page." */
  ok('the footer travels with the list', foot >= 0 && foot > opens && foot < shuts,
    `opens ${opens}, footer ${foot}, shuts ${shuts}`);

  /* ── THE PANEL IS THE COLUMN THAT FILLS THE PAGE ──────────────────────
   *
   * Wrapping the list broke the locked layout. `.table-wrap` takes `flex: 1`
   * from its parent, and its parent had been the shell. Measured at 1536x900
   * before the repair: the shell held its 900, the scroller sat at its
   * content height of 783, and the document scrolled to 1250 when a locked
   * app scrolls nothing. */
  /* EVERY RULE ON IT, NOT THE FIRST. One states the transition name and
     another the column, so a match that stops at the first reports the
     column missing while it sits twenty lines up. */
  const panelRule = [...css.matchAll(/\.list-panel \{[^}]*\}/g)].map((m) => m[0]).join('\n');
  ok('the panel is a column', /flex-direction: column/.test(panelRule), panelRule.slice(0, 70));
  ok('and it fills what is left', /flex: 1/.test(panelRule));
  /* `min-height: 0` is what lets a flex item shrink under its own content. */
  ok('and it may shrink under its content', /min-height: 0/.test(panelRule));

  /* ── THE FOOTER HUGS THE BOTTOM WHEN NOTHING SCROLLS ──────────────────
   *
   * Their idea, 22 September 2026. Measured at 375x1200 with no notes: the
   * page came to 979 and left 221px of empty screen under the footer. */
  const shellRule = (css.match(/\.shell \{[\s\S]*?\n\}/) || [''])[0];
  ok('the page fills the viewport', /min-height: 100dvh/.test(shellRule), shellRule.slice(-70));
  /* `min-height`, NEVER `height`. A long list has to grow past the viewport. */
  ok('and a long list still grows past it', !/\n  height: 100dvh/.test(shellRule));
  ok('the shell is a column', /flex-direction: column/.test(shellRule));

  const footRule = (css.match(/\nfooter \{[^}]*\}/) || [''])[0];
  ok('the footer takes the slack', /margin-block-start: auto/.test(footRule), footRule.slice(0, 70));
  /* AN AUTO MARGIN PUSHES AND PADDING SPACES. Stated as both, the margin
     collapses the moment the column fills and the footer touches the list. */
  ok('and its own distance is padding', /padding-block-start: var\(--space-xl\)/.test(footRule));
  ok('never a margin as well', !/margin-top: var\(--space/.test(footRule));
  /* AND THE TABS POINT AT IT. Every one carries `aria-controls="listPanel"`
     and no such element existed, so the reference went nowhere. */
  ok('it is the panel the tabs name', /role="tabpanel"/.test(markup));
  ok('and it says which tab it belongs to',
    /\$\('#listPanel'\)\?\.setAttribute\('aria-labelledby', `tab-\$\{tab\}`\)/.test(code));
  /* AND THE PAGE AROUND IT HOLDS STILL, rather than cross-fading against a
     picture identical to itself. */
  ok('the rest of the page does not animate',
    /\[data-vt="prev"\]::view-transition-new\(root\) \{ animation: none \}/.test(css));
  ok('nothing slides the root any more', !/view-transition-old\(root\) \{ animation-name: tab-/.test(css));

  /* THE CONTENT FOLLOWS THE FINGER. Their ask, 22 September 2026: reverse
     the slide. The first reading was the filmstrip, where a later tab moved
     the window right and the pages travelled left. This is the other
     convention. A swipe right still steps to a later tab. */
  ok('a later tab arrives from the left',
    /\[data-vt="next"\]::view-transition-new\(list-panel\) \{ animation-name: tab-enter-left \}/.test(css));
  ok('and the old one leaves to the right',
    /\[data-vt="next"\]::view-transition-old\(list-panel\) \{ animation-name: tab-leave-right \}/.test(css));
  ok('going back is the mirror',
    /\[data-vt="prev"\]::view-transition-new\(list-panel\) \{ animation-name: tab-enter-right \}/.test(css)
    && /\[data-vt="prev"\]::view-transition-old\(list-panel\) \{ animation-name: tab-leave-left \}/.test(css));
  /* AND THE TWO DIRECTIONS NEVER AGREE. A swap that touched one of the four
     lines would send both pictures the same way. */
  ok('the two directions are opposites',
    /"next"\]::view-transition-old\(list-panel\) \{ animation-name: tab-leave-right/.test(css)
    && /"prev"\]::view-transition-old\(list-panel\) \{ animation-name: tab-leave-left/.test(css));
  /* THE PANEL IS A DIFFERENT HEIGHT ON EVERY TAB, and the group animates
     between the two. Left to stretch, the old list squashes toward the new
     one's height while it slides. */
  ok('each picture keeps its own size', /object-fit: none/.test(slide) && /object-position: top left/.test(slide),
    slide.slice(0, 60));
  /* THE TRAVEL IS A WHOLE PAGE, so the distance is the whole width. */
  ok('each travels the full width',
    (css.match(/translateX\((?:-)?100%\)/g) || []).length === 4,
    String((css.match(/translateX\((?:-)?100%\)/g) || []).length));
  /* TWO SOLID PAGES, NEVER TWO HALF-TRANSPARENT ONES. The default blend for
     a cross-fade makes them glow where they overlap. */
  ok('the pages stay opaque', /mix-blend-mode: normal/.test(slide), slide.slice(0, 60));
  ok('and the end frame is held', /animation-fill-mode: both/.test(slide));

  /* THE PILL KEEPS PACE WITH THE PAGE. At the fold's 500ms it was still
     gliding under a list that had finished arriving. */
  ok('the pill matches the panel',
    /\[data-vt="next"\]::view-transition-group\(tab-pill\),[\s\S]{0,220}animation-duration: var\(--duration\)/.test(css));
  ok('and so does the panel itself',
    /\[data-vt="prev"\]::view-transition-group\(list-panel\)[\s\S]{0,80}animation-duration: var\(--duration\)/.test(css));
  ok('and the switch never takes the fold', !/data-vt[^\n]*\n?[^}]*--duration-fold/.test(css));

  /* ── A SLIDE IS TRAVEL, SO REDUCED MOTION GETS THE CROSS-FADE BACK ───── */
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  ok('reduced motion fades instead of moving',
    /view-transition-fade-out/.test(reduced) && /view-transition-fade-in/.test(reduced),
    reduced.slice(0, 80));
  ok('and the blend comes back with it', /mix-blend-mode: plus-lighter/.test(reduced));

  /* ── THE PILL'S NAME AND THE RULE THAT REMOVES IT MUST NAME ONE ELEMENT ──
   *
   * The name moved to the indicator when the bar became the only thing that
   * travels. The reduced-motion rule stayed on the tab, so it matched an
   * element carrying no name and removed nothing. A reader who asked for
   * less motion still got the glide, and nothing reported it: the rule was
   * live and it matched.
   *
   * ASK THAT THE TWO AGREE, rather than pinning either selector. Whichever
   * element carries the name is the one that has to give it up. */
  const named = (css.match(/([^\n{]+)\{\s*view-transition-name: tab-pill\s*\}/) || [])[1];
  const removed = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    .match(/([^\n{]+)\{\s*view-transition-name: none\s*\}/);
  ok('the pill states a name somewhere', Boolean(named), String(named));
  ok('and reduced motion takes it off the same element',
    Boolean(removed) && removed[1].trim() === named.trim(),
    `${named && named.trim()} against ${removed && removed[1].trim()}`);
}

/* AND A CLICK KEEPS IT, because a click carries no motion of its own. */
{
  const show = code.slice(code.indexOf('function showTab('),
    code.indexOf("$('.tabs').addEventListener('click'"));
  ok('the animation is on by default', /animate = true/.test(show), show.slice(0, 80));
  ok('and it is skipped when refused', /if \(animate\) \{\s*\n\s*dissolve\(/.test(show));
  ok('the plain path still renders', /else \{ render\(\);/.test(show));
  /* THE FOCUS STILL LANDS ON EITHER PATH, or the arrow keys lose their place
     the day somebody turns the animation off for them too. */
  ok('and it still focuses on the plain path',
    /else \{ render\(\); toTop\(\); if \(focus\)/.test(show));

  /* ── A SWITCH STARTS AT THE TOP OF THE NEW LIST ────────────────────────
   *
   * Their report: "when i switch to the Notes tab, the footer hangs lower
   * for a second, then jumps up." The scroll was kept. Measured: 900px down
   * the watchlist and switched, the page stayed at 900 on a list the reader
   * had not seen. On the empty notes tab it could not, so the browser
   * clamped it and the footer moved 223px under a picture that had not.
   *
   * BOTH SCROLLERS, because the app has two: the page below the height
   * floor, and the list inside it above one. */
  ok('the switch scrolls to the top', /const toTop = \(\) => \{/.test(show));
  ok('it resets the page', /document\.scrollingElement\.scrollTop = 0/.test(show));
  ok('and the list inside it', /wrap\) wrap\.scrollTop = 0/.test(show));
  /* IT RUNS ON BOTH PATHS, or a swipe and a tap disagree about where a list
     opens. */
  ok('the animated path resets too', /dissolve\(\(\) => \{ toTop\(\);/.test(show));
}

/* THE ARROWS ASK showTab DIRECTLY, and so does the drag. The stepper that
   passed a choice between them existed for a swipe that no longer needs it. */
ok('the arrows ask showTab directly',
  /\$\('\.tabs'\)\.addEventListener\('keydown'[\s\S]{0,420}showTab\(order\[/.test(code));

/* -- 7. The focus ring belongs to the keyboard ----------------------------- */
/* Their report: "there's a weird white rectangle showing up around the
   selected tab." showTab moved focus on every switch, and the shared ring is
   a 2px white outline. A pointer switch paints nothing, so it only showed on
   a swipe. */
{
  const show = code.slice(code.indexOf('function showTab('),
    code.indexOf("$('.tabs').addEventListener('click'"));
  ok('showTab was found', show.length > 200, String(show.length));
  /* ASK FOR THE FLAG, NOT THE WHOLE SIGNATURE. This named every argument, so
     adding `animate` beside `focus` failed a check about focus. */
  ok('it takes a focus flag that defaults to off', /focus = false/.test(show),
    show.slice(0, 80));
  ok('and only focuses when asked', /if \(focus\) \$\('#tab-' \+ tab\)\.focus\(\)/.test(show));

  /* AND IT FOCUSES THE TAB THAT IS CURRENT. The old line named youtube or
     links and never notes, so switching to Notes put the ring on YouTube. */
  ok('it focuses the current tab', /\$\('#tab-' \+ tab\)\.focus\(\)/.test(show), 'tab');
  ok('and names no tab by hand', !/tab === 'links' \? 'links' : 'youtube'/.test(show));

  /* THE ARROWS ASK FOR IT, because they move the selection without moving
     focus and a keyboard reader would lose their place. */
  /* READ THE KEYDOWN HANDLER, because the call carries brackets of its own
     and `[^)]*` cannot cross them. */
  const onKeys = code.slice(code.indexOf("$('.tabs').addEventListener('keydown'"));
  ok('the arrow keys ask for focus',
    onKeys.slice(0, 500).includes('{ focus: true }'), onKeys.slice(0, 60));
  /* AND NOTHING ELSE DOES. A click focuses the tab by itself, and a swipe is
     a pointer. */
  ok('nothing else asks for it',
    (code.match(/\{ focus: true \}/g) || []).length === 1,
    String((code.match(/\{ focus: true \}/g) || []).length));
}

/* -- 8. The sync mark turns while it is busy ------------------------------- */
/* Their instruction: have the sync icon rotate, or swap it for a turning
   throbber. No second icon, because the refresh mark is already a circle of
   arrows. */
{
  ok('driveStatus writes the busy mark',
    /toggleAttribute\('data-busy', state === 'busy'\)/.test(code));
  /* ONE WRITER. Every state passes through driveStatus, so the attribute
     cannot disagree with the words beside it. */
  ok('and nothing else writes it',
    (code.match(/data-busy/g) || []).length === 1,
    String((code.match(/data-busy/g) || []).length));
  ok('something still reports a wait', (code.match(/driveStatus\('busy'/g) || []).length >= 4,
    String((code.match(/driveStatus\('busy'/g) || []).length));

  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  ok('the mark turns', /#driveSync\[data-busy\] \.icon \{ animation: sync-turn/.test(css));
  ok('the turn is steady rather than eased', /sync-turn 1s linear infinite/.test(css));
  ok('and it loops', /sync-turn[^}]*infinite/.test(css));
  ok('the turn is a whole circle', /@keyframes sync-turn \{ to \{ rotate: 360deg \} \}/.test(css));
  /* THE MARK TURNS, NEVER THE BUTTON, or the label and the border turn too. */
  ok('the button itself does not turn', !/#driveSync\[data-busy\] \{[^}]*animation/.test(css));
  /* AND UNDER REDUCED MOTION IT STILL SAYS SOMETHING, rather than looking
     idle through the whole wait. */
  const reduce = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  ok('it fades where motion is refused', /#driveSync\[data-busy\] \.icon \{ animation: pulse/.test(reduce));
  ok('and the turn is behind no-preference',
    /no-preference\)[^@]*#driveSync\[data-busy\] \.icon \{ animation: sync-turn/.test(css));
}

/* -- 9. The markup still has three tabs to step between -------------------- */
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
