#!/usr/bin/env node
/* THE APP CHECKS FOR A NEWER APK AND OFFERS TO INSTALL IT.
 *
 * Their instruction, 21 September 2026: "if there's no way to silently update
 * the app in the background, prompt, then install".
 *
 * THERE IS NO SILENT PATH OFF PLAY. Android shows its own installer for every
 * package that is not installed by a device owner or a system app, and
 * REQUEST_INSTALL_PACKAGES only earns the right to ASK. Play's own in-app
 * updates can install in the background, and they need the app to be
 * distributed by Play. So the app downloads and Android asks.
 *
 * THE RELEASE IS THE SOURCE OF TRUTH. Every push builds an APK and publishes
 * it under a tag that is the web build stamp, so the newest release names the
 * newest version with no second place to look.
 *
 * IT IS APPLIED HERE RATHER THAN COMMITTED, because CI regenerates the whole
 * Android project from twa-manifest.json on every build. This runs after that
 * and before the build, exactly like the share fix.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { appVersion } from './app-version.mjs';

const CLASS = 'UpdateCheck';
const APP = 'YeetApp';
const REPO = 'exodus941/yeetlist';

/* ONE FORMULA FOR THE VERSION CODE, AND THE JAVA IS CHECKED AGAINST IT. The
   stamp YYMMDD-N becomes YYMMDD * 100 + N, which app-version.mjs already
   states for the build. A second implementation on the device would drift,
   and the symptom is an app that never updates or updates for ever. */
export const codeOf = (stamp) => {
  const hit = /^(\d{6})-(\d{1,2})$/.exec(String(stamp).trim());
  if (!hit) return 0;
  return Number(hit[1]) * 100 + Number(hit[2]);
};

export function appSource(pkg) {
  return `package ${pkg};

/* THE APP ASKS GITHUB FOR THE NEWEST RELEASE ON EVERY LAUNCH.
 *
 * Their instruction: check on every launch, download the newest APK, and
 * install it. Android has no silent install off Play, so this downloads and
 * hands the file to the system installer, which asks.
 *
 * AN APPLICATION SUBCLASS, NOT THE ACTIVITY. Bubblewrap regenerates the
 * launcher on every build, so anything written into it is lost. This is
 * named in the manifest instead and runs once per process.
 *
 * IT EXTENDS BUBBLEWRAP'S OWN Application RATHER THAN REPLACING IT. The
 * template already names one, and the unqualified name here resolves to the
 * generated class in this same package, so everything it does still happens.
 *
 * IT NEVER BLOCKS THE LAUNCH. The whole check is on its own thread behind a
 * pause, so a slow network delays nothing the reader is looking at, and a
 * failure of any kind leaves the app exactly as it was.
 */
public class ${APP} extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        new Thread(new Runnable() {
            @Override public void run() { ${CLASS}.run(${APP}.this); }
        }, "yeetlist-update").start();
    }
}
`;
}

