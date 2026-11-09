// E2E rifornimenti, consumi e spese annue (v2.6) su emulatori, a larghezza telefono (360 px):
//  - ⛽ dalla scheda del veicolo: data di oggi e "pieno" già impostati, tastiera numerica/decimale
//  - pieno → parziale → pieno: km/l, l/100 km ed €/km calcolati solo tra i pieni
//  - virgola decimale accettata ("39,5"), valori ambigui respinti ("1.500,5"), km in calo → conferma
//  - in Firestore solo numeri (km intero, litri, importo), timestamp del server, addedBy = chi inserisce
//  - modifica (regole di update), grafico delle spese per anno, CSV rifornimenti e spese annue
//  - eliminazione del veicolo → eliminati anche i suoi rifornimenti; nessuna violazione CSP, niente scroll orizzontale
// Prerequisiti: emulatori auth+firestore --project garageos-879bc, app su http://127.0.0.1:5173. Uso: node fuel.e2e.mjs
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
const PROJECT = 'garageos-879bc';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const T = 60_000;
const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); console.log(`  ${cond ? '✔' : '✖'} ${msg}`); };
const localIso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const today = localIso(new Date());
const Y = Number(today.slice(0, 4));
const lastYearEnd = `${Y - 1}-12-31`;

// documenti di una collezione in tutti i garage, letti come amministratore (le regole non si applicano)
async function adminDocs(collectionId) {
  const r = await fetch(`${FS}:runQuery`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId, allDescendants: true }] } }),
  });
  return (await r.json()).filter((x) => x.document).map((x) => x.document);
}
const refuelDocs = () => adminDocs('refuels');

await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 360, height: 760 }, hasTouch: true });
await ctx.addInitScript(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
});
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(`console: ${m.text()}`); });

console.log('E2E rifornimenti e spese annue\n');
await page.goto(`${APP}?emulator&as=fueluser`);
await page.click('[data-action="sign-in"]');
await page.waitForFunction(() => document.getElementById('garage-role').textContent === 'Proprietario', null, { timeout: T });

await page.click('#fab');
await page.waitForSelector('#vehicle-modal.open', { timeout: T });
const emptyDates = await page.$$eval('#v-bollo, #v-revisione, #v-assicurazione, #v-km-date', (els) => els.map((e) => `${e.id}=${e.value}`));
check(emptyDates.every((x) => x.endsWith('=')), `veicolo nuovo: date di bollo/revisione/assicurazione/km vuote, non "oggi" (${emptyDates.join(' ')})`);
await page.fill('#v-plate', 'FU123EL');
await page.fill('#v-model', 'Panda benzina');
await page.fill('#v-km', '10500');
await page.click('[data-action="save-vehicle"]');
await page.waitForFunction(() => document.querySelectorAll('.vehicle-card').length === 1, null, { timeout: T });

// ── ⛽ dalla scheda del veicolo (un tocco)
const btn = await page.$('.vehicle-card [data-action="add-refuel"]');
check(!!btn, 'pulsante ⛽ Rifornimento sulla scheda del veicolo');
const bh = (await btn.boundingBox()).height;
check(bh >= 44, `area di tocco ≥ 44 px (${Math.round(bh)})`);
async function openFromCard() {
  await page.click('.vehicle-card [data-action="add-refuel"]');
  await page.waitForSelector('#refuel-modal.open', { timeout: T });
}
await openFromCard();
check(await page.inputValue('#r-date') === today, `data di oggi già impostata (${await page.inputValue('#r-date')})`);
check(await page.isChecked('#r-full'), '"pieno" spuntato di default');
check(await page.getAttribute('#r-km', 'inputmode') === 'numeric' && await page.getAttribute('#r-liters', 'inputmode') === 'decimal'
  && await page.getAttribute('#r-amount', 'inputmode') === 'decimal', 'tastiera numerica (km) e decimale (litri, importo)');
check(await page.$$eval('#refuel-modal input:not([type=hidden]), #refuel-modal select', (els) => els.every((e) => e.labels && e.labels.length > 0)),
  'ogni campo ha la sua etichetta');

async function fillRefuel({ date, km, liters, amount, full = true, note = '' }) {
  await page.fill('#r-date', date);
  await page.fill('#r-km', km);
  await page.fill('#r-liters', liters);
  await page.fill('#r-amount', amount);
  await page.setChecked('#r-full', full);
  await page.fill('#r-note', note);
}
const saved = () => page.waitForFunction(() => !document.getElementById('refuel-modal').classList.contains('open'), null, { timeout: T });

// 1° pieno (anno scorso, 31 dicembre)
await fillRefuel({ date: lastYearEnd, km: '10000', liters: '40', amount: '70' });
await page.click('[data-action="save-refuel"]');
await saved();

