/* Hands the browser the PUBLIC Google client ID, read from the Vercel
   environment so the repository carries none.

   Be clear about what this does and does not buy. The value reaches the
   browser either way, and anyone can read it from devtools or by calling
   this endpoint. So this keeps it out of git; it does not make it secret.
   What actually protects it lives in the Google console: the client ID works
   only from an Authorized JavaScript origin.

   The client SECRET is never here, and the browser-only token flow never
   asks for one. */

import { serverAuthReady } from './_session.js';

export default function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';

  /* A short cache is safe: this changes only when the console changes, and
     a stale copy would otherwise survive a credential rotation for hours. */
  res.setHeader('Cache-Control', 'public, max-age=300');

  /* GOOGLE_API_KEY is no longer served. It existed for the Google Picker,
     which is gone, and publishing a value nothing reads is its own fault. */
  return res.status(200).json({
    clientId,
    /* The page needs to know whether it can offer Drive at all, before it
       draws a control nobody can use. */
    driveEnabled: Boolean(clientId),
    /* WHICH FLOW THIS DEPLOYMENT CAN RUN. With a client secret and a session
       secret the server holds a refresh token, so a token costs one silent
       request. Without them the page falls back to the browser-only flow,
       which works and needs a click about once an hour. A deployment that is
       half configured degrades rather than breaking. */
    serverAuth: serverAuthReady(),
  });
}
