/* Step one of the authorization code flow: send the reader to Google.

   A top-level REDIRECT, not a popup. The popup is the whole reason the
   browser-only flow kept failing, and a redirect needs no gesture and cannot
   be blocked. The watchlist is in local storage, so leaving the page and
   coming back costs nothing. */

import crypto from 'node:crypto';
import {
  STATE_COOKIE, STATE_MAX_AGE,
  authUrl, serverAuthReady, writeCookie,
} from '../../lib/session.mjs';

export default function handler(req, res) {
  if (!serverAuthReady()) {
    return res.status(503).send(
      'Server-side Google sync is not configured for this deployment. '
      + 'It needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and SESSION_SECRET.',
    );
  }

  /* The state is the only thing standing between this endpoint and anyone who
     can make the reader's browser follow a link. It goes in an HttpOnly
     cookie and is compared on the way back, so a callback the reader never
     started has nothing to match. */
  const state = crypto.randomBytes(16).toString('base64url');
  writeCookie(req, res, STATE_COOKIE, state, STATE_MAX_AGE);

  res.writeHead(302, { Location: authUrl(req, state) });
  return res.end();
}
