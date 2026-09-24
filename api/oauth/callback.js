/* Step two: Google sends the reader back here with a code.

   The code is exchanged server to server for an access token AND a refresh
   token. Only the refresh token is kept, sealed in an HttpOnly cookie. The
   access token is not stored at all, because /api/oauth/token mints a fresh
   one whenever the page asks. */

import {
  COOKIE, COOKIE_MAX_AGE, STATE_COOKIE,
  clearCookie, exchangeCode, readCookie, sealSession, serverAuthReady, writeCookie,
} from '../_session.js';

/* The reader ends up on the page either way, so a failure has to arrive as
   something the page can show. A query parameter survives the redirect where
   a response body would replace the app with a wall of text. */
const home = (res, params) => {
  res.writeHead(302, { Location: '/' + (params ? '?' + new URLSearchParams(params) : '') });
  return res.end();
};

export default async function handler(req, res) {
  if (!serverAuthReady()) return home(res, { drive: 'unconfigured' });

  const url = new URL(req.url, 'http://localhost');
  const expected = readCookie(req, STATE_COOKIE);
  clearCookie(req, res, STATE_COOKIE);

  /* Google reports a declined consent here rather than by failing. */
  const refused = url.searchParams.get('error');
  if (refused) return home(res, { drive: 'error', reason: refused });

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  /* Both halves must be present before they are compared. Two absent values
     are equal, so a missing cookie would otherwise pass the check it exists
     to fail. */
  if (!code || !state || !expected || state !== expected) {
    return home(res, { drive: 'error', reason: 'state_mismatch' });
  }

  try {
    const granted = await exchangeCode(req, code);

    /* No refresh token means this grant cannot outlive its hour, which is the
       state this whole flow exists to escape. Google withholds one when the
       reader has authorised before and consent was not asked for again, so
       report it rather than storing a token that solves nothing. */
    if (!granted.refresh_token) {
      return home(res, { drive: 'error', reason: 'no_refresh_token' });
    }

    writeCookie(req, res, COOKIE, sealSession(granted.refresh_token), COOKIE_MAX_AGE);
    return home(res, { drive: 'linked' });
  } catch (error) {
    return home(res, { drive: 'error', reason: error.message });
  }
}
