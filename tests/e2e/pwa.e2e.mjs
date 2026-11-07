// E2E PWA: service worker e funzionamento OFFLINE (emulatori + server statico proprio, che il test può spegnere).
//  B2  alla PRIMA installazione del SW la pagina NON si ricarica da sola
//  B1  all'aggiornamento del SW la cache "garageos-notif" (e cache di altre app sulla stessa origine) sopravvivono
//  D1  offline vero (server spento, rete e gstatic bloccati): l'app si apre dalla cache del SW, mostra i dati
//      dalla cache Firestore persistente, accetta una modifica offline (la modale si chiude, non resta in
//      caricamento) e la sincronizza al ritorno della rete
//  S   all'uscita (logout) la cache locale Firestore (IndexedDB) e garageos-notif vengono svuotate
// Prerequisiti: emulatori auth+firestore --project garageos-879bc. Uso: node pwa.e2e.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = 'garageos-879bc';
const PROJECT = 'garageos-879bc';
const PORT = 5182;
const APP = `http://127.0.0.1:${PORT}/`;
const T = 60_000;
const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');
const site = mkdtempSync(join(tmpdir(), 'garageos-site-'));
for (const f of ['index.html', 'sw.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'favicon.ico', 'css', 'js']) {
  cpSync(join(repo, f), join(site, f), { recursive: true });
}
const { adminDb } = await import('../../tools/admin/creds.mjs');
const db = adminDb();
const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); console.log(`  ${cond ? '✔' : '✖'} ${msg}`); };

let server;
const startServer = () => new Promise((res) => {
  server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: site, stdio: 'ignore' });
  setTimeout(res, 1200);
});
const stopServer = () => new Promise((res) => { server.on('exit', res); server.kill(); });

await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
await startServer();

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
let navigations = 0;
page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++; });

console.log('E2E PWA / offline\n');
// ── B2: prima visita, nessun SW → nessun reload automatico all'attivazione
await page.goto(`${APP}?emulator&as=pwauser`);
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: T }).catch(() => {});
await page.waitForTimeout(2500);
check(navigations === 1, `prima installazione SW: navigazioni ${navigations} (atteso 1, nessun reload automatico)`);
check(await page.evaluate(() => !!navigator.serviceWorker.controller), 'SW attivo e controlla la pagina (clients.claim)');

// login + dati
await page.click('[data-action="sign-in"]');
await page.waitForFunction(() => document.getElementById('garage-role').textContent === 'Proprietario'
  && document.getElementById('db-status').textContent.includes('Sync'), null, { timeout: T });
await page.click('#fab');
await page.fill('#v-plate', 'OF123LN');
await page.fill('#v-model', 'Panda offline');
await page.click('[data-action="save-vehicle"]');
await page.waitForFunction(() => document.querySelectorAll('.vehicle-card').length === 1, null, { timeout: T });

// SDK in cache?
const sdkCached = await page.evaluate(async () => {
  const base = 'https://www.gstatic.com/firebasejs/10.11.0/';
  const r = await Promise.all(['firebase-app.js', 'firebase-firestore.js', 'firebase-auth.js'].map((f) => caches.match(base + f)));
  return r.every(Boolean);
});
check(sdkCached, 'SDK Firebase (app, firestore, auth) nella cache del SW');

// ── B1: aggiornamento del SW → garageos-notif e cache di altre app sopravvivono
await page.evaluate(async () => {
  await (await caches.open('garageos-notif')).put('notif-data', new Response('{"deadlines":[],"lastNotified":123}'));
  await (await caches.open('altra-app-stessa-origine')).put('x', new Response('x'));
});
const swPath = join(site, 'sw.js');
const swOrig = readFileSync(swPath, 'utf8');
writeFileSync(swPath, swOrig.replace(/const VERSION = '([^']+)';/, "const VERSION = '$1-test-update';"));
await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
await page.waitForSelector('#update-banner.show', { timeout: T });
navigations = 0;
await Promise.all([page.waitForNavigation({ timeout: T }), page.click('#update-banner')]);   // l'utente tocca "Aggiorna"
await page.waitForTimeout(1500);
const keys = await page.evaluate(() => caches.keys());
check(keys.includes('garageos-notif'), `dopo l'aggiornamento la cache garageos-notif esiste ancora (${keys.join(', ')})`);
check(keys.includes('altra-app-stessa-origine'), 'cache di un\'altra app sulla stessa origine intatta');
check(!keys.some((k) => /^garageos-v[\d.]+$/.test(k)), 'la cache della versione precedente è stata rimossa');
check(navigations === 1, `aggiornamento richiesto dall'utente: un solo reload (${navigations})`);
writeFileSync(swPath, swOrig);

