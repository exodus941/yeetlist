/* Hands the browser the two PUBLIC Google identifiers, read from the Vercel
   environment so the repository carries neither.

   Be clear about what this does and does not buy. Both values reach the
   browser either way, and anyone can read them from devtools or by calling
   this endpoint. So this keeps them out of git; it does not make them
   secret. What actually protects them lives in the Google console:

     - the client ID works only from an Authorized JavaScript origin
     - the API key is restricted by HTTP referrer, and to the Picker API

   The client SECRET is never here, and the browser-only token flow never
   asks for one. */

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
  });
}
