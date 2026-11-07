// E2E "primo avvio della v2.2" con la VERA app e i DATI REALI (backup importato nell'emulatore).
// Verifica che:
//  - ogni amico con garage proprio (proprietario, senza users/{uid}) apra il SUO garage con i suoi veicoli,
//    senza che venga creato un garage nuovo, e che venga scritto solo users/{uid};
//  - ogni membro migrato apra il garage di famiglia come "Membro".
// Prerequisiti: emulatori auth+firestore con --project garageos-879bc, app su http://127.0.0.1:5173,
// backup + migration-plan.json in GARAGEOS_BACKUP_DIR (default ~/Documents/garageos-backup).
// Gli account Auth dell'emulatore hanno gli UID REALI ma alias/email finti (nessun dato personale nel test).
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
const migrate = await import('../../tools/admin/migrate-lib.mjs');
const backup = lib.loadBackup(lib.latestBackup('firestore-', DIR));
const authUsers = JSON.parse(readFileSync(lib.latestBackup('auth-users-', DIR), 'utf8')).users;
const plan = JSON.parse(readFileSync(join(DIR, 'migration-plan.json'), 'utf8'));
const D = backup.documents;
const db = adminDb();
const short = (u) => u.slice(0, 6) + '…';
const count = (gid, c) => Object.keys(D).filter((p) => p.startsWith(`garages/${gid}/${c}/`)).length;
const garages = Object.keys(D).filter((p) => /^garages\/[^/]+$/.test(p)).map((p) => p.split('/')[1]);
const friends = garages.filter((g) => g !== plan.garage && count(g, 'vehicles') > 0);
const problems = [];

// 1) emulatori puliti + import del backup
await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
const paths = Object.keys(D);
for (let i = 0; i < paths.length; i += 400) {
  const b = db.batch();
  paths.slice(i, i + 400).forEach((p) => b.set(db.doc(p), lib.decode(D[p], db)));
  await b.commit();
}
console.log(`Importati ${paths.length} documenti del backup nell'emulatore`);

// 2) account Auth con UID reali e alias finti (Google provider rawId = alias)
const people = [
  ...friends.map((uid, i) => ({ uid, alias: `amico${i + 1}`, role: 'amico' })),
  ...plan.uids.map((uid, i) => ({ uid, alias: `famiglia${i + 1}`, role: 'migrato' })),
  { uid: plan.garage, alias: 'proprietario', role: 'proprietario' },
];
const res = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:batchCreate`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
  body: JSON.stringify({ users: people.map((p) => ({
    localId: p.uid, email: `${p.alias}@example.com`, emailVerified: true,
    providerUserInfo: [{ providerId: 'google.com', rawId: p.alias, email: `${p.alias}@example.com` }],
  })) }),
});
if (!res.ok) throw new Error('batchCreate: ' + (await res.text()));

// 3) migrazione mirata (stessa libreria della CLI)
const p = await migrate.planMigration(db, plan.garage, plan.uids, async (uid) => {
  const u = authUsers.find((x) => x.uid === uid); return u && { email: u.email, displayName: u.displayName };
});
if (!p.ok) throw new Error(p.errors.join('; '));
await migrate.applyMigration(db, plan.garage, p);
console.log(`Migrazione applicata sull'emulatore (${plan.uids.length} membri)\n`);

const garageCount = async () => (await db.collection('garages').listDocuments()).length;
const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function openAs(person) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
  });
  page.on('pageerror', (e) => problems.push(`[${person.alias}] pageerror: ${e.message}`));
  await page.goto(`${APP}?emulator&as=${person.alias}`);
  await page.click('[data-action="sign-in"]');
  return { page, ctx };
}

for (const person of people) {
  const before = await garageCount();
  const usersBefore = (await db.doc(`users/${person.uid}`).get()).data();
  const { page, ctx } = await openAs(person);
  const wantRole = person.role === 'migrato' ? 'Membro' : 'Proprietario';
  const wantGarage = person.role === 'migrato' ? plan.garage : person.uid;
  const wantVehicles = count(wantGarage, 'vehicles');
  try {
    await page.waitForFunction(([r, n]) => document.getElementById('garage-role').textContent === r
      && document.querySelectorAll('.vehicle-card').length === n
      && document.getElementById('db-status').textContent.includes('Sync'), [wantRole, wantVehicles], { timeout: T });
  } catch {
    const got = await page.evaluate(() => ({ role: document.getElementById('garage-role').textContent, v: document.querySelectorAll('.vehicle-card').length, title: document.getElementById('garage-title').textContent }));
    problems.push(`[${person.alias}] atteso ${wantRole} con ${wantVehicles} veicoli, trovato ${JSON.stringify(got)}`);
  }
  await page.waitForTimeout(1500);   // eventuali scritture asincrone
  const after = await garageCount();
  const u = (await db.doc(`users/${person.uid}`).get()).data();
  const title = await page.textContent('#garage-title');
  const csp = await page.evaluate(() => window.__csp);
  if (after !== before) problems.push(`[${person.alias}] creato un garage nuovo (${before} → ${after})`);
  if (u?.garageId !== wantGarage) problems.push(`[${person.alias}] users.garageId=${u?.garageId} invece di ${wantGarage}`);
  if (csp.length) problems.push(`[${person.alias}] CSP: ${csp.join(', ')}`);
  const own = await db.doc(`garages/${person.uid}`).get();
  if (person.role === 'migrato' && own.exists !== (`garages/${person.uid}` in D)) problems.push(`[${person.alias}] garage proprio alterato`);
  console.log(`${person.alias.padEnd(13)} uid ${short(person.uid)}  ${wantRole.padEnd(12)} «${title.replace('✎', '').trim()}»  veicoli ${wantVehicles}  `
    + `users/{uid}: ${usersBefore ? 'esisteva' : 'creato'} → ${short(u?.garageId || '—')}  garage totali ${before}→${after}`);
  await ctx.close();
}
await browser.close();
if (problems.length) { console.log('\n✖ PROBLEMI:\n' + problems.map((x) => '  - ' + x).join('\n')); process.exit(1); }
console.log('\n✔ Primo avvio v2.2: ognuno trova il proprio garage (o quello di famiglia), nessun garage nuovo, nessuna violazione CSP');
