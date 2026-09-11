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
  const apiKey = process.env.GOOGLE_API_KEY || '';

  /* A short cache is safe: these change only when the console changes, and
     a stale copy would otherwise survive a credential rotation for hours. */
  res.setHeader('Cache-Control', 'public, max-age=300');

  return res.status(200).json({
    clientId,
    apiKey,
    /* The page needs to know which features it can offer before it draws a
       control nobody can use. */
    driveEnabled: Boolean(clientId),
    pickerEnabled: Boolean(clientId && apiKey),
  });
}
