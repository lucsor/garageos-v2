// E2E registro pagamenti e pagato / previsto (v2.7.0) su emulatori, con le regole vere, a larghezza telefono (390 px):
//  - "✅ Fatto" con 80,50 → il pagamento compare in Spese → 🧾 Pagamenti, con il totale
//  - modifica a 75 → Firestore (solo amount + editedBy + updatedAt), registro con "modificato", spese annue aggiornate
//  - Spese annue: colonna "Previsto" per le scadenze future (anche nel grafico, tratteggiato) e nel CSV
//  - un membro non autore non vede "Elimina"
//  - eliminando il veicolo il pagamento resta come "Veicolo rimosso"
//  - il proprietario elimina il pagamento con il modale di conferma dell'app (nessun confirm() nativo)
// Prerequisiti: emulatori auth+firestore --project garageos-879bc, app su http://127.0.0.1:5173. Uso: node payments.e2e.mjs
// SHOT=<file.png> salva lo screenshot del registro a 390 px.
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
const Y = Number(iso(0).slice(0, 4));
const { adminDb } = await import('../../tools/admin/creds.mjs');
const db = adminDb();
const until = async (fn, page, tries = 30) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await page.waitForTimeout(300); } return null; };

await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function login(alias) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 }, hasTouch: true });
  await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => { problems.push(`dialog nativo inatteso: ${d.message()}`); d.dismiss(); });
  await page.goto(`${APP}?emulator&as=${alias}`);
  await page.click('[data-action="sign-in"]');
  await page.waitForFunction(() => ['Proprietario', 'Membro'].includes(document.getElementById('garage-role').textContent)
    && document.getElementById('db-status').textContent.includes('Sync'), null, { timeout: T });
  const uid = await until(async () => (await db.collection('users').where('email', '==', `${alias}@example.com`).get()).docs[0]?.id, page, 20);
  if (!uid) problems.push(`uid di ${alias} non trovato`);
  return { ctx, page, uid };
}
const ledger = (page) => page.$$eval('#pay-list .ledger-row', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
const openPagamenti = async (page) => { await page.click('#nav-spese'); await page.click('#seg-pagamenti'); };
const doneWith = async (page, title, amount) => {
  await page.click(`.scadenza-item:has-text("${title}") [data-action="deadline-done"]`);
  await page.waitForSelector('#deadline-done-modal.open', { timeout: T });
  if (amount !== undefined) await page.fill('#dd-amount', amount);
  await page.click('[data-action="confirm-deadline-done"]');
  await page.waitForFunction(() => !document.getElementById('deadline-done-modal').classList.contains('open'), null, { timeout: T });
};
const addDeadline = async (page, { kind, label, vehicle, due, repeat, cost }) => {
  await page.click('#fab');
  await page.waitForSelector('#deadline-modal.open', { timeout: T });
  await page.selectOption('#d-kind', kind);
  if (label) await page.fill('#d-label', label);
  if (vehicle) await page.selectOption('#d-vehicle', { label: vehicle });
  await page.fill('#d-due', due);
  if (repeat) await page.selectOption('#d-repeat', repeat);
  if (cost) await page.fill('#d-cost', cost);
  await page.click('[data-action="save-deadline"]');
  await page.waitForFunction(() => !document.getElementById('deadline-modal').classList.contains('open'), null, { timeout: T });
};

console.log('E2E registro pagamenti e pagato / previsto\n');
const { ctx, page, uid } = await login('pyowner');

// veicolo con bollo futuro e importo (→ previsto)
await page.click('#fab');
await page.fill('#v-plate', 'PY123AA');
await page.fill('#v-model', 'Panda');
await page.fill('#v-bollo', iso(400));
await page.fill('#v-bollo-cost', '250');
await page.click('[data-action="save-vehicle"]');
await page.waitForFunction(() => document.querySelectorAll('.vehicle-card').length === 1, null, { timeout: T });

// due scadenze personalizzate, "✅ Fatto" su entrambe
await page.click('#nav-scadenze');
await addDeadline(page, { kind: 'ztl', label: 'ZTL Milano', vehicle: 'PY123AA — Panda', due: iso(10), repeat: '12', cost: '80,50' });
await addDeadline(page, { kind: 'estintore', due: iso(5), cost: '30' });
await doneWith(page, 'ZTL Milano');            // importo precompilato 80,5
await doneWith(page, 'Estintore');             // 30, tutto il garage
const pays = await until(async () => { const s = await db.collection(`garages/${uid}/payments`).get(); return s.size === 2 ? s.docs : null; }, page);
check(!!pays, 'due pagamenti registrati con "✅ Fatto"');
const ztlPay = pays?.find((d) => d.data().kind === 'ztl');

// registro
await openPagamenti(page);
await page.waitForFunction(() => document.querySelectorAll('#pay-list .ledger-row').length === 2, null, { timeout: T }).catch(() => {});
let rows = await ledger(page);
check(rows.length === 2 && rows.some((r) => /ZTL Milano/.test(r) && /80,50/.test(r) && /PY123AA/.test(r)), `il pagamento ZTL compare nel registro: ${rows.join(' | ')}`);
check(rows.some((r) => /Estintore/.test(r) && /Garage \(senza veicolo\)/.test(r)), 'pagamento senza veicolo: "Garage (senza veicolo)"');
check(/2 pagamenti · totale € 110,50/.test(await page.textContent('#pay-total')), `totale del registro: ${await page.textContent('#pay-total')}`);
await page.selectOption('#pay-filter-vehicle', '-');
check((await ledger(page)).length === 1, 'filtro "senza veicolo"');
await page.selectOption('#pay-filter-vehicle', '');
await page.selectOption('#pay-filter-year', String(Y));
check((await ledger(page)).length === 2, `filtro anno ${Y}`);
await page.selectOption('#pay-filter-year', '');

// modifica: importo 75
await page.click('#pay-list .ledger-row:has-text("ZTL Milano") [data-action="pay-edit"]');
await page.waitForSelector('#payment-edit-modal.open', { timeout: T });
check(await page.inputValue('#pe-amount') === '80,5' && await page.inputValue('#pe-label') === 'ZTL Milano', 'modifica: campi precompilati');
check(await page.isVisible('#btn-pay-delete'), 'il proprietario vede "Elimina"');
await page.fill('#pe-amount', '');
await page.click('[data-action="pay-save"]');
check(await page.isVisible('#pe-error') && await page.isVisible('#payment-edit-modal.open'), 'importo vuoto respinto, la finestra resta aperta');
await page.fill('#pe-amount', '1.500,5');
await page.click('[data-action="pay-save"]');
check(await page.isVisible('#pe-error'), '"1.500,5" respinto');
await page.fill('#pe-amount', '75');
await page.click('[data-action="pay-save"]');
const edited = await until(async () => { const d = (await db.doc(`garages/${uid}/payments/${ztlPay?.id}`).get()).data(); return d?.amount === 75 ? d : null; }, page);
check(edited && edited.editedBy === 'pyowner@example.com' && edited.updatedAt?.toMillis() > edited.createdAt?.toMillis()
  && edited.deadlineId === ztlPay?.data().deadlineId && edited.addedBy === 'pyowner@example.com',
  `in Firestore: amount ${edited?.amount}, editedBy ${edited?.editedBy}, collegamento e autore invariati`);
await page.waitForFunction(() => /modificato/.test(document.getElementById('pay-list').textContent), null, { timeout: T }).catch(() => {});
rows = await ledger(page);
check(rows.some((r) => /ZTL Milano/.test(r) && /75,00/.test(r) && /modificato/.test(r)), `registro aggiornato con "modificato": ${rows.join(' | ')}`);
check(/totale € 105,00/.test(await page.textContent('#pay-total')), `totale aggiornato: ${await page.textContent('#pay-total')}`);
check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'a 390 px nessuno scroll orizzontale (registro)');
if (process.env.SHOT) { await page.screenshot({ path: process.env.SHOT, fullPage: false }); console.log(`  📸 ${process.env.SHOT}`); }

