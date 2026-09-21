/* ==========================================================================
   The offline shell

   THE LIST IS ALREADY OFFLINE. Every row lives in localStorage, so the only
   thing standing between a reader and their watchlist on a train is the four
   files that draw it. This caches those and nothing else.

   NO VERSION TO BUMP. A constant cache name, and the page compares ETags to
   decide when the copies are stale. Nothing has to remember to raise a
   number, and no build step writes one.

   ONE VERSION AT A TIME. Everything in the shell is served from the cache,
   so the page and its scripts always come from the same build. The page
   checks for a newer one after it has loaded and reloads once when it has
   the whole set.

   THE API IS NEVER CACHED. /api/videos answers about a link the reader just
   pasted, and a stale answer there is a wrong title on a new row.
   ========================================================================== */

const CACHE = 'yeetlist-shell';

/* The shell, which is every file index.html names. A file missing from this
   list is a file the reader loses offline. */
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/drive.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  /* addAll is atomic: one 404 and nothing is cached at all. Each file is
     fetched on its own so a missing one costs that file rather than the
     whole shell. */
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  /* CACHE FIRST, FOR THE PAGE AS WELL AS ITS FILES. The page used to be
     network first while the scripts were served from the cache, so a launch
     after a deploy ran a NEW page against OLD code. That is a correctness
     fault rather than a delay: the two halves of one build can disagree.

     Serving both from the cache means the reader always runs one version of
     everything. The page itself asks whether a newer one exists and reloads
     once when it has it, which costs nothing at launch. */
  /* THE APP'S OWN DOCUMENT, AND NOTHING ELSE. A first version answered EVERY
     navigation with the cached shell, so /privacy.html returned the app. That
     page is the one the Play listing links to. Another document on this origin
     is another document. */
  const isApp = url.pathname === '/' || url.pathname === '/index.html';
  if (request.mode === 'navigate' && isApp) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = (await cache.match('/index.html')) || (await cache.match('/'));
      if (hit) return hit;
      try { return await fetch(request); } catch { return Response.error(); }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request);
    if (hit) return hit;
    try {
      const live = await fetch(request);
      if (live && live.ok) cache.put(request, live.clone());
      return live;
    } catch { return Response.error(); }
  })());
});

/* THE PAGE HANDS THE NEW COPIES OVER. It is the half that can compare an
   ETag against the cached one, and doing the writing here keeps one owner
   for the cache. */
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'refresh-shell') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async (url) => {
      try {
        const live = await fetch(url, { cache: 'reload' });
        if (live && live.ok) await cache.put(url, live);
      } catch { /* the reader keeps the copy they have */ }
    }));
    event.source?.postMessage({ type: 'shell-refreshed' });
  })());
});
