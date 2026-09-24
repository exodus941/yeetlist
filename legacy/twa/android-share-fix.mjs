#!/usr/bin/env node
/* A SHARE ARRIVING WHILE THE APP IS ALREADY OPEN IS DROPPED, and the drop is
 * silent. Measured on an emulator, 21 September 2026: three shares in a row
 * added one row. Read from the page itself over the devtools bridge,
 * `performance.getEntriesByType('navigation')` held ONE entry. The second
 * share produced no navigation at all, so the page's own handler never ran.
 *
 * THE CAUSE IS ANDROID'S TASK MATCHING, not the library. A share carries
 * FLAG_ACTIVITY_NEW_TASK. Android then looks for a task whose ROOT intent
 * matches by action, data and categories, and extras are not compared. Two
 * SEND intents with no data match, so the task is brought forward and the new
 * intent is never delivered. LauncherActivity reads the share in onCreate,
 * which never runs.
 *
 * SO IT ONLY BITES WHEN THE TASK WAS ROOTED BY A SHARE. Opened from the
 * drawer, the root is MAIN/LAUNCHER, nothing matches, and every share lands.
 * That is why it looked fine: the first share of a session always works.
 *
 * FLAG_ACTIVITY_CLEAR_TOP FIXES IT, measured both ways on the same device.
 * With a SEND-rooted task, a plain share added nothing and the same share at
 * `-f 0x14000000` added the row. But the sharing app sets the flags, not us.
 *
 * SO A TRAMPOLINE TAKES THE SHARE AND RE-FIRES IT WITH THAT FLAG. It holds no
 * task of its own to be matched against: `noHistory` destroys it the moment
 * it stops, and `taskAffinity=""` keeps it out of the app's own task.
 *
 * IT IS APPLIED HERE RATHER THAN COMMITTED, because CI regenerates the whole
 * Android project from twa-manifest.json on every build. A hand edit to the
 * generated tree would be overwritten by the next `bubblewrap update`.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ACTIVITY = 'ShareActivity';

/* THE FILTER IS FOUND BY ITS ACTION, never by a line number. Bubblewrap's
   template puts the share filter first among the launcher's filters, and a
   template edit upstream would move it. */
export function findShareFilter(xml) {
  const filters = [...xml.matchAll(/<intent-filter[^>]*>[\s\S]*?<\/intent-filter>/g)];
  const hits = filters.filter((m) => m[0].includes('android.intent.action.SEND'));
  if (hits.length !== 1) {
    throw new Error(`${hits.length} intent-filters name SEND, and exactly one was expected`);
  }
  return { text: hits[0][0], start: hits[0].index, end: hits[0].index + hits[0][0].length };
}

export function patchManifest(xml) {
  if (xml.includes(`android:name="${ACTIVITY}"`)) {
    throw new Error(`${ACTIVITY} is already declared, so this ran twice`);
  }
  const filter = findShareFilter(xml);

  /* The filter comes OUT of the launcher, or two activities answer one share
     and Android offers the reader a chooser between them. */
  const without = xml.slice(0, filter.start) + xml.slice(filter.end);

  const block = `
        <activity android:name="${ACTIVITY}"
            android:exported="true"
            android:excludeFromRecents="true"
            android:noHistory="true"
            android:taskAffinity=""
            android:theme="@android:style/Theme.NoDisplay">
            ${filter.text.trim()}
        </activity>
`;

  /* It goes before </application>, which is the one anchor the template
     cannot move without the file ceasing to be a manifest. */
  const close = without.lastIndexOf('</application>');
  if (close < 0) throw new Error('the manifest holds no </application>');
  return without.slice(0, close) + block + without.slice(close);
}

export function activitySource(pkg) {
  return `package ${pkg};

/* THE SHARE IS RE-FIRED WITH CLEAR_TOP, because Android will not deliver it.
 * A share carries NEW_TASK, and a task already rooted by a share matches it
 * by action and data, so the task is brought forward and the intent is
 * dropped. CLEAR_TOP recreates LauncherActivity instead, and onCreate is
 * where the library reads the share.
 *
 * THIS ACTIVITY LEAVES NOTHING BEHIND, or it becomes the thing that matches.
 * noHistory ends it the moment it stops and taskAffinity="" keeps it out of
 * the app's own task.
 */
import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

public class ${ACTIVITY} extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Intent forward = new Intent(getIntent());
        forward.setClass(this, LauncherActivity.class);
        forward.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(forward);
        finish();
    }
}
`;
}

