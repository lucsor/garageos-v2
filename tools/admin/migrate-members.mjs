#!/usr/bin/env node
// MIGRAZIONE MIRATA v1 → v2 dei membri di un garage (Admin SDK: gira FUORI dalle regole, una tantum).
//   node migrate-members.mjs --garage <gid> --uid <uid> [--uid <uid> ...]            → DRY RUN (default): mostra il diff
//   node migrate-members.mjs --garage <gid> --uid <uid> [--uid <uid> ...] --apply    → scrive (in una transazione)
// Opzioni: --force (salta i controlli di sicurezza), --show-full-ids
// Con FIRESTORE_EMULATOR_HOST impostato scrive sull'emulatore (e legge gli utenti da FIREBASE_AUTH_EMULATOR_HOST).
import { createRequire } from 'node:module';
import { initializeApp, refreshToken, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { adminDb, PROJECT_ID, whoami } from './creds.mjs';
import { planMigration, applyMigration, printPlan } from './migrate-lib.mjs';

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const many = (flag) => argv.flatMap((a, i) => (a === flag ? [argv[i + 1]] : []));
const gid = many('--garage')[0];
const uids = many('--uid');
const APPLY = argv.includes('--apply');
const FORCE = argv.includes('--force');
const label = argv.includes('--show-full-ids') ? (u) => u : (u) => (u ? u.slice(0, 6) + '…' : u);
if (!gid || !uids.length) { console.error('Uso: --garage <gid> --uid <uid> [...] [--apply]'); process.exit(2); }

const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
let credential;
if (!emulator) {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) credential = applicationDefault();
  else {
    const { configstore } = require('firebase-tools/lib/configstore');
    const api = require('firebase-tools/lib/api');
    credential = refreshToken({ type: 'authorized_user', client_id: api.clientId(), client_secret: api.clientSecret(), refresh_token: configstore.get('tokens').refresh_token });
  }
}
const auth = getAuth(initializeApp({ projectId: PROJECT_ID, ...(credential ? { credential } : {}) }));
const lookupUser = async (uid) => { try { const u = await auth.getUser(uid); return { email: u.email, displayName: u.displayName }; } catch { return null; } };

const db = adminDb();
console.log(`Migrazione membri — progetto ${PROJECT_ID} come ${whoami()} — ${APPLY ? 'APPLY (scrittura)' : 'DRY RUN (nessuna scrittura)'}`);
const plan = await planMigration(db, gid, uids, lookupUser, { force: FORCE });
console.log(printPlan(plan, label));
if (!plan.ok) process.exit(1);
const nothing = !plan.garage.changed && plan.users.every((u) => !u.changed);
if (nothing) { console.log('\n✔ Già migrato: nessuna modifica necessaria (idempotente).'); process.exit(0); }
if (!APPLY) { console.log('\nDRY RUN: nessuna scrittura. Rilancia con --apply per applicare.'); process.exit(0); }
const res = await applyMigration(db, gid, plan);
console.log(`\n✔ Applicato: garage aggiornato=${res.garageUpdated ? 'sì' : 'no'}, users creati=${res.usersCreated}, users aggiornati=${res.usersUpdated}`);
const again = await planMigration(db, gid, uids, lookupUser, { force: FORCE });
console.log(again.garage.changed || again.users.some((u) => u.changed) ? '✖ Verifica: restano differenze!' : '✔ Verifica post-scrittura: stato atteso raggiunto');
