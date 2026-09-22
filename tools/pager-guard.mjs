#!/usr/bin/env node
/* FIFTY ROWS DRAWN, AND EVERY RECORD STILL COUNTED.
 *
 * Their instruction, 21 September 2026: show about fifty entries at once and
 * put the rest behind a paginator, with every record still in memory so
 * search and filtering stay instant.
 *
 * SO THE PAGE IS NOT A FILTER, and that is the whole risk. Every count, the
 * runtime line, Select All and Delete Selected read the FILTERED set. Only
 * the rows drawn are cut. One reader that slices instead acts on fifty rows
 * and reports it as eight hundred.
 *
 * THE PAGE RESETS IN ONE PLACE. The tab, the sort, the search and the three
 * filters each change which records are shown. Written at six doors, the
 * seventh is the one that gets forgotten, so render() asks once, off a key.
 *
 * IT EVALUATES THE REAL FUNCTIONS, sliced out of app.js by name, so a
 * rewrite fails this rather than leaving a copy agreeing with itself.
 */
import { readFileSync } from 'node:fs';
import { build } from './slice-app.mjs';

const app = build(['PAGE_SIZE', 'pageKey', 'lastPage', 'clampPage'], {
  state: ['tab', 'sort', 'searchTerm', 'activeTags', 'untaggedOnly', 'ratingFilter'],
});

const cases = [];
const ok = (name, pass, note = '') => cases.push({ name, pass, note });
const same = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b),
  `${JSON.stringify(a)} against ${JSON.stringify(b)}`);

const fixture = () => {
  app.tab = 'youtube';
  app.sort = { key: 'addedAt', dir: -1 };
  app.searchTerm = '';
  app.activeTags = new Set();
  app.untaggedOnly = false;
  app.ratingFilter = 'any';
};

/* -- 1. Fifty is the size, and it is read rather than restated ----------- */
ok('the page holds fifty', app.PAGE_SIZE === 50, String(app.PAGE_SIZE));

/* -- 2. How many pages a list has ---------------------------------------- */
const { lastPage, PAGE_SIZE: N } = app;
same('an empty list is one page', lastPage(0), 1);
same('one row is one page', lastPage(1), 1);
same('a full page is one page', lastPage(N), 1);
same('one more is two pages', lastPage(N + 1), 2);
same('800 rows are 16 pages', lastPage(800), 16);
ok('no list is ever zero pages', [0, 1, 7, N, N + 1, 800, 12345]
  .every((n) => lastPage(n) >= 1));

/* THE LAST PAGE IS NEVER EMPTY. Every page but the last holds fifty, and the
   last holds what is left, which is at least one row. */
ok('the last page always holds a row', [1, 7, N, N + 1, 99, 100, 101, 800]
  .every((n) => n - (lastPage(n) - 1) * N >= 1));
ok('and never more than fifty', [1, 7, N, N + 1, 99, 100, 101, 800]
  .every((n) => n - (lastPage(n) - 1) * N <= N));

/* -- 3. Every row reaches exactly one page ------------------------------- */
{
  const rows = Array.from({ length: 800 }, (_, i) => i);
  const seen = [];
  for (let p = 1; p <= lastPage(rows.length); p += 1) {
    seen.push(...rows.slice((p - 1) * N, (p - 1) * N + N));
  }
  same('every row is drawn once, in order', seen, rows);
}

/* -- 4. The key changes when the list does, and not otherwise ------------ */
fixture();
const base = app.pageKey();
same('the same state is the same key', app.pageKey(), base);

const moves = {
  'a different tab': () => { app.tab = 'links'; },
  'a different sort key': () => { app.sort = { key: 'title', dir: -1 }; },
  'the other direction': () => { app.sort = { key: 'addedAt', dir: 1 }; },
  'a search': () => { app.searchTerm = 'cat'; },
  'a tag filter': () => { app.activeTags = new Set(['music']); },
  'the untagged filter': () => { app.untaggedOnly = true; },
  'a rating filter': () => { app.ratingFilter = 3; },
};
for (const [name, move] of Object.entries(moves)) {
  fixture();
  move();
  ok(`${name} is a new list`, app.pageKey() !== base, app.pageKey());
}

