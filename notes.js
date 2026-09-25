/* ==========================================================================
   Markdown in, rich text out, and back again

   THE NOTE IS THE FILE. Their choice: a rich editor with markdown
   underneath. So this converts both ways, and the round trip has to be
   stable or a note loses a little of itself on every save.

   THE SUPPORTED SET IS EXACTLY WHAT THE TOOLBAR OFFERS, and nothing else.
   Six heading levels, paragraphs, bold, italic, strikethrough, bulleted and
   numbered lists, and links. A converter that reads more than the editor can
   write is a converter with untested branches.

   NO DEPENDENCY, because this repo has none. That is also why the parser is
   a line walker rather than a grammar: the set is small enough to read in
   one sitting, and a small honest parser beats a large borrowed one nobody
   here can debug.

   IT LIVES IN ITS OWN FILE so a plain Node test can import it. A converter
   proven only through a browser is a converter proven on one engine.
   ========================================================================== */

/* ── Escaping ───────────────────────────────────────────────────────────── */

const HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => HTML[c]);

/* A MARKER IN THE TEXT IS NOT A MARKER. Somebody writing "2 * 3 * 4" means
   arithmetic, and the round trip has to give it back unchanged. Only the
   characters this file can emit are escaped, so a note holding a stray
   underscore keeps it. */
const escMd = (s) => String(s).replace(/([\\`*_~[\]])/g, '\\$1');
const unescMd = (s) => String(s).replace(/\\([\\`*_~[\]])/g, '$1');

/* ── Markdown to HTML ───────────────────────────────────────────────────── */

/* THE INLINE PASS RUNS ON ESCAPED TEXT, so a note cannot inject markup. It
   walks once and takes the longest marker first: `**` before `*`, or bold
   would come out as two italics wrapping nothing. */
export function inlineToHtml(text) {
  const out = [];
  const src = String(text);
  let i = 0;
  let plain = '';

  const flush = () => { if (plain) { out.push(esc(unescMd(plain))); plain = ''; } };

  while (i < src.length) {
    const rest = src.slice(i);

    /* An escaped marker is a character, so it never opens anything. */
    if (rest[0] === '\\' && rest.length > 1) { plain += rest.slice(0, 2); i += 2; continue; }

    const link = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      flush();
      out.push(`<a href="${esc(link[2])}">${inlineToHtml(link[1])}</a>`);
      i += link[0].length;
      continue;
    }

    /* CODE IS LITERAL, so nothing inside it opens anything else. A star in a
       snippet is a star, which is why this is read before the emphasis
       markers. The fence is a run of backticks and the closer is a run of
       the same length, so a snippet holding one can still be written.

       \x60 IS A BACKTICK, WRITTEN AS AN ESCAPE ON PURPOSE. A lone backtick
       makes this file's count odd, and the syntax guard reads an odd count
       as a template literal left open. */
    const span = /^(\x60+)([^\n]*?)\1(?!\x60)/.exec(rest);
    if (span && span[2].trim()) {
      flush();
      out.push(`<code>${esc(span[2].trim())}</code>`);
      i += span[0].length;
      continue;
    }

    const pair = [['**', 'strong'], ['~~', 'del'], ['*', 'em'], ['_', 'em']]
      .find(([mark]) => rest.startsWith(mark));
    if (pair) {
      const [mark, tag] = pair;
      const close = findClose(rest, mark);
      if (close > 0) {
        flush();
        out.push(`<${tag}>${inlineToHtml(rest.slice(mark.length, close))}</${tag}>`);
        i += close + mark.length;
        continue;
      }
    }

    plain += rest[0];
    i += 1;
  }
  flush();
  return out.join('');
}

/* THE CLOSER IS THE FIRST ONE THAT IS NOT ESCAPED, and never at distance
   zero: `****` is four characters somebody typed, not empty bold. */
function findClose(rest, mark) {
  for (let i = mark.length; i <= rest.length - mark.length; i += 1) {
    if (rest[i] === '\\') { i += 1; continue; }
    if (rest.startsWith(mark, i)) return i > mark.length ? i : -1;
  }
  return -1;
}

/* THE BLOCK PASS IS A LINE WALKER. Each line either continues the block it
   is in or starts a new one, which is the whole of the supported set. */
