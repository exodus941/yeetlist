/* Mints an access token from the stored refresh token.

   This is the endpoint that replaces the popup. The page calls it whenever it
   needs to talk to Drive, and it answers server to server with no window, no
   gesture and nothing for a browser to block.

   The refresh token never leaves this function. Only the short-lived access
   token reaches the page, which is what the Drive REST calls need. */

import {
  COOKIE, clearCookie, open, readCookie, refresh, serverAuthReady,
} from '../_session.js';

export default async function handler(req, res) {
  /* Never cached. An access token is minted per request and a stored copy
     would be handed out after it had expired. */
  res.setHeader('Cache-Control', 'no-store');

  if (!serverAuthReady()) {
    return res.status(503).json({ error: 'Server-side Google sync is not configured.' });
  }

  const sealed = readCookie(req, COOKIE);
  if (!sealed) return res.status(401).json({ error: 'Not linked.' });

  const refreshToken = open(sealed);
  /* A cookie that will not open was edited, or the session secret rotated
     under it. Either way it can never work again, so drop it rather than
     failing on every future request. */
  if (!refreshToken) {
    clearCookie(req, res, COOKIE);
    return res.status(401).json({ error: 'The stored connection could not be read.' });
  }

  try {
    const granted = await refresh(refreshToken);
    return res.status(200).json({
      access_token: granted.access_token,
      expires_in: Number(granted.expires_in) || 3600,
    });
  } catch (error) {
    /* invalid_grant is the permanent one: the reader revoked access, changed
       their password, or the grant lapsed because the consent screen is still
       in Testing, where Google expires it after 7 days. Retrying cannot fix
       any of those, so the cookie goes and the page offers to link again.
       Every other failure is treated as temporary and the link is kept.

       READ THE CODE, NEVER THE DESCRIPTION. The description is prose Google
       may reword, and it does not always contain its own code: an invalid
       client answers "The provided client secret is invalid". Tested against
       the message, that case was classified temporary and the reader would
       retry a request that can never succeed. */
    const permanent = /^(invalid_grant|invalid_client|unauthorized_client)$/.test(error.code || '');
    if (permanent) clearCookie(req, res, COOKIE);
    return res.status(permanent ? 401 : 502).json({ error: error.message, permanent });
  }
}
