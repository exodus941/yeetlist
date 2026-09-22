#!/usr/bin/env node
/* THE RELEASE ROUTINE, AS A TOOL RATHER THAN FROM MEMORY.
 *
 * After every build: keep only the newest release, drop the `.aab` that
 * cannot be installed on a phone, and trim the line that names it.
 *
 * A RUN THAT READ NOTHING MUST NOT WRITE. On 22 September 2026 the read of
 * the notes lost its connection mid-pipeline, the shell wrote an empty file,
 * and the empty file was applied. The release then carried no notes at all
 * until they were put back by hand. Every step here refuses rather than
 * writing what it could not read.
 *
 * NOTHING IS DELETED THAT CANNOT BE REBUILT. A release whose notes name a
 * milestone is kept, and the newest is never deleted.
 *
 * `--dry-run` says what it would do. `--self-test` proves the refusals fire,
 * which a dry run against a healthy release cannot.
 */
import { execFileSync } from 'node:child_process';

const REPO = 'exodus941/yeetlist';
const KEEP = /milestone/i;
const LINE = 'The `.aab` is the Play Store format.';

/* -- The two decisions, as functions, so the refusals can be proven ------- */

/* SHORT IS THE FINGERPRINT OF A READ THAT FAILED. The real notes run past 500
   characters, and a connection that drops mid-command leaves nothing at all. */
export function checkNotes(notes) {
  const len = String(notes || '').trim().length;
  if (len < 100) throw new Error(`the notes read back as ${len} characters, which is too few to be real`);
  return len;
}

/* AND THE TRIM HAS TO REMOVE THAT LINE AND NOTHING ELSE. A filter that
   matched more would quietly shorten the notes every run. */
export function trimNotes(notes) {
  checkNotes(notes);
  if (!notes.includes(LINE)) return null;
  const trimmed = notes.split('\n').filter((l) => l.trim() !== LINE).join('\n').replace(/\n+$/, '\n');
  const lost = notes.length - trimmed.length;
  if (lost < LINE.length || lost > LINE.length + 4) {
    throw new Error(`the trim moved ${lost} characters where about ${LINE.length} was expected`);
  }
  checkNotes(trimmed);
  return trimmed;
}

/* -- The self-test -------------------------------------------------------- */
if (process.argv.includes('--self-test')) {
  const cases = [];
  const ok = (name, pass, note = '') => cases.push({ name, pass, note });
  const throws = (name, fn, expect) => {
    try { fn(); ok(name, false, 'it returned rather than refusing'); }
    catch (e) { ok(name, e.message.includes(expect), e.message); }
  };

  const real = [
    'Install `yeetlist-260922-27.apk` on the phone. Android asks once',
    'for permission to install from this source.',
    '',
    '**You only have to do this once.** From here the app checks this',
    'page on every launch, downloads a newer APK when it finds one and',
    "hands it to Android's installer, which asks you to confirm.",
    'Android has no silent install outside the Play Store.',
    '',
    'The app loads the live site, so everything inside it is already',
    'current. A new APK is only needed when the shell changes: the',
    'icons, the share target, the updater, the manifest or this',
    'version.',
    '',
    LINE,
    '',
  ].join('\n');

  /* THE FAULT THAT COST THE NOTES. */
  throws('an empty read refuses', () => trimNotes(''), 'too few to be real');
  throws('and so does a truncated one', () => trimNotes('Install `yeetlist'), 'too few to be real');
  throws('a null read refuses', () => trimNotes(null), 'too few to be real');

  /* THE TRIM ITSELF. */
  const out = trimNotes(real);
  ok('the line goes', !out.includes(LINE));
  ok('and everything else stays', out.includes('Install `yeetlist-260922-27.apk`')
    && out.includes('icons, the share target, the updater'));
  ok('the file still ends with one newline', /[^\n]\n$/.test(out), JSON.stringify(out.slice(-12)));
  ok('only that line was lost', real.length - out.length === LINE.length + 2,
    String(real.length - out.length));

  /* A SECOND RUN IS NOT A SECOND TRIM. */
  ok('a release already trimmed is left alone', trimNotes(out) === null);

  /* AND A FILTER THAT ATE MORE WOULD BE CAUGHT. Two copies of the line make
     the trim remove twice what one costs, which is what a widened match would
     do on a real release. */
  throws('a trim that removed too much refuses',
    () => trimNotes(real.replace(LINE, `${LINE}\n${LINE}`)),
    'where about');

  let bad = 0;
  for (const c of cases) {
    console.log(`tidy self-test: ${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.pass ? '' : ' - ' + c.note}`);
    if (!c.pass) bad += 1;
  }
  console.log(`tidy self-test: ${cases.length - bad} of ${cases.length} clauses hold`);
  process.exit(bad ? 1 : 0);
}