export function markdownToHtml(md) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let list = null;      // 'ul' or 'ol' while one is open
  let para = [];
  let fence = null;     // the opening run of backticks while a block is open
  let code = [];

  const closePara = () => {
    if (!para.length) return;
    out.push(`<p>${inlineToHtml(para.join(' '))}</p>`);
    para = [];
  };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const close = () => { closePara(); closeList(); };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    /* THE FENCE IS ASKED FIRST, because everything inside it is verbatim. A
       blank line, a star and a hash are all plain text in a code block, and
       every rule below would read them as structure. */
    const edge = /^(\x60{3,})\s*\S*\s*$/.exec(line.trim());
    if (fence) {
      if (edge && edge[1].length >= fence.length) { out.push(codeBlock(code)); fence = null; code = []; }
      else code.push(raw);
      continue;
    }
    if (edge) { close(); fence = edge[1]; code = []; continue; }

    if (!line.trim()) { close(); continue; }

    const head = /^(#{1,6})\s+(.*)$/.exec(line);
    if (head) {
      close();
      out.push(`<h${head[1].length}>${inlineToHtml(head[2])}</h${head[1].length}>`);
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const number = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || number) {
      const want = bullet ? 'ul' : 'ol';
      closePara();
      if (list && list !== want) closeList();
      if (!list) { out.push(`<${want}>`); list = want; }
      out.push(`<li>${inlineToHtml((bullet || number)[1])}</li>`);
      continue;
    }

    closeList();
    para.push(line.trim());
  }
  /* AN UNCLOSED FENCE IS STILL A CODE BLOCK. Somebody typing one has not
     finished it yet, and dropping the lines would lose what they wrote. */
  if (fence) out.push(codeBlock(code));
  close();
  return out.join('');
}

const codeBlock = (lines) => `<pre><code>${esc(lines.join('\n'))}</code></pre>`;

/* ── HTML to markdown ───────────────────────────────────────────────────── */

/* WHAT THE EDITOR PRODUCES IS NOT WHAT WE WROTE. A browser answers a bold
   command with `<b>`, `<strong>` or a styled span depending on its version
   and its mood, so the reader here asks what a node MEANS rather than which
   tag it is. */
const MEANS = {
  strong: 'strong', b: 'strong',
  em: 'em', i: 'em',
  del: 'del', s: 'del', strike: 'del',
};

function meaning(el) {
  const tag = el.tagName.toLowerCase();
  if (MEANS[tag]) return MEANS[tag];
  /* A SPAN CARRYING THE STYLE IS THE SAME INSTRUCTION. execCommand writes
     these when styleWithCSS is on, and a converter that reads tags alone
     loses every one of them. */
  const style = el.getAttribute('style') || '';
  if (/font-weight:\s*(bold|[6-9]00)/.test(style)) return 'strong';
  if (/font-style:\s*italic/.test(style)) return 'em';
  if (/text-decoration[^;]*line-through/.test(style)) return 'del';
  return null;
}

const MARK = { strong: '**', em: '*', del: '~~' };

function inlineToMd(node) {
  if (node.nodeType === 3) return escMd(node.nodeValue);
  if (node.nodeType !== 1) return '';

  const tag = node.tagName.toLowerCase();
  if (tag === 'br') return '\n';

  /* A CODE SPAN'S TEXT IS VERBATIM, so it is never escaped and never read
     for markers. The fence is one backtick longer than the longest run
     inside it, which is how a snippet holding one survives the round trip.
     A space pads it where the text starts or ends with a backtick, or the
     two runs would join and the span would close in the wrong place. */
  if (tag === 'code') return codeSpan(rawText(node));

  const inner = [...node.childNodes].map(inlineToMd).join('');

  if (tag === 'a') {
    const href = node.getAttribute('href') || '';
    return href ? `[${inner}](${href})` : inner;
  }

  const means = meaning(node);
  if (!means) return inner;

  /* AN EMPTY MARK IS NOT A MARK. A browser leaves `<strong></strong>`
     behind when somebody deletes the letters inside it, and writing `****`
     would make the next read see a literal. */
  if (!inner.trim()) return inner;

  /* THE SPACE STAYS OUTSIDE THE MARKER, or `** bold **` is not bold in any
     reader. A browser puts it inside whenever a selection includes one. */
  const lead = /^\s*/.exec(inner)[0];
  const tail = /\s*$/.exec(inner)[0];
  const core = inner.slice(lead.length, inner.length - tail.length);
  return `${lead}${MARK[means]}${core}${MARK[means]}${tail}`;
}

/* THE TEXT INSIDE A NODE, WALKED RATHER THAN ASKED FOR. `textContent` is a
   DOM property, and this file is read by a plain Node test whose nodes carry
   only what the walker needs. A converter that asks for one property the
   test cannot supply is a converter proven on one engine. */
