#!/usr/bin/env node
/* THE ROUND TRIP HAS TO BE STABLE, OR A NOTE LOSES A LITTLE ON EVERY SAVE.
 *
 * The editor holds rich text and the file holds markdown, so every keystroke
 * ends in markdown and every open starts from it. A converter that is not
 * exactly reversible for the set the toolbar can write will drift: one save
 * turns `**a**` into `**a**`, the next into `****a****`, and nobody notices
 * until a note is unreadable.
 *
 * SO THE TEST IS md -> html -> md, and the second markdown must equal the
 * first. Every case here is something the toolbar can produce.
 *
 * IT RUNS IN PLAIN NODE, with a DOM small enough to read. jsdom would test
 * jsdom; this tests the reader against the shapes a browser actually hands
 * it, including the ones execCommand invents.
 */
import { readFileSync } from 'node:fs';
import { markdownToHtml, htmlToMarkdown, titleOf, looksLikeMarkdown, pasteToHtml, inlineToHtml }
  from '../notes.js';

/* ── A DOM, because the reader walks nodes ──────────────────────────────
 *
 * ENOUGH TO PARSE WHAT WE EMIT AND WHAT A BROWSER EMITS. Elements, text,
 * attributes and nesting. No entities beyond the four we escape, because
 * nothing here writes any others.
 */
const VOID = new Set(['br', 'hr', 'img']);

function parse(html) {
  const root = { nodeType: 1, tagName: 'DIV', childNodes: [], children: [], attrs: {} };
  const stack = [root];
  const text = String(html);
  let i = 0;

  const add = (node) => {
    const parent = stack[stack.length - 1];
    node.parentNode = parent;
    parent.childNodes.push(node);
    if (node.nodeType === 1) parent.children.push(node);
  };

  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) { addText(text.slice(i)); break; }
    if (lt > i) addText(text.slice(i, lt));
    const gt = text.indexOf('>', lt);
    if (gt < 0) { addText(text.slice(lt)); break; }
    const inner = text.slice(lt + 1, gt).trim();
    i = gt + 1;

    if (inner.startsWith('/')) {
      const name = inner.slice(1).trim().toLowerCase();
      for (let d = stack.length - 1; d > 0; d -= 1) {
        if (stack[d].tagName.toLowerCase() === name) { stack.length = d; break; }
      }
      continue;
    }

    const selfClose = inner.endsWith('/');
    const body = selfClose ? inner.slice(0, -1).trim() : inner;
    const name = (body.split(/\s/)[0] || '').toLowerCase();
    const attrs = {};
    for (const m of body.slice(name.length).matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) attrs[m[1]] = m[2];

    const node = {
      nodeType: 1,
      tagName: name.toUpperCase(),
      attrs,
      childNodes: [],
      children: [],
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
    };
    add(node);
    if (!selfClose && !VOID.has(name)) stack.push(node);
  }

  function addText(value) {
    if (!value) return;
    add({ nodeType: 3, nodeValue: decode(value), childNodes: [], children: [] });
  }
  return root;
}

const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&');

const toMd = (html) => htmlToMarkdown(parse(html));

/* ── Cases ──────────────────────────────────────────────────────────────── */

const cases = [];
const ok = (name, pass, note = '') => cases.push({ name, pass, note });
const same = (name, a, b) => ok(name, a === b, `${JSON.stringify(a)} against ${JSON.stringify(b)}`);

/* EVERY SHAPE THE TOOLBAR CAN WRITE, round-tripped. */
const round = [
  ['a paragraph', 'Just some words.'],
  ['two paragraphs', 'One line.\n\nTwo line.'],
  ['every heading level', '# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six'],
  ['bold', 'A **bold** word.'],
  ['italic', 'An *italic* word.'],
  ['strikethrough', 'A ~~struck~~ word.'],
  ['all three at once', '**Bold** and *italic* and ~~struck~~.'],
  ['a bulleted list', '- One\n- Two\n- Three'],
  ['a numbered list', '1. One\n2. Two\n3. Three'],
  ['a link', 'Read [the docs](https://example.org/a) today.'],
  ['a link with a mark inside', 'Read [**the docs**](https://example.org/a).'],
  ['a heading over a list', '## Shopping\n\n- Milk\n- Bread'],
  ['two lists of different kinds', '- One\n\n1. Two'],
  ['a mark inside a list item', '- A **bold** item'],
  /* THE MONO SET. Their instruction, 22 September 2026: the editor can
     switch between regular text and code text. Markdown offers two shapes
     and both are here. */
  ['a code span', 'Run `npm test` first.'],
  ['a code span holding a star', 'The glob is `*.js` here.'],
  ['a code span holding an underscore', 'Read `file_name` now.'],
  ['a code block', '\x60\x60\x60\nconst a = 1;\nconst b = 2;\n\x60\x60\x60'],
  ['a code block under a heading', '# Setup\n\n\x60\x60\x60\nnpm i\n\x60\x60\x60'],
  ['a code block holding markdown', '\x60\x60\x60\n# not a heading\n- not a list\n\x60\x60\x60'],
  ['a code block holding a blank line', '\x60\x60\x60\none\n\ntwo\n\x60\x60\x60'],
  ['prose after a code block', '\x60\x60\x60\ncode\n\x60\x60\x60\n\nAfter.'],
];

