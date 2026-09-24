/* Hands the grant back to Google and drops the cookie.

   The cookie goes whatever Google answers. The reader asked to be
   disconnected, so a revoke that fails must not leave them still linked. */

import {
  COOKIE, clearCookie, openSession, readCookie, revoke,
} from '../_session.js';

export default async function handler(req, res) {
  /* A state change is not a GET. Written as one, any page that could make the
     browser fetch a URL could sign the reader out. */
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }

  const sealed = readCookie(req, COOKIE);
  clearCookie(req, res, COOKIE);

  let revoked = false;
  if (sealed) {
    const held = openSession(sealed);
    if (held) revoked = await revoke(held.refreshToken);
  }

  return res.status(200).json({ disconnected: true, revoked });
}
