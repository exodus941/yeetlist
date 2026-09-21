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
 * THE TITLE IS ITS OWN FIELD. Their instruction, 22 September 2026: "the
 * title is a separate thing!", after "changing the title of a blank note
 * should not automatically change its first line too!"
 *
 * IT USED TO EDIT THE NOTE'S FIRST BLOCK. Measured on a blank note: typing
 * "Groceries" in the field left the body as `<p>Groceries</p>` and the file
 * as "Groceries". The name a reader gave the note became the note's first
 * sentence, which nobody typed.
 *
 * SO IT IS STORED, IN `name`, AND THE BODY IS NEVER TOUCHED. The list still
 * needs a name for a note that has none, so `title` stays the DISPLAY name
 * and falls back to the body's own first heading or first line. Two fields,
 * one of them derived, rather than one field doing two jobs.
 */
function paintTitle() {
  const field = noteEl('noteTitle');
  /* NEVER WHILE THEY ARE TYPING IN IT. Writing the field's own value back
     into it moves the caret to the end on every keystroke. */
  if (document.activeElement === field) return;
  const note = videos.find((v) => v.id === noteOpen);
  /* THE STORED NAME AND NOTHING ELSE. Showing the derived one here would
     freeze it: a reader editing the first line would find the field still
     holding the old words, with no way to tell which was which. The
     placeholder already says "Untitled note". */
  field.value = note?.name || '';
}

/* THE FIELD IS THE SOURCE WHILE THE EDITOR IS OPEN, so this only asks for a
   save. Writing the record here as well would be a second writer for one
   value, and it would write on every keystroke. */
function renameNote() {
  saveNote();
}

/* A NOTE WITH NO NAME TAKES ITS FIRST LINE, ONCE, ON CLOSE. Their
   instruction, 22 September 2026: "if no title is added, it inherits one
   from the first line of the note as soon as it's closed".

   ONCE, AND ONLY ON CLOSE. Adopting it on every keystroke would put the
   title back to tracking the body, which is the thing they asked to stop.
   After this the name is stored, so editing the first line leaves it alone.

   AN EMPTY NOTE INHERITS NOTHING, because there is no first line to take.
   `titleOf` answers "Untitled note" for one, and storing that would be a
   name nobody chose. */
function adoptTitle() {
  const note = videos.find((v) => v.id === noteOpen);
  if (!note || note.name || !NOTES) return;
  const line = String(note.body || '').trim();
  if (!line) return;
  note.name = NOTES.titleOf(note.body);
  note.title = note.name;
  save();
}

function closeNote() {
  if (noteOpen === null) return;
  saveNote({ now: true });
  adoptTitle();
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
  /* THE STORED NAME, AND THE DISPLAY NAME DERIVED FROM IT. A note with no
     name of its own is still named in the list, by its own first line. */
  const name = noteEl('noteTitle').value.trim();
  const title = name || NOTES.titleOf(body);
  noteEl('noteState').textContent = 'Saved';
  /* NOTHING CHANGED IS NOT A SAVE. Moving the caret fires an input event in
     some engines, and writing then would move the edited stamp, re-sort the
     list and push to Drive for a keystroke nobody made. */
  if (body === note.body && name === (note.name || '') && title === note.title) return;

  note.body = body;
  /* AN EMPTY NAME IS NO NAME, so the field is not stored as an empty string
     that would read as a title somebody chose. */
  if (name) note.name = name; else delete note.name;
  note.title = title;
  note.editedAt = new Date().toISOString();
  save();
}

/* A TYPED LINE BECOMES THE NOTE'S FIRST BLOCK, and nothing else.
   Their instruction, 22 September 2026: typing in the add field and pressing
   Enter opens that note in the editor. The button with an empty field opens a
   fully blank one.

   `titleOf` READS THE NAME OFF THE BODY, so the title is derived rather than
   stated. It is the same function the editor's own title field reads, and it
   falls back to "Untitled note" on an empty body. Writing a title here as
   well would be two writers for one name. */
async function newNote(firstLine = '') {
  /* `titleOf` LIVES IN THE LAZY MODULE, so this waits for it the way
     openNote does. A click can in principle beat the import. */
  await notesReady;

  const now = new Date().toISOString();
  const body = String(firstLine || '').trim();
  videos.push({
    id: noteId(), kind: 'note', title: NOTES.titleOf(body), body,
    addedAt: now, editedAt: now, tags: [],
  });
  save();
  const made = videos[videos.length - 1];
  if (typeof tab !== 'undefined' && tab !== 'notes') showTab('notes'); else render();
  openNote(made.id);
}

