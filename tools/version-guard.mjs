/* THE BUILD STAMP IS A RULE NOBODY CAN REMEMBER, SO A GUARD ASKS IT.
   VERSION sat at 260917-1 through thirteen pushes. The number beside the
   wordmark named a build the reader was not running, and the deployed site
   was the only place that showed it.

   The stamp names the commit it ships in: the date as YYMMDD, then the
   position of that commit among the day's commits. This runs before the
   commit exists, so the expected count is today's commits plus the one being
   made.

   It reads HEAD rather than origin/main. The stamp travels with the commit,
   and origin can be several pushes behind. The comment beside VERSION said
   origin, which is how the count drifted in the first place. */

import { execFileSync } from 'node:child_process';
import { appVersion, SOURCE } from './app-version.mjs';

const today = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
};

/* A REPOSITORY WITH NO COMMITS ANSWERS NOTHING, so the count is zero rather
   than a crash. git rev-list exits non-zero on an unborn branch. */
function commitsToday(stamp) {
  try {
    const out = execFileSync('git', [
      'log', 'HEAD', '--date=format:%y%m%d', '--pretty=%ad',
    ], { encoding: 'utf8' });
    return out.split('\n').filter((line) => line.trim() === stamp).length;
  } catch {
    return 0;
  }
}

/* ONE PARSER, TWO CALLERS. The Android build names the app with this same
   stamp, so a second reading of app.js is a second answer to one question.

   A RUN THAT MEASURED NOTHING IS NOT A PASS. appVersion throws when the
   declaration is renamed, moved or reshaped, and this guard would otherwise
   be silent for as long as it existed. */
let reading;
try {
  reading = appVersion('.');
} catch (error) {
  console.error(`version guard: ${error.message}`);
  process.exit(1);
}
const found = [null, reading.name];

const stamp = today();
const want = `${stamp}-${commitsToday(stamp) + 1}`;

if (found[1] !== want) {
  console.error(`version guard: VERSION reads ${found[1]}, and this commit is ${want}.`);
  console.error(`  Set VERSION to '${want}' in ${SOURCE}, then commit again.`);
  process.exit(1);
}

console.log(`version guard: VERSION ${found[1]} names this commit`);