// ── D1: OFFLINE vero
await page.waitForFunction(() => document.querySelectorAll('.vehicle-card').length === 1, null, { timeout: T });
await stopServer();                                            // il sito non risponde più
await ctx.route(/127\.0\.0\.1:(8080|9099)|googleapis\.com|gstatic\.com|firebaseapp\.com/, (r) => r.abort());
await ctx.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
let offlineOk = false;
try {
  await page.waitForFunction(() => document.getElementById('garage-role')?.textContent === 'Proprietario'
    && document.querySelectorAll('.vehicle-card').length === 1, null, { timeout: T });
  offlineOk = true;
} catch {}
check(offlineOk, 'offline: l\'app si apre dalla cache e mostra il veicolo (cache Firestore persistente)');
const status = await page.textContent('#db-status').catch(() => '');
check(/Offline/.test(status), `offline: indicatore di stato "${status}"`);
// modifica offline
if (offlineOk) {
  await page.click('#fab');
  await page.fill('#v-plate', 'NO123NE');
  await page.fill('#v-model', 'Aggiunta offline');
  await page.click('[data-action="save-vehicle"]').catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('.vehicle-card').length === 2, null, { timeout: 10_000 }).catch(() => {});
  check(await page.$$eval('.vehicle-card', (e) => e.length) === 2, 'offline: un veicolo aggiunto offline compare subito (scrittura in coda)');
  const closed = await page.waitForFunction(() => !document.getElementById('vehicle-modal').classList.contains('open'), null, { timeout: 8000 }).then(() => true, () => false);
  check(closed, 'offline: la finestra di salvataggio si chiude (non resta bloccata in attesa del server)');
}
// ritorno online → sincronizzazione
await startServer();
await ctx.unroute(/127\.0\.0\.1:(8080|9099)|googleapis\.com|gstatic\.com|firebaseapp\.com/);
await ctx.setOffline(false);
let synced = false;
for (let i = 0; i < 30 && !synced; i++) {
  const snap = await db.collectionGroup('vehicles').where('plate', '==', 'NO123NE').get();
  synced = !snap.empty;
  if (!synced) await new Promise((r) => setTimeout(r, 1000));
}
check(synced, 'tornati online: la modifica fatta offline arriva su Firestore');

// ── S: logout → cache locale svuotata (dispositivo condiviso)
const idbHas = (needle) => page.evaluate(async (needle) => {
  const out = [];
  for (const { name } of await indexedDB.databases()) {
    if (!name.startsWith('firestore/')) continue;
    const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    for (const st of db.objectStoreNames) {
      const all = await new Promise((res) => { const r = db.transaction(st).objectStore(st).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => res([]); });
      if (JSON.stringify(all).includes(needle)) out.push(st);
    }
    db.close();
  }
  return out;
}, needle);
await page.evaluate(async () => { await (await caches.open('garageos-notif')).put('notif-data', new Response('{"deadlines":[{"plate":"OF123LN"}]}')); });
check((await idbHas('OF123LN')).length > 0, 'prima del logout la cache locale contiene i dati del garage (controllo del test)');
await Promise.all([page.waitForNavigation({ timeout: T }), page.evaluate(() => document.querySelector('[data-action="sign-out"]').click())]);
await page.waitForSelector('[data-action="sign-in"]', { timeout: T });
const left = await idbHas('OF123LN');
check(left.length === 0, `dopo il logout nessun dato del garage nella cache locale${left.length ? ' (trovato in: ' + left.join(', ') + ')' : ''}`);
check(!(await page.evaluate(() => caches.keys())).includes('garageos-notif'), 'dopo il logout la cache garageos-notif è stata eliminata');

await browser.close();
await stopServer();
if (problems.length) { console.log('\n✖ PROBLEMI:\n' + problems.map((p) => '  - ' + p).join('\n')); process.exit(1); }
console.log('\n✔ Service worker e offline OK');
