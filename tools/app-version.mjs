/* ONE READER FOR THE BUILD STAMP. app.js declares it, the guard checks it, the
 * header paints it, and the Android build names the app with it. A second
 * parser is a second answer the day either one is edited.
 *
 * THE STAMP IS THE VERSION NAME, AND THE CODE IS DERIVED FROM IT. Android
 * takes any string as the name and demands a rising integer as the code.
 * `YYMMDD-N` carries both: the date rises every day and N rises within it, so
 * `YYMMDD * 100 + N` rises with every build and never repeats.
 *
 * 260921-7 is 26,092,107, against Play's ceiling of 2,100,000,000. The ceiling
 * is unreachable: the largest stamp this shape can hold is 991231-99, which is
 * 99,123,199.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SOURCE = 'app.js';

/* A DAY WITH MORE THAN 99 COMMITS WOULD COLLIDE WITH THE NEXT DAY'S FIRST, so
   it refuses rather than shipping a code that stops rising. */
const PER_DAY = 100;

export function appVersion(root = '.') {
  const text = readFileSync(`${root}/${SOURCE}`, 'utf8');
  const found = text.match(/^const VERSION = '([^']+)';$/m);
  if (!found) throw new Error(`no VERSION declaration in ${SOURCE}`);

  const name = found[1];
  const parts = /^(\d{6})-(\d+)$/.exec(name);
  if (!parts) throw new Error(`VERSION '${name}' is not YYMMDD-N`);

  const day = Number(parts[1]);
  const nth = Number(parts[2]);
  if (nth >= PER_DAY) throw new Error(`VERSION '${name}' passes ${PER_DAY - 1} builds in a day`);

  return { name, code: day * PER_DAY + nth };
}

/* Printed for a shell that cannot import a module. `--code` and `--name` give
   one value each, so a workflow reads them without a parser of its own.

   pathToFileURL, NEVER a hand-built `file://`. On Windows the two differ by a
   slash, so the comparison was false and the script printed nothing at all. */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { name, code } = appVersion(process.argv[3] || '.');
  const which = process.argv[2];
  if (which === '--code') console.log(code);
  else if (which === '--name') console.log(name);
  else console.log(`${name} ${code}`);
}