// parziale, con importo ambiguo prima respinto e poi corretto
await openFromCard();
await fillRefuel({ date: today, km: '10.300', liters: '20', amount: '1.500,5', full: false });
await page.click('[data-action="save-refuel"]');
await page.waitForSelector('#r-error:not([hidden])', { timeout: T });
check(/Importo non valido/.test(await page.textContent('#r-error')), `"1.500,5" respinto: ${await page.textContent('#r-error')}`);
check(await page.getAttribute('#r-amount', 'aria-invalid') === 'true', 'campo errato segnalato (aria-invalid)');
check(await page.$eval('#refuel-modal', (m) => m.classList.contains('open')), 'la finestra resta aperta');
await page.fill('#r-amount', '36,5');
await page.click('[data-action="save-refuel"]');
await saved();

// 2° pieno: virgola decimale
await openFromCard();
await fillRefuel({ date: today, km: '10800', liters: '20', amount: '39,5', note: 'autostrada' });
await page.click('[data-action="save-refuel"]');
await saved();

// km in calo → conferma; "Annulla" non salva
await openFromCard();
await fillRefuel({ date: today, km: '9000', liters: '10', amount: '18' });
await page.click('[data-action="save-refuel"]');
await page.waitForSelector('#confirm-modal.open', { timeout: T });
check(/sono meno di quelli del rifornimento/.test(await page.textContent('#confirm-msg')), 'km inferiori al rifornimento precedente: chiede conferma');
await page.click('#confirm-no');
await page.click('[data-action="close-modal"][data-modal="refuel-modal"]');

// ── km del veicolo: solo l'ultimo rifornimento con km MAGGIORI li aggiorna (10000 e 10300 < 10500: no; 10800: sì)
let veh = null;
for (let i = 0; i < 30; i++) { veh = (await adminDocs('vehicles'))[0]?.fields; if (veh?.km?.integerValue === '10800') break; await page.waitForTimeout(300); }
check(veh?.km?.integerValue === '10800' && veh?.kmDate?.stringValue === today,
  `km del veicolo aggiornati dall'ultimo rifornimento: ${JSON.stringify(veh?.km)} al ${veh?.kmDate?.stringValue}`);
check(veh?.bollo?.stringValue === '' && veh?.revisione?.stringValue === '' && veh?.assicurazione?.stringValue === '',
  'in Firestore le date del veicolo restano vuote');

// ── Firestore: solo numeri
let docs = [];
for (let i = 0; i < 30 && docs.length < 3; i++) { docs = await refuelDocs(); if (docs.length < 3) await page.waitForTimeout(300); }
check(docs.length === 3, `3 rifornimenti salvati (${docs.length})`);
const f = docs.map((d) => d.fields);
check(f.every((x) => 'integerValue' in x.km), 'km salvati come intero');
check(f.every((x) => ('integerValue' in x.liters || 'doubleValue' in x.liters) && ('integerValue' in x.amount || 'doubleValue' in x.amount)),
  'litri e importo salvati come numeri (mai stringhe)');
check(f.some((x) => Number(x.amount.doubleValue) === 39.5) && f.some((x) => Number(x.km.integerValue) === 10300), 'virgola e migliaia convertite: 39,5 → 39.5, "10.300" → 10300');
check(f.every((x) => 'booleanValue' in x.full) && f.filter((x) => x.full.booleanValue === false).length === 1, 'pieno/parziale come booleano');
check(f.every((x) => 'timestampValue' in x.createdAt && 'timestampValue' in x.updatedAt), 'createdAt/updatedAt: timestamp del server');
check(f.every((x) => x.addedBy.stringValue === 'fueluser@example.com'), 'addedBy = email di chi inserisce');

// ── Consumi nella scheda Spese
await page.click('#nav-spese');
await page.waitForSelector('.fuel-group [data-stat="kml"]', { timeout: T });
const stat = (k) => page.textContent(`.fuel-group [data-stat="${k}"]`);
check(await stat('kml') === '20,0', `km/l tra i pieni: ${await stat('kml')} (800 km / 40 l)`);
check(await stat('l100') === '5,0', `l/100 km: ${await stat('l100')}`);
check(await stat('eurkm') === '0,095', `€/km: ${await stat('eurkm')} (76 € / 800 km)`);
check(await page.$$eval('.fuel-item[data-refuel]', (x) => x.length) === 3, 'tre rifornimenti nell\'elenco');
check((await page.textContent('.fuel-group')).includes('parziale'), 'il parziale è indicato come tale');
const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
check(noScroll, 'a 360 px nessuno scroll orizzontale (rifornimenti)');
// Ricerca e misura nella STESSA funzione, ripetuta finché vale: con $$eval i pulsanti trovati potevano essere staccati
// da un nuovo disegno della lista (snapshot di Firestore, es. km del veicolo aggiornati) e misurare 0×0 (CI instabile, #15 e #18).
const tapOk = await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('.fuel-item [data-action]')];
  return b.length > 0 && b.every((x) => { const r = x.getBoundingClientRect(); return r.height >= 44 && r.width >= 44; });
}, null, { timeout: 5000 }).then(() => true, () => false);
check(tapOk, 'pulsanti modifica/elimina ≥ 44 × 44 px');