function main(root) {
  const manifestPath = `${root}/app/src/main/AndroidManifest.xml`;
  const twaPath = `${root}/twa-manifest.json`;
  if (!existsSync(manifestPath)) {
    console.error(`share fix: no manifest at ${manifestPath}, so nothing was patched`);
    process.exit(1);
  }
  const pkg = JSON.parse(readFileSync(twaPath, 'utf8')).packageId;
  if (!pkg) {
    console.error('share fix: twa-manifest.json states no packageId');
    process.exit(1);
  }

  const before = readFileSync(manifestPath, 'utf8');
  const after = patchManifest(before);
  writeFileSync(manifestPath, after);

  const dir = `${root}/app/src/main/java/${pkg.split('.').join('/')}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${ACTIVITY}.java`, activitySource(pkg));

  /* READ IT BACK. A patch that reports success without landing is the whole
     class of fault this file exists inside. */
  const back = readFileSync(manifestPath, 'utf8');
  const launcher = back.slice(back.indexOf('android:name="LauncherActivity"'),
    back.indexOf(`android:name="${ACTIVITY}"`));
  const ok = back.includes(`android:name="${ACTIVITY}"`)
    && back.includes('android:noHistory="true"')
    && !launcher.includes('android.intent.action.SEND')
    && (back.match(/android\.intent\.action\.SEND/g) || []).length === 1;
  console.log(`share fix: ${ACTIVITY} declared in ${pkg}, `
    + `SEND moved off LauncherActivity — ${ok ? 'ok' : 'THE PATCH DID NOT LAND'}`);
  process.exit(ok ? 0 : 1);
}

/* THE PATCH RUNS ONLY IN CI, WHERE NOTHING WATCHES IT, so it is proven here
   instead. Each case breaks one clause, and a case that stops failing is a
   patch that has gone quiet. */
function selfTest() {
  const FILTER = `            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>`;
  const sample = (filter) => `<manifest>
    <application>
        <activity android:name="LauncherActivity" android:exported="true">
${filter}
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
            </intent-filter>
        </activity>
    </application>
</manifest>`;

  const cases = [];
  const say = (name, pass, note = '') => cases.push({ name, pass, note });

  const out = patchManifest(sample(FILTER));
  const launcher = out.slice(out.indexOf('LauncherActivity'), out.indexOf(ACTIVITY));
  say('the launcher loses the filter', !launcher.includes('action.SEND'));
  say('the trampoline gains it',
    /<activity android:name="ShareActivity"[\s\S]*?action\.SEND[\s\S]*?<\/activity>/.test(out));
  say('SEND is declared once', (out.match(/action\.SEND/g) || []).length === 1);
  say('it sits inside the application', out.indexOf(ACTIVITY) < out.indexOf('</application>'));
  say('noHistory is stated', out.includes('android:noHistory="true"'));

  const refuses = (xml, why) => {
    try { patchManifest(xml); say(why, false, 'it did not refuse'); }
    catch (e) { say(why, true, e.message); }
  };
  refuses(out, 'a second run refuses');
  refuses(sample(''), 'no share filter refuses');
  refuses(sample(FILTER + '\n' + FILTER), 'two share filters refuse');
  refuses(sample(FILTER).replace('</application>', ''), 'no application element refuses');

  const java = activitySource('app.yeetlist.twa');
  say('the source names the package', java.startsWith('package app.yeetlist.twa;'));
  say('the source sets CLEAR_TOP', java.includes('FLAG_ACTIVITY_CLEAR_TOP'));

  let bad = 0;
  for (const c of cases) {
    if (!c.pass) bad += 1;
    console.log(`share fix self-test: ${c.pass ? 'ok  ' : 'FAIL'} ${c.name}`
      + (c.note && !c.pass ? ` — ${c.note}` : ''));
  }
  console.log(`share fix self-test: ${cases.length - bad} of ${cases.length} clauses hold`);
  process.exit(bad ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) selfTest();
  else main(process.argv[2] || '.');
}
