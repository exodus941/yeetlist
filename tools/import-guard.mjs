#!/usr/bin/env node
/* A LINK IN THE FILE HAS TO REACH A LIST.
 *
 * A text file of links arrived holding YouTube addresses and many others.
 * Only the YouTube ones were imported. The cause was not the YouTube reader.
 * A video id is swept out of the whole text at the end, so it survives any
 * line shape, while a page address only survived a line the prose rules
 * accepted as an entry.
 *
 * So the shapes are the guard. Six of them took the video and dropped every
 * other link: an indented line, a tab-indented line, several addresses on
 * one line, an address with words after it, a quoted address, and an address
 * followed by its own title.
 *
 * AND THE OTHER HALF IS THAT PROSE MUST STAY PROSE. A note or an article
 * cites addresses rather than saving them, so a document has to keep taking
 * only its marked entries. A guard proving the links arrive is half a guard.
 *
 * IT EVALUATES THE REAL SCANNERS, taken out of app.js as one run, so a
 * rewrite fails this rather than leaving a copy agreeing with itself.
 */
import { appSource, region } from './slice-app.mjs';

/* The two helpers the run calls and does not declare. Their own homes are
   elsewhere in app.js, above the import section. */
const outside = `
const linkId = (value) => { const url = new URL(value); url.hash = ''; return url.toString().replace(/\\/$/, ''); };
const withScheme = (raw) => (/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw);
`;

const body = [outside, region(appSource(), 'VIDEO_ID', 'importRun'),
  'return { linksIn, listLike, videoIdFrom };'].join('\n\n');
// eslint-disable-next-line no-new-func
const app = new Function(body)();

const cases = [];
const ok = (name, pass, note = '') => cases.push({ name, pass, note });

const read = (text) => {
  const { clips, pages } = app.linksIn(text, false);
  return { clips: [...clips], pages: [...pages.keys()], names: [...pages.values()] };
};

const YT = 'https://youtu.be/dQw4w9WgXcQ';
const A = 'https://a.example/1';
const B = 'https://b.example/2';

/* -- 1. Every line shape a link list takes ------------------------------- */
const shapes = {
  'one address a line': `${A}\n${B}`,
  'a video among them': `${A}\n${YT}\n${B}`,
  'indented with spaces': `  ${A}\n  ${B}`,
  'indented with a tab': `\t${A}\n\t${B}`,
  'several on one line': `${A} ${B}`,
  'quoted': `"${A}"\n"${B}"`,
  'in angle brackets': `<${A}>\n<${B}>`,
  'with a list marker': `- ${A}\n- ${B}`,
  'numbered': `1. ${A}\n2. ${B}`,
  'a trailing comma': `${A},\n${B},`,
  'carriage returns': `${A}\r\n${B}\r\n`,
  'blank lines between': `${A}\n\n${B}`,
  'a name after it': `${A} Some Site\n${B} Another Site`,
  'a name before it': `Some Site - ${A}\nAnother Site - ${B}`,
  'a markdown link': `[Some Site](${A})\n[Another](${B})`,
};
for (const [name, text] of Object.entries(shapes)) {
  const got = read(text);
  ok(`${name}: both addresses arrive`,
    got.pages.includes(A) && got.pages.includes(B), got.pages.join(' '));
}

/* THE VIDEO STILL SORTS ITSELF, and it never lands in the bookmarks. */
{
  const got = read(`${A}\n${YT}\n${B}`);
  ok('the video goes to the videos', got.clips.join() === 'dQw4w9WgXcQ', got.clips.join());
  ok('the video is not also a bookmark',
    !got.pages.some((p) => p.includes('youtu')), got.pages.join(' '));
}

/* A NAME IS KEPT WHICHEVER SIDE OF THE ADDRESS IT SITS. */
{
  const after = read(`${A} Some Site`);
  ok('a name after the address is kept', after.names[0] === 'Some Site', after.names[0]);
  const before = read(`Some Site - ${A}\nAnother - ${B}`);
  ok('a name before the address is kept', before.names[0] === 'Some Site', before.names[0]);
  const md = read(`[Some Site](${A})\n[Another](${B})`);
  ok('a markdown name is kept', md.names[0] === 'Some Site', md.names[0]);
}

/* AN ADDRESS WITH NO SCHEME IS STILL AN ADDRESS, where `www.` says so. */
{
  const got = read('www.a.example/1\nwww.b.example/2');
  ok('a www address is taken', got.pages.length === 2, got.pages.join(' '));
  ok('and it gets a scheme',
    got.pages.every((p) => p.startsWith('https://')), got.pages.join(' '));
}

/* AN ASSET IS NOT A PAGE, whatever the file looks like. */
{
  const got = read(`${A}\nhttps://a.example/pic.jpg\n${B}`);
  ok('an image is still refused', got.pages.length === 2, got.pages.join(' '));
}

/* -- 2. Prose is still prose --------------------------------------------- */
const document = `# A Note About Things

I read an interesting piece today at https://cited.example/one and it made
me think. The author cites https://cited.example/two as the source, which is
worth a look.

Some more prose with no links at all in it, just words and more words that
carry the argument along for a while.

- ${A}
- ${B}

Another paragraph of prose. See also https://cited.example/three for
background. Nothing in this paragraph is a bookmark.`;
{
  ok('a citing document is not a list', !app.listLike(document));
  const got = read(document);
  ok('it keeps its marked entries',
    got.pages.includes(A) && got.pages.includes(B), got.pages.join(' '));
  ok('and takes none of its citations',
    !got.pages.some((p) => p.includes('cited')), got.pages.join(' '));
}

const readme = `# Project

Install it with npm. See the docs at https://docs.example/start for the
full guide, and the API reference at https://api.example/ref.

## Notes

Nothing else here at all, just words about how the thing works.`;
{
  ok('a readme is not a list', !app.listLike(readme));
  ok('so its citations are left alone', read(readme).pages.length === 0,
    read(readme).pages.join(' '));
}

/* AND A LIST IS A LIST. The two measurements are what separate them, so
   both verdicts are asserted rather than only the one that failed. */
ok('a bare dump is a list', app.listLike(`${A}\n${B}\n${YT}`));
ok('a titled list is a list', app.listLike(`Some Site - ${A}\nAnother Site - ${B}`));
ok('an empty file is not a list', !app.listLike(''));

/* -- Verdict ------------------------------------------------------------- */
let bad = 0;
for (const c of cases) {
  if (!c.pass) { bad += 1; console.log(`import guard: FAIL ${c.name} - ${c.note}`); }
}
if (!cases.length) {
  console.error('import guard: no cases ran, so nothing was measured');
  process.exit(1);
}
console.log(`import guard: ${cases.length - bad} of ${cases.length} cases hold`);
process.exit(bad ? 1 : 0);
