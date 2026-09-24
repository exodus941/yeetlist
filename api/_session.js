/* ==========================================================================
   The server half of Drive sync.

   WHY THIS EXISTS. The browser-only token flow has no refresh token. Its
   access token lives about an hour, and renewing one means a fresh
   authorisation request. That request opens a popup, and a browser blocks a
   popup no click asked for, so the link broke on every reload the reader did
   not trigger themselves.

   The authorization CODE flow returns a refresh token alongside the access
   token. A refresh token is exchanged server to server, with no popup and no
   gesture, so the connection survives a reload, a deploy and a closed tab.

   WHERE THE REFRESH TOKEN LIVES. In one encrypted cookie, marked HttpOnly, so
   no script on the page can read it and no database is needed. The cookie IS
   the session: this project has no accounts and stores nothing per user.

   ONE IMPLEMENTATION, TWO CALLERS. The serverless functions and the local
   dev server both import this file. A second copy would drift, and these are
   the routines a mistake in is silent.
   ========================================================================== */

import crypto from 'node:crypto';

export const COOKIE = 'yeetlist_drive';
export const STATE_COOKIE = 'yeetlist_oauth_state';
export const SCOPE = 'https://www.googleapis.com/auth/drive.file';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/* Chrome caps a cookie at 400 days and silently truncates anything longer,
   so asking for more would state a lifetime the browser does not grant. */
const YEAR = 400 * 24 * 60 * 60;

export const settings = () => ({
  clientId: process.env.GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  sessionSecret: process.env.SESSION_SECRET || '',
});

/* The server flow needs all three. With any one missing the app falls back to
   the browser-only flow, which still works and still needs a click each hour.
   A half-configured deployment must degrade rather than break. */
export const serverAuthReady = () => {
  const { clientId, clientSecret, sessionSecret } = settings();
  return Boolean(clientId && clientSecret && sessionSecret);
};

/* Derived once per instance. scrypt is deliberately slow, which is the point
   for a secret somebody may have typed rather than generated, and caching
   keeps that cost off every request after the first. */
let cachedKey = null;
const key = () => {
  if (cachedKey) return cachedKey;
  const { sessionSecret } = settings();
  if (!sessionSecret) throw new Error('SESSION_SECRET is not set.');
  cachedKey = crypto.scryptSync(sessionSecret, 'yeetlist.session.v1', 32);
  return cachedKey;
};

/* AES-256-GCM, so tampering is detected rather than decrypted into rubbish.
   The tag is what makes open() throw on a edited cookie instead of returning
   a plausible string. */
export function seal(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}

export function open(sealed) {
  const parts = String(sealed || '').split('.');
  /* Check the SHAPE first. Buffer.from(undefined) throws a different error,
     and a malformed cookie is an ordinary state rather than a fault. */
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, body] = parts.map((p) => Buffer.from(p, 'base64url'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/* THE COOKIE CARRIES WHEN THE LINK WAS MADE, beside the refresh token.
   Their report, 24 September 2026: sync "keeps getting disconnected at random
   intervals". How long a link lasted is the fastest way to tell the causes
   apart. Seven days, sixteen hours and "until the browser was cleared" each
   point somewhere different, and only the server sees the moment of linking
   on every device.

   A COOKIE WRITTEN BEFORE THIS HOLDS THE BARE TOKEN. It still opens: a value
   that is not a JSON object is read as the token, with no date. So no link
   made before this change is lost by it. */
export const sealSession = (refreshToken, linkedAt = Date.now()) =>
  seal(JSON.stringify({ rt: refreshToken, at: linkedAt }));

export function openSession(sealed) {
  const plain = open(sealed);
  if (!plain) return null;
  if (plain.startsWith('{')) {
    try {
      const held = JSON.parse(plain);
      if (held && typeof held.rt === 'string' && held.rt) {
        return { refreshToken: held.rt, linkedAt: Number(held.at) || null };
      }
    } catch { /* falls through to "unreadable" */ }
    return null;
  }
  return { refreshToken: plain, linkedAt: null };
}

export function readCookie(req, name) {
  const raw = req.headers?.cookie || '';
  for (const part of raw.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() !== name) continue;
    return decodeURIComponent(part.slice(at + 1).trim());
  }
  return null;
}

/* Secure is set only where the connection IS https. Chrome makes an exception
   for http://localhost, and Safari does not, so a hardcoded Secure would make
   the local preview silently drop every cookie. */
const secure = (req) =>
  (req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'
  || Boolean(req.socket?.encrypted);

export function writeCookie(req, res, name, value, maxAge) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    /* Lax, not Strict: Google returns the reader here by a top-level
       redirect, and Strict withholds the cookie on a cross-site navigation.
       The state check is what guards that entry point. */
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (secure(req)) bits.push('Secure');
  append(res, bits.join('; '));
}

export const clearCookie = (req, res, name) => writeCookie(req, res, name, '', 0);

function append(res, cookie) {
  const held = res.getHeader('Set-Cookie');
  const all = held ? (Array.isArray(held) ? held : [held]) : [];
  res.setHeader('Set-Cookie', [...all, cookie]);
}

/* The redirect URI must match what the console holds, character for
   character, so it is derived from the request rather than configured twice.
   A second source is a second thing to keep in step. */
export function redirectUri(req) {
  const proto = secure(req) ? 'https' : 'http';
  const host = (req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim();
  return `${proto}://${host}/api/oauth/callback`;
}

export function authUrl(req, state) {
  const { clientId } = settings();
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: SCOPE,
    /* offline is what asks for a refresh token at all. */
    access_type: 'offline',
    /* Google returns a refresh token only on a FIRST grant, so a reader who
       has authorised before would come back with an access token and nothing
       to renew it with. consent asks every time, which costs one extra screen
       and is the difference between this flow working and not. */
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${query}`;
}

async function post(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    /* TWO FIELDS, TWO READERS. The description is prose for a person, and
       Google is free to reword it. The code is the stable machine value.

       Branching on the description is what made the caller's permanent-error
       test unreliable: an invalid client answers "The provided client secret
       is invalid", which holds no occurrence of invalid_client at all. */
    const reason = data.error_description || data.error || `HTTP ${response.status}`;
    const error = new Error(String(reason));
    error.code = String(data.error || '');
    /* THE SUBTYPE IS WHAT TELLS ONE invalid_grant FROM ANOTHER. A work
       account whose admin forces a fresh sign-in on a timer answers
       invalid_grant with `invalid_rapt`. A revoked grant answers invalid_grant
       with nothing. Same code, different cure, so it is kept. */
    error.subtype = String(data.error_subtype || '');
    error.status = response.status;
    throw error;
  }
  return data;
}

export function exchangeCode(req, code) {
  const { clientId, clientSecret } = settings();
  return post(TOKEN_URL, {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(req),
    grant_type: 'authorization_code',
  });
}

export function refresh(refreshToken) {
  const { clientId, clientSecret } = settings();
  return post(TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });
}

/* A revoke that fails must not stop the disconnect. The reader asked to be
   disconnected, so the cookie goes whatever Google says. */
export async function revoke(token) {
  try {
    await post(REVOKE_URL, { token });
    return true;
  } catch {
    return false;
  }
}

export const COOKIE_MAX_AGE = YEAR;
export const STATE_MAX_AGE = 600;