// modifica (regole di update: createdAt e addedBy invariati, updatedAt del server)
await page.click('.fuel-item:has-text("autostrada") [data-action="edit-refuel"]');
await page.waitForSelector('#refuel-modal.open', { timeout: T });
check(await page.inputValue('#r-amount') === '39,5', `in modifica l'importo è mostrato con la virgola (${await page.inputValue('#r-amount')})`);
await page.fill('#r-note', 'autostrada A1');
await page.click('[data-action="save-refuel"]');
await saved();
await page.waitForSelector('.fuel-item:has-text("autostrada A1")', { timeout: T });
check(true, 'rifornimento modificato e salvato (update accettato dalle regole)');
check(await stat('eurkm') === '0,095', 'consumi invariati dopo la modifica della nota');

// CSV rifornimenti
const read = async (dl) => readFileSync(await dl.path(), 'utf8');
let [dl] = await Promise.all([page.waitForEvent('download', { timeout: T }), page.click('[data-action="csv-refuels"]')]);
let csv = await read(dl);
check(/^garageos-rifornimenti-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()), `file: ${dl.suggestedFilename()}`);
check(csv.startsWith('﻿"Data";"Veicolo";"Km";"Litri";"Importo (€)"'), 'CSV con BOM e intestazione');
check(csv.includes(`"${lastYearEnd}";"FU123EL Panda benzina";"10000";"40,00";"70,00";"1,750";"sì"`), 'riga del primo pieno con decimali alla italiana');
check(csv.includes('"10300";"20,00";"36,50";"1,825";"no"'), 'riga del parziale');
check(csv.includes('"TOTALE";"";"80,00";"146,00"'), 'riga dei totali');

// ── Spese annue: grafico e CSV
await page.click('#seg-annue');
await page.waitForSelector('#spend-chart', { timeout: T });
const cols = await page.$$eval('#spend-chart .sp-col', (c) => c.map((x) => x.dataset.year));
check(JSON.stringify(cols) === JSON.stringify([String(Y - 1), String(Y)]), `grafico per anno, a cavallo del 31 dicembre (${cols.join(', ')})`);
check(await page.$$eval('#spend-chart .sp-seg.carburante', (s) => s.length) === 2, 'barre del carburante nel grafico');
const rowY = await page.textContent(`.spend-table tr[data-year="${Y}"]`);
check(/€ 76/.test(rowY), `anno ${Y}: carburante € 76 (${rowY.replace(/\s+/g, ' ').trim()})`);
check(await page.$$eval('.sp-row', (r) => r.length) === 1, 'ripartizione per veicolo');
check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'a 360 px nessuno scroll orizzontale (spese annue)');
[dl] = await Promise.all([page.waitForEvent('download', { timeout: T }), page.click('[data-action="csv-spese"]')]);
csv = await read(dl);
check(/^garageos-spese-annue-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()), `file: ${dl.suggestedFilename()}`);
check(csv.includes(`"${Y - 1}";"FU123EL Panda benzina";"0,00";"0,00";"70,00";"70,00";"40,00"`), 'CSV spese: anno precedente');
check(csv.includes(`"${Y}";"FU123EL Panda benzina";"0,00";"0,00";"76,00";"76,00";"40,00"`), 'CSV spese: anno in corso');

// ── Scheda del veicolo: consumo in sintesi
await page.click('#nav-garage');
check(/20,0 km\/l/.test(await page.textContent('.vehicle-card')), 'la scheda del veicolo mostra i km/l');

const csp = [...new Set(await page.evaluate(() => window.__csp))];
check(csp.length === 0, `nessuna violazione CSP${csp.length ? ': ' + csp.join(' | ') : ''}`);

// ── Eliminazione del veicolo → anche i rifornimenti
await page.click('.vehicle-card [data-action="delete-vehicle"]');
await page.click('#confirm-yes');
await page.waitForFunction(() => document.querySelectorAll('.vehicle-card').length === 0, null, { timeout: T });
for (let i = 0; i < 30; i++) { docs = await refuelDocs(); if (!docs.length) break; await page.waitForTimeout(300); }
check(docs.length === 0, `eliminando il veicolo si eliminano i suoi rifornimenti (rimasti: ${docs.length})`);

await browser.close();
if (problems.length) { console.log('\n✖ PROBLEMI:\n' + problems.map((p) => '  - ' + p).join('\n')); process.exit(1); }
console.log('\n✔ Rifornimenti e spese annue OK');
