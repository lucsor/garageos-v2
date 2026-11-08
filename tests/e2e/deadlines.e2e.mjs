// E2E scadenze personalizzate (F2, v2.5.3) su emulatori, con le regole vere.
//  - il pulsante + nella scheda Scadenze crea una scadenza (tipo, descrizione, veicolo o tutto il garage, ricorrenza, importo)
//  - la scadenza compare nella lista insieme a bollo/revisione/assicurazione, nel conteggio e nel calendario .ics
//  - in Firestore: numeri veri, timestamp del server, autore
//  - "Fatto" su una ricorrente sposta la data; su una singola la elimina (dopo conferma)
//  - un membro del garage la vede; modifica ed eliminazione
//  - cancellando il veicolo spariscono anche le sue scadenze personalizzate
// Prerequisiti: emulatori auth+firestore --project garageos-879bc, app su http://127.0.0.1:5173. Uso: node deadlines.e2e.mjs
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = 'garageos-879bc';
const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
const PROJECT = 'garageos-879bc';
const T = 60_000;
const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); console.log(`  ${cond ? '✔' : '✖'} ${msg}`); };
const iso = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const { adminDb } = await import('../../tools/admin/creds.mjs');
const db = adminDb();

await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function login(alias) {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => { problems.push(`dialog inatteso: ${d.message()}`); d.dismiss(); });
  await page.goto(`${APP}?emulator&as=${alias}`);
  await page.click('[data-action="sign-in"]');
  await page.waitForFunction(() => ['Proprietario', 'Membro'].includes(document.getElementById('garage-role').textContent)
    && document.getElementById('db-status').textContent.includes('Sync'), null, { timeout: T });
  let uid = null;     // uid assegnato dall'emulatore Auth: lo si ricava da users/{uid} (email = alias@example.com)
  for (let i = 0; i < 20 && !uid; i++) {
    uid = (await db.collection('users').where('email', '==', `${alias}@example.com`).get()).docs[0]?.id || null;
    if (!uid) await page.waitForTimeout(250);
  }
  if (!uid) problems.push(`uid di ${alias} non trovato`);
  return { ctx, page, uid };
}
const items = (page) => page.$$eval('.scadenza-item .sc-title', (e) => e.map((x) => x.textContent.trim()));
const confirmYes = async (page) => { await page.waitForSelector('#confirm-modal.open', { timeout: T }); await page.click('#confirm-yes'); };

console.log('E2E scadenze personalizzate\n');
const { ctx, page, uid } = await login('dlowner');

// veicolo con bollo
await page.click('#fab');
await page.fill('#v-plate', 'DL123AA');
await page.fill('#v-model', 'Panda');
await page.fill('#v-bollo', iso(60));
// openModal precompila con oggi le date vuote del veicolo (comportamento esistente): date esplicite e lontane
await page.fill('#v-revisione', iso(200));
await page.fill('#v-assicurazione', iso(300));
await page.click('[data-action="save-vehicle"]');
await page.waitForFunction(() => document.querySelectorAll('.vehicle-card').length === 1, null, { timeout: T });

// + nella scheda Scadenze
await page.click('#nav-scadenze');
check(await page.isVisible('#fab'), 'pulsante + visibile nella scheda Scadenze');
await page.click('#fab');
await page.waitForSelector('#deadline-modal.open', { timeout: T });
await page.selectOption('#d-kind', 'ztl');
check(await page.inputValue('#d-label') === 'Permesso ZTL', 'scegliendo il tipo la descrizione si precompila');
await page.fill('#d-label', 'ZTL Milano <b>x</b>');
await page.selectOption('#d-vehicle', { label: 'DL123AA — Panda' });
await page.fill('#d-due', iso(20));
await page.selectOption('#d-repeat', '12');
await page.fill('#d-cost', '80,50');
await page.click('[data-action="save-deadline"]');
await page.waitForFunction(() => !document.getElementById('deadline-modal').classList.contains('open'), null, { timeout: T });

