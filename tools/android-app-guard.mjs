#!/usr/bin/env node
/* THE ANDROID APP IS ITS OWN WINDOW, AND THE PAGE AND THE WINDOW AGREE.
 *
 * Their decision, 24 September 2026: route A. The phone no longer hands the
 * page to a browser app. It shows the live site with Android's own web
 * engine, so the list and the Google link live in the app's own storage.
 *
 * NO BUILD RUNS HERE. Every JVM on this machine fails to open a selector, so
 * the APK is only ever compiled in CI. That makes this file the one place a
 * mistake is caught before a phone meets it. It asks four things:
 *
 *   the page and the window name the same bridge methods, both ways
 *   the window only answers the site, and only ever shows the site
 *   the build, the recipe and the signing key agree on every name
 *   the server's Android sign-in door refuses anybody but the app
 *
 * The server half runs the real endpoint against a stubbed Google.
 */
import { readText } from './slice-app.mjs';

process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.SESSION_SECRET = 'test-session-secret-for-the-guard';

const cases = [];
const ok = (name, pass, note = '') => cases.push({ name, pass, note });

const java = readText('android/app/src/main/java/app/yeetlist/twa/MainActivity.java');
const manifest = readText('android/app/src/main/AndroidManifest.xml');
const gradle = readText('android/app/build.gradle');
const flow = readText('.github/workflows/android.yml');
const app = readText('app.js');
const drive = readText('drive.js');
const webManifest = JSON.parse(readText('manifest.webmanifest'));
const updater = readText('tools/android-updater.mjs');

/* A comment can quote a method name, so every source is read with its
   comments blanked. A stated call inside prose is not a call. */
const blank = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
const javaCode = blank(java);
const pageCode = blank(app) + blank(drive);