// spese annue: pagato e previsto
await page.click('#seg-annue');
await page.waitForSelector('#spend-chart', { timeout: T });
const tot = (await page.textContent(`.spend-table tr[data-year="${Y}"] td.tot`))?.trim();
check(tot === '€ 105', `Spese annue ${Y}: pagato = 75 + 30 (${tot})`);
const nextZtl = (() => { const d = new Date(iso(10) + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + 1); return d.toISOString().slice(0, 10); })();
const plannedYears = { [Number(nextZtl.slice(0, 4))]: 80.5 };
const bY = Number(iso(400).slice(0, 4));
plannedYears[bY] = (plannedYears[bY] || 0) + 250;
for (const [yy, amt] of Object.entries(plannedYears)) {
  const cell = (await page.textContent(`.spend-table tr[data-year="${yy}"] td.planned`).catch(() => ''))?.trim();
  check(cell === `€ ${Math.round(amt).toLocaleString('it-IT')}`, `Previsto ${yy}: ${cell} (scadenze future con importo)`);
  const paid = (await page.textContent(`.spend-table tr[data-year="${yy}"] td.tot`).catch(() => ''))?.trim();
  if (Number(yy) !== Y) check(paid === '€ 0', `le scadenze future non entrano nel pagato ${yy} (${paid})`);
}
check(await page.$$eval('#spend-chart .sp-planned', (e) => e.length) >= 1, 'grafico: barra tratteggiata del previsto');
check(/Previsto/.test(await page.textContent('.spend-table thead')), 'tabella: colonna "Previsto"');
check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'a 390 px nessuno scroll orizzontale (spese annue)');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: T }), page.click('[data-action="csv-spese"]')]);
const csv = readFileSync(await dl.path(), 'utf8');
check(csv.includes('"Totale pagato (€)";"Litri";"Previsto (€)"'), 'CSV: colonna "Previsto (€)"');
check(csv.includes(`"${Y}";"PY123AA Panda";"0,00";"75,00";"0,00";"75,00";"0,00";`), 'CSV: pagato dell\'anno con l\'importo modificato');
check(csv.includes(`;"80,50"`) || csv.includes(`;"330,50"`), 'CSV: previsto della ZTL rinnovata');