for (const [name, md] of round) same(`round trip: ${name}`, toMd(markdownToHtml(md)), md);

/* TWICE, because a converter can be wrong in a way one pass hides. */
for (const [name, md] of round) {
  const once = toMd(markdownToHtml(md));
  same(`stable on a second save: ${name}`, toMd(markdownToHtml(once)), once);
}

/* WHAT A BROWSER HANDS BACK, which is not what we wrote. */
same('a <b> is bold', toMd('<p>A <b>bold</b> word.</p>'), 'A **bold** word.');
same('an <i> is italic', toMd('<p>An <i>odd</i> word.</p>'), 'An *odd* word.');
same('an <s> is struck', toMd('<p>A <s>gone</s> word.</p>'), 'A ~~gone~~ word.');
same('a styled span is bold', toMd('<p>A <span style="font-weight: 700">bold</span> word.</p>'),
  'A **bold** word.');
same('a styled span is italic', toMd('<p>A <span style="font-style: italic">lean</span> word.</p>'),
  'A *lean* word.');
same('a styled span is struck',
  toMd('<p>A <span style="text-decoration: line-through">gone</span> word.</p>'), 'A ~~gone~~ word.');
same('an empty mark writes nothing', toMd('<p>Before<strong></strong>after</p>'), 'Beforeafter');
same('a space stays outside the marker', toMd('<p>a <strong>bold </strong>b</p>'), 'a **bold** b');
same('a div is a paragraph', toMd('<div>A line.</div><div>Another.</div>'), 'A line.\n\nAnother.');
same('a bare text node is a paragraph', toMd('Typed straight in.'), 'Typed straight in.');
same('a trailing break is dropped', toMd('<p>A line.</p><br>'), 'A line.');

/* THE SHAPE CHROME ACTUALLY PRODUCED. Pressing the bullet button inside a
   paragraph nested the list inside it, and the first reader flattened the
   whole thing to one line: "MilkBread". Copied out of the live editor. */
same('a list nested in a paragraph is still a list',
  toMd('<p><ul><li>Milk</li><li>Bread</li></ul></p>'), '- Milk\n- Bread');
same('a heading nested in a div is still a heading',
  toMd('<div><h2>Title</h2><p>Body</p></div>'), '## Title\n\nBody');
same('a paragraph beside a nested list keeps both',
  toMd('<p>Before<ul><li>One</li></ul></p>'), 'Before\n\n- One');
same('a list nested in a heading is a list, not a heading',
  toMd('<h1><ul><li>one</li><li>two</li></ul></h1>'), '- one\n- two');
same('a heading with only words is still a heading',
  toMd('<h1>Just a title</h1>'), '# Just a title');
same('a list inside a list item is not lost',
  toMd('<ul><li>One<ul><li>Deep</li></ul></li></ul>'), '- One\n- Deep');

/* TEXT THAT LOOKS LIKE A MARKER IS NOT A MARKER. */
same('arithmetic survives', toMd(markdownToHtml('2 \\* 3 \\* 4 is 24')), '2 \\* 3 \\* 4 is 24');
same('a stray underscore survives', toMd('<p>file_name_here</p>'), 'file\\_name\\_here');
ok('an unclosed marker is literal', inlineToHtml('a * b') === 'a * b', inlineToHtml('a * b'));
ok('four stars are not empty bold', !/<strong>/.test(inlineToHtml('****')), inlineToHtml('****'));

/* ── Code text ───────────────────────────────────────────────────────────
 *
 * A SNIPPET IS VERBATIM, which is the whole reason it exists. So nothing in
 * it is escaped, nothing in it is read as a marker, and a code block's line
 * breaks and blank lines are kept exactly.
 */
same('a code span survives untouched', toMd('<p>Run <code>a_b *c*</code> now.</p>'),
  'Run \x60a_b *c*\x60 now.');
