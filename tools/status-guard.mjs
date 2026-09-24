#!/usr/bin/env node
/* THE MESSAGE UNDER THE PASTE FIELD SAYS WHICH KIND IT IS.
 *
 * Their instruction, 22 September 2026: "each have an associated alert icon
 * (the error icons should be red, bad alerts should be orange, and the other
 * ones should be white), while the text itself should be white, so that it's
 * readable at smaller sizes. the grey looks fancy but offers little in the
 * way of visibility."
 *
 * THREE TONES, AND EACH ONE IS A SHAPE AS WELL AS A COLOUR. Colour alone
 * would leave a reader who cannot separate red from orange with one mark and
 * three meanings.
 */
import { readFileSync } from 'node:fs';
import { appSource, slice as sliceOne } from './slice-app.mjs';

const src = appSource();
const blank = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
const code = blank(src);
const at = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const html = at('../index.html');
const css = at('../styles.css');

const cases = [];
const ok = (name, pass, note = '') => cases.push({ name, pass, note });

/* -- 1. Three tones, three shapes ---------------------------------------- */
{
  ok('the three marks are named in one place',
    /const STATUS_MARK = \{ error: '#i-alert', warn: '#i-warn', info: '#i-info' \};/.test(code));

  /* A SHAPE NOBODY DREW IS A MARK THAT PAINTS NOTHING. Two of the three were
     added for this, so the set has to carry them. */
  for (const id of ['i-alert', 'i-warn', 'i-info']) {
    ok(`the set holds ${id}`, html.includes(`<symbol id="${id}"`), id);
  }

  /* AND THE THREE ARE DIFFERENT DRAWINGS. Two tones sharing one glyph would
     leave the colour carrying the whole difference. */
  const shape = (id) => {
    const m = new RegExp(`<symbol id="${id}"[\\s\\S]*?</symbol>`).exec(html);
    return m ? m[0].replace(/id="[^"]*"/, '') : '';
  };
  const drawings = ['i-alert', 'i-warn', 'i-info'].map(shape);
  ok('no two tones share a drawing', new Set(drawings).size === 3,
    String(new Set(drawings).size));
}

/* -- 2. The tone reaches the mark ---------------------------------------- */
{
  const fn = sliceOne(code, 'say');
  ok('the writer takes a tone', /function say\(text, \{ markup = false, tone = 'info'(?:, sticky = false)? \} = \{\}\)/.test(fn));
  ok('the row carries it', /row\.dataset\.tone = STATUS_MARK\[tone\] \? tone : 'info';/.test(fn));
  ok('and the mark is swapped', /\$\('#statusMarkUse'\)\.setAttribute\('href', STATUS_MARK\[tone\] \|\| STATUS_MARK\.info\);/.test(fn));
  /* AN UNKNOWN TONE IS NOT A BLANK MARK. A typo in a caller would otherwise
     point the mark at nothing and paint an empty box. */
  ok('an unknown tone falls back to a fact', /STATUS_MARK\[tone\] \|\| STATUS_MARK\.info/.test(fn));
}

/* -- 3. Every failure says so -------------------------------------------- */
/* AN ERROR THAT LOOKS LIKE A FACT IS THE ONE MESSAGE THIS IS FOR. Each of
   these is a thing that failed and the reader has to act on. */
{
  const errors = [
    "say(error.message || 'Could not add that link.', { tone: 'error' });",
    "say(`The installer could not be found: ${error.message}.`, { tone: 'error' });",
    "say(describeLinkFailure(arriving.get('reason') || ''), { tone: 'error' });",
    "say('Profiler failed: ' + error.message, { tone: 'error' })",
  ];
  for (const line of errors) {
    ok(`it is red: ${line.slice(4, 44)}`, code.includes(line), line.slice(0, 60));
  }

  /* THE THREE BARE ONES SHARE A SPELLING, so they are counted rather than
     quoted. A new `say(error.message)` with no tone reads as a fact. */
  const bare = (code.match(/say\(error\.message\);/g) || []).length;
  ok('no failure is left untoned', bare === 0, `${bare} left`);
  /* TWO LITERAL SITES NOW, NOT THREE. The pull and the push failed with the
     same two lines, so they share syncFailed() since 24 September 2026. That
     is one site standing for two callers, and both callers are counted. */
  const toned = (code.match(/say\(error\.message, \{ tone: 'error' \}\);/g) || []).length;
  ok('and both sites carry the tone', toned === 2, String(toned));
  const shared = (code.match(/syncFailed\(error\);/g) || []).length;
  ok('and the shared one serves the pull and the push', shared === 2, String(shared));
}