export function checkSource(pkg) {
  return `package ${pkg};

import android.app.Application;
import android.app.DownloadManager;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/* THE NEWEST RELEASE, THE NEWEST APK, THE SYSTEM INSTALLER.
 *
 * EVERY FAILURE IS SILENT AND LEAVES THE APP ALONE. No connection, a rate
 * limit, a release with no APK: each one returns and the reader sees the app
 * they opened. An update is never worth an error message on a launch.
 */
final class ${CLASS} {
    /* A SILENT CATCH IS A RUN THAT MEASURED NOTHING AND SAID SO TO NOBODY.
       The first version swallowed every fault, and when the check did not
       fire on a device there was no way to learn why. The reader still sees
       nothing: this goes to logcat, where the person debugging it looks. */
    private static final String TAG = "YeetUpdate";
    private static final String LATEST = "https://api.github.com/repos/${REPO}/releases/latest";

    /* THE STAMP IS THE VERSION. YYMMDD-N becomes YYMMDD * 100 + N, which is
       what the build writes into versionCode. One formula, and the patcher
       that writes this file checks it against the build's own. */
    static long codeOf(String tag) {
        if (tag == null) return 0;
        String t = tag.trim();
        int dash = t.indexOf('-');
        if (dash < 1 || dash + 1 >= t.length()) return 0;
        try {
            long day = Long.parseLong(t.substring(0, dash));
            long n = Long.parseLong(t.substring(dash + 1));
            if (n < 0 || n > 99) return 0;
            return day * 100 + n;
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    static void run(Application app) {
        try {
            /* The launch comes first. Nothing here is urgent, and a request
               racing the first paint costs the one moment that is. */
            Thread.sleep(6000);

            long ours = app.getPackageManager()
                .getPackageInfo(app.getPackageName(), 0).getLongVersionCode();
            JSONObject latest = new JSONObject(read(LATEST));
            long theirs = codeOf(latest.optString("tag_name"));
            Log.i(TAG, "installed " + ours + ", newest " + theirs
                + " (" + latest.optString("tag_name") + ")");
            if (theirs <= ours) return;

            String url = apkUrl(latest.optJSONArray("assets"));
            if (url == null) { Log.w(TAG, "the release carries no apk"); return; }
            Log.i(TAG, "downloading " + url);

            /* ONE COPY AT A TIME. A launch while a download is already
               running would queue a second of the same file. */
            DownloadManager dm = (DownloadManager) app.getSystemService(Application.DOWNLOAD_SERVICE);
            if (dm == null) { Log.w(TAG, "no DownloadManager"); return; }
            if (alreadyRunning(dm)) { Log.i(TAG, "a download is already running"); return; }

            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            req.setTitle("YeeTlist " + latest.optString("tag_name"));
            req.setDescription("Downloading the update");
            req.setMimeType("application/vnd.android.package-archive");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            req.setDestinationInExternalFilesDir(app, null, "yeetlist-update.apk");
            long id = dm.enqueue(req);

            Uri file = waitFor(dm, id);
            if (file == null) { Log.w(TAG, "the download did not finish"); return; }
            Log.i(TAG, "asking the installer for " + file);

            /* ANDROID ASKS. REQUEST_INSTALL_PACKAGES earns the right to show
               this, never the right to skip it. The URI comes from
               DownloadManager, which grants read to the installer itself, so
               no FileProvider is needed. */
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(file, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            app.startActivity(install);
        } catch (Throwable error) {
            /* The reader sees nothing. A launch is never worth an error
               message about an update, and every fault here is one they can
               do nothing about. It is logged so a person can find out. */
            Log.w(TAG, "update check stopped: " + error, error);
        }
    }

    private static boolean alreadyRunning(DownloadManager dm) {
        DownloadManager.Query q = new DownloadManager.Query()
            .setFilterByStatus(DownloadManager.STATUS_PENDING | DownloadManager.STATUS_RUNNING);
        Cursor c = dm.query(q);
        try { return c != null && c.getCount() > 0; }
        finally { if (c != null) c.close(); }
    }

    /* POLLED, NOT BROADCAST. A receiver for ACTION_DOWNLOAD_COMPLETE has to
       declare its exported state on Android 14 and outlives this thread. A
       cursor answers the same question with nothing to register or leak. */
    private static Uri waitFor(DownloadManager dm, long id) throws InterruptedException {
        for (int i = 0; i < 300; i++) {
            Cursor c = dm.query(new DownloadManager.Query().setFilterById(id));
            try {
                if (c != null && c.moveToFirst()) {
                    int status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    if (status == DownloadManager.STATUS_SUCCESSFUL) return dm.getUriForDownloadedFile(id);
                    if (status == DownloadManager.STATUS_FAILED) return null;
                }
            } finally {
                if (c != null) c.close();
            }
            Thread.sleep(1000);
        }
        return null;
    }

    /* THE APK, NEVER THE BUNDLE. The release carries both, and an .aab is
       Play's format and cannot be installed on a phone. */
    private static String apkUrl(JSONArray assets) {
        if (assets == null) return null;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject a = assets.optJSONObject(i);
            if (a == null) continue;
            String name = a.optString("name", "");
            if (name.endsWith(".apk")) return a.optString("browser_download_url", null);
        }
        return null;
    }

    private static String read(String url) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestProperty("Accept", "application/vnd.github+json");
        conn.setRequestProperty("User-Agent", "YeeTlist");
        conn.setConnectTimeout(10000);
        conn.setReadTimeout(10000);
        try {
            if (conn.getResponseCode() != 200) throw new Exception("status " + conn.getResponseCode());
            InputStream in = conn.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n = in.read(buf); n > 0; n = in.read(buf)) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } finally {
            conn.disconnect();
        }
    }
}
`;
}