same('a star in a code span stays a star',
  inlineToHtml('a \x60*b*\x60 c'), 'a <code>*b*</code> c');
same('a code span cannot inject markup',
  inlineToHtml('\x60<img src=x>\x60'), '<code>&lt;img src=x&gt;</code>');
same('an empty code span writes nothing', toMd('<p>a<code></code>b</p>'), 'ab');
/* THE FENCE GROWS PAST WHAT IS INSIDE IT, or the span closes early. */
ok('a span holding a backtick takes a longer fence',
  toMd('<p><code>a \x60 b</code></p>') === '\x60\x60a \x60 b\x60\x60',
  toMd('<p><code>a \x60 b</code></p>'));
ok('a block holding three backticks takes four',
  toMd('<pre><code>\x60\x60\x60</code></pre>').startsWith('\x60\x60\x60\x60'),
  toMd('<pre><code>\x60\x60\x60</code></pre>'));
/* A BLOCK IS NOT A SPAN, even though both are drawn in the mono face. */
ok('a code block reads as a block', /<pre><code>/.test(markdownToHtml('\x60\x60\x60\nx\n\x60\x60\x60')),
  markdownToHtml('\x60\x60\x60\nx\n\x60\x60\x60'));
same('a fence language is not kept', toMd(markdownToHtml('\x60\x60\x60js\nvar a;\n\x60\x60\x60')),
  '\x60\x60\x60\nvar a;\n\x60\x60\x60');
same('an unclosed fence still keeps its text', toMd(markdownToHtml('\x60\x60\x60\nhalf typed')),
  '\x60\x60\x60\nhalf typed\n\x60\x60\x60');
same('a code block keeps its indentation',
  toMd(markdownToHtml('\x60\x60\x60\nif (a) {\n  b();\n}\n\x60\x60\x60')),
  '\x60\x60\x60\nif (a) {\n  b();\n}\n\x60\x60\x60');
ok('code in pasted text is markdown', looksLikeMarkdown('run \x60npm i\x60'));
ok('a code block in pasted text is markdown', looksLikeMarkdown('\x60\x60\x60\nx\n\x60\x60\x60'));
/* THE TITLE IS WORDS, so a fence is never one. */
same('a code span in a title reads as its words', titleOf('# The \x60npm\x60 way'), 'The npm way');

/* A NOTE NAMES ITSELF. */
same('the first heading is the title', titleOf('# My note\n\nBody'), 'My note');
same('the first line is the title with no heading', titleOf('Just words\n\nmore'), 'Just words');
same('the marks come off the title', titleOf('## **Bold** title'), 'Bold title');
same('a link in the title reads as its words', titleOf('# See [the docs](https://x.y)'), 'See the docs');
same('a bullet is not part of the title', titleOf('- First item'), 'First item');
same('an empty note still has a name', titleOf('   \n\n  '), 'Untitled note');

/* PASTING. Their rule: plain text, unless the text itself holds markdown. */
ok('a heading in pasted text is markdown', looksLikeMarkdown('# Hello'));
ok('a bullet in pasted text is markdown', looksLikeMarkdown('- one\n- two'));
ok('bold in pasted text is markdown', looksLikeMarkdown('a **b** c'));
ok('a link in pasted text is markdown', looksLikeMarkdown('see [x](https://y.z)'));
ok('ordinary prose is not markdown', !looksLikeMarkdown('Just a sentence about 2 * 3.'));
ok('an empty paste is not markdown', !looksLikeMarkdown('   '));
same('pasted markdown becomes rich text', pasteToHtml('# Title'), '<h1>Title</h1>');
same('pasted prose keeps its lines', pasteToHtml('one\ntwo'), '<p>one<br>two</p>');
same('pasted prose keeps its paragraphs', pasteToHtml('one\n\ntwo'), '<p>one</p><p>two</p>');
ok('pasted text cannot inject markup', !pasteToHtml('<img src=x onerror=1>').includes('<img'),
  pasteToHtml('<img src=x onerror=1>'));
ok('markdown-shaped text cannot inject markup either',
  !pasteToHtml('# <img src=x onerror=1>').includes('<img'), pasteToHtml('# <img src=x onerror=1>'));

