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

  const closePara = () => {
    if (!para.length) return;
    out.push(`<p>${inlineToHtml(para.join(' '))}</p>`);
    para = [];
  };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const close = () => { closePara(); closeList(); };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

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
  close();
  return out.join('');
}

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

  /* One blank line between blocks, none at either end. */
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
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
