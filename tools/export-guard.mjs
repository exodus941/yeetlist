#!/usr/bin/env node
/* ONE MENU, TWO KINDS OF ITEM, AND A SECOND MENU PER NOTE.
 *
 * Their instructions, 22 September 2026, in two parts. First: add an option
 * to download the latest APK, called "Download APK Installer". Then: rename
 * the list items, add "All Notes", give every note its own download in three
 * formats, and stamp every filename with the moment it was taken.
 *
 * FOUR ITEMS WRITE A FILE AND ONE FETCHES AN INSTALLER, so the click handler
 * branches. That is the thing worth holding: a branch keyed on position, or
 * one that falls through, sends the installer item into `exportFile(
 * undefined)` and silently writes a links file instead.
 *
 * THE NAMES ARE THE OTHER HALF. Five shapes were dictated exactly, and a
 * filename is a constant nothing else in the app reads. Nobody notices a
 * wrong one until a folder of exports will not sort.
 */
import { readFileSync } from 'node:fs';
import { appSource } from './slice-app.mjs';
import { markdownToText, noteToHtmlPage } from '../notes.js';

const src = appSource();
const blank = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
const code = blank(src);
const at = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const html = at('../index.html');
const ui = blank(at('../notes-ui.js'));
const css = at('../styles.css');

const cases = [];
const ok = (name, pass, note = '') => cases.push({ name, pass, note });
const same = (name, a, b) => ok(name, a === b, `${JSON.stringify(a)} against ${JSON.stringify(b)}`);

/* -- 1. The global menu: four lists and an installer ----------------------- */
{
  const menu = html.slice(html.indexOf('id="exportMenu"'), html.indexOf('</ul>', html.indexOf('id="exportMenu"')));
  const scopes = [...menu.matchAll(/data-scope="([^"]+)"/g)].map((m) => m[1]);

  ok('the menu offers four lists', scopes.length === 4, scopes.join(' | '));
  ok('and every one names a scope', scopes.every(Boolean), scopes.join(' | '));
  ok('the notes file is one of them', scopes.includes('notes'), scopes.join(' | '));

  /* THE WORDS ARE THEIRS. Each item says what it writes, because a fourth
     item writing the notes made "Everything" false. */
  ok('YouTube says Links', menu.includes('>YouTube Links<'), 'label');
  ok('Everything became All Links', menu.includes('>All Links<') && !menu.includes('>Everything<'));
  ok('the notes item says All Notes', menu.includes('>All Notes<'));
  ok('Bookmarks is unchanged', menu.includes('>Bookmarks<'));

  ok('the installer is still offered', menu.includes('>Download APK Installer<'));
  /* IT IS KEYED ON AN ATTRIBUTE, NEVER ON ITS POSITION. A fifth scope added
     tomorrow would otherwise move the branch onto the wrong row. */
  ok('the installer carries no export scope', !/data-get="apk"[^>]*data-scope/.test(menu));
  /* A SEPARATOR IS A REAL ITEM WITH NO ROLE, so nothing announces it. */
  ok('a separator divides the two kinds', /multi-sep[^>]*aria-hidden="true"/.test(menu), 'sep');
  ok('and it is not a menu item', !/multi-sep[^>]*role="menuitem"/.test(menu));
}

/* -- 2. The branch cannot fall through ------------------------------------- */
{
  const onClick = code.slice(code.indexOf("$('#exportMenu').addEventListener('click'"));
  const body = onClick.slice(0, onClick.indexOf('});'));
  ok('the click handler was found', body.length > 100, String(body.length));
  ok('it asks the attribute', /item\.dataset\.get === 'apk'/.test(body), body.slice(-160));
  ok('and the two paths are exclusive', /else exportFile\(item\.dataset\.scope\)/.test(body),
    body.slice(-160));
  /* THE MENU STILL CLOSES AND FOCUS STILL RETURNS, on either path. */
  ok('the menu closes first', body.indexOf('openExport(false)') < body.indexOf('dataset.get'));
}