/* -- 1. The bridge, both ways --------------------------------------------- */
{
  const exposed = new Set([...javaCode.matchAll(/@JavascriptInterface\s+public\s+\w+\s+(\w+)\s*\(/g)].map((m) => m[1]));
  /* A CALL CAN GO THROUGH A LOCAL NAME. `const app = window.YeetlistAndroid`
     then `app.version()` is a call the direct pattern cannot see, and the
     first version of this check missed two of four that way. So every alias
     is found and followed too. */
  const aliases = new Set(['YeetlistAndroid',
    ...[...pageCode.matchAll(/const (\w+) = window\.YeetlistAndroid;/g)].map((m) => m[1])]);
  /* AND A NAME INSIDE QUOTED TEXT IS NOT A CALL. The alias here is `app`, so
     the package name 'app.yeetlist.twa' read as a call to yeetlist(). */
  const noStrings = pageCode.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, (m) => ' '.repeat(m.length));
  const called = new Set();
  for (const alias of aliases) {
    for (const m of noStrings.matchAll(new RegExp(`\\b${alias}\\??\\.(\\w+)`, 'g'))) called.add(m[1]);
  }
  ok('the window exposes a bridge', exposed.size >= 4, [...exposed].join(' '));
  ok('the page calls it', called.size >= 4, [...called].join(' '));
  /* A METHOD THE PAGE CALLS AND THE WINDOW LACKS is a button that does
     nothing on the phone, with no error anybody sees. */
  for (const name of called) ok(`the page's ${name}() exists in the window`, exposed.has(name));
  ok('and it is named the same on both sides',
    /addJavascriptInterface\(new Bridge\(\), "YeetlistAndroid"\)/.test(javaCode));

  /* THE WAY BACK. Each page("x") call in the window lands on yeetNative.x. */
  const answers = new Set([...javaCode.matchAll(/page\("(\w+)"/g)].map((m) => m[1]));
  const hears = /window\.yeetNative = \{([\s\S]*?)\n\};/.exec(app);
  ok('the page listens for the window', Boolean(hears));
  for (const name of answers) {
    ok(`the window's ${name} answer has a listener`,
      Boolean(hears) && new RegExp(`\\n  (?:async )?${name}\\(`).test(hears[1]));
  }
  ok('every answer is quoted, so nothing can break out of the call',
    /JSONObject\.quote\(String\.valueOf\(a\)\)/.test(javaCode));

  /* EVERY DOOR BUT THE VERSION CHECKS IT IS THE SITE ASKING. */
  const bodies = [...javaCode.matchAll(/@JavascriptInterface\s+public\s+\w+\s+(\w+)\s*\([^)]*\)\s*\{([\s\S]*?)\n        \}/g)];
  for (const [, name, body] of bodies) {
    if (name === 'version') continue;
    ok(`${name}() answers only the site`, /if \(!onSite(?: \|\| url == null)?\) return;/.test(body));
  }
  ok('the site is known before any call can arrive',
    /onPageStarted\([\s\S]{0,120}onSite = isSite\(Uri\.parse\(url\)\);/.test(javaCode));

  /* THE UPDATER THE MENU CALLS IS WRITTEN BY ANOTHER TOOL, so it is asked
     there. A missing runNow() would fail only in CI. */
  ok('the menu check exists in the updater', /static void runNow\(Application app\)/.test(updater));
}

/* -- 2. The window only shows the site ------------------------------------ */
{
  ok('the site is https on one host',
    /"https"\.equals\(u\.getScheme\(\)\) && siteHost\.equals\(u\.getHost\(\)\)/.test(javaCode));
  ok('anything else opens outside',
    /if \(isSite\(u\)\) return false;\s*\n\s*openOutside\(u\);\s*\n\s*return true;/.test(javaCode));
  ok('the address is the live site', readText('android/app/src/main/res/values/strings.xml')
    .includes('<string name="siteUrl">https://yeetlist.vercel.app/</string>'));
  ok('no page can read the phone’s files',
    /setAllowFileAccess\(false\)/.test(javaCode) && /setAllowContentAccess\(false\)/.test(javaCode));
}

/* -- 3. What a browser used to do ----------------------------------------- */
{
  /* A SHARE WHILE THE APP IS OPEN REACHES THE PAGE. The old wrapper dropped
     it: Android matched the running task and threw the new share away. One
     window plus onNewIntent answers it by construction. */
  ok('one window, always', /android:launchMode="singleTask"/.test(manifest));
  ok('a share while open is loaded', /onNewIntent[\s\S]{0,200}if \(share != null\) web\.loadUrl\(share\);/.test(javaCode));
  ok('the app takes shared text', /android\.intent\.action\.SEND[\s\S]{0,160}android:mimeType="text\/plain"/.test(manifest));

  /* THE SAME PARAMETERS THE WEBSITE'S SHARE TARGET STATES, so the page reads
     a share from the app exactly as it reads one from a browser. */
  const params = webManifest.share_target?.params || {};
  ok('the share lands on the text parameter', params.text === 'text'
    && /appendQueryParameter\("text", text\)/.test(javaCode), JSON.stringify(params));
  ok('and the title on the title parameter', params.title === 'title'
    && /appendQueryParameter\("title", title\)/.test(javaCode));

  ok('turning the phone does not reload the page',
    /android:configChanges="[^"]*orientation[^"]*screenSize/.test(manifest));
  ok('the import button opens a file picker', /public boolean onShowFileChooser\(/.test(javaCode));
  ok('the export goes through a save dialog', /Intent\.ACTION_CREATE_DOCUMENT/.test(javaCode));
  ok('and the page sends it there first',
    /function saveText\(name, text, type\) \{[\s\S]{0,400}YeetlistAndroid\?\.saveFile[\s\S]{0,120}return;/.test(app));

  /* FROM ANDROID 15 THE PAGE IS DRAWN UNDER THE BARS AND THE KEYBOARD. Left
     alone, the header sits under the clock and the paste field under the
     keyboard. */
  ok('the page stays clear of the bars and the keyboard',
    /WindowInsets\.Type\.systemBars\(\)/.test(javaCode) && /WindowInsets\.Type\.ime\(\)/.test(javaCode));
  /* FROM ANDROID 16 THE OLD BACK METHOD IS NOT CALLED for an app built for
     it, so back would leave the app from any page. */
  ok('back works on new Android', /registerOnBackInvokedCallback\(/.test(javaCode));
  ok('and walks back through the page first', /if \(web\.canGoBack\(\)\) web\.goBack\(\);/.test(javaCode));
  /* A FIRST LAUNCH WITH NO CONNECTION HAS NOTHING SAVED TO SHOW. Android's
     own error page named a code and waited for the app to be reopened. */
  ok('a failed first load shows a plain screen',
    /if \(!request\.isForMainFrame\(\)\) return;\s*\n\s*showOffline\(/.test(javaCode));
  ok('and loads the app once the phone is really online',
    /NET_CAPABILITY_VALIDATED/.test(javaCode) && /registerDefaultNetworkCallback\(netWatch\)/.test(javaCode));
  ok('which needs the permission to watch the connection',
    /android\.permission\.ACCESS_NETWORK_STATE/.test(manifest));
  ok('and a retry that fails waits longer, so it cannot loop',
    /Math\.min\(30000L, 2000L << Math\.min\(4, retries\)\)/.test(javaCode) && /retries = 0;/.test(javaCode));
  ok('the Google link is written to disk when the app goes to the back',
    /onPause\(\)[\s\S]{0,200}CookieManager\.getInstance\(\)\.flush\(\);/.test(javaCode));
}

/* -- 4. Sign-in ----------------------------------------------------------- */
{
  const scope = /const SCOPE = '([^']+)'/.exec(drive)?.[1];
  ok('the app asks for the same Drive scope as the website',
    Boolean(scope) && java.includes(`DRIVE_SCOPE = "${scope}"`), scope);
  /* OFFLINE ACCESS, WITH THE REFRESH FLAG, IS WHAT MAKES THE LINK LAST. */
  ok('the app asks for a lasting link', /\.requestOfflineAccess\(clientId\.trim\(\), true\)/.test(javaCode));
  ok('the page hands the app its client ID',
    /app\.linkDrive\(\(await settings\(\)\)\.clientId \|\| ''\)/.test(drive));
  /* THE BRANCH HAS TO BE LIVE AS WELL AS FIRST. The first version of this
     clause compared positions only, so a branch switched off with `false`
     still read as correct. Google's page then opened inside the app, where
     Google refuses to show it. */
  const branch = /if \(app\?\.linkDrive && await serverAuth\(\)\) \{\s*\n\s*app\.linkDrive\(/.exec(blank(drive));
  ok('and does so before it would redirect to Google', Boolean(branch)
    && branch.index < drive.indexOf("location.href = '/api/oauth/start'"));
  ok('a missing Google Cloud entry is named', /if \(code == 10\) return "developer_error";/.test(javaCode)
    && /developer_error:\s*\n\s*'Google does not recognise this app yet/.test(app));
  ok('the code goes to the server with the app’s own header',
    /fetch\('\/api\/oauth\/native'[\s\S]{0,200}'X-Yeetlist-App': '1'/.test(app));
  ok('and the page comes back through the website’s own door',
    /\{ drive: 'linked' \}/.test(app) && /location\.replace\(`\/\?\$\{new URLSearchParams\(query\)\}`\)/.test(app));
}

/* -- 5. The build agrees with itself -------------------------------------- */
{
  /* THE SAME PACKAGE AS THE OLD APP, so it installs over it. */
  ok('the package is the old app’s', /applicationId 'app\.yeetlist\.twa'/.test(gradle));
  const assetlinks = JSON.parse(readText('.well-known/assetlinks.json'));
  ok('and the site still names it', JSON.stringify(assetlinks).includes('"app.yeetlist.twa"'));

  ok('the recipe hands the build its version',
    /-PyeetVersionName="\$NAME" -PyeetVersionCode="\$CODE"/.test(flow)
    && /findProperty\('yeetVersionName'\)/.test(gradle) && /findProperty\('yeetVersionCode'\)/.test(gradle));
  ok('and its signing password, under the name the build reads',
    /YEET_KEYSTORE_PASSWORD: \$\{\{ secrets\.ANDROID_KEYSTORE_PASSWORD \}\}/.test(flow)
    && /System\.getenv\('YEET_KEYSTORE_PASSWORD'\)/.test(gradle));
  ok('the key file is where the recipe puts it',
    /base64 -d > android\/yeetlist\.keystore/.test(flow) && /rootProject\.file\('yeetlist\.keystore'\)/.test(gradle));
  ok('an unsigned build stops the run', /test -f "\$APK" \|\| \{/.test(flow));
  /* GOOGLE CLOUD'S ANDROID ENTRY NEEDS THE SHA-1, so every run prints it. */
  ok('every run prints both fingerprints', /grep -iE "SHA1:\|SHA256:"/.test(flow));
  ok('the updater is written before the build',
    flow.indexOf('node tools/android-updater.mjs android') < flow.indexOf('./gradlew'));
  ok('the old wrapper is not built any more', !/bubblewrap/i.test(flow.replace(/^\s*#.*$/gm, '')));
  ok('the account picker is a dependency', /play-services-auth:/.test(gradle));
}

/* -- 6. The server's Android door ----------------------------------------- */
{
  const session = await import('../api/_session.js');
  const { default: native } = await import('../api/oauth/native.js');

  const call = async ({ method = 'POST', headers = {}, body = {}, google = [] } = {}) => {
    const realFetch = globalThis.fetch;
    const sent = [];
    let turn = 0;
    globalThis.fetch = async (url, init) => {
      sent.push(Object.fromEntries(new URLSearchParams(init.body)));
      const g = google[Math.min(turn++, google.length - 1)];
      return { ok: g.status < 400, status: g.status, json: async () => g.body };
    };
    const held = {};
    const res = {
      statusCode: 200,
      body: null,
      setHeader(k, v) { held[k.toLowerCase()] = v; },
      getHeader(k) { return held[k.toLowerCase()]; },
      status(code) { this.statusCode = code; return this; },
      json(b) { this.body = b; return this; },
    };
    const req = {
      method,
      body,
      headers: { host: 'yeetlist.vercel.app', 'x-forwarded-proto': 'https', ...headers },
      socket: {},
    };
    try { await native(req, res); } finally { globalThis.fetch = realFetch; }
    const cookie = [].concat(held['set-cookie'] || []).find((c) => c.startsWith(`${session.COOKIE}=`));
    return { status: res.statusCode, body: res.body, cookie, sent };
  };

  const fromApp = { origin: 'https://yeetlist.vercel.app', 'x-yeetlist-app': '1' };
  const granted = { status: 200, body: { access_token: 'ya29.x', refresh_token: '1//r' } };

  ok('a GET is refused', (await call({ method: 'GET' })).status === 405);
  ok('a post without the app’s header is refused',
    (await call({ headers: { origin: 'https://yeetlist.vercel.app' }, body: { code: 'c' } })).status === 403);
  ok('a post from another site is refused',
    (await call({ headers: { ...fromApp, origin: 'https://evil.example' }, body: { code: 'c' } })).status === 403);
  ok('a post with no origin is refused',
    (await call({ headers: { 'x-yeetlist-app': '1' }, body: { code: 'c' } })).status === 403);
  ok('a post with no code is refused', (await call({ headers: fromApp, body: {} })).status === 400);

  const good = await call({ headers: fromApp, body: { code: '4/abc' }, google: [granted] });
  ok('a good code links', good.status === 200 && good.body?.linked === true, JSON.stringify(good.body));
  ok('and exchanges with no redirect address', good.sent[0]?.redirect_uri === '', JSON.stringify(good.sent[0]));
  ok('and writes the same lasting link the website makes', Boolean(good.cookie)
    && session.openSession(decodeURIComponent(good.cookie.split(';')[0].split('=')[1]))?.refreshToken === '1//r');

  /* IF GOOGLE EVER WANTS THE WEB ADDRESS INSTEAD, it says so and the second
     try uses it. Without this, a change on Google's side would break every
     phone link with no way to see why. */
  const retry = await call({
    headers: fromApp,
    body: { code: '4/abc' },
    google: [{ status: 400, body: { error: 'redirect_uri_mismatch', error_description: 'Bad Request' } }, granted],
  });
  ok('a redirect complaint is retried with the web address',
    retry.status === 200 && retry.sent[1]?.redirect_uri === 'https://yeetlist.vercel.app/api/oauth/callback',
    JSON.stringify(retry.sent));

  const noRefresh = await call({ headers: fromApp, body: { code: 'c' }, google: [{ status: 200, body: { access_token: 'x' } }] });
  ok('a link that cannot last is refused, not stored',
    noRefresh.status === 400 && noRefresh.body?.reason === 'no_refresh_token' && !noRefresh.cookie);

  const refused = await call({ headers: fromApp, body: { code: 'c' }, google: [{ status: 400, body: { error: 'invalid_grant' } }] });
  ok('Google’s refusal reaches the page by its code', refused.body?.reason === 'invalid_grant');
}

/* -- Verdict -------------------------------------------------------------- */
let bad = 0;
for (const c of cases) {
  if (!c.pass) { bad += 1; console.log(`android-app guard: FAIL ${c.name}${c.note ? ` - ${c.note}` : ''}`); }
}
if (!cases.length) {
  console.error('android-app guard: no cases ran, so nothing was measured');
  process.exit(1);
}
console.log(`android-app guard: ${cases.length - bad} of ${cases.length} cases hold`);
process.exit(bad ? 1 : 0);