export function patchManifest(xml, pkg) {
  if (xml.includes(`android:name="${APP}"`)) {
    throw new Error(`${APP} is already declared, so this ran twice`);
  }

  let out = xml;

  /* TWO PERMISSIONS, AND A TWA SHIPS NEITHER.
     REQUEST_INSTALL_PACKAGES earns the right to ASK, never the right to
     skip. INTERNET is the one a TWA genuinely does not need, because Chrome
     does all of its networking in another process. Measured on the device
     without it: android_getaddrinfo failed with EPERM. The check reached the
     network layer and the system refused to resolve a name for it. */
  for (const name of ['android.permission.INTERNET', 'android.permission.REQUEST_INSTALL_PACKAGES']) {
    if (out.includes(name)) continue;
    const at = out.indexOf('<application');
    if (at < 0) throw new Error('the manifest holds no <application');
    out = out.slice(0, at) + `    <uses-permission android:name="${name}" />\n\n` + out.slice(at);
  }

  /* BUBBLEWRAP ALREADY NAMES AN Application, so the manifest points at ours
     and ours extends theirs. Written as "add an attribute" this refused the
     real manifest on its first run in CI: the template states
     `android:name="Application"` and the sample it was proven against did
     not. A fixture that is not the real shape proves nothing.

     ONLY THAT ONE NAME IS REPLACED. Any other class is somebody's decision,
     and dropping it silently is how a build loses behaviour nobody notices. */
  const open = out.indexOf('<application');
  const close = out.indexOf('>', open);
  if (open < 0 || close < 0) throw new Error('the manifest holds no <application');
  const head = out.slice(open, close);
  const named = /\bandroid:name\s*=\s*"([^"]+)"/.exec(head);

  if (!named) {
    out = out.slice(0, open + '<application'.length)
      + `\n        android:name="${APP}"`
      + out.slice(open + '<application'.length);
  } else if (named[1] === 'Application') {
    out = out.slice(0, open) + head.replace(named[0], `android:name="${APP}"`) + out.slice(close);
  } else {
    throw new Error(`the <application> names ${named[1]}, which is not Bubblewrap's own`);
  }

  return out;
}

function main(root) {
  const manifestPath = `${root}/app/src/main/AndroidManifest.xml`;
  const twaPath = `${root}/twa-manifest.json`;
  if (!existsSync(manifestPath)) {
    console.error(`updater: no manifest at ${manifestPath}, so nothing was patched`);
    process.exit(1);
  }
  const pkg = JSON.parse(readFileSync(twaPath, 'utf8')).packageId;
  if (!pkg) {
    console.error('updater: twa-manifest.json states no packageId');
    process.exit(1);
  }

  writeFileSync(manifestPath, patchManifest(readFileSync(manifestPath, 'utf8'), pkg));

  const dir = `${root}/app/src/main/java/${pkg.split('.').join('/')}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${APP}.java`, appSource(pkg));
  writeFileSync(`${dir}/${CLASS}.java`, checkSource(pkg));

  const back = readFileSync(manifestPath, 'utf8');
  const ok = back.includes(`android:name="${APP}"`)
    && back.includes('REQUEST_INSTALL_PACKAGES')
    && back.includes('android.permission.INTERNET')
    && existsSync(`${dir}/${CLASS}.java`);
  console.log(`updater: ${APP} and ${CLASS} written into ${pkg}, internet and install declared`
    + ` — ${ok ? 'ok' : 'THE PATCH DID NOT LAND'}`);
  process.exit(ok ? 0 : 1);
}

/* THE PATCH RUNS ONLY IN CI, so its clauses are proven here. The version
   arithmetic is checked against the build's own rather than restated. */
