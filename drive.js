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

  /* TWO FILES, BECAUSE A NOTE IS A DOCUMENT AND A WATCHLIST IS A TABLE.
     Their instruction, 21 September 2026: notes get a separate yeetnotes.md.

     Each SLOT is one Drive file with its own id and its own stamp. The keys
     are separate in storage, so a device that has synced the watchlist and
     not yet the notes holds one id and not the other, rather than one field
     meaning whichever file was touched last.

     `fileId` and `syncedAt` keep the names they have always had, so an
     existing link survives this change untouched. */
  const SLOTS = {
    main: { name: 'yeetlist.md', idKey: 'fileId', atKey: 'syncedAt' },
    notes: { name: 'yeetnotes.md', idKey: 'notesFileId', atKey: 'notesSyncedAt' },
  };
  const slotOf = (slot) => SLOTS[slot] || SLOTS.main;

  const FILENAME = SLOTS.main.name;
  const REMEMBER = 'yeetlist-drive';
  const API = 'https://www.googleapis.com/drive/v3/files';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

  let token = null;
  let tokenExpiry = 0;
  let client = null;

  const remembered = () => {
    try { return JSON.parse(localStorage.getItem(REMEMBER) || 'null'); }
    catch { return null; }
  };

  const remember = (patch) =>
    localStorage.setItem(REMEMBER, JSON.stringify({ ...remembered(), ...patch }));

  const forget = () => localStorage.removeItem(REMEMBER);

  /* THE TOKEN OUTLIVES THE PAGE, BECAUSE A RELOAD IS NOT A DISCONNECT.

     Held in a module variable alone it died on every load, so every load had
     to ask Google for a new one. That request can open a popup, and a browser
     blocks a popup with no user gesture behind it. A deploy reloads the page,
     which is exactly the load the reader did not trigger, so the link read as
     broken every time a build went out. Pressing the button worked, and the
     only difference was the gesture.

     An access token lives about an hour. Kept, a reload inside that hour asks
     Google for nothing at all. Disconnect clears it with everything else. */
  (() => {
    const held = remembered();
    if (held?.token && Date.now() < held.tokenExpiry - 60_000) {
      token = held.token;
      tokenExpiry = held.tokenExpiry;
    }
  })();

  const connected = () => Boolean(remembered()?.connected);
  const fileId = (slot) => remembered()?.[slotOf(slot).idKey] || null;
  const syncedAt = (slot) => remembered()?.[slotOf(slot).atKey] || null;

  /* ONE WRITER FOR A SLOT'S TWO FIELDS. Written at each call site instead,
     the notes pull would have had to name `notesFileId` and the watchlist
     pull `fileId`, and the one that got it wrong would quietly point both
     files at one id. */
  const keep = (slot, { fileId: id, syncedAt: at } = {}) => {
    const { idKey, atKey } = slotOf(slot);
    const patch = {};
    if (id !== undefined) patch[idKey] = id;
    if (at !== undefined) patch[atKey] = at;
    remember(patch);
  };

  /* Is there a usable token right now? Being LINKED and being AUTHORISED are
     different facts, and treating them as one is what lost connections on
     every deploy. The link is remembered in storage; the token is not, and
     has to be fetched again on each load. */
  const live = () => Boolean(token) && Date.now() < tokenExpiry - 60_000;

  /* The GIS script is loaded async, so a click can land before it arrives.
     15 seconds, not 8: a fresh build re-fetches every asset, so this is
     slowest on exactly the load where the resume runs. */
  const gisReady = () => new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const poll = () => {
      if (window.google?.accounts?.oauth2) return resolve();
      if (Date.now() > deadline) return reject(new Error('Google sign-in script did not load.'));
      setTimeout(poll, 60);
    };
    poll();
  });

  /* THE SERVER HOLDS A REFRESH TOKEN, SO A TOKEN COSTS ONE SILENT REQUEST.
     No window opens, so there is nothing for a browser to block and no
     gesture to wait for. This is the whole difference between the two flows.

     The access token is NOT kept in storage here. The server mints another
     whenever it is asked, so storing one buys nothing and leaves a
     credential on disk for an hour. */
  async function serverToken() {
    const response = await fetch('/api/oauth/token', { cache: 'no-store' });
    const body = await response.json().catch(() => ({}));

    if (response.status === 401) {
      /* The server says the link is gone for good: revoked, or the grant
         lapsed. Forget it, so the page offers to make a new one rather than
         showing a connection that cannot come back. */
      forget();
      throw new Error(body.error || 'Not linked to Google Drive.');
    }
    if (!response.ok) {
      throw new Error(body.error || `Could not get a Drive token (${response.status}).`);
    }

    token = body.access_token;
    tokenExpiry = Date.now() + (Number(body.expires_in) || 3600) * 1000;
    remember({ connected: true });
    return token;
  }

  /* prompt:'' asks for a token without showing the consent screen. It
     resolves only while the user still has a Google session and has already
     granted the scope, so it is the renewal path, never the first grant. */
  async function getToken({ interactive }) {
    if (token && Date.now() < tokenExpiry - 60_000) return token;
    const { clientId, serverAuth } = await settings();
    /* The one place a missing client ID IS a failure: nothing can be signed
       in without it. Every other caller reads driveEnabled instead. */
    if (!clientId) throw new Error('GOOGLE_CLIENT_ID is not set for this deployment.');

    if (serverAuth) return serverToken();

    await gisReady();

    return new Promise((resolve, reject) => {
      /* EVERY WAIT IS BOUNDED, OR A CALLBACK THAT NEVER COMES HANGS THE APP.
         GIS answers through one of two callbacks, and a blocked popup can
         leave both unfired. The promise then never settles, so the caller's
         "a request is in flight" flag stays true for the life of the page and
         nothing can retry. 30 seconds is well past any real sign-in. */
      let settled = false;
      const finish = (fn) => (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const done = finish(resolve);
      const fail = finish(reject);
      const timer = setTimeout(
        () => fail(new Error('Google did not answer the sign-in request.')),
        30000,
      );

      client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        prompt: interactive ? 'consent' : '',
        callback: (response) => {
          if (response.error) return fail(new Error(describe(response.error)));
          token = response.access_token;
          tokenExpiry = Date.now() + (Number(response.expires_in) || 3600) * 1000;
          remember({ connected: true, token, tokenExpiry });
          done(token);
        },
        error_callback: (err) => fail(new Error(describe(err?.type))),
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

    /* A 401 means the token died early. Drop it and try once more. It is
       dropped from STORAGE too, or the next load restores a dead token and
       spends a 401 on the first call to find that out. */
    if (response.status === 401) {
      token = null;
      tokenExpiry = 0;
      remember({ token: null, tokenExpiry: 0 });
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
  async function find(slot) {
    const name = slotOf(slot).name;
    const query = encodeURIComponent(`name = '${name}' and trashed = false`);
    const url = `${API}?q=${query}&spaces=drive&orderBy=modifiedTime desc`
      + `&fields=files(id,name,modifiedTime,size)&pageSize=10`;
    const data = await json(await call(url), 'Looking for ' + name);
    return data.files?.[0] || null;
  }

  async function meta(id) {
    const url = `${API}/${id}?fields=id,name,modifiedTime,size`;
    return json(await call(url), 'Reading file details');
  }

  async function read(id) {
    const response = await call(`${API}/${id}?alt=media`);
    if (!response.ok) throw new Error(`Reading the Drive file failed (${response.status})`);
    return response.text();
  }

  async function create(slot, text) {
    const name = slotOf(slot).name;
    const boundary = 'yeet' + Math.random().toString(36).slice(2);
    const metadata = { name, mimeType: 'text/markdown' };
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
    ), 'Creating ' + name);

    keep(slot, { fileId: data.id });
    return data;
  }

  async function update(id, text) {
    return json(await call(
      `${UPLOAD}/${id}?uploadType=media&fields=id,modifiedTime`,
      { method: 'PATCH', headers: { 'Content-Type': 'text/markdown; charset=UTF-8' }, body: text },
    ), 'Saving the Drive file');
  }

  /* THE GOOGLE PICKER IS GONE, DELIBERATELY.
     It existed to adopt a yeetlist.md that YeeTlist did not create, because
     drive.file cannot see such a file until the reader hands it over. Its
     only control was a button called "Pick existing file", and that name now
     means the DEVICE filesystem, which is what a reader expects of it.

     Code nothing can reach is a fault, so it came out rather than sitting
     behind no button. GOOGLE_API_KEY was needed for this and nothing else,
     so that variable is now unused too.

     Nothing else is lost: a yeetlist.md YeeTlist wrote on another device is
     still found by name, which is the case that matters. */

  /* Which flow this deployment runs. Asked once and cached with the rest of
     the configuration, so nothing has to thread it through every caller. */
  const serverAuth = async () => Boolean((await settings()).serverAuth);

  return {
    FILENAME,
    fileName: (slot) => slotOf(slot).name,
    settings, serverAuth,
    connected, live, fileId, syncedAt, remember, keep, forget,

    /* LINKING IS A REDIRECT, NOT A POPUP, WHERE THE SERVER CAN HOLD A
       REFRESH TOKEN. A redirect needs no gesture and cannot be blocked, and
       the watchlist is in local storage, so leaving the page costs nothing.
       This never resolves: the navigation ends the page. */
    async connect() {
      if (await serverAuth()) {
        location.href = '/api/oauth/start';
        return new Promise(() => {});
      }
      return getToken({ interactive: !connected() });
    },

    resume: () => getToken({ interactive: false }),
    find, meta, read, create, update,

    async disconnect() {
      const held = token;
      token = null;
      tokenExpiry = 0;
      forget();

      if (await serverAuth()) {
        /* The cookie is the session, and only the server can clear it.
           Dropping local storage alone would leave the reader linked. */
        await fetch('/api/oauth/disconnect', { method: 'POST' }).catch(() => {});
        return;
      }

      /* Hand the token back, so the grant does not outlive the button. */
      if (held && window.google?.accounts?.oauth2) {
        try { google.accounts.oauth2.revoke(held); } catch {}
      }
    },
  };
})();
