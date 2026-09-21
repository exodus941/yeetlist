/* ==========================================================================
   Notes: the list's third kind, and its editor

   A NOTE IS A MARKDOWN DOCUMENT AND NOTHING ELSE. Its title is the first
   heading, or the first line where there is none, so there is one source of
   truth and the file that syncs is exactly the note.

   IT LIVES IN THE SAME ARRAY AS EVERYTHING ELSE, with `kind: 'note'`. The
   tags, the rating, the search, the selection, the sort and the tombstones
   are machinery the other two lists already have. A second array would be a
   second copy of every one of them.

   THIS FILE LOADS BEFORE app.js, because app.js renders on its last line and
   that render can ask for a note's excerpt. A function declaration is global
   to the page, so everything here is in place before that happens. The
   reverse order threw on the first paint of the notes tab.

   IT REACHES INTO app.js DELIBERATELY. `videos`, `save`, `render`, `tab` and
   `showTab` are the app's own state, and a note is one more row in it. Every
   reference is inside a function, so it resolves when the reader acts rather
   than while this file loads.
   ========================================================================== */

/* THE CONVERTER IS A MODULE so a plain Node test can import it. A round trip
   proven only through a browser is proven on one engine. */
let NOTES = null;
const notesReady = import('./notes.js').then((m) => { NOTES = m; return m; });

const noteEl = (id) => document.getElementById(id);

/* ── The list ───────────────────────────────────────────────────────────── */

/* THE FIRST FEW WORDS AFTER THE TITLE, so a list of notes says what each one
   is about. The title line comes off, because the row already shows it and
   repeating it says nothing.

   IT READS THE MARKDOWN rather than rendering it. A note IS its source, and
   a second renderer here would be a second thing to keep true. */