/* ── The add field writes a note ─────────────────────────────────────────
 *
 * Their instruction, 22 September 2026: the New Note field is identical to
 * the link field on the other two tabs. Typing a line and pressing Enter
 * opens that note in the editor. The button alone opens a blank one.
 *
 * THE ROUTE IS WHAT BREAKS SILENTLY. `addVideo` serves all three tabs, and
 * its second line returns early on an empty field. The notes branch has to
 * sit ABOVE that line, or the button with nothing typed does nothing at all
 * and no error says so.
 *
 * READ AS TEXT, because the route lives in a browser file that needs a DOM.
 * Comments are blanked first, or a rule quoted in prose reads as code.
 */
{
  /* A WRONG LINE NUMBER IS WORSE THAN NONE, so a comment is blanked rather
     than deleted. Nothing here reports a line, and the offsets below are
     compared against each other, so the lengths have to hold. */
  const blank = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));

  const app = blank(readFileSync(new URL('../app.js', import.meta.url), 'utf8'));
  const ui = blank(readFileSync(new URL('../notes-ui.js', import.meta.url), 'utf8'));
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

  const add = app.slice(app.indexOf('async function addVideo()'));
  const route = add.indexOf("tab === 'notes'");
  const bail = add.indexOf('if (!typed) return;');
  ok('the notes branch sits above the empty-field return',
    route > -1 && bail > -1 && route < bail, `${route} against ${bail}`);
  ok('the branch clears the field and calls newNote',
    /tab === 'notes'\)\s*\{[^}]*#videoUrl'\)\.value = ''[^}]*newNote\(typed\)/.test(add));

  /* THE SECOND BUTTON IS GONE FROM EVERY STORE. One left behind in the fade
     lists is a selector matching nothing, and one left in the markup is a
     control nothing shows.

     THE MARKUP SPELLS IT DIFFERENTLY, and asking for the selector there is a
     case that can never fire. An element writes `id="newNote"` with no hash,
     so putting the button back left this quiet. Proven by injection. */
  for (const [where, text, needle] of [['the markup', html, 'id="newNote"'],
    ['the stylesheet', css, '#newNote'], ['app.js', app, '#newNote'],
    ['notes-ui.js', ui, '#newNote']]) {
    const at = text.indexOf(needle);
    ok(`no ${needle} left in ${where}`, at < 0,
      at < 0 ? '' : text.slice(Math.max(0, at - 20), at + 30));
  }

  /* ONE FIELD, SO EVERY LIST STATES WHAT IT SAYS. A fourth list added
     tomorrow needs all three, and an empty placeholder is what the notes tab
     shipped while its field was hidden. */
  /* `const sorts`, WHICH IS THE NEXT TOP-LEVEL DECLARATION. `function inTab`
     read as the end and is written as a const arrow, so the slice came back
     empty and the three loops below reported 0 of 3 on correct code. */
  const specs = app.slice(app.indexOf('const LISTS'), app.indexOf('const sorts'));
  ok('the list specs were found', specs.length > 500, String(specs.length));
  for (const key of ['placeholder', 'fieldName', 'add']) {
    /* `\\b`, NOT `\b`. A template literal resolves every escape at parse
       time, so `\b` reaches the RegExp as a backspace character rather than
       as a word boundary. It matched nothing and reported 0 of 3 on correct
       code. Double every backslash inside a literal. */
    const found = [...specs.matchAll(new RegExp(`\\b${key}: '([^']*)'`, 'g'))].map((m) => m[1]);
    ok(`every list states its ${key}`, found.length === 3, `${found.length}: ${found.join(' | ')}`);
    ok(`no list leaves its ${key} empty`, found.every((v) => v.trim().length > 0), found.join(' | '));
  }

  /* THE TITLE IS DERIVED, NEVER STATED TWICE. newNote reads titleOf so the
     name cannot disagree with the body the editor shows. */
  ok('newNote takes a first line', /function newNote\(firstLine = ''\)/.test(ui));
  ok('and derives the title from the body', /title: NOTES\.titleOf\(body\)/.test(ui));
  ok('and waits for the lazy module', /async function newNote[\s\S]{0,400}await notesReady/.test(ui));

  /* AND titleOf ANSWERS BOTH CASES, which is why one writer is enough. */
  same('a typed line becomes the title', titleOf('Groceries for the weekend'),
    'Groceries for the weekend');
  same('an empty body falls back', titleOf(''), 'Untitled note');
  same('a blank run of spaces falls back too', titleOf('   '), 'Untitled note');
}

/* ── Verdict ────────────────────────────────────────────────────────────── */

let bad = 0;
for (const c of cases) {
  if (!c.pass) bad += 1;
  if (!c.pass) console.log(`notes guard: FAIL ${c.name} — ${c.note}`);
}
if (!cases.length) {
  console.error('notes guard: no cases ran, so nothing was measured');
  process.exit(1);
}
console.log(`notes guard: ${cases.length - bad} of ${cases.length} cases hold`);
process.exit(bad ? 1 : 0);
