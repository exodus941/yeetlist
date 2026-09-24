#!/usr/bin/env node
/* EVERY DRIVE DROP NAMES ITS CAUSE, AND HOW LONG THE LINK LASTED.
 *
 * Their report, 24 September 2026: Google sync "keeps getting disconnected at
 * random intervals". The page never said why. Each cause has a different
 * cure, and the gap between drops is what tells them apart:
 *
 *   no_cookie                  the browser lost the link, Google did nothing
 *   invalid_grant/invalid_rapt a work account forcing a fresh sign-in
 *   invalid_grant              revoked, replaced by a newer link, or expired
 *
 * So this runs the REAL token endpoint against a stubbed Google, the REAL
 * page wording sliced out of app.js, and the REAL drive.js record in a
 * sandbox. A rewrite of any of them fails here rather than leaving a copy
 * agreeing with itself.
 */
import vm from 'node:vm';
import { build, readText, appSource } from './slice-app.mjs';

process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.SESSION_SECRET = 'test-session-secret-for-the-guard';

const session = await import('../api/_session.js');
const { default: token } = await import('../api/oauth/token.js');

const cases = [];
const ok = (name, pass, note = '') => cases.push({ name, pass, note });
const same = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b),
  `${JSON.stringify(a)} against ${JSON.stringify(b)}`);

/* -- 1. The cookie carries the link date, and an old cookie still opens --- */
{
  const at = Date.UTC(2026, 8, 18, 9, 0);
  const held = session.openSession(session.sealSession('1//refresh', at));
  same('a new cookie opens to its token and date', held, { refreshToken: '1//refresh', linkedAt: at });

  /* A COOKIE WRITTEN BEFORE THIS CHANGE HOLDS THE BARE TOKEN. Reading it as
     unreadable would drop every existing link on the day this ships. */
  const legacy = session.openSession(session.seal('1//old-token'));
  same('an old cookie still opens, with no date', legacy, { refreshToken: '1//old-token', linkedAt: null });

  ok('an edited cookie does not open', session.openSession('a.b.c') === null);
  ok('a JSON cookie with no token does not open',
    session.openSession(session.seal(JSON.stringify({ at: 5 }))) === null);
}

/* -- 2. The endpoint names each refusal ----------------------------------- */
const call = async ({ cookie, google } = {}) => {
  const realFetch = globalThis.fetch;
  if (google) {
    globalThis.fetch = async () => ({
      ok: google.status < 400,
      status: google.status,
      json: async () => google.body,
    });
  }
  const headers = {};
  const res = {
    statusCode: 200,
    body: null,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const req = {
    headers: {
      cookie: cookie ? `${session.COOKIE}=${encodeURIComponent(cookie)}` : '',
      'user-agent': 'guard',
    },
    socket: {},
  };
  /* The endpoint logs one line per drop. Kept off the guard's own output. */
  const log = console.log;
  console.log = () => {};
  try { await token(req, res); } finally {
    console.log = log;
    globalThis.fetch = realFetch;
  }
  const cleared = [].concat(headers['set-cookie'] || []).some((c) => /Max-Age=0/.test(c));
  return { status: res.statusCode, body: res.body, cleared };
};

{
  const none = await call();
  same('no cookie is a 401', none.status, 401);
  same('and it says so', none.body.reason, 'no_cookie');

  const bad = await call({ cookie: 'x.y.z' });
  same('an unreadable cookie is a 401', bad.status, 401);
  same('and it says so', bad.body.reason, 'unreadable');
  ok('and it is cleared', bad.cleared);

  const at = Date.UTC(2026, 8, 20, 12, 0);
  const good = session.sealSession('1//r', at);

  /* THE WORK-ACCOUNT CASE. Same code as a revoked grant, different cure, so
     the subtype has to reach the page. */
  const rapt = await call({
    cookie: good,
    google: { status: 400, body: { error: 'invalid_grant', error_subtype: 'invalid_rapt', error_description: 'reauth related error (invalid_rapt)' } },
  });
  same('a forced fresh sign-in is a 401', rapt.status, 401);
  same('with Google’s code', rapt.body.reason, 'invalid_grant');
  same('and its subtype', rapt.body.subtype, 'invalid_rapt');
  same('and when the link was made', rapt.body.linkedAt, at);
  ok('and the cookie goes', rapt.cleared);

  const revoked = await call({
    cookie: good,
    google: { status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } },
  });
  same('a revoked grant is a 401', revoked.status, 401);
  same('with no subtype', revoked.body.subtype, '');

  /* A PASSING FAULT MUST NOT END THE LINK. That is the one mistake that
     would make this change cause the very drops it diagnoses. */
  const flaky = await call({
    cookie: good,
    google: { status: 503, body: { error: 'temporarily_unavailable' } },
  });
  same('a passing fault is not a 401', flaky.status, 502);
  ok('and the cookie stays', !flaky.cleared);

  const fine = await call({
    cookie: good,
    google: { status: 200, body: { access_token: 'ya29.x', expires_in: 3599 } },
  });
  same('a good link mints a token', fine.body.access_token, 'ya29.x');
  same('and reports when it was made', fine.body.linkedAt, at);
}