function rawText(node) {
  if (node.nodeType === 3) return String(node.nodeValue ?? '');
  if (node.nodeType !== 1) return '';
  if (node.tagName.toLowerCase() === 'br') return '\n';
  return [...node.childNodes].map(rawText).join('');
}

/* ONE WRITER FOR THE FENCE LENGTH. A span and a block both need a run longer
   than anything inside them, and two implementations of that would drift. */
const longestRun = (text) => (String(text).match(/\x60+/g) || [])
  .reduce((n, run) => Math.max(n, run.length), 0);

function codeSpan(text) {
  /* THE ZERO-WIDTH CHARACTER COMES OUT. The editor puts one inside a new
     empty code element so the caret has somewhere to sit, and it is not
     whitespace to `trim`, so an untouched span would write a fence around
     an invisible character. */
  const flat = String(text).replace(/​/g, '').replace(/\s+/g, ' ');
  if (!flat.trim()) return '';
  const bar = '\x60'.repeat(longestRun(flat) + 1);
  const pad = /^\x60|\x60$/.test(flat) ? ' ' : '';
  return `${bar}${pad}${flat}${pad}${bar}`;
}

const BLOCKS = new Set(['p', 'div', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'section', 'article', 'pre']);

/* A BLOCK INSIDE A BLOCK IS WHAT A BROWSER ACTUALLY PRODUCES, and reading
   the outer one as inline flattens everything in it. Measured in Chrome:
   pressing the bullet button inside a paragraph gave `<p><ul><li>Milk</li>
   <li>Bread</li></ul></p>`, and the reader wrote "MilkBread" as one line.
   So a container is descended into rather than flattened. */
const holdsBlocks = (el) => [...el.children]
  .some((child) => BLOCKS.has(child.tagName.toLowerCase()));

export function htmlToMarkdown(root) {
  const out = [];

  const walk = (parent) => {
    for (const node of parent.childNodes) {
      if (node.nodeType === 3) {
        /* A BARE TEXT NODE IS A PARAGRAPH. An empty editor that somebody
           types into gives one of these before any block exists. */
        const text = escMd(node.nodeValue).trim();
        if (text) out.push(text, '');
        continue;
      }
      if (node.nodeType !== 1) continue;

      const tag = node.tagName.toLowerCase();
      if (tag === 'br') continue;

      /* A CODE BLOCK IS A FENCE, AND ITS TEXT IS VERBATIM. Nothing in it is
         escaped, nothing in it is read for markers, and the line breaks are
         the whole point, so they are kept. */
      if (tag === 'pre') {
        const text = rawText(node).replace(/\r\n?/g, '\n').replace(/\n+$/, '');
        const bar = '\x60'.repeat(Math.max(3, longestRun(text) + 1));
        out.push(bar, ...(text ? text.split('\n') : []), bar, '');
        continue;
      }

      /* A HEADING HOLDING BLOCKS IS MALFORMED, AND THE BLOCKS WIN. An editor
         produces this whenever a paste lands inside a heading that was left
         behind by a delete. Measured: `<h1><ul><li>one</li></ul></h1>` read
         as "# onetwo", so a pasted list became a heading with no list in it.
         The check comes first, because a real heading never holds one. */
      const head = /^h([1-6])$/.exec(tag);
      if (head && !holdsBlocks(node)) {
        const text = inlineToMd(node).trim();
        if (text) out.push(`${'#'.repeat(Number(head[1]))} ${text}`, '');
        continue;
      }

      if (tag === 'ul' || tag === 'ol') {
        let n = 0;
        for (const li of node.children) {
          if (li.tagName.toLowerCase() !== 'li') continue;
          n += 1;
          /* A NESTED LIST IS NOT SUPPORTED AND MUST NOT BE LOST. Its items
             come up to this level rather than vanishing into the parent
             item's text, which is what flattening did. */
          const nested = [...li.children].filter((c) => ['ul', 'ol'].includes(c.tagName.toLowerCase()));
          const body = nested.length
            ? inlineToMd({ ...li, childNodes: [...li.childNodes].filter((c) => !nested.includes(c)) }).trim()
            : inlineToMd(li).trim();
          if (body) out.push(tag === 'ul' ? `- ${body}` : `${n}. ${body}`);
          for (const inner of nested) walk({ childNodes: [inner] });
        }
        out.push('');
        continue;
      }

      if (holdsBlocks(node)) { walk(node); continue; }

      const text = inlineToMd(node).trim();
      if (text) out.push(text, '');
    }
  };

  walk(root);

  return tidy(out);
}

