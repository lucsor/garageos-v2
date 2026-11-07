// E2E promemoria push (client) su emulatori, con le regole vere. FCM non ha emulatore: in modalità emulatore
// l'app usa un token finto, il resto è reale (permesso, Firestore, regole, UI, service worker).
//  - nessuna richiesta di permesso all'avvio; "Attiva su questo dispositivo" → token in users/{uid}/pushTokens/{sha256}
//  - preferenze (giorni, dettagli) salvate in users/{uid}.push
//  - disattivazione e logout cancellano il token; permesso revocato → token cancellato al riavvio
//  - iPhone fuori dalla Home: istruzioni di installazione, niente pulsante
//  - una push consegnata al service worker mostra la notifica (anche con dati illeggibili)
// Prerequisiti: emulatori auth+firestore --project garageos-879bc, app su http://127.0.0.1:5173. Uso: node push.e2e.mjs
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = 'garageos-879bc';
const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
const ORIGIN = new URL(APP).origin;
const PROJECT = 'garageos-879bc';
const T = 60_000;
const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); console.log(`  ${cond ? '✔' : '✖'} ${msg}`); };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const { adminDb } = await import('../../tools/admin/creds.mjs');
const db = adminDb();

await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function open(alias, { permission = true, ua } = {}) {
  const ctx = await browser.newContext({ ...(ua ? { userAgent: ua, hasTouch: true } : {}) });
  if (permission) await ctx.grantPermissions(['notifications'], { origin: ORIGIN });
  await ctx.addInitScript(() => {
    window.__csp = []; window.__permAsked = 0;
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    const orig = Notification.requestPermission.bind(Notification);
    Notification.requestPermission = (...a) => { window.__permAsked++; return orig(...a); };
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${APP}?emulator&as=${alias}`);
  await page.click('[data-action="sign-in"]');
  await page.waitForFunction(() => document.getElementById('garage-role').textContent === 'Proprietario'
    && document.getElementById('db-status').textContent.includes('Sync'), null, { timeout: T });
  let uid = null;     // uid assegnato dall'emulatore Auth: lo si ricava da users/{uid} (email = alias@example.com)
  for (let i = 0; i < 20 && !uid; i++) {
    uid = (await db.collection('users').where('email', '==', `${alias}@example.com`).get()).docs[0]?.id || null;
    if (!uid) await page.waitForTimeout(250);
  }
  if (!uid) problems.push(`uid di ${alias} non trovato`);
  return { ctx, page, uid };
}
const openModal = async (page) => {
  await page.evaluate(() => document.querySelector('[data-action="open-push"]').click());
  await page.waitForSelector('#push-modal.open', { timeout: T });
};
const tokens = async (uid) => (await db.collection(`users/${uid}/pushTokens`).get()).docs;

console.log('E2E promemoria push (client)\n');
let { ctx, page, uid } = await open('pushuser');
await page.waitForTimeout(1500);
check(await page.evaluate(() => window.__permAsked) === 0, 'all\'avvio NON viene chiesto il permesso per le notifiche');

await openModal(page);
check(/non attivi/.test(await page.textContent('#push-status')), 'stato iniziale: non attivi su questo dispositivo');
await page.click('#push-toggle');
await page.waitForFunction(() => /attivi su questo dispositivo/.test(document.getElementById('push-status').textContent) && !/non/.test(document.getElementById('push-status').textContent), null, { timeout: T });
let docs = await tokens(uid);
const expectedToken = `emu-token-${uid}-desktop`;
check(docs.length === 1 && docs[0].id === sha(expectedToken) && docs[0].data().token === expectedToken && docs[0].data().platform === 'desktop',
  'attivazione: token salvato in users/{uid}/pushTokens/{sha256(token)}');
check(docs[0]?.data().createdAt?.constructor?.name === 'Timestamp', 'timestamp del server sul token');
check((await db.doc(`users/${uid}`).get()).data()?.push?.enabled === true, 'preferenze: promemoria attivi');
check(await page.evaluate(() => window.__permAsked) === 1, 'il permesso viene chiesto solo al tocco su "Attiva"');

// preferenze
await page.uncheck('#push-days input[value="30"]');
await page.check('#push-days input[value="14"]');
await page.uncheck('#push-details');
await page.click('[data-action="push-save"]');
await page.waitForFunction(() => !document.getElementById('push-modal').classList.contains('open'), null, { timeout: T });
let prefs = (await db.doc(`users/${uid}`).get()).data().push;
check(JSON.stringify(prefs.days) === '[14,7,1]' && prefs.details === false && prefs.enabled === true, `preferenze salvate: ${JSON.stringify(prefs)}`);
await openModal(page);
check(!(await page.isChecked('#push-details')) && await page.isChecked('#push-days input[value="14"]'), 'riaprendo la finestra le preferenze sono quelle salvate');

// disattiva / riattiva
await page.click('#push-toggle');
await page.waitForFunction(() => /non attivi/.test(document.getElementById('push-status').textContent), null, { timeout: T });
check((await tokens(uid)).length === 0, 'disattivazione: token cancellato');
await page.click('#push-toggle');
await page.waitForFunction(() => !/non attivi/.test(document.getElementById('push-status').textContent), null, { timeout: T });
check((await tokens(uid)).length === 1, 'riattivazione: token di nuovo presente');
await page.click('[data-action="close-modal"][data-modal="push-modal"]');

// push consegnata al service worker → notifica
{
  const w = ctx.serviceWorkers().find((x) => x.url().startsWith(ORIGIN));
  await w.evaluate(() => {
    self.__shown = [];
    const orig = self.registration.showNotification.bind(self.registration);
    self.registration.showNotification = (title, o = {}) => { self.__shown.push({ title, body: o.body, url: o.data?.url, tag: o.tag }); return orig(title, o); };
  });
}
const cdp = await ctx.newCDPSession(page);
const regId = await new Promise(async (res) => {
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => { const r = e.registrations.find((x) => x.scopeURL.startsWith(ORIGIN)); if (r) res(r.registrationId); });
  await cdp.send('ServiceWorker.enable');
});
await cdp.send('ServiceWorker.deliverPushMessage', { origin: ORIGIN, registrationId: regId,
  data: JSON.stringify({ data: { title: 'GarageOS — 1 scadenza', body: 'AB123CD · Bollo: domani', url: './#scadenze', tag: 'garageos-reminders' } }) });
// Chrome headless non conserva le notifiche (getNotifications() resta vuoto): si registra la chiamata
// a showNotification del service worker, che è ciò che il nostro gestore deve fare.
const sw = ctx.serviceWorkers().find((w) => w.url().startsWith(ORIGIN));
const shown = () => sw.evaluate(() => self.__shown || []);
let notes = [];
for (let i = 0; i < 20 && !notes.length; i++) { notes = await shown(); if (!notes.length) await page.waitForTimeout(250); }
check(notes[0]?.title === 'GarageOS — 1 scadenza' && notes[0]?.body === 'AB123CD · Bollo: domani' && notes[0]?.url === './#scadenze' && notes[0]?.tag === 'garageos-reminders',
  `push → notifica mostrata dal service worker (${JSON.stringify(notes[0])})`);
await cdp.send('ServiceWorker.deliverPushMessage', { origin: ORIGIN, registrationId: regId, data: 'non è json' });
await page.waitForTimeout(800);
notes = await shown();
check(notes[1]?.body === 'Hai scadenze in arrivo', 'push illeggibile → notifica generica (mai una push "muta")');
await cdp.send('ServiceWorker.deliverPushMessage', { origin: ORIGIN, registrationId: regId, data: JSON.stringify({ data: { title: 'x', body: 'y', url: 'https://evil.example/' } }) });
await page.waitForTimeout(800);
notes = await shown();
check(notes[2]?.url === './', 'URL esterni nella push ignorati (al click si apre solo GarageOS)');

// logout → token cancellato
await Promise.all([page.waitForNavigation({ timeout: T }), page.evaluate(() => document.querySelector('[data-action="sign-out"]').click())]);
check((await tokens(uid)).length === 0, 'logout: token del dispositivo cancellato');
const csp = [...new Set(await page.evaluate(() => window.__csp))];
check(csp.length === 0, `nessuna violazione CSP${csp.length ? ': ' + csp.join(' | ') : ''}`);
await ctx.close();

// permesso revocato dalle impostazioni → token cancellato al riavvio dell'app
({ ctx, page, uid } = await open('revoker'));
await openModal(page);
await page.click('#push-toggle');
await page.waitForFunction(() => !/non attivi/.test(document.getElementById('push-status').textContent), null, { timeout: T });
check((await tokens(uid)).length === 1, 'revoca: token presente prima');
await ctx.clearPermissions();
await page.reload();
await page.waitForFunction(() => document.getElementById('db-status').textContent.includes('Sync'), null, { timeout: T });
let gone = false;
for (let i = 0; i < 20 && !gone; i++) { gone = (await tokens(uid)).length === 0; if (!gone) await page.waitForTimeout(300); }
check(gone, 'permesso revocato → al riavvio il token viene cancellato');
await ctx.close();

// iPhone fuori dalla Home: istruzioni, niente pulsante; suggerimento nella scheda Scadenze
({ ctx, page } = await open('iosuser', { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }));
await page.click('#nav-scadenze');
check(await page.isVisible('#push-ios-hint'), 'iPhone in Safari: suggerimento "aggiungi alla Home" nella scheda Scadenze');
await openModal(page);
check(await page.isVisible('#push-ios') && !(await page.isVisible('#push-toggle')), 'iPhone in Safari: istruzioni di installazione, nessun pulsante "Attiva"');
await page.click('[data-action="close-modal"][data-modal="push-modal"]');
await page.click('[data-action="push-ios-dismiss"]');
check(!(await page.isVisible('#push-ios-hint')), 'il suggerimento si può nascondere');
await ctx.close();
({ ctx, page } = await open('oldios', { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.7 Mobile/15E148 Safari/604.1' }));
await openModal(page);
check(/iOS 16\.4/.test(await page.textContent('#push-unavailable')) && !(await page.isVisible('#push-ios')), 'iOS < 16.4: spiega che non è possibile e suggerisce il calendario');
await ctx.close();

await browser.close();
if (problems.length) { console.log('\n✖ PROBLEMI:\n' + problems.map((p) => '  - ' + p).join('\n')); process.exit(1); }
console.log('\n✔ Promemoria push (client) OK');