/* -- 3. The page's wording ------------------------------------------------ */
{
  const { spanWords, describeLoss } = build(['LOSS_CAUSE', 'spanWords', 'describeLoss']);
  const H = 3600000;
  same('minutes', spanWords(40 * 60000), '40 minutes');
  same('one minute, not zero', spanWords(10000), '1 minute');
  same('hours and minutes', spanWords(16 * H + 5 * 60000), '16 hours 5 minutes');
  same('days and hours', spanWords(6 * 24 * H + 2 * H), '6 days 2 hours');
  same('whole days', spanWords(7 * 24 * H), '7 days');
  same('no span, no words', spanWords(0), '');

  const at = Date.UTC(2026, 8, 24, 13, 5);
  const rapt = { at, reason: 'invalid_grant', subtype: 'invalid_rapt', linkedAt: at - 16 * H };
  const text = describeLoss(rapt, [
    { at: at - 20 * H, linkedAt: at - 36 * H, reason: 'invalid_grant', subtype: 'invalid_rapt' },
  ]);
  ok('it says how long the link lasted', /after 16 hours linked/.test(text), text);
  ok('it names the work-account cause', /work or school account/.test(text), text);
  ok('it lists the earlier drops', /Earlier drops came after 16 hours\./.test(text), text);
  ok('and ends with the exact code', /Code: invalid_grant \/ invalid_rapt\.$/.test(text), text);

  const lost = describeLoss({ at, reason: 'no_cookie', subtype: '', linkedAt: null });
  ok('a lost browser link blames the browser, not Google', /saved data for this site was cleared/.test(lost), lost);
  ok('and claims no span it does not know', !/after .* linked/.test(lost), lost);

  const odd = describeLoss({ at, reason: 'something_new', subtype: '' });
  ok('an unknown cause still shows its code', /Code: something_new\./.test(odd), odd);
}

/* -- 4. drive.js keeps the record through the drop ------------------------ */
{
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const ctx = vm.createContext({ localStorage, fetch: async () => ({}), window: {}, console });
  const DRIVE = vm.runInContext(`${readText('drive.js')}\n;DRIVE`, ctx);

  DRIVE.remember({ connected: true, linkedAt: 1000 });
  DRIVE.recordLoss({ reason: 'no_cookie', error: 'Not linked.' });
  DRIVE.forget();
  const [first] = DRIVE.losses();
  ok('the drop survives forgetting the link', first && first.reason === 'no_cookie');
  same('and uses the page’s date when the server has none', first && first.linkedAt, 1000);

  DRIVE.recordLoss({ reason: 'invalid_grant', linkedAt: 5000 });
  same('the server’s date wins when it has one', DRIVE.losses()[0].linkedAt, 5000);

  for (let i = 0; i < 9; i += 1) DRIVE.recordLoss({ reason: `r${i}` });
  same('only the last five are kept', DRIVE.losses().length, 5);
  same('newest first', DRIVE.losses()[0].reason, 'r8');

  ok('a new drop is unanswered', DRIVE.losses().every((l) => l.seen === false));
  DRIVE.markLossesSeen();
  ok('and closing it answers all of them', DRIVE.losses().every((l) => l.seen === true));
}

/* -- 5. The wiring -------------------------------------------------------- */
{
  const drive = readText('drive.js');
  const app = appSource();
  ok('the drop is recorded before the link is forgotten',
    /recordLoss\(body\);\s*\n\s*forget\(\);/.test(drive));

  /* EVERY PLACE A SYNC CAN FIND THE LINK GONE SHOWS THE REPORT. A drop is
     most likely found by a background check an hour in, not at load. */
  ok('a failed resume shows it', /renderDrive\(\);[\s\S]{0,300}showLoss\(\);\s*\n\s*\}\s*\n\}/.test(app));
  ok('a failed pull or push shows it', (app.match(/syncFailed\(error\);/g) || []).length === 2);
  ok('a background check shows it', /if \(!DRIVE\.connected\(\)\) \{ renderDrive\(\); showLoss\(\); \}/.test(app));
  ok('an earlier unanswered drop shows on load', /\} else \{\s*\n\s*\/\*[^*]*\*\/\s*\n\s*showLoss\(\);/.test(app));

  /* IT WAITS FOR THE READER. A drop is noticed later, from the pulsing
     button, and a line that timed out by then told nobody anything. */
  ok('the report does not time out', /say\(describeLoss\(latest, earlier\), \{ tone: 'warn', sticky: true \}\)/.test(app));
  ok('and a sticky line sets no timer', /if \(!sticky\) statusTimer = setTimeout/.test(app));
  ok('closing it answers it', /if \(lossOnScreen\) DRIVE\.markLossesSeen\(\);/.test(app));
  ok('and so does linking again', /linkedAt: Date\.now\(\) \}\);\s*\n\s*DRIVE\.markLossesSeen\(\);/.test(app));
}

/* -- Verdict -------------------------------------------------------------- */
let bad = 0;
for (const c of cases) {
  if (!c.pass) { bad += 1; console.log(`drive-loss guard: FAIL ${c.name} - ${c.note}`); }
}
if (!cases.length) {
  console.error('drive-loss guard: no cases ran, so nothing was measured');
  process.exit(1);
}
console.log(`drive-loss guard: ${cases.length - bad} of ${cases.length} cases hold`);
process.exit(bad ? 1 : 0);
