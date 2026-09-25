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
/* THE MANIFEST NAMES THE INSTALLED APP, and without that name the browser
   cannot tell the page which version is on the phone. */
const manifest = at('../manifest.webmanifest');

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
  same('YouTube Links', name('youtube'), '260922-0905-Yeetlist-YouTube.html');
  same('Bookmarks', name('links'), '260922-0905-Yeetlist-Bookmarks.html');
  same('All Links', name('all'), '260922-0905-Yeetlist-All.html');
  same('All Notes', name('notes'), '260922-0905-Yeetlist-Notes.md');

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
  /* THEIR INSTRUCTION: a dark background identical to Yeetlist's interface,
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
  ok('it says what wrote it', page.includes('Yeetlist'));

  /* THE FOOTER SHARES THE NOTE'S LEFT MARGIN, and one box owns the measure.
     Their instruction, 22 September 2026. A `ch` resolves against the
     element's own font, so the same rule on both put the 12px footer 77.63px
     inside the 16px note. The wrapper carries it once. */
  ok('one box owns the measure', /\.sheet \{ width: min\(72ch, 100%\); margin-inline: auto \}/.test(page));
  ok('and the note and the footer are both inside it',
    /<div class="sheet">[\s\S]*<main>[\s\S]*<\/main>[\s\S]*<footer>[\s\S]*<\/footer>[\s\S]*<\/div>/.test(page));
  /* BLANK THE COMMENTS FIRST. The prose explaining this rule names both
     elements and the measure, so a scan of the raw text reads the
     explanation as the code it forbids. */
  const rules = page.replace(/\/\*[\s\S]*?\*\//g, ' ');
  ok('neither states a measure of its own',
    !/\bmain[^{]*\{[^}]*72ch/.test(rules) && !/\bfooter[^{]*\{[^}]*72ch/.test(rules),
    (rules.match(/\b(?:main|footer)[^{]*\{[^}]*72ch/) || [''])[0].slice(0, 80));

  /* AND THE NAME IN IT IS A LINK. Their instruction, the same day. */
  ok('the footer links to the site',
    /<footer>Written with <a href="https:\/\/yeetlist\.vercel\.app">Yeetlist<\/a>\.<\/footer>/.test(page),
    page.slice(page.indexOf('<footer>'), page.indexOf('</footer>') + 9));

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

  /* THE READ MOVED OUT OF THE PRESS, so the two are sliced separately. One
     asks GitHub for the newest release and the other decides what to do with
     it. Reading only the press reported the release lookup as absent. */
  const rd = code.slice(code.indexOf('async function newestRelease()'));
  const read = rd.slice(0, rd.indexOf('\n}\n'));
  const both = `${read}\n${body}`;

  ok('downloadApk was found', body.length > 200, String(body.length));
  ok('the release lookup was found', read.length > 200, String(read.length));
  ok('it picks a file ending .apk', /endsWith\('\.apk'\)/.test(both), 'apk');
  /* A PLAY STORE BUNDLE CANNOT BE INSTALLED ON A PHONE. Their instruction,
     22 September 2026: lose the bundles. Every release is cleared of one by
     hand, and picking by extension is what survives one arriving again. */
  ok('and never mentions the bundle', !/\.aab/.test(both));

  /* THE NEWEST RELEASE NAMES ITSELF, so nothing here holds a version. */
  ok('it asks for the latest release', /releases\/latest/.test(both));
  ok('and no version is written in', !/26\d{4}-\d/.test(both), both.slice(0, 80));

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
  ok('it reports the file it found', /Downloading \$\{apk\.name\}/.test(body));
  ok('and names the cause when it cannot', /could not be found: \$\{error\.message\}/.test(body));
  ok('it says something before the wait', /say\('Finding the newest installer/.test(body));

  /* -- AND THE PHONE ANSWERS FOR ITSELF ----------------------------------- */
  /* Their question, 22 September 2026: "really, i have to keep it running for
     15 minutes? can't you just add Check for Updates in the download menu
     under APK Installer?"

     THE PAGE CANNOT SEE THE INSTALLED APP'S VERSION BY ITSELF. It loads the
     live site, so the number it paints is the site's. Comparing that against
     a release would always say the two agree. */
  ok('it asks the phone what is installed', /await installedApp\(\)/.test(body));
  ok('and the answer comes from the browser rather than a guess',
    /navigator\.getInstalledRelatedApps\?\.\(\)/.test(code));
  ok('the manifest names the app it asks about',
    /"related_applications"/.test(manifest) && /"app\.yeetlist\.twa"/.test(manifest));
  ok('and the code names the same package',
    /const APK_PACKAGE = 'app\.yeetlist\.twa';/.test(code));

  /* NOTHING IS DOWNLOADED WHEN THE PHONE IS ALREADY CURRENT. Handing Android
     the version it is running reinstalls it and says nothing useful. */
  ok('a current phone downloads nothing', /if \(have && newest && have >= newest\) \{/.test(body));
  ok('and it says so', /is the newest build, and you already have it/.test(body));

  /* AN ABSENT ANSWER IS NOT A REFUSAL. A desktop has no installed app, and a
     phone can answer without a version, so both fall through to the download
     rather than reporting the reader is current. */
  ok('an unknown version still offers the file',
    /have\s*\n?\s*\? `Yeetlist \$\{tag\} is newer/.test(body));

  /* THE STAMP IS THE VERSION, and the Java on the phone holds the same
     formula. Two arithmetics for one question disagree the first time either
     moves. */
  ok('the page reads the stamp the same way the app does',
    /return Number\(m\[1\]\) \* 100 \+ Number\(m\[2\]\);/.test(code));

  /* ONE ITEM, NEVER TWO. Two menu entries running one function is two ways to
     do one thing, and the second one drifts. */
  {
    const items = (html.match(/data-get="apk"/g) || []).length;
    ok('the menu carries one installer item', items === 1, String(items));
    ok('and it renames itself in the installed app',
      /item\.textContent = 'Check for Updates';/.test(code));
    ok('and the rename runs', /\nnameApkItem\(\);/.test(code));
  }
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

/* -- 10. The editor's own download --------------------------------------- */
{
  /* Their instruction, 22 September 2026: the download exists in the note
     editor too, beside the close button. */
  const bar = html.slice(html.indexOf('<header class="note-bar">'),
    html.indexOf('</header>', html.indexOf('<header class="note-bar">')));
  ok('the editor bar carries a download', /id="noteGet"/.test(bar), 'noteGet');
  ok('it opens the same menu', /aria-controls="noteGetMenu"/.test(bar));
  ok('it says it opens a menu', /id="noteGet"[\s\S]{0,200}aria-haspopup="menu"/.test(bar));
  ok('it is named for a reader', /aria-label="Download this note"/.test(bar));
  /* BESIDE THE CLOSE BUTTON, and before it, so the destructive delete keeps
     the far end on its own. */
  ok('it sits beside the close button',
    bar.indexOf('id="noteGet"') < bar.indexOf('id="noteBack"'), 'order');
  ok('and the delete is still last',
    bar.indexOf('id="noteBack"') < bar.indexOf('id="noteDelete"'), 'order');

  /* IT CARRIES NO id, because it always means the note that is open. A copy
     written onto it is a second answer that can go stale. */
  ok('the editor button names no note', !/id="noteGet"[^>]*data-id/.test(bar));
  /* THREE BUTTONS OPEN ONE MENU: a note's row, the editor's download, and
     the hamburger the whole bar folds into. */
  ok('the handler reaches all three buttons',
    /closest\?\.\('\.row-get, #noteGet, #noteMenu'\)/.test(ui));
  ok('and falls back to the open note', /getMenu\.button\.dataset\.id \|\| noteOpen/.test(ui));
  ok('it acts on nothing with no note', /if \(!id\) return;/.test(ui));
}

/* -- 11. The note card shows one date, and the download shares its line --- */
{
  /* Their instruction, 22 September 2026: show the last updated date on the
     left, and the download button at its right across the card. */
  ok('the card paints one date only', /tr:has\(\.cell-excerpt\) \.cell-added \{ display: none \}/.test(css));
  const placed = (css.match(/tr:has\(\.cell-excerpt\) \.cell-get \{[^}]*\}/) || [''])[0];
  ok('the download sits on the date line', /grid-row: 3/.test(placed), placed.slice(0, 90));
  ok('and at the card’s end edge', /justify-self: end/.test(placed));
  ok('it is centred on that line', /align-self: center/.test(placed));

  /* IT LEFT LINE 1, so the download is never part of the corner pair.
     SINCE 25 SEPTEMBER 2026 EVERY CARD HOLDS A PAIR THERE, the fold chevron
     and the cross, so the pair spacing applies to every card and a bookmark's
     pencil sits one more pair along. */
  ok('the download never joins the corner pair', !/:has\(\.cell-get\)\)? \{[\s\S]{0,60}--row-pair/.test(css));
  ok('every card states the pair spacing', /tbody tr \{\s*--row-pair/.test(css));
  ok('and a bookmark title clears its pencil as well',
    /tr:has\(\.cell-edit\) \.cell-title \{[\s\S]{0,160}var\(--row-pair\) \* 2/.test(css) && !/cell-get\) \.cell-title/.test(css));
}

/* -- 12. The editor folds to two rows ------------------------------------ */
{
  /* Their instruction, 22 September 2026: download and delete inside a
     hamburger, the four marks on one full-width row, and the style control
     sharing the next row with the three lists. */
  const bar = html.slice(html.indexOf('<header class="note-bar">'),
    html.indexOf('</header>', html.indexOf('<header class="note-bar">')));
  ok('the bar carries a hamburger', /id="noteMenu"/.test(bar));
  ok('it is a square with no words', !/>[A-Za-z]/.test(bar.slice(bar.indexOf('id="noteMenu"'),
    bar.indexOf('</button>', bar.indexOf('id="noteMenu"')))), 'no label');
  /* IT ONLY EXISTS WHERE THE BAR RAN SHORT. */
  ok('it is absent by default', /#noteMenu \{ display: none \}/.test(css));
  ok('and the two actions fold into it',
    /#noteGet,\s*#noteDelete \{ display: none \}[\s\S]{0,80}#noteMenu \{ display: inline-flex \}/.test(css));

  /* THE MENU HOLDS THE THREE FORMATS AND THE DELETE, flat. A download that
     opened a second menu would cost a press and say nothing new. */
  ok('the menu adds a delete for the hamburger', /button\.id !== 'noteMenu'\) return formats/.test(ui));
  ok('under a rule', /multi-sep[^`]*aria-hidden="true"/.test(ui));
  ok('and it says it is destructive', /multi-option multi-danger/.test(ui));
  ok('the danger item has its own colour', /\.multi-option\.multi-danger \{ color: var\(--danger-quiet\) \}/.test(css));
  /* IT CLOSES THE NOTE FIRST, or the editor sits open over a record that has
     gone. */
  ok('the delete closes the note first',
    /action === 'delete'\) \{ closeNote\(\); openDelete\(\[id\]\); return; \}/.test(ui));

  /* THE TWO GROUPS ARE NAMED, so the narrow layout can place each one. */
  ok('the marks group is named', /class="note-tool-group note-marks"/.test(html));
  ok('the lists group is named', /class="note-tool-group note-lists"/.test(html));

  /* TWO SUMS, BECAUSE A MARK IS 36 UNDER A MOUSE AND 44 UNDER A FINGER. One
     number left a finger at 520px with the lists wrapped on their own. */
  ok('the fold reads both pointers',
    /@media \(max-width: 503px\), \(pointer: coarse\) and \(max-width: 559px\)/.test(css));
  ok('and so does the third row',
    /@media \(max-width: 323px\), \(pointer: coarse\) and \(max-width: 347px\)/.test(css));

  /* THE MARKS TAKE A FULL LINE AND THE PAIR SHARES THE NEXT. */
  ok('the marks span the row', /\.note-marks \{ grid-column: 1 \/ -1; grid-row: 1 \}/.test(css));
  ok('the lists sit beside the style control', /\.note-lists \{ grid-column: 2; grid-row: 2 \}/.test(css));
  ok('the style control keeps its measured width',
    /\.multi\.note-level \{ grid-column: 1; grid-row: 2 \}/.test(css)
    && /\.multi\.note-level \{ width: 168px/.test(css));

  /* A STRETCHED MARK IS NO LONGER A SQUARE, so the ratio has to go or the
     height reads the grown width. */
  const stretch = (css.match(/\.note-tool-group > \.note-tool \{[^}]*\}/) || [''])[0];
  ok('the marks stretch', /flex: 1 1 0/.test(stretch), stretch.slice(0, 80));
  ok('and the square ratio is released', /aspect-ratio: auto/.test(stretch));
}

/* -- 13. The title is its own field -------------------------------------- */
{
  /* Their instruction, 22 September 2026: "changing the title of a blank
     note should not automatically change its first line too!", then "the
     title is a separate thing!"
     Measured before: typing "Groceries" into a blank note's title left the
     body as <p>Groceries</p> and the file as "Groceries". */
  const rename = ui.slice(ui.indexOf('function renameNote('));
  const body = rename.slice(0, rename.indexOf('\n}\n'));
  ok('renameNote was found', body.length > 10, String(body.length));
  /* IT NEVER TOUCHES THE BODY. That is the whole fault. */
  ok('renaming writes nothing into the note',
    !/noteBody/.test(body) && !/firstElementChild/.test(body) && !/textContent/.test(body), body);
  ok('it only asks for a save', /saveNote\(\)/.test(body));

  const save = ui.slice(ui.indexOf('function saveNote('));
  const sbody = save.slice(0, save.indexOf('\n}\n'));
  ok('the save reads the field', /noteEl\('noteTitle'\)\.value\.trim\(\)/.test(sbody));
  /* THE STORED NAME, AND A DISPLAY NAME DERIVED FROM IT. A note with no name
     of its own is still named in the list by its own first line. */
  ok('the stored name wins', /const title = name \|\| NOTES\.titleOf\(body\)/.test(sbody));
  ok('an empty name is no name', /if \(name\) note\.name = name; else delete note\.name/.test(sbody));
  ok('the list name is stored too', /note\.title = title/.test(sbody));

  /* THE FIELD SHOWS THE STORED NAME AND NOTHING ELSE. Showing the derived
     one would freeze it the moment a reader edited the first line. */
  const paint = ui.slice(ui.indexOf('function paintTitle('));
  const pbody = paint.slice(0, paint.indexOf('\n}\n'));
  ok('the field shows the stored name', /field\.value = note\?\.name \|\| ''/.test(pbody), pbody.slice(-90));
  ok('and never the body', !/noteBody/.test(pbody), pbody);

  /* A NOTE WITH NO NAME TAKES ITS FIRST LINE, ONCE, ON CLOSE. Their
     instruction: "if no title is added, it inherits one from the first line
     of the note as soon as it's closed". */
  const adopt = ui.slice(ui.indexOf('function adoptTitle('));
  const abody = adopt.slice(0, adopt.indexOf('\n}\n'));
  ok('adoptTitle was found', abody.length > 60, String(abody.length));
  ok('it runs on close', /saveNote\(\{ now: true \}\);\s*adoptTitle\(\);/.test(ui));
  /* ONCE. A note that already has a name keeps it, or the title goes back to
     tracking the body, which is the fault this whole change removes. */
  ok('a named note keeps its name', /if \(!note \|\| note\.name/.test(abody), abody.slice(0, 90));
  /* AND AN EMPTY NOTE INHERITS NOTHING, because there is no first line. */
  ok('an empty note inherits nothing', /if \(!line\) return;/.test(abody));
  ok('it stores both names', /note\.name = NOTES\.titleOf\(note\.body\)/.test(abody)
    && /note\.title = note\.name/.test(abody));

  /* AND THE FILE CARRIES IT, above the note the way the tags are. Left in
     the payload alone, a person reading yeetnotes.md saw no name. */
  ok('the notes file states the name', /> Name: \$\{cell\(n\.name\)\}/.test(code));
  ok('and a named empty note needs no invented heading',
    /n\.name \? \[\] : \[`# \$\{n\.title \|\| 'Untitled note'\}`\]/.test(code));
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