/* -- The run -------------------------------------------------------------- */
const dry = process.argv.includes('--dry-run');
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });
const step = (words) => console.log(`tidy: ${words}`);
const refuse = (words) => { console.error(`tidy: REFUSED, ${words}`); process.exit(1); };
const firstLine = (e) => String(e.message).split('\n')[0];

let list;
try {
  list = JSON.parse(gh('release', 'list', '--repo', REPO, '--limit', '30', '--json', 'tagName,isLatest'));
} catch (error) { refuse(`the release list could not be read: ${firstLine(error)}`); }
if (!Array.isArray(list) || !list.length) refuse('the release list came back empty');

const newest = list.find((r) => r.isLatest);
if (!newest) refuse('no release is marked latest, so there is nothing to keep');
step(`newest is ${newest.tagName}, ${list.length} in all`);

for (const release of list) {
  if (release.tagName === newest.tagName) continue;
  let body;
  try {
    body = gh('release', 'view', release.tagName, '--repo', REPO, '--json', 'body', '-q', '.body');
  } catch (error) {
    refuse(`${release.tagName} could not be read, so it was not deleted: ${firstLine(error)}`);
  }
  if (KEEP.test(body)) { step(`keeping ${release.tagName}, its notes name a milestone`); continue; }
  if (dry) { step(`would delete ${release.tagName}`); continue; }
  gh('release', 'delete', release.tagName, '--repo', REPO, '--yes', '--cleanup-tag');
  step(`deleted ${release.tagName}`);
}

let assets;
try {
  assets = JSON.parse(gh('release', 'view', newest.tagName, '--repo', REPO, '--json', 'assets'))
    .assets.map((a) => a.name);
} catch (error) { refuse(`the assets could not be read: ${firstLine(error)}`); }

if (!assets.some((n) => n.endsWith('.apk'))) refuse('the newest release carries no .apk, so nothing was changed');
const bundle = assets.find((n) => n.endsWith('.aab'));
if (!bundle) step('no bundle to drop');
else if (dry) step(`would drop ${bundle}`);
else { gh('release', 'delete-asset', newest.tagName, bundle, '--repo', REPO, '--yes'); step(`dropped ${bundle}`); }

let notes;
try {
  notes = gh('release', 'view', newest.tagName, '--repo', REPO, '--json', 'body', '-q', '.body');
} catch (error) {
  refuse(`the notes could not be read, so they were not rewritten: ${firstLine(error)}`);
}

let trimmed;
try { trimmed = trimNotes(notes); } catch (error) { refuse(firstLine(error)); }

if (trimmed === null) step('the notes already name no bundle');
else if (dry) step(`would trim ${notes.length - trimmed.length} characters`);
else {
  execFileSync('gh', ['release', 'edit', newest.tagName, '--repo', REPO, '--notes-file', '-'],
    { input: trimmed, encoding: 'utf8' });
  /* READ IT BACK. A write that reported success is not a write that landed. */
  const after = gh('release', 'view', newest.tagName, '--repo', REPO, '--json', 'body', '-q', '.body');
  if (after.includes(LINE)) refuse('the line is still there after the edit');
  try { checkNotes(after); } catch (error) { refuse(`the edit emptied the notes: ${firstLine(error)}`); }
  step(`trimmed, notes now ${after.trim().length} characters`);
}

console.log(`tidy: ${newest.tagName} is the only release, with its .apk and no bundle line`);
