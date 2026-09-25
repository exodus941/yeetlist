/* The Android app's way in: a one-time code from Android's account picker.

   Google will not show its sign-in page inside an app's web view, so the
   phone asks Android instead, and Android returns a one-time code. The page
   posts it here. From then on the link is the same as the website's: a
   refresh token sealed in an HttpOnly cookie, which /api/oauth/token uses.

   THE COOKIE LANDS IN THE APP'S OWN STORAGE, because the request comes from
   the app's own web view. That is the point of the move: no other app's
   cleanup can reach it.

   ONLY THE SITE'S OWN PAGES MAY POST. A page elsewhere could otherwise link
   this browser to a Drive the reader does not own. The custom header makes
   any cross-site attempt ask permission first, and nothing here grants it;
   the origin check answers the rest. */

import {
  COOKIE, COOKIE_MAX_AGE, exchangeCode, sealSession, serverAuthReady, writeCookie,
} from '../_session.js';

const readBody = (req) => new Promise((resolve) => {
  if (req.body && typeof req.body === 'object') return resolve(req.body);
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; if (raw.length > 8192) req.destroy(); });
  req.on('end', () => {
    try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); }
  });
  req.on('error', () => resolve({}));
});

/* THE HOST THE REQUEST CAME TO, the same way the redirect address is worked
   out, so the check agrees with the callback about what "this site" is. */
const hostOf = (req) =>
  (req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim();

export function sameSite(req) {
  const origin = req.headers?.origin;
  if (!origin) return false;
  try { return new URL(origin).host === hostOf(req); } catch { return false; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.', reason: 'method' });
  }
  if (!serverAuthReady()) {
    return res.status(503).json({ error: 'Server-side Google sync is not configured.', reason: 'unconfigured' });
  }
  if (req.headers?.['x-yeetlist-app'] !== '1' || !sameSite(req)) {
    return res.status(403).json({ error: 'Only Yeetlist itself can link this way.', reason: 'forbidden' });
  }

  const { code } = await readBody(req);
  if (typeof code !== 'string' || !code || code.length > 2048) {
    return res.status(400).json({ error: 'No sign-in code arrived.', reason: 'no_code' });
  }

  /* A CODE FROM ANDROID IS BOUND TO NO REDIRECT ADDRESS, so it is exchanged
     with an empty one. If Google ever insists on the web address instead, it
     says so without spending the code, and the second try uses that. */
  let granted;
  try {
    granted = await exchangeCode(req, code, '');
  } catch (error) {
    if (!/redirect_uri/i.test(`${error.code} ${error.message}`)) {
      return res.status(400).json({ error: error.message, reason: error.code || 'exchange_failed' });
    }
    try {
      granted = await exchangeCode(req, code);
    } catch (again) {
      return res.status(400).json({ error: again.message, reason: again.code || 'exchange_failed' });
    }
  }

  /* No refresh token means a link that dies within the hour, which is the
     state this whole flow exists to escape. */
  if (!granted.refresh_token) {
    return res.status(400).json({ error: 'Google returned no refresh token.', reason: 'no_refresh_token' });
  }

  writeCookie(req, res, COOKIE, sealSession(granted.refresh_token), COOKIE_MAX_AGE);
  return res.status(200).json({ linked: true });
}