/* One blank line between blocks, none at either end.

   IT SKIPS INSIDE A FENCE, because a code block may hold two blank lines on
   purpose and collapsing them changes what it says. A text pass over the
   whole thing could not tell the two cases apart. */
function tidy(lines) {
  const out = [];
  let fence = null;

  for (const line of lines.join('\n').split('\n')) {
    const edge = /^(\x60{3,})/.exec(line);
    if (fence) {
      out.push(line);
      if (edge && edge[1].length >= fence.length) fence = null;
      continue;
    }
    if (edge) { fence = edge[1]; out.push(line); continue; }
    if (!line.trim() && (!out.length || !out[out.length - 1].trim())) continue;
    out.push(line);
  }

  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join('\n');
}

/* ── The list's own title ───────────────────────────────────────────────── */

/* A NOTE HAS NO TITLE FIELD, SO THE DOCUMENT NAMES ITSELF. The first heading
   is the title if there is one, and the first line of text otherwise. One
   source of truth, and the export is exactly the note.

   AN EMPTY NOTE IS STILL A NOTE and still needs a name in the list. */
export function titleOf(md, fallback = 'Untitled note') {
  for (const raw of String(md ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const head = /^#{1,6}\s+(.*)$/.exec(line);
    const text = unescMd(head ? head[1] : line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''))
      /* \x60 IS A BACKTICK, WRITTEN AS AN ESCAPE ON PURPOSE. A lone backtick
         in this file makes the count odd, and the syntax guard reads an odd
         count as a template literal left open. It refused this file. */
      .replace(/\*\*|~~|[*_\x60]/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .trim();
    if (text) return text;
  }
  return fallback;
}

/* ── Markdown to plain text ─────────────────────────────────────────────
 *
 * THEIR INSTRUCTION, 22 September 2026: the TXT download strips all
 * formatting and offers a barebones file.
 *
 * SO THE MARKUP GOES AND THE CONTENT STAYS. A star, a hash and a backtick
 * are formatting. A link's address is not: it is the one thing in a note
 * that cannot be worked out from what is left, so it is kept in brackets
 * after the words. A bullet keeps a dash and a numbered item keeps its
 * number, because a list with neither is a run of lines nobody can read.
 */
export function markdownToText(md) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let fence = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const edge = /^(\x60{3,})\s*\S*\s*$/.exec(line.trim());

    /* A CODE BLOCK IS ALREADY PLAIN TEXT. Only its fence comes off, and the
       indentation inside it is what the code MEANS. */
    if (fence) {
      if (edge && edge[1].length >= fence.length) fence = null;
      else out.push(raw);
      continue;
    }
    if (edge) { fence = edge[1]; continue; }

    const head = /^#{1,6}\s+(.*)$/.exec(line);
    if (head) { out.push(inlineToText(head[1])); continue; }

    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) { out.push(`${bullet[1]}- ${inlineToText(bullet[2])}`); continue; }

    const number = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
    if (number) { out.push(`${number[1]}${number[2]}. ${inlineToText(number[3])}`); continue; }

    out.push(inlineToText(line));
  }

  /* One blank line between blocks, none at either end, the same shape the
     Markdown itself keeps. */
  const tidied = [];
  for (const line of out) {
    if (!line.trim() && (!tidied.length || !tidied[tidied.length - 1].trim())) continue;
    tidied.push(line);
  }
  while (tidied.length && !tidied[tidied.length - 1].trim()) tidied.pop();
  return tidied.join('\n');
}

/* THE MARKS COME OFF AND THE WORDS STAY. A link keeps its address after its
   words, unless the words ARE the address and repeating it says nothing. */
function inlineToText(text) {
  return unescMd(String(text)
    .replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (m, words, href) => (
      words.trim() && words.trim() !== href ? `${words} (${href})` : href))
    .replace(/(\x60+)([^\n]*?)\1/g, '$2')
    .replace(/\*\*([^\n]*?)\*\*/g, '$1')
    .replace(/~~([^\n]*?)~~/g, '$1')
    .replace(/(?<!\\)[*_](\S[^\n]*?)(?<!\\)[*_]/g, '$1'));
}

/* ── One note as its own page ───────────────────────────────────────────
 *
 * THEIR INSTRUCTION, 22 September 2026: the HTML download renders the
 * Markdown, on a dark background identical to Yeetlist's own, using system
 * fonts. Segoe UI and Consolas on Windows, and whatever each other
 * operating system supplies.
 *
 * SO THE FONT STACK NAMES WINDOWS FIRST AND FALLS THROUGH. Segoe UI only
 * exists on Windows, so naming it costs nothing anywhere else, and
 * `system-ui` behind it is each platform's own default by definition. No
 * web font is loaded: the file has to open with no network at all.
 *
 * THE COLOURS ARE WRITTEN IN, because a downloaded file carries no
 * stylesheet. They are Yeetlist's own tokens, and the drift check in
 * `tools/export-guard.mjs` reads them back out of styles.css.
 */
