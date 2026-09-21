#!/usr/bin/env node
/* ONE MENU, TWO KINDS OF ITEM.
 *
 * Their instruction, 22 September 2026: add an option to download the latest
 * APK, called "Download APK Installer", in both the web and the app.
 *
 * THREE ITEMS WRITE A FILE OUT OF THE LISTS AND ONE FETCHES AN INSTALLER, so
 * the click handler branches. That is the thing worth holding: a branch keyed
 * on position, or one that falls through, sends the installer item into
 * `exportFile(undefined)` and silently writes a bookmarks file instead.
 *
 * AND THE RELEASE CARRIES BOTH FORMATS. Measured against the live release:
 * `yeetlist-260922-7.aab` and `yeetlist-260922-7.apk`. An `.aab` is the Play
 * Store's format and cannot be installed on a phone, so picking by extension
 * is the whole correctness of this feature.
 */
import { readFileSync } from 'node:fs';
import { appSource } from './slice-app.mjs';

const src = appSource();
const blank = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
const code = blank(src);
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const cases = [];
const ok = (name, pass, note = '') => cases.push({ name, pass, note });

/* -- 1. The item is there, and named what they asked for ------------------- */
ok('the menu offers the installer', html.includes('>Download APK Installer<'),
  (html.match(/>[^<]*APK[^<]*</) || ['none'])[0]);
ok('it is a menu item', /data-get="apk"[^>]*>|role="menuitem"[^>]*data-get="apk"/.test(html)
  || /<li class="multi-option" role="menuitem" tabindex="-1" data-get="apk">/.test(html), 'role');

/* IT IS KEYED ON AN ATTRIBUTE, NEVER ON ITS POSITION. A fourth scope added
   tomorrow would otherwise move the branch onto the wrong row. */
ok('it carries no export scope', !/data-get="apk"[^>]*data-scope/.test(html));
{
  const menu = html.slice(html.indexOf('id="exportMenu"'), html.indexOf('</ul>', html.indexOf('id="exportMenu"')));
  const scopes = [...menu.matchAll(/data-scope="([^"]+)"/g)].map((m) => m[1]);
  ok('the three list exports are still there', scopes.length === 3, scopes.join(' | '));
  ok('and every one names a scope', scopes.every(Boolean), scopes.join(' | '));
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

/* -- 3. The APK, never the bundle ----------------------------------------- */
{
  const fn = code.slice(code.indexOf('async function downloadApk()'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  ok('downloadApk was found', body.length > 200, String(body.length));
  ok('it picks a file ending .apk', /endsWith\('\.apk'\)/.test(body), 'apk');
  ok('and never mentions the bundle', !/\.aab/.test(body));

  /* THE NEWEST RELEASE NAMES ITSELF, so nothing here holds a version. */
  ok('it asks for the latest release', /releases\/latest/.test(body));
  ok('and no version is written in', !/26\d{4}-\d/.test(body), body.slice(0, 80));

  /* THE SAME REPOSITORY THE UPDATER ON THE DEVICE READS. Two names for one
     source is how a page offers an installer from somewhere else. */
  const updater = readFileSync(new URL('./android-updater.mjs', import.meta.url), 'utf8');
  const theirs = (updater.match(/const REPO = '([^']+)'/) || [])[1];
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
