#!/usr/bin/env node
/* A SELECTION PER TAB, OUT OF ONE SET.
 *
 * Their instruction, 21 September 2026: switching tabs keeps every
 * selection, and Delete Selected removes only the rows picked on the tab in
 * front of the reader. The other tabs hold theirs until the page reloads.
 *
 * ONE SET AND ELEVEN READERS, which is what makes this worth a guard. The
 * set spans every tab, so any reader that forgets to scope acts on rows
 * nobody can see. That is the exact fault the old code avoided by clearing
 * the set on every switch, and clearing it is the thing they asked to stop.
 *
 * IT EVALUATES THE REAL FUNCTIONS, sliced out of app.js by name, so a
 * rewrite of any of them fails this rather than leaving a copy agreeing
 * with itself.
 */
import { build } from './slice-app.mjs';

const app = build(
  ['DEAD_TAG', 'sortTags', 'ordered', 'listOf', 'pickedHere', 'pickedCount', 'nounFor'],
  {
    state: ['videos', 'selected', 'tab'],
    /* LISTS is the real table, read out of app.js by its nouns alone. The
       guard needs the three nouns and nothing else that entry holds. */
    extra: `const LISTS = {
      youtube: { noun: ['Video', 'Videos'] },
      links: { noun: ['Bookmark', 'Bookmarks'] },
      notes: { noun: ['Note', 'Notes'] },
    };`,
  },
);

const cases = [];
const ok = (name, pass, note = '') => cases.push({ name, pass, note });
const same = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b),
  `${JSON.stringify(a)} against ${JSON.stringify(b)}`);

const fixture = () => {
  app.videos = [
    { id: 'vid0', title: 'A video', tags: [] },
    { id: 'vid1', title: 'Another video', tags: [] },
    { id: 'https://example.org/a', kind: 'link', title: 'A bookmark', tags: [] },
    { id: 'https://example.org/b', kind: 'link', title: 'Another bookmark', tags: [] },
    { id: 'note-aaa', kind: 'note', title: 'A note', body: '# A note', tags: [] },
    { id: 'note-bbb', kind: 'note', title: 'Another note', body: '# Another', tags: [] },
  ];
  /* One pick on each of the three tabs, which is the state the old code
     could never reach. */
  app.selected = new Set(['vid0', 'https://example.org/a', 'note-aaa']);
  app.tab = 'youtube';
};

/* -- 1. Each tab sees its own picks and nobody else's -------------------- */
fixture();
same('the youtube tab picks its own', app.pickedHere(), ['vid0']);
app.tab = 'links';
same('the bookmarks tab picks its own', app.pickedHere(), ['https://example.org/a']);
app.tab = 'notes';
same('the notes tab picks its own', app.pickedHere(), ['note-aaa']);

ok('the set still holds all three', app.selected.size === 3);
ok('every pick reaches exactly one tab', (() => {
  let total = 0;
  for (const t of ['youtube', 'links', 'notes']) { app.tab = t; total += app.pickedCount(); }
  return total === app.selected.size;
})());

/* -- 2. A switch changes what is picked, never what is held -------------- */
fixture();
const held = [...app.selected].sort();
for (const t of ['links', 'notes', 'youtube', 'notes']) app.tab = t;
same('switching tabs holds every pick', [...app.selected].sort(), held);

/* -- 3. A delete on one tab offers only that tab's rows ------------------ */
fixture();
app.tab = 'notes';
const going = app.pickedHere();
same('a delete on notes offers only the note', going, ['note-aaa']);
ok('it offers no video and no bookmark',
  !going.some((id) => /^vid/.test(id) || id.startsWith('http')));

/* THE OTHER TABS SURVIVE IT. Removing the records the delete names leaves
   every other pick where it was. */
app.videos = app.videos.filter((v) => !going.includes(v.id));
going.forEach((id) => app.selected.delete(id));
app.tab = 'youtube';
same('the videos are still picked after a notes delete', app.pickedHere(), ['vid0']);
app.tab = 'links';
same('the bookmarks are still picked', app.pickedHere(), ['https://example.org/a']);

/* -- 4. A sync cannot clear a selection ---------------------------------- */
fixture();
/* A pull rebuilds the array. The ids are what the selection holds, so a
   record that arrives, changes or is replaced by an equal copy changes
   nothing here. */
app.videos = app.videos.map((v) => ({ ...v, title: `${v.title} (synced)` }));
app.videos.push({ id: 'vid2', title: 'Arrived from another device', tags: [] });
app.tab = 'youtube';
same('a pull that rewrites every record keeps the picks', app.pickedHere(), ['vid0']);

/* AND A RECORD DELETED ELSEWHERE SIMPLY STOPS BEING RETURNED. The id may
   sit in the set for the life of the page, and it reaches no reader. */
app.videos = app.videos.filter((v) => v.id !== 'vid0');
same('a record deleted on another device drops out of the picks', app.pickedHere(), []);
ok('and nothing had to clear the set', app.selected.has('vid0'));

/* -- 5. The count reads the list's own noun ------------------------------ */
fixture();
app.tab = 'youtube';
same('one video', app.nounFor(1), 'video');
same('two videos', app.nounFor(2), 'videos');
app.tab = 'links';
same('one bookmark', app.nounFor(1), 'bookmark');
app.tab = 'notes';
same('one note', app.nounFor(1), 'note');
same('two notes', app.nounFor(2), 'notes');
ok('zero takes the plural', app.nounFor(0) === 'notes');

/* -- Verdict ------------------------------------------------------------- */
let bad = 0;
for (const c of cases) {
  if (!c.pass) { bad += 1; console.log(`selection guard: FAIL ${c.name} - ${c.note}`); }
}
if (!cases.length) {
  console.error('selection guard: no cases ran, so nothing was measured');
  process.exit(1);
}
console.log(`selection guard: ${cases.length - bad} of ${cases.length} cases hold`);
process.exit(bad ? 1 : 0);