function excerptOf(v) {
  const lines = String(v.body || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let past = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!past) { past = true; continue; }
    out.push(line.replace(/^#{1,6}\s+/, '').replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''));
    if (out.join(' ').length > 160) break;
  }
  const text = out.join(' ')
    .replace(/\*\*|~~/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    /* \x60 IS A BACKTICK, WRITTEN AS AN ESCAPE ON PURPOSE. A lone backtick
       makes this file's count odd, and the syntax guard reads an odd count
       as a template literal left open. */
    .replace(/[*_\x60]/g, '')
    .trim();
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

/* ── Opening and closing ────────────────────────────────────────────────── */

/* HELD RATHER THAN READ FROM THE DOM, because a render rebuilds the list
   under the editor and a Drive pull can arrive mid-edit. */
let noteOpen = null;
let noteTimer = null;

const noteId = () => `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function openNote(id) {
  await notesReady;
  const note = videos.find((v) => v.id === id && v.kind === 'note');
  if (!note) return;
  noteOpen = id;

  const body = noteEl('noteBody');
  body.innerHTML = NOTES.markdownToHtml(note.body || '');
  /* AN EMPTY NOTE STILL NEEDS A BLOCK TO TYPE INTO. With nothing in the box
     the first keystroke lands in a bare text node, and every block command
     then has no element to act on. */
  if (!body.firstElementChild) body.innerHTML = '<p><br></p>';

  noteEl('noteState').textContent = 'Saved';
  noteEl('noteEditor').hidden = false;
  paintTitle();
  document.body.dataset.noteOpen = '';
  syncTools();
  body.focus();
  caretToEnd(body);
}

/* ── The title ──────────────────────────────────────────────────────────
 *
 * THE FIELD EDITS THE NOTE'S FIRST BLOCK, and nothing else. `titleOf` reads
 * the first heading, or the first line where there is none, so whatever the
 * field shows is what that function will return. One name, one place.
 *
 * THAT IS ALSO THEIR SECOND RULE: a note added without a title takes its
 * first line as the title. It always did, and now the field says so.
 */
function paintTitle() {
  const field = noteEl('noteTitle');
  /* NEVER WHILE THEY ARE TYPING IN IT. Writing the field's own value back
     into it moves the caret to the end on every keystroke. */
  if (document.activeElement === field) return;
  const first = noteEl('noteBody').firstElementChild;
  field.value = first ? first.textContent.trim() : '';
}

function renameNote(text) {
  const body = noteEl('noteBody');
  if (!body.firstElementChild) body.innerHTML = '<p><br></p>';
  const first = body.firstElementChild;
  /* A BLOCK EMPTIED OF TEXT STILL NEEDS A LINE BOX, or the block collapses
     and the caret has nowhere to sit. */
  if (text) first.textContent = text;
  else first.innerHTML = '<br>';
  saveNote();
}

function closeNote() {
  if (noteOpen === null) return;
  saveNote({ now: true });
  noteOpen = null;
  noteEl('noteEditor').hidden = true;
  delete document.body.dataset.noteOpen;
  render();
}

/* THE CARET GOES TO THE END, because a reader opening a note means to carry
   on writing rather than to start again at the top. */
function caretToEnd(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/* ── Saving ─────────────────────────────────────────────────────────────── */

/* ON A TIMER, NEVER ON EVERY KEYSTROKE. Each save converts the whole
   document, writes local storage and queues a Drive push. Doing that per
   character is what makes an editor feel heavy. 600ms holds a word and
   loses nothing a reader would notice. */
function saveNote({ now = false } = {}) {
  if (noteOpen === null || !NOTES) return;
  clearTimeout(noteTimer);
  if (!now) {
    noteEl('noteState').textContent = 'Saving…';
    noteTimer = setTimeout(() => saveNote({ now: true }), 600);
    return;
  }

  const note = videos.find((v) => v.id === noteOpen);
  if (!note) return;

  const body = NOTES.htmlToMarkdown(noteEl('noteBody'));
  noteEl('noteState').textContent = 'Saved';
  /* NOTHING CHANGED IS NOT A SAVE. Moving the caret fires an input event in
     some engines, and writing then would move the edited stamp, re-sort the
     list and push to Drive for a keystroke nobody made. */
  if (body === note.body) return;

  note.body = body;
  note.title = NOTES.titleOf(body);
  note.editedAt = new Date().toISOString();
  save();
}

function newNote() {
  const now = new Date().toISOString();
  videos.push({
    id: noteId(), kind: 'note', title: 'Untitled note', body: '',
    addedAt: now, editedAt: now, tags: [],
  });
  save();
  const made = videos[videos.length - 1];
  if (typeof tab !== 'undefined' && tab !== 'notes') showTab('notes'); else render();
  openNote(made.id);
}

/* ── The toolbar ─────────────────────────────────────────────────────────
 *
 * execCommand IS DEPRECATED AND STILL THE ONLY THING EVERY CURRENT BROWSER
 * IMPLEMENTS for this. Its replacements cover selection painting and input
 * handling, not block formatting. What protects us is that the output is
 * read back as markdown: whichever tag an engine chooses, the file is the
 * same, and `tools/notes-guard.mjs` pins the ones they choose.
 */
const NOTE_COMMANDS = {
  bold: 'bold',
  italic: 'italic',
  strike: 'strikeThrough',
  bullets: 'insertUnorderedList',
  numbers: 'insertOrderedList',
};

function runMark(mark) {
  const body = noteEl('noteBody');
  body.focus();

  if (mark === 'link') {
    const href = prompt('Address for this link');
    if (href === null) return;
    const url = href.trim();
    if (url) document.execCommand('createLink', false, noteHref(url));
    else document.execCommand('unlink');
  } else if (NOTE_COMMANDS[mark]) {
    document.execCommand(NOTE_COMMANDS[mark]);
  }

  flatten();
  syncTools();
  saveNote();
}

/* A BARE HOST IS A LINK TO THIS SITE WITHOUT A SCHEME. app.js states this
   rule for the add field; a note's links answer to the same one. */
const noteHref = (value) => (/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);

function setLevel(level) {
  noteEl('noteBody').focus();
  /* `formatBlock` TAKES THE TAG IN ANGLE BRACKETS in every engine that
     implements it, and a bare name is ignored by some of them. */
  document.execCommand('formatBlock', false, `<${level}>`);
  flatten();
  syncTools();
  saveNote();
}

/* THE TOOLBAR REPORTS THE CARET'S OWN STATE, or a reader cannot tell whether
   the next word will be bold. `queryCommandState` answers for the selection
   rather than for the last button pressed. */
function syncTools() {
  if (noteEl('noteEditor').hidden) return;
  for (const button of document.querySelectorAll('.note-tool')) {
    const mark = button.dataset.mark;
    let on = false;
    if (mark === 'link') on = Boolean(caretIn('a'));
    else if (NOTE_COMMANDS[mark]) {
      try { on = document.queryCommandState(NOTE_COMMANDS[mark]); } catch { on = false; }
    }
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  const block = caretIn('h1,h2,h3,h4,h5,h6');
  setLevelValue(block ? block.tagName.toLowerCase() : 'p');
}

/* ONE WRITER FOR WHAT THE STYLE CONTROL SAYS. The trigger's words and the
   ticked option are one fact, so a caret move and a pick cannot leave them
   disagreeing. */
function setLevelValue(level) {
  const list = noteEl('noteLevelList');
  if (!list) return;
  for (const option of list.querySelectorAll('.multi-option')) {
    const on = option.dataset.value === level;
    option.setAttribute('aria-checked', on ? 'true' : 'false');
    if (on) noteEl('noteLevelValue').textContent = option.textContent;
  }
}

function caretIn(selector) {
  const sel = getSelection();
  if (!sel || !sel.rangeCount) return null;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === 3) node = node.parentElement;
  const body = noteEl('noteBody');
  for (let n = node; n && n !== body; n = n.parentElement) {
    if (n.matches && n.matches(selector)) return n;
  }
  return null;
}

/* ── Pasting ─────────────────────────────────────────────────────────────
 *
 * THEIR RULE: a paste arrives as plain text with every bit of formatting
 * stripped, unless the text itself holds markdown.
 *
 * SO THE CLIPBOARD'S HTML IS NEVER READ. Word and a web page both offer
 * rich HTML, and taking it is what drags a stranger's fonts, colours and
 * spans into a note. Only the plain-text flavour is asked for, and only it
 * decides what arrives.
 */
function onPaste(event) {
  event.preventDefault();
  const text = event.clipboardData?.getData('text/plain') ?? '';
  if (!text || !NOTES) return;
  /* insertHTML rather than a range write, so one undo step covers the paste
     the way it does everywhere else in a text box. */
  document.execCommand('insertHTML', false, NOTES.pasteToHtml(text));
  flatten();
  syncTools();
  saveNote();
}

/* ── Keeping the structure flat ──────────────────────────────────────────
 *
 * A BLOCK INSIDE A BLOCK IS WHAT THE BROWSER LEAVES BEHIND, and markdown has
 * no way to say it. Measured twice in one sitting. Pressing the bullet
 * button inside a paragraph gave `<p><ul>…</ul></p>`. Pasting into a
 * heading that a delete had left behind gave `<h1><ul>…</ul></h1>`, and the
 * pasted list came out as a heading.
 *
 * THE CONVERTER FORGIVES BOTH, and this stops them existing. Two defences,
 * because the converter also reads notes written by other editors and the
 * editor also has to look right while somebody is in it: a list nested in a
 * heading is drawn at heading size on screen whatever the file ends up
 * saying.
 */
const FLAT = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const BLOCKY = new Set([...FLAT, 'UL', 'OL', 'BLOCKQUOTE', 'PRE']);

function flatten() {
  const body = noteEl('noteBody');
  /* Bounded, because an unwrap can expose another. Five is far past any
     nesting an editor produces and it cannot spin. */
  for (let pass = 0; pass < 5; pass += 1) {
    const guilty = [...body.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6')]
      .filter((el) => FLAT.has(el.tagName)
        && [...el.children].some((c) => BLOCKY.has(c.tagName)));
    if (!guilty.length) return;
    for (const el of guilty) el.replaceWith(...el.childNodes);
  }
}

/* ── Wiring ──────────────────────────────────────────────────────────────
 *
 * DELEGATED FROM THE DOCUMENT, because this file loads before app.js and
 * before anything it needs exists. A listener on an element would have to
 * wait for that element; a listener on the document never does.
 */
document.addEventListener('click', (event) => {
  const open = event.target.closest?.('.note-open');
  if (open) { openNote(open.dataset.id); return; }

  if (event.target.closest?.('#newNote')) { newNote(); return; }
  if (event.target.closest?.('#noteBack')) { closeNote(); return; }

  const tool = event.target.closest?.('.note-tool');
  if (tool) { runMark(tool.dataset.mark); return; }

  /* THE PEN DOES WHAT THE FIELD DOES, so there is one way to rename a note
     rather than two behaviours to keep in step. It selects the whole title,
     because a reader pressing it means to replace the name. */
  if (event.target.closest?.('#noteRename')) {
    const field = noteEl('noteTitle');
    field.focus();
    field.select();
    return;
  }

  if (event.target.closest?.('#noteDelete') && noteOpen !== null) {
    const id = noteOpen;
    closeNote();
    openDelete([id]);
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'noteBody') { paintTitle(); saveNote(); }
  if (event.target.id === 'noteTitle') renameNote(event.target.value);
});

/* ENTER LEAVES THE TITLE AND GOES BACK TO THE TEXT, because a title field
   holds one line and the next thing a reader wants is the body. */
document.addEventListener('keydown', (event) => {
  if (event.target.id !== 'noteTitle') return;
  if (event.key === 'Enter' || event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    noteEl('noteBody').focus();
  }
});

document.addEventListener('paste', (event) => {
  if (event.target.closest?.('#noteBody')) onPaste(event);
});

/* THE TOOLBAR FOLLOWS THE CARET, so it has to hear every way the caret can
   move: typing, clicking, and the arrow keys. */
document.addEventListener('selectionchange', () => {
  if (noteOpen !== null) syncTools();
});

document.addEventListener('keydown', (event) => {
  if (noteOpen === null) return;
  if (event.key === 'Escape') { event.preventDefault(); closeNote(); return; }

  /* THE THREE SHORTCUTS EVERY EDITOR HAS. A browser already maps two of
     them to its own bold and italic inside a contenteditable, and mapping
     them here keeps the toolbar's state and the save in step. */
  if (!(event.metaKey || event.ctrlKey)) return;
  const mark = { b: 'bold', i: 'italic' }[event.key.toLowerCase()];
  if (!mark) return;
  event.preventDefault();
  runMark(mark);
});
