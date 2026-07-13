// ===== GarageOS Service Worker =====
// Aggiorna questo numero ogni volta che carichi una nuova versione!
const VERSION = '2.1.0';
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

// ── Messaggio dall'app: attiva nuova versione / controlla scadenze
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    console.log('[SW] Skip waiting — activating new version');
    self.skipWaiting();
  }
  if (event.data?.type === 'CHECK_DEADLINES') {
    checkDeadlines();
  }
});

// ── Controllo periodico in background (PWA installata, Chrome/Android)
self.addEventListener('periodicsync', event => {
  if (event.tag === 'garageos-check') event.waitUntil(checkDeadlines());
});

// Legge lo snapshot scadenze salvato dall'app e notifica quelle a <= 10 giorni.
// Notifica al massimo una volta ogni 20 ore.
async function checkDeadlines() {
  try {
    if (self.Notification && Notification.permission !== 'granted') return;
    const cache = await caches.open('garageos-notif');
    const res = await cache.match('notif-data');
    if (!res) return;
    const state = await res.json();
    const now = Date.now();
    if (state.lastNotified && now - state.lastNotified < 20 * 3600 * 1000) return;

    const dayDiff = d => Math.ceil(
      (new Date(d).setHours(0,0,0,0) - new Date(now).setHours(0,0,0,0)) / 86400000
    );
    const soon = (state.deadlines || []).filter(d => dayDiff(d.date) <= 10);
    if (soon.length === 0) return;

    const body = soon.map(d => {
      const days = dayDiff(d.date);
      const when = days < 0 ? 'SCADUTO' : days === 0 ? 'OGGI' : `tra ${days}gg`;
      return `${d.plate} · ${d.label}: ${when}`;
    }).join('\n');

    await self.registration.showNotification('GarageOS — Scadenze in arrivo', {
      body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'garageos-deadlines',
    });
    state.lastNotified = now;
    await cache.put('notif-data', new Response(JSON.stringify(state), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (e) { console.warn('[SW] checkDeadlines:', e); }
}

// Click sulla notifica → apri/focalizza l'app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const client = list.find(c => 'focus' in c);
      if (client) return client.focus();
      return clients.openWindow('./');
    })
  );
});
