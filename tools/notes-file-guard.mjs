#!/usr/bin/env node
/* THE SPLIT HAS TO ROUTE EVERY RECORD TO EXACTLY ONE FILE.
 *
 * Notes live in yeetnotes.md and everything else in yeetlist.md, while both
 * share one array in memory. So three questions decide whether a sync is
 * safe, and none of them is visible by reading:
 *
 *   1. Does each payload carry its own records and nobody else's?
 *   2. Does adopting one file's merge leave the other file's records alone?
 *   3. Does the ping-pong guard actually hold when nothing changed?
 *
 * IT EVALUATES THE REAL SOURCE. The functions are sliced out of app.js by
 * name and run here, so a rewrite of any of them fails this rather than
 * leaving a copy in a test that agrees with itself.
 */
import { appSource, slice as sliceOne } from './slice-app.mjs';

const src = appSource();
const slice = (name) => sliceOne(src, name);

const NAMES = [
  'DEAD_TAG', 'PAYLOAD_VERSION', 'sortTags', 'ordered', 'normalise', 'listOf',
  'isNoteId', 'isNoteGrave', 'noteRecords', 'otherRecords', 'payload', 'notesPayload',
  'cell', 'notesText', 'parseFile', 'merge',
  'mineFor', 'localFor', 'adopt', 'digest', 'worthCreating', 'payloadFor',
];

/* `videos` and `tombstones` are the app's own state, so the harness supplies
   them and the sliced code writes them exactly as the app does. */
const body = [
  'let videos = [];',
  'let tombstones = [];',
  "const PAYLOAD_MARK = 'yeetlist:json';",
  ...NAMES.map(slice),
  'return {',
  '  get videos() { return videos; }, set videos(v) { videos = v; },',
  '  get tombstones() { return tombstones; }, set tombstones(t) { tombstones = t; },',
  `  ${NAMES.join(', ')} };`,
].join('\n\n');

// eslint-disable-next-line no-new-func
const app = new Function(body)();

const cases = [];
const ok = (name, pass, note = '') => cases.push({ name, pass, note });
const same = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b),
  `${JSON.stringify(a)} against ${JSON.stringify(b)}`);

/* -- The fixture: two watchlist rows, two notes, two deletions ----------- */
const fixture = () => {
  app.videos = [
    { id: 'dQw4w9WgXcQ', title: 'A video', channel: 'C', tags: ['a'], addedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'https://example.org/x', kind: 'link', title: 'A bookmark', url: 'https://example.org/x', tags: [], addedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'note-aaa-111111', kind: 'note', title: 'First', body: '# First\n\nSome words.', tags: ['b'], addedAt: '2026-01-03T00:00:00.000Z' },
    { id: 'note-bbb-222222', kind: 'note', title: 'Second', body: '# Second', tags: [], addedAt: '2026-01-04T00:00:00.000Z' },
  ];
  app.tombstones = [
    { id: 'oldVideoId1', at: '2026-01-05T00:00:00.000Z' },
    { id: 'note-ccc-333333', at: '2026-01-06T00:00:00.000Z' },
  ];
};

/* -- 1. Each file carries its own records -------------------------------- */
fixture();
same('the watchlist payload holds no note',
  app.payload().videos.map((v) => v.id).filter(app.isNoteId), []);
same('the watchlist payload holds both other kinds',
  app.payload().videos.map((v) => v.id), ['dQw4w9WgXcQ', 'https://example.org/x']);
same('the notes payload holds only notes',
  app.notesPayload().videos.map((v) => v.id), ['note-aaa-111111', 'note-bbb-222222']);
same('a video tombstone stays in the watchlist file',
  app.payload().deleted.map((t) => t.id), ['oldVideoId1']);
same('a note tombstone goes to the notes file',
  app.notesPayload().deleted.map((t) => t.id), ['note-ccc-333333']);
ok('every record reaches exactly one file',
  app.payload().videos.length + app.notesPayload().videos.length === app.videos.length,
  `${app.payload().videos.length} + ${app.notesPayload().videos.length} against ${app.videos.length}`);
ok('every tombstone reaches exactly one file',
  app.payload().deleted.length + app.notesPayload().deleted.length === app.tombstones.length);

/* A BOOKMARK'S ID IS ITS ADDRESS AND A VIDEO'S IS ELEVEN CHARACTERS, so
   neither can be read as a note. The routing rests on exactly this. */
ok('a YouTube id is not a note id', !app.isNoteId('dQw4w9WgXcQ'));
ok('a URL id is not a note id', !app.isNoteId('https://note-taking.example/x'));
ok('a note id is a note id', app.isNoteId('note-aaa-111111'));

/* A NOTE MADE BEFORE THE `note-` PREFIX EXISTED IS STILL A NOTE. Its grave
   carries the kind, so routing never depends on the id's shape. */