/* ── Taking one note away ────────────────────────────────────────────────
 *
 * THEIR INSTRUCTION, 22 September 2026: a download button left of each
 * note's delete icon, opening a menu of MD, HTML and TXT. The MD file is the
 * note exactly as written, the TXT file has every mark stripped, and the
 * HTML file renders it on YeeTlist's own dark background.
 *
 * ONE MENU FOR THE WHOLE LIST. A menu per row would be one hidden menu per
 * note, and a menu inside a table cell is cut off by the scroller the table
 * sits in. This one is fixed to the window and placed against whichever
 * button was pressed, which is what the tag suggestions already do.
 */
const NOTE_FORMATS = [['md', 'MD'], ['html', 'HTML'], ['txt', 'TXT']];

/* A FILENAME IS NOT A TITLE. Every character Windows, macOS and Linux
   refuse comes out, the runs of space collapse, and the length is capped so
   a note whose first line is a paragraph still saves. */
function noteFilePart(title) {
  const clean = String(title || 'Untitled note')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[ -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return (clean || 'Untitled note').slice(0, 60);
}

async function downloadNote(id, format) {
  await notesReady;
  const note = videos.find((v) => v.id === id && v.kind === 'note');
  if (!note) return;

  /* THE OPEN NOTE MAY HOLD UNSAVED KEYSTROKES. The save runs on a timer, so
     a download taken mid-word would write the version before it. */
  if (noteOpen === id) saveNote({ now: true });

  const body = String(note.body || '');
  const title = NOTES.titleOf(body);
  const name = `${stamp()}-${noteFilePart(title)}`;

  if (format === 'md') saveText(`${name}.md`, body, 'text/markdown;charset=utf-8');
  else if (format === 'txt') saveText(`${name}.txt`, NOTES.markdownToText(body), 'text/plain;charset=utf-8');
  else saveText(`${name}.html`, NOTES.noteToHtmlPage(title, body), 'text/html;charset=utf-8');
}

/* HELD RATHER THAN READ BACK OFF THE DOM, because a render replaces every
   row and the button this menu belongs to goes with it. */
const getMenu = { el: null, button: null };

function getMenuBox() {
  if (getMenu.el) return getMenu.el;
  const list = document.createElement('ul');
  list.id = 'noteGetMenu';
  list.className = 'multi-panel multi-list row-get-menu';
  list.setAttribute('role', 'menu');
  list.setAttribute('aria-label', 'Download this note');
  list.tabIndex = -1;
  list.hidden = true;
  document.body.append(list);

  list.addEventListener('click', (event) => {
    const item = event.target.closest('.multi-option');
    if (!item || !getMenu.button) return;
    /* THE ROW BUTTON NAMES ITS NOTE. The editor's buttons carry no id,
       because they always mean the note that is open, and a copy written
       onto one would be a second answer that can go stale. */
    const id = getMenu.button.dataset.id || noteOpen;
    closeGet();
    if (!id) return;
    /* THE DELETE CLOSES THE NOTE FIRST, the same way the header button does,
       so the editor is not left open over a record that has gone. */
    if (item.dataset.action === 'delete') { closeNote(); openDelete([id]); return; }
    downloadNote(id, item.dataset.format);
  });

  /* ARROWS MOVE, ENTER AND SPACE PRESS, ESCAPE LEAVES. The same keys the
     export menu answers, because it is the same kind of control. */
  list.addEventListener('keydown', (event) => {
    const items = [...list.querySelectorAll('.multi-option')];
    const at = items.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); return closeGet({ focus: true }); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      return items[(at + step + items.length) % items.length]?.focus();
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      document.activeElement?.click();
    }
  });

  getMenu.el = list;
  return list;
}

/* THE ITEMS DEPEND ON WHICH BUTTON OPENED IT. A download offers the three
   formats. The hamburger is where the whole bar folded, so it offers those
   same three and the delete under a rule. One menu rather than two, because
   two would be two places to keep the formats true. */
function getMenuItems(button) {
  const formats = NOTE_FORMATS.map(([key, label]) => `<li class="multi-option" role="menuitem"
    tabindex="-1" data-format="${key}">${label}</li>`).join('');
  if (button.id !== 'noteMenu') return formats;
  return `${formats}<li class="multi-sep" aria-hidden="true"></li>`
    + `<li class="multi-option multi-danger" role="menuitem" tabindex="-1"
         data-action="delete">Delete Note</li>`;
}

function openGet(button) {
  const list = getMenuBox();
  getMenu.button = button;
  list.innerHTML = getMenuItems(button);
  list.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  placeGet();
  list.querySelector('.multi-option')?.focus();
}

/* THE BUTTON SITS AT THE END OF A ROW, so the menu is aligned to its own end
   rather than to its start: placed from the left it would run off the page.
   It opens upward wherever it would fall off the bottom. */
