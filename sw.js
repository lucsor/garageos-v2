// ===== GarageOS Service Worker =====
// Aggiorna questo numero ogni volta che carichi una nuova versione! (il pre-commit hook lo controlla)
const VERSION = '2.5.4';
const CACHE_PREFIX = 'garageos-v';            // solo le cache con questo prefisso appartengono a questo SW
const CACHE_NAME = CACHE_PREFIX + VERSION;
const NOTIF_CACHE = 'garageos-notif';         // snapshot scadenze per le notifiche: NON va mai cancellata
const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.11.0/';

// File da cachare per l'uso offline (path RELATIVI: funzionano ovunque sia hostata l'app)
const PRECACHE = [
  './',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  // moduli dell'app: la lista è verificata da tools/check-precache.mjs (pre-commit e CI)
  './css/app.css',
  './js/app.js',
  './js/utils.js',
  './js/csv.js',
  './js/costs.js',
  './js/ics.js',
  './js/push.js',
  './js/legacy-banner.js',
  './js/deadlines.js',
  // SDK Firebase (URL versionati e immutabili, CORS aperto): senza questi l'app offline resta bianca
  FIREBASE_SDK + 'firebase-app.js',
  FIREBASE_SDK + 'firebase-firestore.js',
  FIREBASE_SDK + 'firebase-auth.js',
];

// ── Install: precache (singolarmente: un file mancante non deve far fallire tutto)
self.addEventListener('install', event => {
  console.log('[SW] Install v' + VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(PRECACHE.map(u => cache.add(new Request(u, { cache: 'reload' }))))
    )
  );
  // NON fare skipWaiting automatico — aspetta che l'utente tocchi "Aggiorna"
});

// ── Activate: cancella SOLO le versioni precedenti di questa app.
// (Prima cancellava ogni cache ≠ corrente, compresa garageos-notif e le cache di altre app sulla stessa origine.)
self.addEventListener('activate', event => {
  console.log('[SW] Activate v' + VERSION);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol === 'chrome-extension:') return;

  // SDK Firebase: cache-first (URL versionato = contenuto immutabile)
  if (url.href.startsWith(FIREBASE_SDK)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  // Google Fonts (CSS + file): cache-first, salvati al primo uso; se mancano l'app usa i font di sistema
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req).catch(() => new Response('', { status: 504 })));
    return;
  }
  // Tutto il resto fuori origine (Firestore, Auth, ...): lascia al browser / all'SDK (che ha la sua cache offline)
  if (url.origin !== self.location.origin) return;

  // Stessa origine: network-first, fallback cache (offline).
  // cache: 'no-cache' = sempre una verifica col server (ETag → 304, quasi gratis): con l'app divisa in più
  // moduli ES, la cache HTTP del browser (max-age=600 su GitHub Pages) potrebbe altrimenti servire per
  // qualche minuto dopo un deploy un app.js nuovo con un utils.js vecchio → import rotto, pagina bianca.
  event.respondWith(
    // (le navigazioni no: una Request di tipo navigate non si può ricreare con opzioni)
    (req.mode === 'navigate' ? fetch(req) : fetch(req, { cache: 'no-cache' }))
      .then(response => {
        // non salvare le varianti con query string (?invite=..., ?emulator) come pagine separate
        if (response.ok && !url.search) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: req.mode === 'navigate' })
          .then(cached => cached || caches.match('./'))
      )
  );
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const response = await fetch(req);
  // solo risposte complete (niente 206 parziali, che cache.put rifiuta)
  if (response.status === 200 || response.type === 'opaque') {
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, response.clone()).catch(() => {});
  }
  return response;
}

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
    const cache = await caches.open(NOTIF_CACHE);
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

// ── Push dei promemoria (FCM, messaggio "data" inviato da tools/admin/send-reminders.mjs).
// Ogni push DEVE mostrare una notifica (obbligatorio su iOS e Chrome): anche se il contenuto è illeggibile.
self.addEventListener('push', event => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch { p = {}; }
  const d = p.data || p.notification || {};
  event.waitUntil(self.registration.showNotification(String(d.title || 'GarageOS — Scadenze').slice(0, 100), {
    body: String(d.body || 'Hai scadenze in arrivo').slice(0, 500),
    icon: 'icon-192.png', badge: 'icon-192.png',
    tag: String(d.tag || 'garageos-reminders').slice(0, 64),
    data: { url: d.url === './#scadenze' ? './#scadenze' : './' },    // solo URL interni noti
  }));
});

// Click sulla notifica → apri/focalizza l'app (sulla scheda Scadenze se è un promemoria)
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const client = list.find(c => 'focus' in c);
      if (client) {
        if (url !== './') client.postMessage({ type: 'OPEN_TAB', tab: 'scadenze' });
        return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
