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
