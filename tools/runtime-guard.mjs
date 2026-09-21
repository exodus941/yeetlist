#!/usr/bin/env node
/* THE RUNTIME SITS BESIDE THE COUNT, SO IT IS SHORT.
 *
 * Their instruction, 22 September 2026: put the time counter next to the
 * count, and "we can even display it as 5d 23h 34m (in fact if it starts to
 * go into DAYS, remove the seconds display)".
 *
 * THE SECONDS RULE IS ANSWERED BY CONSTRUCTION, NOT BY A SECOND TEST. The
 * formatter shows three units from the largest that is not zero, so once days
 * are present the third unit is minutes and no seconds can appear. That is
 * worth a guard precisely because nothing in the code says "seconds" and
 * "days" in one place: a later edit to the unit count breaks their rule with
 * no line to read.
 *
 * IT EVALUATES THE REAL FUNCTION, sliced out of app.js, so a rewrite fails
 * this rather than leaving a copy agreeing with itself.
 */
import { appSource, slice as sliceOne } from './slice-app.mjs';

const src = appSource();
const app = new Function([sliceOne(src, 'runtime'), 'return { runtime };'].join('\n'))();
const { runtime } = app;

const cases = [];
const ok = (name, pass, note = '') => cases.push({ name, pass, note });
const same = (name, got, want) => ok(name, got === want, `${JSON.stringify(got)} against ${JSON.stringify(want)}`);

const D = 86400;
const H = 3600;
const M = 60;

/* -- 1. Their own examples ------------------------------------------------- */
same('their compact example', runtime(5 * D + 23 * H + 34 * M), '5d 23h 34m');
same('the figure they had on screen', runtime(244 * H + 31 * M + 11), '10d 4h 31m');

/* -- 2. Three units, from the largest that is not zero --------------------- */
same('days, hours, minutes', runtime(2 * D + 3 * H + 4 * M + 5), '2d 3h 4m');
same('hours, minutes, seconds', runtime(3 * H + 4 * M + 5), '3h 4m 5s');
same('minutes and seconds', runtime(4 * M + 5), '4m 5s');
same('seconds alone', runtime(5), '5s');
same('nothing at all', runtime(0), '0s');

/* -- 3. NO SECONDS ONCE IT REACHES DAYS, which is their rule --------------- */
for (const total of [D, D + 1, D + 59, 2 * D + 3 * H + 4 * M + 59,
  9 * D + 23 * H + 59 * M + 59, 365 * D + 12345]) {
  const out = runtime(total);
  ok(`no seconds at ${(total / D).toFixed(2)} days`, !/\d+s\b/.test(out), out);
  ok(`and it still says days at ${(total / D).toFixed(2)}`, /^\d+d\b/.test(out), out);
}

/* AND SECONDS SURVIVE UNDER A DAY, or the rule has eaten more than it was
   asked to. A day minus one second is the boundary. */
{
  const out = runtime(D - 1);
  same('one second under a day keeps its seconds', out, '23h 59m 59s');
}

/* -- 4. A zero in the middle stays, a trailing zero goes ------------------- */
same('a zero hour in the middle stays', runtime(5 * D + 34 * M), '5d 0h 34m');
same('a zero minute in the middle stays', runtime(3 * H + 5), '3h 0m 5s');
same('a trailing zero minute goes', runtime(5 * D + 23 * H), '5d 23h');
same('a trailing zero second goes', runtime(4 * M), '4m');
same('two trailing zeros go', runtime(5 * D), '5d');
same('a whole hour is one unit', runtime(H), '1h');

/* -- 5. Never more than three units, and never a leading zero -------------- */
for (const total of [0, 1, 59, 60, 61, 3599, 3600, 86399, 86400, 86401,
  100 * D + 7, 244 * H + 31 * M + 11, 5 * D + 23 * H + 34 * M]) {
  const out = runtime(total);
  const units = out.split(' ');
  ok(`at most three units for ${total}`, units.length <= 3, out);
  ok(`no leading zero for ${total}`, !/^0[dhms]/.test(out) || out === '0s', out);
  ok(`every unit is labelled for ${total}`, units.every((u) => /^\d+[dhms]$/.test(u)), out);
  ok(`no trailing zero unit for ${total}`, units.length === 1 || !/^0/.test(units[units.length - 1]), out);
}

/* -- 6. It is short, which is the whole reason it changed ------------------ */
/* THE OLD FORM WAS 223.2px OF INK at 375, against 343 available beside a
   116.2px count. Characters are a proxy a plain test can hold, and the two
   numbers are in the commit. */
for (const total of [244 * H + 31 * M + 11, 999 * D, D - 1]) {
  ok(`the string stays short for ${total}`, runtime(total).length <= 12, runtime(total));
}

/* -- 7. The list spec no longer puts a word before the noun --------------- */
{
  const lists = src.slice(src.indexOf('const LISTS'), src.indexOf('const sorts'));
  const heads = [...lists.matchAll(/^\s*head: '([^']*)',/gm)].map((m) => m[1]);
  ok('every list states its head', heads.length === 3, heads.join(' | '));
  ok('and none of them puts a word in front of the noun',
    heads.every((h) => h === ''), heads.join(' | '));
}

/* -- Verdict --------------------------------------------------------------- */
let bad = 0;
for (const c of cases) {
  if (!c.pass) { bad += 1; console.log(`runtime guard: FAIL ${c.name} - ${c.note}`); }
}
if (!cases.length) {
  console.error('runtime guard: no cases ran, so nothing was measured');
  process.exit(1);
}
console.log(`runtime guard: ${cases.length - bad} of ${cases.length} cases hold`);
process.exit(bad ? 1 : 0);