/* -- 3. Every filename they dictated -------------------------------------- */
{
  /* THE STAMP IS READ OUT OF THE APP'S OWN FUNCTION, never retyped. A second
     copy of the arithmetic here would agree with itself and not with what a
     reader downloads. */
  const fn = code.slice(code.indexOf('function stamp('));
  const stamp = new Function(`${fn.slice(0, fn.indexOf('\n}\n') + 2)}\nreturn stamp;`)();
  same('the stamp is six digits, a dash, then four',
    stamp(new Date(2026, 8, 22, 9, 5)), '260922-0905');
  same('a two-digit hour is not padded twice',
    stamp(new Date(2026, 11, 1, 23, 59)), '261201-2359');

  /* LOCAL TIME, NEVER UTC. The stamp answers a question about the reader's
     own clock, and an ISO date would move a late evening download to the
     next day. Proven by asking for a local time whose UTC date differs. */
  const late = new Date(2026, 8, 22, 23, 30);
  ok('the stamp reads the local clock',
    stamp(late).startsWith(`${String(late.getFullYear() % 100)}0922`), stamp(late));

  const names = code.slice(code.indexOf('const EXPORT_PART'));
  const parts = new Function(`${names.slice(0, names.indexOf('};') + 2)}\nreturn EXPORT_PART;`)();
  const name = (scope, s = '260922-0905') => {
    const [part, ext] = parts[scope];
    return `${s}-${part}.${ext}`;
  };

  /* EXACTLY WHAT THEY WROTE. */
  same('YouTube Links', name('youtube'), '260922-0905-YeeTlist-YouTube.html');
  same('Bookmarks', name('links'), '260922-0905-YeeTlist-Bookmarks.html');
  same('All Links', name('all'), '260922-0905-YeeTlist-All.html');
  same('All Notes', name('notes'), '260922-0905-YeeTlist-Notes.md');

  /* THE BUILDER READS THAT TABLE RATHER THAN HOLDING ITS OWN COPY. */
  ok('exportName reads the table', /EXPORT_PART\[scope\] \|\| EXPORT_PART\.all/.test(code));
  ok('and the stamp leads the name', /\$\{stamp\(\)\}-\$\{part\}\.\$\{ext\}/.test(code));
}

