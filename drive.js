/* ==========================================================================
   Google Drive sync, browser-only.

   Scope is drive.file: the narrowest Drive scope Google offers. It grants
   access to files this app created, plus any file the user hands it through
   the Picker. It cannot list, read or search anything else.

   No client secret. The token model needs the client ID alone, so nothing
   secret ships in this file. The access token lives in memory for about an
   hour and is re-acquired silently while the Google session lasts.
   ========================================================================== */

const DRIVE = (() => {
  /* The client ID and the API key come from /api/config, which reads them
     from the Vercel environment. Neither is in this repository.

     Neither is a secret either: both reach the browser, and the endpoint is
     public. Secrecy is not what protects them. The console does that, by
     restricting the client ID to an Authorized JavaScript origin and the API
     key to an HTTP referrer. The client SECRET is never used here at all,
     because the token flow does not need one. */
  let config = null;

  /* A deployment with no client ID set is a CONFIGURATION, not a failure, so
     this reports it rather than throwing. It threw once, and the only thing
     that hid the Connect button was a catch block. An exception for a normal
     state means every caller has to catch to learn an ordinary fact, and
     driveEnabled exists precisely so none of them has to. */
  async function settings() {
    if (config) return config;
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('Could not read the Google configuration.');
    config = await response.json();
    return config;
  }

  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const FILENAME = 'yeetlist.md';
  const REMEMBER = 'yeetlist-drive';
  const API = 'https://www.googleapis.com/drive/v3/files';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

  let token = null;
  let tokenExpiry = 0;
  let client = null;
  let pickerReady = false;

  const remembered = () => {
    try { return JSON.parse(localStorage.getItem(REMEMBER) || 'null'); }
    catch { return null; }
  };

  const remember = (patch) =>
    localStorage.setItem(REMEMBER, JSON.stringify({ ...remembered(), ...patch }));

  const forget = () => localStorage.removeItem(REMEMBER);

  const connected = () => Boolean(remembered()?.connected);
  const fileId = () => remembered()?.fileId || null;
  const syncedAt = () => remembered()?.syncedAt || null;

  /* The GIS script is loaded async, so a click can land before it arrives. */
  const gisReady = () => new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    const poll = () => {
      if (window.google?.accounts?.oauth2) return resolve();
      if (Date.now() > deadline) return reject(new Error('Google sign-in script did not load.'));
      setTimeout(poll, 60);
    };
    poll();
  });

  /* prompt:'' asks for a token without showing the consent screen. It
     resolves only while the user still has a Google session and has already
     granted the scope, so it is the renewal path, never the first grant. */
  async function getToken({ interactive }) {
    if (token && Date.now() < tokenExpiry - 60_000) return token;
    const { clientId } = await settings();
    /* The one place a missing client ID IS a failure: nothing can be signed
       in without it. Every other caller reads driveEnabled instead. */
    if (!clientId) throw new Error('GOOGLE_CLIENT_ID is not set for this deployment.');
    await gisReady();

    return new Promise((resolve, reject) => {
      client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        prompt: interactive ? 'consent' : '',
        callback: (response) => {
          if (response.error) return reject(new Error(describe(response.error)));
          token = response.access_token;
          tokenExpiry = Date.now() + (Number(response.expires_in) || 3600) * 1000;
          remember({ connected: true });
          resolve(token);
        },
        error_callback: (err) => reject(new Error(describe(err?.type))),
      });
      client.requestAccessToken();
    });
  }

  /* Name the cause, or the reader is left with a code. Measured: Google
     returned "Error 401: deleted_client" for a client that had been removed
     in the console, and the app reported only "Google sign-in failed." The
     two configuration cases are the ones worth spelling out, because neither
     is anything the reader did. */
  const describe = (code) => ({
    popup_closed: 'Sign-in window was closed before it finished.',
    popup_failed_to_open: 'The browser blocked the sign-in window. Allow pop-ups for this site.',
    access_denied: 'Access was declined.',
    interaction_required: 'Google needs you to sign in again.',
    deleted_client: 'This app’s Google OAuth client has been deleted. A new client ID is needed.',
    invalid_client: 'Google does not recognise this app’s client ID. Check GOOGLE_CLIENT_ID and the authorised origins.',
    unauthorized_client: 'This origin is not authorised for the Google client. Add it under Authorized JavaScript origins.',
  }[code] || ('Google sign-in failed' + (code ? ' (' + code + ').' : '.')));

  async function call(url, options = {}, { interactive = false } = {}) {
    const access = await getToken({ interactive });
    const response = await fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: 'Bearer ' + access },
    });

    /* A 401 means the token died early. Drop it and try once more. */
    if (response.status === 401) {
      token = null;
      const retry = await getToken({ interactive: true });
      return fetch(url, {
        ...options,
        headers: { ...options.headers, Authorization: 'Bearer ' + retry },
      });
    }
    return response;
  }

  async function json(response, what) {
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      let detail = '';
      try { detail = JSON.parse(body)?.error?.message || ''; } catch {}
      throw new Error(`${what} failed (${response.status})${detail ? ': ' + detail : ''}`);
    }
    return response.json();
  }

  /* drive.file only ever returns files this app owns or was given, so this
     search cannot see the rest of the Drive even though it looks like it
     could. A file the user made by hand is invisible until they pick it. */
  async function find() {
    const query = encodeURIComponent(`name = '${FILENAME}' and trashed = false`);
    const url = `${API}?q=${query}&spaces=drive&orderBy=modifiedTime desc`
      + `&fields=files(id,name,modifiedTime,size)&pageSize=10`;
    const data = await json(await call(url), 'Looking for ' + FILENAME);
    return data.files?.[0] || null;
  }

  async function meta(id) {
    const url = `${API}/${id}?fields=id,name,modifiedTime,size`;
    return json(await call(url), 'Reading file details');
  }

  async function read(id) {
    const response = await call(`${API}/${id}?alt=media`);
    if (!response.ok) throw new Error(`Reading ${FILENAME} failed (${response.status})`);
    return response.text();
  }

  async function create(text) {
    const boundary = 'yeet' + Math.random().toString(36).slice(2);
    const metadata = { name: FILENAME, mimeType: 'text/markdown' };
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: text/markdown; charset=UTF-8',
      '',
      text,
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const data = await json(await call(
      `${UPLOAD}?uploadType=multipart&fields=id,modifiedTime`,
      { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body },
    ), 'Creating ' + FILENAME);

    remember({ fileId: data.id });
    return data;
  }

  async function update(id, text) {
    return json(await call(
      `${UPLOAD}/${id}?uploadType=media&fields=id,modifiedTime`,
      { method: 'PATCH', headers: { 'Content-Type': 'text/markdown; charset=UTF-8' }, body: text },
    ), 'Saving ' + FILENAME);
  }

  /* The Picker is how a file YeeTlist did not create becomes reachable.
     Choosing one grants drive.file access to that single file, nothing more. */
  const pickerLoaded = () => new Promise((resolve, reject) => {
    if (pickerReady) return resolve();
    if (!window.gapi) {
      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.onerror = () => reject(new Error('The Google Picker script did not load.'));
      script.onload = () => gapi.load('picker', () => { pickerReady = true; resolve(); });
      document.head.append(script);
      return;
    }
    gapi.load('picker', () => { pickerReady = true; resolve(); });
  });

  async function pick() {
    const { apiKey } = await settings();
    if (!apiKey) throw new Error('Picking an existing file needs GOOGLE_API_KEY to be set.');
    const access = await getToken({ interactive: false });
    await pickerLoaded();

    return new Promise((resolve) => {
      const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
        .setMimeTypes('text/markdown,text/plain,application/octet-stream')
        .setMode(google.picker.DocsViewMode.LIST);

      new google.picker.PickerBuilder()
        .setOAuthToken(access)
        .setDeveloperKey(apiKey)
        .setTitle('Choose your yeetlist.md')
        .addView(view)
        .setCallback((data) => {
          if (data.action === google.picker.Action.PICKED) {
            const chosen = data.docs[0];
            remember({ fileId: chosen.id });
            resolve({ id: chosen.id, name: chosen.name });
          } else if (data.action === google.picker.Action.CANCEL) {
            resolve(null);
          }
        })
        .build()
        .setVisible(true);
    });
  }

  return {
    FILENAME,
    settings,
    connected, fileId, syncedAt, remember, forget,
    connect: () => getToken({ interactive: !connected() }),
    resume: () => getToken({ interactive: false }),
    find, meta, read, create, update, pick,
    disconnect() {
      const held = token;
      token = null;
      tokenExpiry = 0;
      forget();
      /* Hand the token back, so the grant does not outlive the button. */
      if (held && window.google?.accounts?.oauth2) {
        try { google.accounts.oauth2.revoke(held); } catch {}
      }
    },
  };
})();