export function noteToHtmlPage(title, md) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || 'Untitled note')}</title>
<style>
:root {
  color-scheme: dark;
  --bg: #0f0f0f;
  --surface: #181818;
  --sunken: #111111;
  --line: #303030;
  --line-subtle: #282828;
  --text: #f1f1f1;
  --muted: #a8a8a8;
  --accent: #ff0044;
  --body: "Segoe UI", system-ui, -apple-system, sans-serif;
  --mono: Consolas, ui-monospace, SFMono-Regular, Menlo, monospace;
}
* { box-sizing: border-box }
body {
  margin: 0;
  padding: 32px 16px 48px;
  background: var(--bg);
  color: var(--text);
  font-family: var(--body);
  font-size: 16px;
  line-height: 1.5;
}
/* ONE MEASURE, ONE OWNER. The footer sits under the note, so it shares the
   note's own left margin rather than the page's.

   A ch RESOLVES AGAINST THE ELEMENT'S OWN FONT, so the measure cannot sit on
   both boxes. Stated on each, the 12px footer got a 72ch of its own and came
   out 77.63px inside the note's left edge. The wrapper carries it once, at
   the body size, and both boxes then start on one line. */
.sheet { width: min(72ch, 100%); margin-inline: auto }
h1, h2, h3, h4, h5, h6 { margin: 24px 0 8px; line-height: 1.2 }
h1 { font-size: 32px }
h2 { font-size: 24px }
h3 { font-size: 20px }
h4, h5, h6 { font-size: 16px }
:where(h1, h2, h3, h4, h5, h6):first-child { margin-block-start: 0 }
p, ul, ol { margin: 0 0 12px }
ul, ol { padding-inline-start: 24px }
li { margin-block-end: 2px }
a { color: var(--accent) }
del { color: var(--muted) }
code {
  padding: 2px 4px;
  border-radius: 4px;
  background: var(--sunken);
  font-family: var(--mono);
  font-size: 0.9em;
}
pre {
  margin: 0 0 12px;
  padding: 12px;
  overflow-x: auto;
  border: 1px solid var(--line-subtle);
  border-radius: 4px;
  background: var(--sunken);
  font-family: var(--mono);
  font-size: 14px;
  tab-size: 2;
}
pre code { padding: 0; border-radius: 0; background: none; font-size: inherit }
footer {
  margin-block-start: 32px;
  padding-block-start: 16px;
  border-block-start: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
}
</style>
</head>
<body>
<div class="sheet">
<main>${markdownToHtml(md)}</main>
<footer>Written with <a href="https://yeetlist.vercel.app">Yeetlist</a>.</footer>
</div>
</body>
</html>
`;
}

/* ── Pasting ────────────────────────────────────────────────────────────── */

/* THEIR RULE: a paste arrives as plain text with every bit of formatting
   stripped, UNLESS the text itself holds markdown, in which case that
   markdown is honoured.

   SO THE QUESTION IS ABOUT THE TEXT, never about the clipboard's HTML. Word
   and a web page both offer rich HTML, and taking it is what drags a
   stranger's fonts and colours into a note. The plain-text flavour is the
   only thing read, and it is asked whether it looks like markdown. */
export function looksLikeMarkdown(text) {
  const s = String(text ?? '');
  if (!s.trim()) return false;
  return [
    /^#{1,6}\s+\S/m,                 // a heading
    /^\s*[-*+]\s+\S/m,               // a bullet
    /^\s*\d+[.)]\s+\S/m,             // a number
    /\*\*[^*\n]+\*\*/,               // bold
    /~~[^~\n]+~~/,                   // strikethrough
    /\[[^\]\n]*\]\([^)\s]+\)/,       // a link
    /^\x60{3,}/m,                    // a code block
    /\x60[^\x60\n]+\x60/,            // a code span
  ].some((re) => re.test(s));
}

/* Plain text with no markdown in it still has LINES, and a reader who pastes
   three paragraphs means three paragraphs. */
export function plainToHtml(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => `<p>${block.split('\n').map((l) => esc(l)).join('<br>')}</p>`)
    .join('');
}

export function pasteToHtml(text) {
  return looksLikeMarkdown(text) ? markdownToHtml(text) : plainToHtml(text);
}