/* THE ORDER TAGS WERE PICKED IN IS NOT A NEW LIST. The set is sorted into
   the key, so picking two tags the other way round stays on the page. */
fixture();
app.activeTags = new Set(['music', 'talks']);
const two = app.pageKey();
fixture();
app.activeTags = new Set(['talks', 'music']);
same('the tag order is not a change', app.pageKey(), two);

/* AND A RECORD ARRIVING IS NOT A NEW LIST EITHER. A sync rewrites the array
   and changes none of these, so a reader stays on the page they were on. */
fixture();
same('a sync does not move the reader', app.pageKey(), base);

/* -- 5. Two ends and a field a reader types into ------------------------ */
/* Their instruction, 22 September 2026: "just give previous page and next
   page buttons (disabled on the first and last pages respectively), and add a
   little text box between them with the current page number, so that the user
   can type a number to jump to a page. no individual page numbers necessary."

   SO THE RUN OF BUTTONS IS GONE, and with it the gap mark and the rule about
   a gap standing for one page. A hundred pages is now three controls. */
const { clampPage } = app;
same('the page typed in is the page taken', clampPage('3', 10), 3);
same('one is the floor', clampPage('0', 10), 1);
same('and so is a negative', clampPage('-4', 10), 1);

/* A NUMBER PAST THE END IS THE END, NOT A REFUSAL. A reader who types 90 on a
   three-page list means the last page. Refusing leaves them where they were
   with nothing said, which reads as a control that does nothing. */
same('past the end is the end', clampPage('90', 3), 3);
same('the last page itself holds', clampPage('3', 3), 3);

/* AND NOTHING TYPED IS NOT PAGE ONE. Clearing the field and leaving it would
   otherwise throw the reader back to the start of the list. */
same('an empty field keeps the page', clampPage('', 10, 4), 4);
same('and so do words', clampPage('seven', 10, 4), 4);
same('and so does a bare sign', clampPage('-', 10, 4), 4);

/* A NUMBER WITH SOMETHING AFTER IT IS STILL THAT NUMBER. A finger on a phone
   keyboard adds a space often enough to matter. */
same('trailing space is ignored', clampPage(' 5 ', 10), 5);

/* AND A DECIMAL IS THE WHOLE PART. 2.9 is somebody typing 2 and slipping. */
same('a decimal takes its whole part', clampPage('2.9', 10), 2);