// scadenza di tutto il garage, singola
await page.click('#fab');
await page.waitForSelector('#deadline-modal.open', { timeout: T });
check(await page.inputValue('#d-due') === '', 'nuova scadenza: data vuota (non precompilata con oggi)');
await page.selectOption('#d-kind', 'estintore');
await page.fill('#d-due', iso(5));
await page.click('[data-action="save-deadline"]');
await page.waitForFunction(() => document.querySelectorAll('.scadenza-item').length === 5, null, { timeout: T });

let titles = await items(page);
check(titles[0].startsWith('Estintore') && titles[1].startsWith('ZTL Milano <b>x</b> — DL123AA') && titles[2].startsWith('Bollo — DL123AA'),
  `lista ordinata per data, testo dell'utente non interpretato come HTML: ${titles.join(' | ')}`);
check(/garage/i.test(titles[0]), 'scadenza senza veicolo indicata come "tutto il garage"');
check(await page.textContent('#scad-badge') === '2', `contatore scadenze vicine (≤30 gg) = 2 (${await page.textContent('#scad-badge')})`);

// Firestore: numeri veri e timestamp del server
const docs = (await db.collection(`garages/${uid}/deadlines`).get()).docs.map((d) => d.data());
const ztl = docs.find((d) => d.kind === 'ztl');
check(ztl && ztl.cost === 80.5 && ztl.repeatMonths === 12 && typeof ztl.vehicleId === 'string', `in Firestore: cost ${ztl?.cost} (number), repeatMonths ${ztl?.repeatMonths}`);
check(ztl && ztl.createdAt?.constructor?.name === 'Timestamp' && ztl.updatedAt?.constructor?.name === 'Timestamp', 'createdAt/updatedAt sono timestamp del server');
check(docs.find((d) => d.kind === 'estintore')?.vehicleId === null, 'estintore senza veicolo (vehicleId null)');

// calendario: anche le personalizzate
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: T }), page.click('[data-action="ics-all"]')]);
const ics = readFileSync(await dl.path(), 'utf8').replace(/\r\n /g, '');
check((ics.match(/^BEGIN:VEVENT/gm) || []).length === 5 && ics.includes('ZTL Milano <b>x</b>') && ics.includes('Estintore'), 'il file .ics contiene anche le scadenze personalizzate');

// "Fatto" sulla ricorrente → +12 mesi
await page.click('.scadenza-item:has-text("ZTL Milano") [data-action="deadline-done"]');
await page.waitForSelector('#deadline-done-modal.open', { timeout: T });
check(await page.inputValue('#dd-amount') === '80,5', `"Fatto": importo precompilato con il costo previsto (${await page.inputValue('#dd-amount')})`);
check(await page.inputValue('#dd-date') === iso(0), '"Fatto": data del pagamento = oggi');
await page.fill('#dd-amount', '1.500,5');
await page.click('[data-action="confirm-deadline-done"]');
check(await page.isVisible('#dd-error') && await page.isVisible('#deadline-done-modal.open'), '"1.500,5" respinto, la finestra resta aperta');
await page.fill('#dd-amount', '82,30');
await page.click('[data-action="confirm-deadline-done"]');
let pay = null;
for (let i = 0; i < 20 && !pay; i++) {
  pay = (await db.collection(`garages/${uid}/payments`).get()).docs[0]?.data();
  if (!pay) await page.waitForTimeout(300);
}
check(pay && pay.amount === 82.3 && pay.date === iso(0) && pay.kind === 'ztl' && typeof pay.vehicleId === 'string'
  && pay.createdAt?.constructor?.name === 'Timestamp', `pagamento registrato con l'importo modificato: ${pay?.amount} (number), ${pay?.date}`);