// un membro non autore: vede il registro, non "Elimina"
const { ctx: c2, page: p2, uid: uid2 } = await login('pymember');
await db.doc(`garages/${uid}`).update({ memberUids: [uid2], [`memberInfo.${uid2}`]: { email: 'pymember@example.com', name: 'pymember', photo: '', joinedAt: new Date(), inviteId: 'f'.repeat(64) } });
await db.doc(`users/${uid2}`).set({ garageId: uid }, { merge: true });
await p2.reload();
await p2.waitForFunction(() => document.getElementById('garage-role').textContent === 'Membro', null, { timeout: T });
await openPagamenti(p2);
await p2.waitForFunction(() => document.querySelectorAll('#pay-list .ledger-row').length === 2, null, { timeout: T }).catch(() => {});
check((await ledger(p2)).length === 2, 'il membro vede il registro');
await p2.click('#pay-list .ledger-row:has-text("ZTL Milano") [data-action="pay-edit"]');
await p2.waitForSelector('#payment-edit-modal.open', { timeout: T });
check(!(await p2.isVisible('#btn-pay-delete')), 'un membro non autore non vede "Elimina"');
await p2.click('#payment-edit-modal [data-action="close-modal"]');
await c2.close();

// eliminando il veicolo il pagamento resta come "Veicolo rimosso"
await page.click('#nav-garage');
await page.click('[data-action="delete-vehicle"]');
await page.waitForSelector('#confirm-modal.open', { timeout: T });
await page.click('#confirm-yes');
await page.waitForFunction(() => document.querySelectorAll('.vehicle-card').length === 0, null, { timeout: T });
check((await db.collection(`garages/${uid}/payments`).get()).size === 2, 'eliminato il veicolo, i pagamenti restano in Firestore');
await openPagamenti(page);
rows = await ledger(page);
check(rows.some((r) => /ZTL Milano/.test(r) && /Veicolo rimosso/.test(r)), `registro: "Veicolo rimosso" (${rows.join(' | ')})`);
check(await page.$('#pay-filter-vehicle option[value="?"]') !== null, 'filtro "Veicoli rimossi" disponibile');

// il proprietario elimina il pagamento (modale di conferma dell'app)
await page.click('#pay-list .ledger-row:has-text("ZTL Milano") [data-action="pay-edit"]');
await page.waitForSelector('#payment-edit-modal.open', { timeout: T });
await page.click('#btn-pay-delete');
await page.waitForSelector('#confirm-modal.open', { timeout: T });
check(/la scadenza non torna indietro/.test(await page.textContent('#confirm-msg')), 'conferma con il modale dell\'app');
await page.click('#confirm-yes');
const gone = await until(async () => (await db.doc(`garages/${uid}/payments/${ztlPay?.id}`).get()).exists ? null : true, page);
check(!!gone, 'pagamento eliminato da Firestore');
await page.waitForFunction(() => document.querySelectorAll('#pay-list .ledger-row').length === 1, null, { timeout: T }).catch(() => {});
check((await ledger(page)).length === 1, 'sparito dal registro');
await page.click('#seg-annue');
const tot2 = (await page.textContent(`.spend-table tr[data-year="${Y}"] td.tot`))?.trim();
check(tot2 === '€ 30', `sparito dalle spese annue (${tot2})`);

const csp = [...new Set(await page.evaluate(() => window.__csp))];
check(csp.length === 0, `nessuna violazione CSP${csp.length ? ': ' + csp.join(' | ') : ''}`);
await ctx.close();
await browser.close();
if (problems.length) { console.log('\n✖ PROBLEMI:\n' + problems.map((p) => '  - ' + p).join('\n')); process.exit(1); }
console.log('\n✔ Registro pagamenti OK');
