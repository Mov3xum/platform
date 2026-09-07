/* Movexum service worker (CLAUDE.md § 35).
 *
 * Avsiktligt minimal och dataminimerande:
 *  - Navigeringar (HTML) går ALLTID till nätet; ingen sida cachas. Vid
 *    nätverksfel visas den förcachade /offline-sidan. Inloggat innehåll
 *    (bolagsdata, chatt, PII) hamnar därmed aldrig i en SW-cache.
 *  - API-anrop (/api/, PocketBase, server actions) rörs inte alls.
 *  - Bara oföränderliga, publika resurser cachas: /_next/static/*, fonter,
 *    ikoner och brand-SVG:er (cache-first, versionerade filnamn).
 * Registreras bara i produktion (PwaRegister.tsx).
 */
const VERSION = 'mx-pwa-v1';
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = '/offline';

const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('mx-pwa-') && k !== STATIC_CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  if (url.origin !== self.location.origin) return false;
  const p = url.pathname;
  return (
    p.startsWith('/_next/static/') ||
    p.startsWith('/fonts/') ||
    p.startsWith('/icons/') ||
    p.startsWith('/brand/')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Navigeringar: nät först, aldrig cache — offline-sida som sista utväg.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return cached || new Response('Du är offline.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      })
    );
    return;
  }

  if (!isStaticAsset(url)) return; // API, PocketBase, bilder m.m. lämnas orörda.

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok && (res.type === 'basic' || res.type === 'default')) {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined);
        }
        return res;
      });
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