/* -- 4. A reduced success warns ------------------------------------------ */
/* IT WORKED, IN A REDUCED WAY. A row with no details, a bookmark with no
   title, and a build with no API key each ask the reader for something. */
{
  ok('a row waiting for details warns',
    /say\('Added\. The details arrive when a connection does\.', \{ tone: 'warn' \}\)/.test(code));
  ok('a bookmark waiting for a title warns',
    /\{ tone: waiting \? 'warn' : 'info' \}/.test(code));
  ok('and a build with no key warns',
    /\{ markup: data\.limited, tone: data\.limited \? 'warn' : 'info' \}/.test(code));
  /* THE MARKUP FLAG MOVED INTO THE OPTIONS, so the one caller that passes it
     cannot be read as a tone. */
  ok('the markup caller states it by name', /markup: data\.limited/.test(code));
}

/* -- 5. The words are white, and the mark is not ------------------------- */
{
  /* Measured on the card at 12px: the muted grey read 6.85:1 and the page's
     own text reads 15.72. */
  ok('the message takes the page text colour',
    /\.status-row \.hint \{[^}]*color: var\(--text\)/.test(css));

  /* THE MARK READS ITS TONE FROM THE ROW, so one attribute paints it. */
  for (const [tone, token] of [['error', '--danger'], ['warn', '--warn'], ['info', '--text']]) {
    ok(`${tone} paints ${token}`,
      new RegExp(`\\.status-row\\[data-tone="${tone}"\\] \\.status-mark \\{ color: var\\(${token}\\) \\}`).test(css), token);
  }
  /* AND NONE OF THE THREE IS A LITERAL. A colour typed here is a fourth
     value nobody can change from the palette. */
  ok('no tone states a literal colour',
    !/\.status-row\[data-tone[^}]*#[0-9a-f]{3,8}/i.test(css));

  /* IT SITS ON THE MESSAGE'S FIRST LINE, which is the lift every mark beside
     a label takes here. Measured: 2.31px above the cap and 2.69 below the
     baseline, 0.38 off centre. */
  ok('the mark sits on the first line', /\.status-mark \{[^}]*align-self: baseline/.test(css));
  ok('and takes the cap-band lift',
    /\.status-mark \{[^}]*transform: translateY\(calc\(\(100% - var\(--cap-ratio\) \* 1em\) \/ 2\)\)/.test(css));
  ok('and is drawn at the published mark size',
    /\.status-mark \{[^}]*width: var\(--mark\);[^}]*height: var\(--mark\);/.test(css));

  /* THE MARK IS NOT IN THE LIVE REGION. The words beside it already say what
     happened, and the region would otherwise announce a shape. */
  ok('the mark is out of the accessibility tree',
    /<svg class="icon status-mark" aria-hidden="true">/.test(html));
  ok('and the words are the live region', /<p id="addStatus" class="hint" role="status">/.test(html));
}

/* -- Verdict -------------------------------------------------------------- */
let bad = 0;
for (const c of cases) {
  if (!c.pass) { bad += 1; console.log(`status guard: FAIL ${c.name} - ${c.note}`); }
}
if (!cases.length) {
  console.error('status guard: no cases ran, so nothing was measured');
  process.exit(1);
}
console.log(`status guard: ${cases.length - bad} of ${cases.length} cases hold`);
process.exit(bad ? 1 : 0);
