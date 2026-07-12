// ===== GarageOS Service Worker =====
// Aggiorna questo numero ogni volta che carichi una nuova versione!
const VERSION = '2.0.1';
const CACHE_NAME = 'garageos-v' + VERSION;

// File da cachare per uso offline (path RELATIVI: funzionano ovunque sia hostata l'app)
const PRECACHE = [
  './',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// ── Install: precache i file principali
self.addEventListener('install', event => {
  console.log('[SW] Install v' + VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // addAll fallisce tutto se un file manca: cache singolarmente e ignora gli errori
      Promise.allSettled(PRECACHE.map(u => cache.add(u)))
    )
  );
  // NON fare skipWaiting automatico — aspetta che l'utente clicchi "Aggiorna"
});

// ── Activate: cancella le vecchie cache
self.addEventListener('activate', event => {
  console.log('[SW] Activate v' + VERSION);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: network-first, fallback cache offline (solo stessa origin)
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Lascia passare Firebase, Google Fonts e CDN esterni
  if (url.origin !== self.location.origin || url.protocol === 'chrome-extension:') {
    return; // lascia al browser
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(cached => cached || caches.match('./'))
      )
  );
});

// ── Messaggio dall'app: attiva subito la nuova versione
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    console.log('[SW] Skip waiting — activating new version');
    self.skipWaiting();
  }
});
