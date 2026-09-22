#!/usr/bin/env node
/* A SHARE NEVER LANDS ON NOTES.
 *
 * Their instruction, 22 September 2026: a link shared to the Android app has
 * to reach the Bookmarks tab or the YouTube tab, "because they are both
 * capable of sorting links into their respective categories ... it never gets
 * shared to the Notes tab, because then it creates a note out of it, that i
 * cannot use."
 *
 * THE ADD WRITES A NOTE ON THAT TAB, WHICH IS CORRECT FOR THE BUTTON. The
 * reader pressing Add on Notes means a note. The reader did not choose the
 * tab a share arrives on, so the same branch is wrong there.
 *
 * IT EVALUATES THE REAL FUNCTIONS, sliced out of app.js, so a rewrite fails
 * this rather than leaving a copy agreeing with itself.
 */
import { appSource, slice as sliceOne } from './slice-app.mjs';

const src = appSource();

/* EVERY DEPENDENCY, OR A TRY/CATCH SWALLOWS THE MISSING ONE AND ANSWERS.
   Measured while writing this: `isYouTube` was left out, so `playlistOf`
   threw inside its own catch, returned null, and a playlist address reported
   as a bookmark. A wrong answer rather than an error. */
const app = new Function([
  sliceOne(src, 'isYouTube'),
  sliceOne(src, 'withScheme'),
  sliceOne(src, 'videoIdOf'),
  sliceOne(src, 'playlistOf'),
  sliceOne(src, 'listFor'),
  sliceOne(src, 'sharedLink'),
  'return { isYouTube, withScheme, videoIdOf, playlistOf, listFor, sharedLink };',
].join('\n\n'))();

const { withScheme, listFor, sharedLink } = app;

const cases = [];
const ok = (name, pass, note = '') => cases.push({ name, pass, note });
const same = (name, got, want) => ok(name, got === want, `${JSON.stringify(got)} against ${JSON.stringify(want)}`);

const where = (link) => listFor(withScheme(link));

/* -- 1. Every shared link lands on a list that sorts links ---------------- */
/* THE ONLY TWO ANSWERS THERE CAN BE. A third value here is a share reaching
   a list that cannot hold a link. */
const LINKS = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://youtu.be/dQw4w9WgXcQ',
  'https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
  'https://www.youtube.com/shorts/abc12345678',
  'https://www.youtube.com/playlist?list=PL1234567890',
  'https://www.youtube.com/@somechannel',
  'https://www.youtube.com/',
  'https://example.com/article',
  'https://news.example.co.uk/a/b?c=d#e',
  'example.com',
  'http://192.168.0.1:8080/page',
];

for (const link of LINKS) {
  const got = where(link);
  ok(`${link} lands on a list that sorts links`, got === 'youtube' || got === 'links', got);
  ok(`${link} never lands on notes`, got !== 'notes', got);
}

/* -- 2. And it lands on the RIGHT one -------------------------------------- */
same('a watch address is a video', where('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'youtube');
same('a short address is a video', where('https://youtu.be/dQw4w9WgXcQ'), 'youtube');
same('a short is a video', where('https://www.youtube.com/shorts/abc12345678'), 'youtube');
same('a playlist is the video list', where('https://www.youtube.com/playlist?list=PL1234567890'), 'youtube');

/* A YOUTUBE ADDRESS WITH NO VIDEO IN IT IS A BOOKMARK. A channel page is the
   commonest one, and the video endpoint can only answer about a video. */
same('a channel page is a bookmark', where('https://www.youtube.com/@somechannel'), 'links');
same('the bare site is a bookmark', where('https://www.youtube.com/'), 'links');
same('any other address is a bookmark', where('https://example.com/article'), 'links');

/* -- 3. The address is pulled out of a shared sentence -------------------- */
/* Chrome puts the address in `url` where the sending app separates it, and in
   `text` where it does not, which is most of them. */
{
  const p = (o) => new URLSearchParams(o);
  same('a separated address is taken whole',
    sharedLink(p({ url: 'https://youtu.be/abc' })), 'https://youtu.be/abc');
  same('an address inside a sentence is pulled out',
    sharedLink(p({ text: 'Watch this https://youtu.be/abc' })), 'https://youtu.be/abc');
  same('url wins over text',
    sharedLink(p({ url: 'https://youtu.be/abc', text: 'https://example.com/x' })), 'https://youtu.be/abc');
  same('a share with no address at all is nothing',
    sharedLink(p({ text: 'just some words' })), '');
}

/* -- 4. The share leaves the notes tab BEFORE the add ---------------------- */
/* THE ORDER IS THE WHOLE FIX. addVideo() reads `tab` on its first line, so a
   switch after the call changes nothing about which branch ran. */
{
  const share = sliceOne(src, 'takeShare');
  ok('the share handler was found', share.length > 100, String(share.length));

  /* BLANK THE COMMENTS BEFORE ASKING WHERE ANYTHING SITS. The comment above
     the fix names `addVideo()` while explaining it, so the first version of
     the ordering check found that mention and reported the add first. Blank
     them rather than deleting them, or every line number below shifts. */
  const code = share.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  ok('it leaves the notes tab',
    /if \(tab === 'notes'\) showTab\(/.test(share),
    (share.match(/tab === 'notes'[^\n]*/) || ['none'])[0]);
  ok('and it reads the one writer for where a link belongs',
    /showTab\(listFor\(withScheme\(link\)\)/.test(share));
  ok('and it switches without an animation, because nothing is on screen yet',
    /showTab\(listFor\(withScheme\(link\)\), \{ animate: false \}\)/.test(share));

  /* A MISSING NEEDLE RETURNS -1, AND -1 IS BEFORE EVERYTHING. Ask that both
     exist before comparing where they sit. */
  const leave = code.indexOf("tab === 'notes'");
  const add = code.indexOf('addVideo()');
  ok('the leave is there', leave > -1);
  ok('the add is there', add > -1);
  ok('and the leave comes first', leave > -1 && add > -1 && leave < add,
    `${leave} against ${add}`);
}

/* -- 5. One writer for where a link belongs ------------------------------- */
/* The add and the share both ask this, so neither can drift from the other. */
{
  const decl = (src.match(/function listFor\(url\)/g) || []).length;
  ok('the question is asked in one place', decl === 1, String(decl));
  ok('and the add reads it', /const target = listFor\(url\);/.test(src));
  ok('and nothing asks it the old way a second time',
    !/videoIdOf\(url\) \? 'youtube' : 'links'/.test(src.replace(/function listFor[\s\S]*?\n\}/, '')));
}

/* -- 6. The button still writes a note on the notes tab ------------------- */
/* The fix must not reach the case it was never about. A reader pressing Add
   on Notes still gets a note, with an empty field or a typed line. */
{
  const add = sliceOne(src, 'addVideo');
  ok('the add still writes a note on that tab',
    /if \(tab === 'notes'\) \{[\s\S]{0,120}newNote\(typed\);/.test(add));
}

/* -- Verdict --------------------------------------------------------------- */
let bad = 0;
for (const c of cases) {
  if (!c.pass) { bad += 1; console.log(`share guard: FAIL ${c.name} - ${c.note}`); }
}
if (!cases.length) {
  console.error('share guard: no cases ran, so nothing was measured');
  process.exit(1);
}
console.log(`share guard: ${cases.length - bad} of ${cases.length} cases hold`);
process.exit(bad ? 1 : 0);