/* -- 4. The notes file is the file that syncs ----------------------------- */
{
  const fn = code.slice(code.indexOf('function exportFile('));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  ok('exportFile was found', body.length > 60, String(body.length));
  ok('the notes scope writes Markdown', /scope === 'notes'/.test(body) && /notesText\(\)/.test(body),
    body);
  /* ONE WRITER. A second rendering of the notes here would drift from the
     one Drive holds. */
  ok('it asks notesText rather than rebuilding it',
    (code.match(/notesText\(\)/g) || []).length >= 2);
  ok('the three link lists still write a bookmark file', /bookmarkFile\(scope\)/.test(body), body);
  /* ONE WRITER FOR EVERY DOWNLOAD, so a missed revoke cannot leak a file. */
  ok('every download goes through saveText', /function saveText\(/.test(code));
  ok('and saveText revokes what it made', /URL\.revokeObjectURL\(link\.href\)/.test(code));
  ok('nothing else builds its own anchor',
    (code.match(/URL\.createObjectURL/g) || []).length === 1,
    String((code.match(/URL\.createObjectURL/g) || []).length));
}

/* -- 5. A note's own download -------------------------------------------- */
{
  /* THE BUTTON IS IN THE NOTES LIST AND NOWHERE ELSE. A video and a bookmark
     are links, so there is no document to write. */
  const spec = code.slice(code.indexOf('  notes: {'), code.indexOf('};', code.indexOf('  notes: {')));
  ok('the notes list carries a download column', /\{ key: 'get' \}/.test(spec), 'get');
  ok('it sits before the delete', spec.indexOf("key: 'get'") < spec.indexOf("key: 'remove'"));

  const links = code.slice(code.indexOf('  links: {'), code.indexOf('  notes: {'));
  const youtube = code.slice(code.indexOf('  youtube: {'), code.indexOf('  links: {'));
  ok('the bookmarks list has none', !/key: 'get'/.test(links));
  ok('the watchlist has none', !/key: 'get'/.test(youtube));

  /* THE COLUMN HAS A WIDTH AND A HEADING, or the table drops it. */
  ok('the column states a width', /\.col-remove, \.col-edit, \.col-get/.test(css));
  ok('and the header cell names it', /c\.key === 'get'/.test(code) && /sr-only">Download/.test(code));

  /* THREE FORMATS, EXACTLY AS THEY NAMED THEM. */
  /* READ TO THE END OF THE DECLARATION. A class inside a class is what a
     nested array is, so a scan stopping at the first closing bracket reads
     one entry of three and reports the other two missing. */
  const formats = ui.slice(ui.indexOf('const NOTE_FORMATS'),
    ui.indexOf('];', ui.indexOf('const NOTE_FORMATS')) + 2);
  ok('the menu offers MD, HTML and TXT',
    /'md', 'MD'/.test(formats) && /'html', 'HTML'/.test(formats) && /'txt', 'TXT'/.test(formats),
    formats);

  const fn = ui.slice(ui.indexOf('async function downloadNote('));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  ok('downloadNote was found', body.length > 200, String(body.length));
  /* THE MD FILE IS THE NOTE, 1:1. Anything that converted it would be a
     second renderer to keep true against notes.js. */
  ok('MD writes the body untouched', /'md'\) saveText\(`\$\{name\}\.md`, body/.test(body), body);
  ok('TXT strips the marks', /markdownToText\(body\)/.test(body));
  ok('HTML renders the page', /noteToHtmlPage\(title, body\)/.test(body));
  /* THE NAME IS THE STAMP AND THE NOTE'S OWN TITLE. */
  ok('the file is stamped then named', /\$\{stamp\(\)\}-\$\{noteFilePart\(title\)\}/.test(body));
  /* A DOWNLOAD MID-WORD MUST NOT WRITE THE VERSION BEFORE IT. The editor
     saves on a timer, so the open note is flushed first. */
  ok('the open note is saved first', /noteOpen === id\) saveNote\(\{ now: true \}\)/.test(body));

  /* A FILENAME IS NOT A TITLE. */
  const part = ui.slice(ui.indexOf('function noteFilePart('));
  const filePart = new Function(`${part.slice(0, part.indexOf('\n}\n') + 2)}\nreturn noteFilePart;`)();
  same('a plain title is the filename', filePart('Shopping list'), 'Shopping list');
  same('a slash cannot reach the filename', filePart('a/b:c*d?e"f<g>h|i'), 'a b c d e f g h i');
  same('an empty title still names the file', filePart('   '), 'Untitled note');
  same('a trailing dot comes off', filePart('Notes...'), 'Notes');
  ok('a paragraph-long title is capped', filePart('x'.repeat(400)).length === 60,
    String(filePart('x'.repeat(400)).length));
}

/* -- 6. The single-note HTML page ----------------------------------------- */
{
  /* THEIR INSTRUCTION: a dark background identical to YeeTlist's interface,
     system fonts, Segoe UI and Consolas on Windows. */
  const page = noteToHtmlPage('A note', '# A note\n\nWith `code` in it.');
  ok('it is a whole document', /^<!doctype html>/i.test(page) && page.includes('</html>'));
  ok('it names itself', page.includes('<title>A note</title>'));
  ok('it renders the markdown', page.includes('<h1>A note</h1>') && page.includes('<code>code</code>'));

  /* THE COLOURS ARE READ BACK OUT OF THE STYLESHEET. A downloaded file
     carries none, so they are written in, and a written constant drifts the
     moment the app's own ground moves. */
  const token = (name) => (css.match(new RegExp(`\\s--${name}:\\s*(#[0-9a-f]{3,8})`, 'i')) || [])[1];
  for (const [name, inPage] of [['bg', '--bg'], ['surface', '--surface'], ['text', '--text'],
    ['text-muted', '--muted'], ['line', '--line'], ['accent', '--accent']]) {
    const want = token(name);
    ok(`the page's ${inPage} is the app's --${name}`,
      Boolean(want) && page.includes(`${inPage}: ${want};`), `${want}`);
  }

  ok('Windows takes Segoe UI', /"Segoe UI", system-ui/.test(page));
  ok('and every other system its own default', /system-ui, -apple-system/.test(page));
  ok('Windows takes Consolas for mono', /--mono: Consolas/.test(page));
  ok('and every other system its own mono', /ui-monospace/.test(page.slice(page.indexOf('--mono'))));
  /* NO NETWORK. A saved file has to open with none. */
  ok('it loads no web font', !/fonts\.googleapis|@import|@font-face/.test(page));
  ok('it fetches nothing at all', !/<(?:script|link|img|iframe)\b/i.test(page));
  ok('it says what wrote it', page.includes('YeeTlist'));

  /* A NOTE CANNOT INJECT MARKUP INTO ITS OWN PAGE. */
  const nasty = noteToHtmlPage('<script>x</script>', 'a <img src=x onerror=1> b');
  ok('a title cannot carry a tag', !/<script>/.test(nasty), nasty.slice(nasty.indexOf('<title>'), 80));
  ok('a body cannot carry a tag', !/<img/.test(nasty));
}

/* -- 7. The plain-text file ----------------------------------------------- */
{
  /* THEIR INSTRUCTION: strip all formatting, barebones. So the markup goes
     and nothing a reader wrote does. */
  same('a heading loses its hashes', markdownToText('## Shopping'), 'Shopping');
  same('bold loses its stars', markdownToText('a **b** c'), 'a b c');
  same('italic loses its star', markdownToText('a *b* c'), 'a b c');
  same('strikethrough loses its tildes', markdownToText('a ~~b~~ c'), 'a b c');
  same('code loses its backticks', markdownToText('run \x60npm i\x60'), 'run npm i');
  same('a bullet keeps its dash', markdownToText('* One'), '- One');
  same('a numbered item keeps its number', markdownToText('1) One'), '1. One');
  /* AN ADDRESS IS CONTENT, NOT FORMATTING. It is the one thing in a note
     that cannot be worked out from what is left. */
  same('a link keeps its address', markdownToText('see [the docs](https://x.y)'),
    'see the docs (https://x.y)');
  same('a bare link is not said twice', markdownToText('[https://x.y](https://x.y)'), 'https://x.y');
  /* A CODE BLOCK IS ALREADY PLAIN TEXT, and its indentation is what it says. */
  same('a code block keeps its shape',
    markdownToText('\x60\x60\x60\nif (a) {\n  b();\n}\n\x60\x60\x60'), 'if (a) {\n  b();\n}');
  ok('no fence survives', !/\x60/.test(markdownToText('\x60\x60\x60js\nx\n\x60\x60\x60')));
  same('an escaped star comes back as a star', markdownToText('2 \\* 3'), '2 * 3');
}

/* -- 8. The installer: the APK, never the bundle -------------------------- */
{
  const fn = code.slice(code.indexOf('async function downloadApk()'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  ok('downloadApk was found', body.length > 200, String(body.length));
  ok('it picks a file ending .apk', /endsWith\('\.apk'\)/.test(body), 'apk');
  /* A PLAY STORE BUNDLE CANNOT BE INSTALLED ON A PHONE. Their instruction,
     22 September 2026: lose the bundles. Every release is cleared of one by
     hand, and picking by extension is what survives one arriving again. */
  ok('and never mentions the bundle', !/\.aab/.test(body));

  /* THE NEWEST RELEASE NAMES ITSELF, so nothing here holds a version. */
  ok('it asks for the latest release', /releases\/latest/.test(body));
  ok('and no version is written in', !/26\d{4}-\d/.test(body), body.slice(0, 80));

  /* THE SAME REPOSITORY THE UPDATER ON THE DEVICE READS. Two names for one
     source is how a page offers an installer from somewhere else. */
  const theirs = (at('./android-updater.mjs').match(/const REPO = '([^']+)'/) || [])[1];
  const ours = (code.match(/const APK_REPO = '([^']+)'/) || [])[1];
  ok('the web and the device read one repository', Boolean(ours) && ours === theirs,
    `${ours} against ${theirs}`);

  /* A NEW TAB WITH `noopener`, or the opened page can reach back into this
     one. */
  ok('it opens a new tab', /window\.open\([^)]*'_blank', 'noopener'\)/.test(body));

  /* AND IT SAYS WHAT HAPPENED, on both outcomes. A fetch that fails silently
     reads as a dead control. */
  ok('it reports the file it found', /say\(`Downloading \$\{apk\.name\}/.test(body));
  ok('and names the cause when it cannot', /could not be found: \$\{error\.message\}/.test(body));
  ok('it says something before the wait', /say\('Finding the newest installer/.test(body));
}

/* -- 9. The row menu cannot outlive its row ------------------------------- */
{
  /* ONE MENU FOR THE WHOLE LIST, because a menu per row is one hidden menu
     per note and a menu inside a cell is clipped by the scroller. */
  ok('the menu is fixed to the window', /\.row-get-menu \{[^}]*position: fixed/.test(css));
  ok('and it is not inside a row', !/<[^>]*row-get-menu/.test(html));
  /* A RENDER REPLACES EVERY ROW, so the button it was placed against goes. */
  ok('a render closes it', /^  closeGet\(\);$/m.test(code.slice(code.indexOf('function render()'),
    code.indexOf('function render()') + 600)));
  ok('a detached button closes it rather than measuring 0',
    /!button\.isConnected\) return closeGet\(\)/.test(ui));
  /* IT FOLLOWS A SCROLL RATHER THAN CLOSING, and the capture phase is why: a
     scroll inside the list does not bubble. */
  ok('it follows a scroll', /addEventListener\('scroll', placeGet, \{ capture: true/.test(ui));
  ok('and a resize', /addEventListener\('resize', placeGet\)/.test(ui));
  /* PRESSING THE SAME BUTTON AGAIN CLOSES IT. */
  ok('the button toggles', /const same = getMenu\.button === get/.test(ui));
  /* ESCAPE LEAVES AND FOCUS COMES BACK. */
  ok('Escape closes it', /'Escape'\) \{ event\.preventDefault\(\); return closeGet\(\{ focus: true \}\)/.test(ui));
  ok('the arrows move within it', /ArrowDown' \? 1 : -1/.test(ui.slice(ui.indexOf('getMenuBox'))));
  /* THE PRESSED BUTTON STAYS LIT, or nothing says which one the menu belongs
     to. */
  ok('the open button is marked', /\.row-get\[aria-expanded="true"\]/.test(css));
  ok('and it keeps that mark in forced colors',
    /forced-colors: active\)[\s\S]{0,400}row-get\[aria-expanded="true"\]/.test(css));
}

/* -- Verdict --------------------------------------------------------------- */
let bad = 0;
for (const c of cases) {
  if (!c.pass) { bad += 1; console.log(`export guard: FAIL ${c.name} - ${c.note}`); }
}
if (!cases.length) {
  console.error('export guard: no cases ran, so nothing was measured');
  process.exit(1);
}
console.log(`export guard: ${cases.length - bad} of ${cases.length} cases hold`);
process.exit(bad ? 1 : 0);