app.tombstones = [
  { id: 'n7uw8qzp90q3', at: '2026-01-07T00:00:00.000Z', kind: 'note' },
  { id: 'dQw4w9WgXcQ', at: '2026-01-08T00:00:00.000Z' },
];
same('a stamped grave goes to the notes file whatever its id',
  app.notesPayload().deleted.map((t) => t.id), ['n7uw8qzp90q3']);
same('an unstamped grave goes to the watchlist file',
  app.payload().deleted.map((t) => t.id), ['dQw4w9WgXcQ']);
ok('a grave written before the stamp still routes by its prefix',
  app.isNoteGrave({ id: 'note-old-000001', at: 'x' }));
ok('a watchlist grave is not a note grave', !app.isNoteGrave({ id: 'dQw4w9WgXcQ', at: 'x' }));

/* -- 2. Adopting one file leaves the other alone ------------------------- */
fixture();
app.adopt('notes', {
  videos: [{ id: 'note-zzz-999999', kind: 'note', title: 'Z', body: '# Z', tags: [] }],
  deleted: [],
});
same('a notes pull keeps every video and bookmark',
  app.videos.filter((v) => !app.isNoteId(v.id)).map((v) => v.id),
  ['dQw4w9WgXcQ', 'https://example.org/x']);
same('a notes pull replaces the notes',
  app.videos.filter((v) => app.isNoteId(v.id)).map((v) => v.id), ['note-zzz-999999']);
same('a notes pull keeps the video tombstone', app.tombstones.map((t) => t.id), ['oldVideoId1']);

fixture();
app.adopt('main', { videos: [{ id: 'newVideoId1', title: 'N', tags: [] }], deleted: [] });
same('a watchlist pull keeps every note',
  app.videos.filter((v) => app.isNoteId(v.id)).map((v) => v.id),
  ['note-aaa-111111', 'note-bbb-222222']);
same('a watchlist pull keeps the note tombstone',
  app.tombstones.map((t) => t.id), ['note-ccc-333333']);

/* -- 3. The ping-pong guard ---------------------------------------------- */
fixture();
same('an unchanged notes file is not pushed back',
  app.digest(app.payloadFor('notes')), app.digest(app.parseFile(app.notesText())));

/* A TIMESTAMP MOVES ON EVERY CALL, which is what defeated the old text
   comparison. Two payloads taken a moment apart must read as equal. */
fixture();
same('a fresh timestamp is not a change',
  app.digest(app.notesPayload()), app.digest(app.notesPayload()));

fixture();
const beforeEdit = app.digest(app.notesPayload());
app.videos = app.videos.map((v) => (v.id === 'note-aaa-111111' ? { ...v, body: '# Edited' } : v));
ok('an edited note IS a change', app.digest(app.notesPayload()) !== beforeEdit);

/* ORDER IS NOT A CHANGE. A merge returns its own order and the file holds
   the order it was written in. */
fixture();
const beforeSort = app.digest(app.notesPayload());
app.videos = [...app.videos].reverse();
same('a reordered list is not a change', app.digest(app.notesPayload()), beforeSort);

/* -- 4. The notes file reads, and round-trips ---------------------------- */
fixture();
const written = app.notesText();
ok('the notes file names itself', written.startsWith('# Yeetlist notes'), written.slice(0, 40));
ok('a note body appears above the payload',
  written.indexOf('Some words.') < written.indexOf('json'));
ok('a note tag appears above the payload', written.includes('> Tags: #b'));
same('the notes file round-trips its records',
  app.parseFile(written).videos.map((v) => v.id), ['note-aaa-111111', 'note-bbb-222222']);
same('the notes file round-trips its tombstones',
  app.parseFile(written).deleted.map((t) => t.id), ['note-ccc-333333']);
ok('the notes file carries no video', !written.includes('dQw4w9WgXcQ'));

/* -- 5. An empty notes list creates no file ------------------------------ */
app.videos = [{ id: 'dQw4w9WgXcQ', title: 'A video', tags: [] }];
app.tombstones = [];
ok('no note and no deletion means no notes file', !app.worthCreating('notes'));
ok('the watchlist file is always worth creating', app.worthCreating('main'));
app.tombstones = [{ id: 'note-ccc-333333', at: '2026-01-06T00:00:00.000Z' }];
ok('a note deletion alone still earns the file', app.worthCreating('notes'));
app.tombstones = [];
app.videos.push({ id: 'note-ddd-444444', kind: 'note', title: 'D', body: '# D', tags: [] });
ok('one note earns the file', app.worthCreating('notes'));

/* -- Verdict ------------------------------------------------------------- */
let bad = 0;
for (const c of cases) {
  if (!c.pass) { bad += 1; console.log(`notes file guard: FAIL ${c.name} - ${c.note}`); }
}
if (!cases.length) {
  console.error('notes file guard: no cases ran, so nothing was measured');
  process.exit(1);
}
console.log(`notes file guard: ${cases.length - bad} of ${cases.length} cases hold`);
process.exit(bad ? 1 : 0);