/* -- The two ends and the field are written in the markup, not by render -- */
/* A CONTROL REBUILT ON EVERY DRAW LOSES THE CARET. The list redraws on every
   page change, so a field written by innerHTML cannot be typed into. */
{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  ok('the field is in the markup', /id="pagerJump"/.test(html));
  ok('and both ends are too',
    /data-page="back"/.test(html) && /data-page="on"/.test(html));
  /* A FIELD WITH NO NAME IS A BOX NOBODY CAN IDENTIFY. It carries no visible
     label, so it takes one that is read aloud. */
  ok('the field carries a label',
    /<span class="sr-only">Page number<\/span>[\s\S]{0,300}id="pagerJump"/.test(html));
  /* A PHONE KEYBOARD OPENS ON DIGITS. `type="number"` would add two spinner
     arrows the row has no width for. */
  ok('it asks for the number keyboard', /inputmode="numeric"/.test(html));
  ok('and not the spinner', !/id="pagerJump"[^>]*type="number"/.test(html));

  const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  /* AN END KEEPS ITS PLACE IN THE TAB ORDER. `disabled` would take Previous
     out of reach on page one, so a keyboard reader could not learn which end
     they were at. */
  ok('the ends say their state rather than leaving', /setAttribute\('aria-disabled'/.test(src));
  ok('and none of them is disabled outright', !/pager-step[^\n]*\bdisabled\b/.test(src));
  /* THE FIELD IS LEFT ALONE WHILE IT IS BEING TYPED IN. Writing the number
     back under the caret is what makes a field impossible to edit. */
  ok('the render does not write over the caret',
    /document\.activeElement !== jump/.test(src));
  /* ENTER AND LEAVING BOTH TAKE IT. A reader who types and taps the list
     expects the number to have counted. */
  ok('Enter takes the number', /key !== 'Enter'/.test(src));
  ok('and so does leaving the field', /addEventListener\('blur', takeJump\)/.test(src));
  /* THE RUN OF PAGE BUTTONS IS GONE, not left beside the new shape. */
  ok('the run of page buttons is gone', !/pageRun/.test(src));
  ok('and its gap mark with it', !/pager-gap/.test(src));
}

/* -- The pager sits on the foot of the screen until the list runs out ----- */
/* Their ask, 22 September 2026: "can i have the paginator locked at the bottom
   of the pane? and when it scrolls to the absolute bottom of the list, it
   slides up, revealing the footer?"

   `position: sticky` WITH A BOTTOM INSET IS BOTH HALVES. A sticky box is
   pinned while its own place in the flow is off the bottom of the screen, and
   it lets go the moment that place arrives. Its place is directly above the
   footer, so the end of the list is exactly when it rises. */
{
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const rule = /\n\.pager \{([\s\S]*?)\n\}/.exec(css);
  ok('the pager rule was found', Boolean(rule));
  const body = rule ? rule[1] : '';

  ok('it is pinned to the foot', /position: sticky/.test(body) && /inset-block-end: 0/.test(body));
  /* AN OPAQUE FILL IS NOT OPTIONAL. A sticky box stays in flow, so the rows
     scroll UNDER it. The two bands at the top of the list take the same fill
     for the same reason. */
  ok('and it paints an opaque fill', /background: var\(--bg\)/.test(body));
  /* PINNED, THE BOX'S BOTTOM EDGE IS THE VIEWPORT EDGE. Without the page's
     own padding the buttons sit on the glass. */
  ok('and carries the page padding', /padding-block: var\(--space-md\) var\(--page-pad\)/.test(body));
  /* THE HAIRLINE THAT WAS HERE IS NOW A FADE, asserted further down. A line
     and a ramp on one edge is two treatments for one thing. */

  /* AND IT GOES BACK INTO FLOW WHERE THE APP LOCKS. There the list is its own
     scroller and the pager sits in a column that never scrolls.

     THE OVERRIDE HAS TO COME AFTER THE BASE RULE. A media query adds no
     specificity, so the later of two `.pager` rules wins. Written with the
     other two sticky boxes it lost: measured at 1536x900, the pager read
     `sticky` with the page's own padding on its foot while the app was
     locked. */
  const lock = css.lastIndexOf('@media (min-width: 1121px) and (min-height: 700px)');
  const base = css.indexOf('\n.pager {');
  ok('the locked override is there',
    /@media \(min-width: 1121px\)[\s\S]{0,400}\.pager \{\s*\n\s*position: static;/.test(css));
  ok('and it comes after the base rule', lock > base, `${lock} against ${base}`);
  ok('it gives the padding back', /\.pager \{\s*\n\s*position: static;\s*\n\s*padding-block: 0;/.test(css));
  ok('and the hairline with it', /\.pager::before \{ content: none \}/.test(css));
  /* BOTH BRANCHES OF THE LOCK, or a tall narrow window keeps a pinned pager
     inside a column that cannot scroll. */
  ok('both lock branches are named',
    /@media \(min-width: 1121px\) and \(min-height: 700px\),\s*\n\s*\(max-width: 1120px\) and \(min-width: 700px\) and \(min-height: 950px\) \{\s*\n\s*\.pager \{/.test(css));
}

/* -- The row holds on every page ----------------------------------------- */
/* Their report, 22 September 2026: "moving to a different page is causing the
   paginator to break into multiple lines."

   IT WAS ON THE EDGE AND THE PAGE NUMBER TIPPED IT. Measured at 375: the
   readout ran 191px on page one and 200 on page two, beside 188px of buttons
   in 343 of room. One extra digit decided whether the row held. */
{
  const src2 = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  /* SHORTENING IT WAS NOT ENOUGH. The width still moved with the page, so
     the row broke on some pages and not others. Measured at 375 over 137
     records: 117.13px on page one at 72px tall, 134.13 on page three at 102.

     THE RANGE IS GONE. The field beside it already says which page the reader
     is on. "137 videos" changes only when the list does. */
  ok('the readout is the total alone',
    /\$\('#pagerCount'\)\.textContent = `\$\{total\} \$\{noun\}`;/.test(src2));
  ok('and the range is not still there', !/\$\{from \+ 1\}-\$\{from \+ count\}/.test(src2));
  /* A CONSTANT COUNT ANNOUNCES NO PAGE CHANGE, so the page gets its own line
     with no width of its own. */
  ok('the page is still said aloud',
    /\$\('#pagerSaid'\)\.textContent = `Page \$\{page\} of \$\{last\}`;/.test(src2));
  /* THE LONG FORM IS GONE, not left beside it. */
  /* NO BACKTICK IN THE PATTERN. One on a line opens a template-literal region
     the syntax guard cannot close, and it read the comment after this as a
     block comment inside a string. The words alone are distinctive. */
  ok('and the long one is not still there', !/Showing \$\{from \+ 1\} to /.test(src2));
}

/* -- The rows fade into the pinned pager ---------------------------------- */
/* Their instruction, 22 September 2026: "that nice little fading gradient at
   the top of the scrolling pane also needs to be at the bottom of the pane,
   above the paginator, until it scrolls to the bottom."

   THE CUT MOVED WHEN THE PAGER BECAME STICKY. The page's own foot already
   carries this ramp, and the pager's opaque fill now sits over it. */
{
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const ramp = /\.pager::before \{([\s\S]*?)\n\}/.exec(css);
  ok('the ramp was found', Boolean(ramp));
  const body = ramp ? ramp[1] : '';

  ok('it sits directly above the pager', /inset-block-end: 100%/.test(body));
  /* IT MEASURES FROM THE FOOTER, NOT FROM THE PAGE. The pager lets go a whole
     footer before the page ends, so a ramp keyed on the page's own travel
     would still read full at that moment and vanish in one frame. */
  ok('and its height is the pager travel left', /height: var\(--pager-fade\)/.test(body));
  /* AND THE PAGE'S OWN FOOT STRIP GOES QUIET WHILE THE PAGER COVERS IT, or
     a 16px gradient paints over the buttons. The strip is fixed to the
     screen at a higher layer, so it wins wherever the two meet. */
  ok('the foot strip has its own number', /height: var\(--page-strip\)/.test(css));
  const src3 = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  ok('and it is zero while the pager is pinned',
    /--page-strip', pinned \? '0px'/.test(src3));
  ok('while the ramp is zero once the pager lets go',
    /--pager-fade[\s\S]{0,120}sticky \? /.test(src3) || /const toGo = sticky/.test(src3));
  /* THE SAME RAMP THE OTHER EDGES USE, reversed. Two shapes for one treatment
     would drift the first time either moved. */
  ok('it reuses the shipped ramp',
    /var\(--bg\) 87%[\s\S]{0,80}28%/.test(body) && /var\(--bg\) 40%[\s\S]{0,80}62%/.test(body));
  ok('and takes no press', /pointer-events: none/.test(body));
  /* THE HAIRLINE IT REPLACED IS GONE. A line and a fade on one edge is two
     treatments for one thing. */
  ok('the hairline is gone', !/\.pager::before \{[^}]*background: var\(--line-subtle\)/.test(css));
}

/* -- The empty box sits in the middle of the space it has ----------------- */
/* Their report, 22 September 2026, with a screenshot: "the 'your watchlist is
   clear' thing should be centered vertically inside the big blank area, not
   near its top edge. also, the empty box icon needs to be bigger, and there
   needs to be more padding below it."

   THE SCROLLER IS THE COLUMN, so the box can take the leftover. Measured at
   1536x900 after: 78px above the content and 78 below, 0.00 off centre. */
{
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

  ok('the scroller is a column', /\.table-wrap \{[\s\S]{0,900}display: flex;\s*\n\s*flex-direction: column;/.test(css));
  /* THE TABLE KEEPS ITS OWN HEIGHT. Left to shrink, a long list would be
     squeezed to fit the box rather than scrolling it. */
  ok('and the table keeps its own height', /\.table-wrap > table \{ flex: 0 0 auto \}/.test(css));

  const rule = /\n\.empty \{([\s\S]*?)\n\}/.exec(css);
  ok('the empty box rule was found', Boolean(rule));
  const body = rule ? rule[1] : '';
  ok('it takes the leftover', /flex: 1/.test(body));
  ok('and centres in it', /justify-content: center/.test(body));

  /* THE MARK IS AN ILLUSTRATION, NOT A MARK BESIDE A LABEL, so it takes a
     step from the space scale. The type scale stops at 24. */
  const mark = /\.empty \.icon \{([\s\S]*?)\n\}/.exec(css);
  ok('the mark rule was found', Boolean(mark));
  const markBody = mark ? mark[1] : '';
  ok('the mark is drawn at a published step',
    /width: var\(--space-3xl\);\s*\n\s*height: var\(--space-3xl\);/.test(markBody));
  ok('and stands clear of the words under it', /margin-block-end: var\(--space-sm\)/.test(markBody));
  ok('and neither is a typed number', !/\d+px/.test(markBody), markBody.replace(/\s+/g, ' ').slice(0, 70));

  /* AND THE LOADING OVERLAY'S OWN MARK TOO. */
  ok('the boot mark stands clear of its bar',
    /\.boot-mark \{[^}]*margin-block-end: var\(--space-sm\)/.test(css));

  /* THE ACTION STANDS 16px CLEAR OF THE WORDS, WHICH IS ONE NUMBER FROM TWO
     WRITERS. The column publishes 8 and the button used to state 16, and the
     two ADD, so it painted 24 on all three empty screens. Their call,
     22 September 2026: "keep it consistent."

     SO THE MARGIN CARRIES THE DIFFERENCE, and it is written as the
     subtraction rather than as the answer. Typed as 8 it would stop tracking
     either token. Measured after: 16.00 on the first-run screen, the
     no-results screen and the failure screen. */
  ok('the action reads the published step minus the column gap',
    /\.empty > \.btn, \.empty > \.btn-text \{\s*\n\s*margin-top: calc\(var\(--space-lg\) - var\(--space-sm\)\);/.test(css));
  /* A CHILD COMBINATOR, because the subtraction is about THIS parent. As a
     descendant it would fire on a button nested deeper, whose own parent
     publishes a different gap or none. */
  ok('and it names the direct child', !/\.empty \.btn,/.test(css));
  /* THE COLUMN IS THE OTHER HALF OF THE SUM, so it is pinned too. */
  ok('the column still publishes the small step',
    /\.empty \{[\s\S]{0,260}gap: var\(--space-sm\);/.test(css));
}

/* -- Verdict ------------------------------------------------------------- */
let bad = 0;
for (const c of cases) {
  if (!c.pass) { bad += 1; console.log(`pager guard: FAIL ${c.name} - ${c.note}`); }
}
if (!cases.length) {
  console.error('pager guard: no cases ran, so nothing was measured');
  process.exit(1);
}
console.log(`pager guard: ${cases.length - bad} of ${cases.length} cases hold`);
process.exit(bad ? 1 : 0);
