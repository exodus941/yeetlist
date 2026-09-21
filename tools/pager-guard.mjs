#!/usr/bin/env node
/* FIFTY ROWS DRAWN, AND EVERY RECORD STILL COUNTED.
 *
 * Their instruction, 21 September 2026: show about fifty entries at once and
 * put the rest behind a paginator, with every record still in memory so
 * search and filtering stay instant.
 *
 * SO THE PAGE IS NOT A FILTER, and that is the whole risk. Every count, the
 * runtime line, Select All and Delete Selected read the FILTERED set. Only
 * the rows drawn are cut. One reader that slices instead acts on fifty rows
 * and reports it as eight hundred.
 *
 * THE PAGE RESETS IN ONE PLACE. The tab, the sort, the search and the three
 * filters each change which records are shown. Written at six doors, the
 * seventh is the one that gets forgotten, so render() asks once, off a key.
 *
 * IT EVALUATES THE REAL FUNCTIONS, sliced out of app.js by name, so a
 * rewrite fails this rather than leaving a copy agreeing with itself.
 */
import { build } from './slice-app.mjs';

const app = build(['PAGE_SIZE', 'pageKey', 'lastPage', 'pageRun'], {
  state: ['tab', 'sort', 'searchTerm', 'activeTags', 'untaggedOnly', 'ratingFilter'],
});

const cases = [];
const ok = (name, pass, note = '') => cases.push({ name, pass, note });
const same = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b),
  `${JSON.stringify(a)} against ${JSON.stringify(b)}`);

const fixture = () => {
  app.tab = 'youtube';
  app.sort = { key: 'addedAt', dir: -1 };
  app.searchTerm = '';
  app.activeTags = new Set();
  app.untaggedOnly = false;
  app.ratingFilter = 'any';
};

/* -- 1. Fifty is the size, and it is read rather than restated ----------- */
ok('the page holds fifty', app.PAGE_SIZE === 50, String(app.PAGE_SIZE));

/* -- 2. How many pages a list has ---------------------------------------- */
const { lastPage, PAGE_SIZE: N } = app;
same('an empty list is one page', lastPage(0), 1);
same('one row is one page', lastPage(1), 1);
same('a full page is one page', lastPage(N), 1);
same('one more is two pages', lastPage(N + 1), 2);
same('800 rows are 16 pages', lastPage(800), 16);
ok('no list is ever zero pages', [0, 1, 7, N, N + 1, 800, 12345]
  .every((n) => lastPage(n) >= 1));

/* THE LAST PAGE IS NEVER EMPTY. Every page but the last holds fifty, and the
   last holds what is left, which is at least one row. */
ok('the last page always holds a row', [1, 7, N, N + 1, 99, 100, 101, 800]
  .every((n) => n - (lastPage(n) - 1) * N >= 1));
ok('and never more than fifty', [1, 7, N, N + 1, 99, 100, 101, 800]
  .every((n) => n - (lastPage(n) - 1) * N <= N));

/* -- 3. Every row reaches exactly one page ------------------------------- */
{
  const rows = Array.from({ length: 800 }, (_, i) => i);
  const seen = [];
  for (let p = 1; p <= lastPage(rows.length); p += 1) {
    seen.push(...rows.slice((p - 1) * N, (p - 1) * N + N));
  }
  same('every row is drawn once, in order', seen, rows);
}

/* -- 4. The key changes when the list does, and not otherwise ------------ */
fixture();
const base = app.pageKey();
same('the same state is the same key', app.pageKey(), base);

const moves = {
  'a different tab': () => { app.tab = 'links'; },
  'a different sort key': () => { app.sort = { key: 'title', dir: -1 }; },
  'the other direction': () => { app.sort = { key: 'addedAt', dir: 1 }; },
  'a search': () => { app.searchTerm = 'cat'; },
  'a tag filter': () => { app.activeTags = new Set(['music']); },
  'the untagged filter': () => { app.untaggedOnly = true; },
  'a rating filter': () => { app.ratingFilter = 3; },
};
for (const [name, move] of Object.entries(moves)) {
  fixture();
  move();
  ok(`${name} is a new list`, app.pageKey() !== base, app.pageKey());
}

/* THE ORDER TAGS WERE PICKED IN IS NOT A NEW LIST. The set is sorted into
   the key, so picking two tags the other way round stays on the page. */
fixture();
app.activeTags = new Set(['music', 'talks']);
const two = app.pageKey();
fixture();
app.activeTags = new Set(['talks', 'music']);
same('the tag order is not a change', app.pageKey(), two);

/* AND A RECORD ARRIVING IS NOT A NEW LIST EITHER. A sync rewrites the array
   and changes none of these, so a reader stays on the page they were on. */
fixture();
same('a sync does not move the reader', app.pageKey(), base);

/* -- 5. The run of pages a reader is offered ----------------------------- */
const { pageRun } = app;
same('one page needs no run', pageRun(1, 1), [1]);
same('three pages show all three', pageRun(2, 3), [1, 2, 3]);
same('five pages from the middle show all five', pageRun(3, 5), [1, 2, 3, 4, 5]);
same('sixteen pages from the start', pageRun(1, 16), [1, 2, null, 16]);
same('sixteen pages from the middle', pageRun(8, 16), [1, null, 7, 8, 9, null, 16]);
same('sixteen pages from the end', pageRun(16, 16), [1, null, 15, 16]);

/* A PAGE IS NEVER OFFERED TWICE, which a short list makes easy to do: page 2
   of 3 is both "one either side" and "the last". */
for (const [at, last] of [[1, 1], [2, 3], [3, 5], [1, 16], [8, 16], [16, 16], [2, 4], [4, 5]]) {
  const run = pageRun(at, last).filter((n) => n !== null);
  ok(`no page is offered twice at ${at} of ${last}`,
    new Set(run).size === run.length, run.join(' '));
  ok(`every page offered at ${at} of ${last} exists`,
    run.every((n) => n >= 1 && n <= last), run.join(' '));
  ok(`the page in front of the reader is offered at ${at} of ${last}`, run.includes(at));
  ok(`the first and the last are offered at ${at} of ${last}`,
    run.includes(1) && run.includes(last));
  /* A GAP MEANS SOMETHING IS MISSING. Between 1 and 2 there is nothing to
     hide, and a mark there names a page that does not exist. */
  const all = pageRun(at, last);
  ok(`a gap hides at least two pages at ${at} of ${last}`,
    all.every((n, i) => n !== null || all[i + 1] - all[i - 1] > 2), all.join(' '));

  /* AND A JUMP WITH NO MARK IS A PAGE THAT VANISHED. Proven by mutation:
     dropping the single-page clause left the run reading 1, 3, 4, 5, with
     page 2 offered nowhere and nothing saying it was hidden. Every other
     assertion here passed on it. */
  ok(`no page vanishes between two offered at ${at} of ${last}`,
    all.every((n, i) => n === null || i === 0 || all[i - 1] === null
      || n - all[i - 1] === 1), all.join(' '));
}

/* -- Verdict ------------------------------------------------------------- */
let bad = 0;
for (const c of cases) {
  if (!c.pass) { bad += 1; console.log(`pager guard: FAIL ${c.name} - ${c.note}`); }
}
if (!cases.length) {
  console.error('pager guard: no cases ran, so nothing was measured');
  process.exit(1);
}
console.log(`pager guard: ${cases.length - bad} of ${cases.length} cases hold`);
process.exit(bad ? 1 : 0);