await page.click('#nav-spese');
await page.click('#seg-annue');
await page.waitForFunction(() => /82,30/.test(document.getElementById('subsection-annue').textContent), null, { timeout: T }).catch(() => {});
check(/82,30/.test(await page.textContent('#subsection-annue')), 'il pagamento conta nelle Spese annue');
await page.click('#nav-scadenze');
const next = (() => { const d = new Date(iso(20) + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + 1); return d.toISOString().slice(0, 10); })();
let moved = false;
for (let i = 0; i < 20 && !moved; i++) {
  moved = (await db.collection(`garages/${uid}/deadlines`).where('kind', '==', 'ztl').get()).docs[0]?.data().due === next;
  if (!moved) await page.waitForTimeout(300);
}
check(moved, `"Fatto" su una ricorrente: nuova scadenza ${next}`);

// un membro la vede
// (invito via UI omesso: si aggiunge il membro direttamente con l'admin SDK, come farebbe un invito accettato)
const { ctx: c2, page: p2, uid: uid2 } = await login('dlmember');
await db.doc(`garages/${uid}`).update({ memberUids: [uid2], [`memberInfo.${uid2}`]: { email: 'dlmember@example.com', name: 'dlmember', photo: '', joinedAt: new Date(), inviteId: 'f'.repeat(64) } });
await db.doc(`users/${uid2}`).set({ garageId: uid }, { merge: true });
await p2.reload();
await p2.waitForFunction(() => document.getElementById('garage-role').textContent === 'Membro', null, { timeout: T });
await p2.click('#nav-scadenze');
await p2.waitForFunction(() => document.querySelectorAll('.scadenza-item').length === 5, null, { timeout: T }).catch(() => {});
check((await items(p2)).some((t) => t.startsWith('ZTL Milano')), 'un membro del garage vede le scadenze personalizzate');

// modifica dal membro
await p2.click('.scadenza-item:has-text("Estintore") [data-action="edit-deadline"]');
await p2.waitForSelector('#deadline-modal.open', { timeout: T });
await p2.fill('#d-label', 'Estintore garage');
await p2.click('[data-action="save-deadline"]');
await p2.waitForFunction(() => [...document.querySelectorAll('.sc-title')].some((e) => e.textContent.includes('Estintore garage')), null, { timeout: T });
check(true, 'un membro modifica una scadenza');

// "Fatto" su una singola → eliminata
await p2.click('.scadenza-item:has-text("Estintore garage") [data-action="deadline-done"]');
await p2.waitForSelector('#deadline-done-modal.open', { timeout: T });
check(await p2.inputValue('#dd-amount') === '', '"Fatto" senza costo previsto: importo vuoto');
await p2.click('[data-action="confirm-deadline-done"]');
await p2.waitForFunction(() => ![...document.querySelectorAll('.sc-title')].some((e) => e.textContent.includes('Estintore')), null, { timeout: T }).catch(() => {});
check(!(await items(p2)).some((t) => t.startsWith('Estintore')), '"Fatto" su una scadenza singola la elimina');
check((await db.collection(`garages/${uid}/payments`).get()).size === 1, 'importo vuoto: nessun pagamento registrato');
await c2.close();

// cancellando il veicolo spariscono anche le sue scadenze personalizzate
await page.click('#nav-garage');
await page.click('[data-action="delete-vehicle"]');
await confirmYes(page);
let gone = false;
for (let i = 0; i < 20 && !gone; i++) {
  gone = (await db.collection(`garages/${uid}/deadlines`).get()).empty;
  if (!gone) await page.waitForTimeout(300);
}
check(gone, 'eliminando il veicolo vengono eliminate anche le sue scadenze personalizzate');
let payGone = false;
for (let i = 0; i < 20 && !payGone; i++) {
  payGone = (await db.collection(`garages/${uid}/payments`).get()).empty;
  if (!payGone) await page.waitForTimeout(300);
}
check(payGone, '... e i suoi pagamenti');

const csp = [...new Set(await page.evaluate(() => window.__csp))];
check(csp.length === 0, `nessuna violazione CSP${csp.length ? ': ' + csp.join(' | ') : ''}`);
await ctx.close();
await browser.close();
if (problems.length) { console.log('\n✖ PROBLEMI:\n' + problems.map((p) => '  - ' + p).join('\n')); process.exit(1); }
console.log('\n✔ Scadenze personalizzate OK');
