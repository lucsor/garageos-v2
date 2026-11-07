// E2E costi degli interventi multi-tipo, con i DATI REALI del backup importati nell'emulatore.
// Verifica:
//  1. sui dati reali i totali (statistiche) sono quelli attesi → nessuna regressione;
//  2. un gruppo legacy (stesso createdAt, stesso costo ripetuto su N tipi) è contato UNA volta;
//  3. un nuovo intervento con 3 tipi e 250 € aumenta il totale di 250 € (non 750), costo salvato solo sul primo
//     documento, gli altri due mostrati come "incluso".
// Prerequisiti: emulatori auth+firestore --project garageos-879bc, app su http://127.0.0.1:5173, backup in GARAGEOS_BACKUP_DIR.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = 'garageos-879bc';
const PROJECT = 'garageos-879bc';
const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
const DIR = process.env.GARAGEOS_BACKUP_DIR || join(homedir(), 'Documents', 'garageos-backup');
const T = 60_000;
const lib = await import('../../tools/admin/restore-lib.mjs');
const { adminDb } = await import('../../tools/admin/creds.mjs');
const backup = lib.loadBackup(lib.latestBackup('firestore-', DIR));
const plan = JSON.parse(readFileSync(join(DIR, 'migration-plan.json'), 'utf8'));
const D = backup.documents;
const db = adminDb();
const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); console.log(`  ${cond ? '✔' : '✖'} ${msg}`); };

// emulatori puliti + backup + account proprietario (uid reale, alias finto)
await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
const paths = Object.keys(D);
for (let i = 0; i < paths.length; i += 400) {
  const b = db.batch(); paths.slice(i, i + 400).forEach((p) => b.set(db.doc(p), lib.decode(D[p], db))); await b.commit();
}
const owners = Object.keys(D).filter((p) => /^garages\/[^/]+$/.test(p)).map((p) => p.split('/')[1])
  .filter((g) => Object.keys(D).some((p) => p.startsWith(`garages/${g}/mechs/`)));
await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:batchCreate`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
  body: JSON.stringify({ users: owners.map((uid, i) => ({ localId: uid, email: `owner${i}@example.com`, emailVerified: true,
    providerUserInfo: [{ providerId: 'google.com', rawId: `owner${i}`, email: `owner${i}@example.com` }] })) }),
});

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const euro = (s) => Number(String(s).replace(/[^\d,]/g, '').replace(',', '.')) || 0;
async function statTotal(page) { return euro(await page.textContent('.stat-card:nth-child(3) .stat-value')); }
async function waitTotal(page, n) {
  await page.waitForFunction((n) => {
    const t = document.querySelector('.stat-card:nth-child(3) .stat-value')?.textContent || '';
    return (Number(t.replace(/[^\d,]/g, '').replace(',', '.')) || 0) === n;
  }, n, { timeout: T }).catch(() => {});
}

console.log('E2E costi multi-tipo (dati reali)\n');
for (const [i, gid] of owners.entries()) {
  const mechs = Object.entries(D).filter(([p]) => p.startsWith(`garages/${gid}/mechs/`)).map(([, m]) => m);
  const naive = mechs.reduce((s, m) => s + (parseFloat(m.cost) || 0), 0);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${APP}?emulator&as=owner${i}`);
  await page.click('[data-action="sign-in"]');
  await page.waitForFunction(() => document.getElementById('db-status').textContent.includes('Sync')
    && document.querySelectorAll('.vehicle-card').length > 0, null, { timeout: T });
  await page.waitForTimeout(1500);
  console.log(`garage ${gid.slice(0, 6)}… (${mechs.length} interventi)`);
  // 1) dati reali: nessun gruppo con costo ripetuto → totale = somma semplice
  check(await statTotal(page) === Math.round(naive), `dati reali: totale €${await statTotal(page)} = atteso €${Math.round(naive)}`);

  if (gid === plan.garage || i === 0) {
    const vid = Object.keys(D).find((p) => p.startsWith(`garages/${gid}/vehicles/`)).split('/').pop();
    // 2) gruppo legacy: 3 documenti, stesso createdAt, stesso costo 100 → +100
    const createdAt = '2026-11-07T10:00:00.000Z';
    const b = db.batch();
    for (const t of ['olio_motore', 'filtro_olio', 'filtro_aria'])
      b.set(db.collection(`garages/${gid}/mechs`).doc(), { vehicleId: vid, type: t, date: '2026-11-07', km: '', cost: '100', garage: '', note: 'test legacy', createdAt, updatedAt: createdAt, addedBy: 'test' });
    await b.commit();
    await waitTotal(page, Math.round(naive + 100));
    check(await statTotal(page) === Math.round(naive + 100), `gruppo legacy 3×€100 contato una volta: €${await statTotal(page)} (atteso €${Math.round(naive + 100)})`);

    // 3) nuovo intervento dal form: 3 tipi, €250
    await page.click('#nav-officina');
    await page.click('#fab');
    await page.waitForSelector('#mech-modal.open', { timeout: T });
    await page.selectOption('#m-vehicle', vid);
    for (const t of ['candele', 'batteria', 'spazzole']) await page.click(`.mech-type-btn[data-type="${t}"]`);
    await page.fill('#m-cost', '250');
    await page.fill('#m-note', 'test multi-tipo');
    await page.click('[data-action="save-mech"]');
    await page.click('#nav-garage');
    await waitTotal(page, Math.round(naive + 350));
    check(await statTotal(page) === Math.round(naive + 350), `nuovo intervento 3 tipi €250: totale €${await statTotal(page)} (atteso €${Math.round(naive + 350)}, non €${Math.round(naive + 100 + 750)})`);
    const saved = (await db.collection(`garages/${gid}/mechs`).where('note', '==', 'test multi-tipo').get()).docs.map((d) => d.data().cost).sort();
    check(JSON.stringify(saved) === JSON.stringify(['', '', '250']), `in Firestore: costi ${JSON.stringify(saved)} (atteso ["","","250"])`);
    await page.click('#nav-officina');
    await page.waitForTimeout(800);
    const inclusi = await page.$$eval('.mech-cost', (els) => els.filter((e) => e.textContent.trim() === 'incluso').length);
    check(inclusi === 4, `voci "incluso" in Officina: ${inclusi} (attese 4 = 2 legacy + 2 nuove)`);
    const hints = await page.$$eval('.mech-incl', (els) => els.map((e) => e.textContent.trim()));
    check(hints.length === 4 && hints.every((h) => /^🔗 Costo già conteggiato in «.+»$/.test(h)), `indicazione "Costo già conteggiato in «…»" sotto ogni voce inclusa (${hints.length})`);
  }
  await ctx.close();
}
await browser.close();
if (problems.length) { console.log('\n✖ PROBLEMI:\n' + problems.map((p) => '  - ' + p).join('\n')); process.exit(1); }
console.log('\n✔ Costi multi-tipo corretti, nessuna regressione sui dati reali');
