/* ==========================================================================
   The offline shell

   THE LIST IS ALREADY OFFLINE. Every row lives in localStorage, so the only
   thing standing between a reader and their watchlist on a train is the four
   files that draw it. This caches those and nothing else.

   NO VERSION TO BUMP. A constant cache name plus stale-while-revalidate means
   a changed file is fetched in the background and used on the next load, so
   nothing has to remember to raise a number. The page itself is network first,
   so a fresh deploy arrives the moment there is a connection.

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

  /* A NAVIGATION IS NETWORK FIRST, and that covers the share target too: a
     shared link arrives as a GET to `/?url=…`, which is a navigation. The
     cached page answers it when there is no connection, and the query
     survives, so the link is still added once the list loads. */
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match('/index.html')) || (await cache.match('/')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request);
    const live = fetch(request).then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    }).catch(() => null);
    return hit || (await live) || Response.error();
  })());
});
