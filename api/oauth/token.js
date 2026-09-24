/* Mints an access token from the stored refresh token.

   This is the endpoint that replaces the popup. The page calls it whenever it
   needs to talk to Drive, and it answers server to server with no window, no
   gesture and nothing for a browser to block.

   The refresh token never leaves this function. Only the short-lived access
   token reaches the page, which is what the Drive REST calls need.

   EVERY REFUSAL SAYS WHY. Their report, 24 September 2026: sync "keeps getting
   disconnected at random intervals". This endpoint is the only place a link
   is ever declared gone, and it used to answer with a sentence and nothing a
   page could sort on. Each 401 now carries a `reason` from a fixed set, the
   subtype Google gave, and when the link was made. The page shows it, so the
   next drop names its own cause. */

import {
  COOKIE, clearCookie, openSession, readCookie, refresh, serverAuthReady,
} from '../_session.js';

/* THE CODES THAT CAN NEVER COME BACK. Retrying cannot fix any of these, so
   the cookie goes and the page offers to link again. Every other failure is
   treated as temporary and the link is kept.

   READ THE CODE, NEVER THE DESCRIPTION. The description is prose Google may
   reword, and it does not always contain its own code: an invalid client
   answers "The provided client secret is invalid". */
export const PERMANENT = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client']);

/* One line per drop in the host's log, so the pattern can be read across
   devices. The token itself is never written. */
const logLost = (req, body) => {
  const agent = String(req.headers?.['user-agent'] || '').slice(0, 160);
  console.log(JSON.stringify({ event: 'yeetlist-drive-lost', ...body, agent }));
};

export function lostBody(reason, { subtype = '', detail = '', linkedAt = null } = {}) {
  return { error: detail || reason, permanent: true, reason, subtype, linkedAt };
}

export default async function handler(req, res) {
  /* Never cached. An access token is minted per request and a stored copy
     would be handed out after it had expired. */
  res.setHeader('Cache-Control', 'no-store');

  if (!serverAuthReady()) {
    return res.status(503).json({ error: 'Server-side Google sync is not configured.' });
  }

  /* NO COOKIE AT ALL IS ITS OWN CAUSE. Google did not refuse anything: this
     browser simply holds no link. Its site data was cleared, or the page
     opened in a different browser from the one that linked. */
  const sealed = readCookie(req, COOKIE);
  if (!sealed) {
    const body = lostBody('no_cookie', { detail: 'Not linked.' });
    logLost(req, body);
    return res.status(401).json(body);
  }

  /* A cookie that will not open was edited, or the session secret rotated
     under it. Either way it can never work again, so drop it rather than
     failing on every future request. */
  const held = openSession(sealed);
  if (!held) {
    clearCookie(req, res, COOKIE);
    const body = lostBody('unreadable', { detail: 'The stored connection could not be read.' });
    logLost(req, body);
    return res.status(401).json(body);
  }

  try {
    const granted = await refresh(held.refreshToken);
    return res.status(200).json({
      access_token: granted.access_token,
      expires_in: Number(granted.expires_in) || 3600,
      linkedAt: held.linkedAt,
    });
  } catch (error) {
    const code = error.code || '';
    if (!PERMANENT.has(code)) {
      return res.status(502).json({ error: error.message, permanent: false, reason: code || 'temporary' });
    }
    clearCookie(req, res, COOKIE);
    const body = lostBody(code, {
      subtype: error.subtype || '',
      detail: error.message,
      linkedAt: held.linkedAt,
    });
    logLost(req, body);
    return res.status(401).json(body);
  }
}