function placeGet() {
  const { el, button } = getMenu;
  if (!el || el.hidden || !button) return;

  /* A RENDER REPLACES EVERY ROW, so the button this menu was opened against
     can be detached. A detached element measures 0x0, which would park the
     menu in the corner of the window over nothing. */
  if (!button.isConnected) return closeGet();

  const box = button.getBoundingClientRect();

  el.style.left = `${Math.max(8, Math.min(box.right - el.offsetWidth, innerWidth - el.offsetWidth - 8))}px`;

  const below = innerHeight - box.bottom;
  el.style.top = below < el.offsetHeight + 8 && box.top > el.offsetHeight + 8
    ? `${box.top - el.offsetHeight - 4}px`
    : `${box.bottom + 4}px`;
}

function closeGet({ focus = false } = {}) {
  const { el, button } = getMenu;
  if (!el || el.hidden) return;
  el.hidden = true;
  button?.setAttribute('aria-expanded', 'false');
  /* THE BUTTON MAY BE GONE. A render between the open and the close detaches
     it, and focusing a detached element does nothing rather than throwing. */
  if (focus && button?.isConnected) button.focus();
  getMenu.button = null;
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

  if (mark === 'code') {
    toggleCode();
  } else if (mark === 'link') {
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

/* ── Code text ───────────────────────────────────────────────────────────
 *
 * execCommand HAS NO CODE COMMAND, so this is the one mark written by hand.
 * A range is what does it, and the two directions are not symmetrical: on
 * wraps a selection, off unwraps whichever element the caret is inside.
 *
 * A SNIPPET IS ONE RUN OF TEXT. Markdown has no way to say "code across
 * three paragraphs", so a selection spanning blocks is flattened into one
 * span rather than producing a file that cannot be read back.
 */
const CODE_BLOCKS = 'p, div, h1, h2, h3, h4, h5, h6, ul, ol, li, pre, blockquote';

function toggleCode() {
  const held = caretIn('code');
  if (held) { held.replaceWith(...held.childNodes); return; }

  const sel = getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const code = document.createElement('code');

  if (range.collapsed) {
    /* NOTHING SELECTED IS STILL A SWITCH, so the next word typed has to land
       inside. A zero-width character gives the caret a place to sit; the
       converter strips it, so it never reaches the file. */
    code.textContent = '​';
    range.insertNode(code);
  } else {
    code.append(range.extractContents());
    for (const block of code.querySelectorAll(CODE_BLOCKS)) block.replaceWith(...block.childNodes);
    range.insertNode(code);
  }

  const inside = document.createRange();
  inside.selectNodeContents(code);
  inside.collapse(false);
  sel.removeAllRanges();
  sel.addRange(inside);
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
    else if (mark === 'code') on = Boolean(caretIn('code'));
    else if (NOTE_COMMANDS[mark]) {
      try { on = document.queryCommandState(NOTE_COMMANDS[mark]); } catch { on = false; }
    }
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  /* A CODE BLOCK IS ONE OF THE LEVELS, so the control has to report it. */
  const block = caretIn('h1,h2,h3,h4,h5,h6,pre');
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
  /* THE DOWNLOAD MENU CLOSES ON ANY CLICK THAT IS NOT ITS OWN. It is asked
     first, because the press that opens it must not immediately close it. */
  const get = event.target.closest?.('.row-get, #noteGet, #noteMenu');
  if (get) {
    const same = getMenu.button === get && !getMenu.el?.hidden;
    closeGet();
    if (!same) openGet(get);
    return;
  }
  if (!event.target.closest?.('#noteGetMenu')) closeGet();

  const open = event.target.closest?.('.note-open');
  if (open) { openNote(open.dataset.id); return; }

  /* `#newNote` IS GONE. One field and one button serve all three tabs, and
     `addVideo` routes to `newNote` on this one. */
  if (event.target.closest?.('#noteBack')) { closeNote(); return; }

  const tool = event.target.closest?.('.note-tool');
  if (tool) { runMark(tool.dataset.mark); return; }

  if (event.target.closest?.('#noteDelete') && noteOpen !== null) {
    const id = noteOpen;
    closeNote();
    openDelete([id]);
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'noteBody') { paintTitle(); saveNote(); }
  if (event.target.id === 'noteTitle') renameNote();
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

/* THE MENU IS FIXED TO THE WINDOW AND THE BUTTON IS NOT, so a scroll or a
   resize moves one and not the other. It follows, rather than closing:
   closing on a scroll is what makes a menu feel like it was dismissed by
   accident. `capture` because the list is its own scroller and a scroll
   event there does not bubble. */
addEventListener('scroll', placeGet, { capture: true, passive: true });
addEventListener('resize', placeGet);

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