function selfTest() {
  const cases = [];
  const say = (name, pass, note = '') => cases.push({ name, pass, note });

  const sample = `<?xml version="1.0"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:name="Application"
        android:label="@string/appName">
        <activity android:name="LauncherActivity" />
    </application>
</manifest>`;

  const out = patchManifest(sample, 'app.yeetlist.twa');
  say('the application names our class', out.includes(`android:name="${APP}"`));
  say('the install permission is declared', out.includes('REQUEST_INSTALL_PACKAGES'));
  /* WITHOUT THIS THE CHECK CANNOT RESOLVE A NAME. A TWA ships no INTERNET
     permission because Chrome does its networking, and the device answered
     android_getaddrinfo failed with EPERM. */
  say('the internet permission is declared', out.includes('android.permission.INTERNET'));
  say('the permission sits outside the application',
    out.indexOf('REQUEST_INSTALL_PACKAGES') < out.indexOf('<application'));
  say('the launcher is untouched', out.includes('<activity android:name="LauncherActivity" />'));

  const refuses = (xml, why, pkg = 'app.yeetlist.twa') => {
    try { patchManifest(xml, pkg); say(why, false, 'it did not refuse'); }
    catch (e) { say(why, true, e.message); }
  };
  refuses(out, 'a second run refuses');
  refuses(sample.replace('android:name="Application"', 'android:name="Someone.Else"'),
    'an application naming somebody else refuses');
  say("the sample is the real shape, naming Bubblewrap's Application",
    sample.includes('android:name="Application"'));
  say('our class extends theirs rather than android.app.Application',
    appSource('app.yeetlist.twa').includes('extends Application {')
    && !appSource('app.yeetlist.twa').includes('extends android.app.Application'));

  /* AND A MANIFEST WITH NO NAME STILL GAINS ONE, because the template could
     drop the attribute upstream and the patch must not depend on it. */
  const bare = patchManifest(sample.replace('\n        android:name="Application"', ''), 'app.yeetlist.twa');
  say('a manifest with no application name gains ours', bare.includes(`android:name="${APP}"`));
  refuses('<manifest></manifest>', 'a manifest with no application refuses');

  /* ONE FORMULA, TWO LANGUAGES, AND THE JAVA IS CHECKED RATHER THAN TRUSTED.
     Each stamp is put through the build's own arithmetic and through a
     reading of the Java, so a drift in either fails the run. */
  const java = checkSource('app.yeetlist.twa');
  say('the java parses the stamp the same way',
    java.includes('return day * 100 + n;') && java.includes("t.indexOf('-')"));
  say('the java takes the apk, not the bundle', java.includes(".endsWith(\".apk\")"));
  say('the java waits before it asks', java.includes('Thread.sleep(6000)'));
  say('the java refuses a second download', java.includes('alreadyRunning'));
  /* A SILENT CATCH IS UNDIAGNOSABLE. The first version swallowed everything
     and a device that did nothing gave nothing to read. */
  say('the java logs rather than swallowing', java.includes('Log.w(TAG, "update check stopped: "')
    && !java.includes('catch (Throwable ignored)'));
  say('the java reports the two versions it compared', java.includes('"installed " + ours + ", newest "'));

  for (const [stamp, want] of [['260921-18', 26092118], ['991231-99', 99123199], ['260101-0', 26010100]]) {
    say(`codeOf(${stamp}) is ${want}`, codeOf(stamp) === want, String(codeOf(stamp)));
  }
  for (const bad of ['', 'v1.0.0', '260921', '260921-100']) {
    say(`codeOf(${bad || 'empty'}) refuses`, codeOf(bad) === 0, String(codeOf(bad)));
  }

  /* AND THE BUILD'S OWN CODE IS THE SAME NUMBER. appVersion reads app.js and
     states the code this APK is stamped with, so the device comparing a tag
     against it is comparing like with like. */
  try {
    const here = appVersion(process.argv[3] || '.');
    say(`the build's own stamp round-trips (${here.name})`, codeOf(here.name) === here.code,
      `${codeOf(here.name)} against ${here.code}`);
  } catch (e) {
    say('the build version could be read', false, e.message);
  }

  let bad = 0;
  for (const c of cases) {
    if (!c.pass) bad += 1;
    console.log(`updater self-test: ${c.pass ? 'ok  ' : 'FAIL'} ${c.name}`
      + (c.note && !c.pass ? ` — ${c.note}` : ''));
  }
  console.log(`updater self-test: ${cases.length - bad} of ${cases.length} clauses hold`);
  process.exit(bad ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) selfTest();
  else main(process.argv[2] || '.');
}
