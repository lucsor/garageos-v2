#!/usr/bin/env node
// SOLA LETTURA: gli amici hanno già usato la v2? Prerequisito per la pulizia dei members[] legacy (S4).
//   node check-v2-logins.mjs [--since 2026-11-07T12:09:00Z] [--who lucoli76,geom.milite,matulamichele]
// Come si capisce "ha usato la v2": v1 e v2 condividono il progetto Firebase, ma dal --since (redirect v1 → v2
// online) la v1 non carica più Firebase. Quindi un accesso (lastSignInTime) o un rinnovo del token
// (lastRefreshTime, avviene aprendo l'app) DOPO quella data viene dalla v2.
// Limite: una scheda v1 rimasta aperta prima del redirect può aver rinnovato il token per qualche ora;
// per questo il risultato è "certo" solo se l'attività è di almeno 24 h dopo --since.
// Mostra anche, per il garage di ognuno, quanti elementi ha ancora il campo legacy members[].
import { createRequire } from 'node:module';
import { initializeApp, refreshToken, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { PROJECT_ID, whoami, adminDb } from './creds.mjs';

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const since = new Date(opt('--since', '2026-11-07T12:09:00Z'));
const certain = new Date(since.getTime() + 24 * 3600e3);
const who = opt('--who', 'lucoli76,geom.milite,matulamichele').split(',').map((s) => s.trim().toLowerCase());
if (process.env.FIRESTORE_EMULATOR_HOST) { console.error('FIRESTORE_EMULATOR_HOST impostato: questo controllo ha senso solo in produzione.'); process.exit(2); }

let credential;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) credential = applicationDefault();
else {
  const { configstore } = require('firebase-tools/lib/configstore');
  const api = require('firebase-tools/lib/api');
  credential = refreshToken({ type: 'authorized_user', client_id: api.clientId(), client_secret: api.clientSecret(),
    refresh_token: configstore.get('tokens').refresh_token });
}
const auth = getAuth(initializeApp({ credential, projectId: PROJECT_ID }));
const db = adminDb();
const users = [];
let pageToken;
do { const p = await auth.listUsers(1000, pageToken); users.push(...p.users); pageToken = p.pageToken; } while (pageToken);

const fmt = (s) => (s ? new Date(s).toISOString().slice(0, 16).replace('T', ' ') + 'Z' : '—');
console.log(`Controllo accessi v2 — ${PROJECT_ID} come ${whoami()} — SOLA LETTURA`);
console.log(`v2 da: ${fmt(since)} · risultato certo se attività dopo: ${fmt(certain)}\n`);
let allOk = true;
for (const w of who) {
  const u = users.find((x) => (x.email || '').toLowerCase().split('@')[0] === w);
  if (!u) { console.log(`✖ ${w}: account non trovato`); allOk = false; continue; }
  const last = [u.metadata.lastSignInTime, u.metadata.lastRefreshTime].filter(Boolean).map((s) => new Date(s)).sort((a, b) => b - a)[0];
  const state = !last || last < since ? '✖ non ancora' : last < certain ? '≈ probabile (entro 24 h dal redirect)' : '✔ sì';
  if (!state.startsWith('✔')) allOk = false;
  const g = await db.doc(`garages/${u.uid}`).get();
  const legacy = g.exists ? (g.data().members || []).length : null;
  console.log(`${state.padEnd(38)} ${w.padEnd(16)} ultimo accesso ${fmt(u.metadata.lastSignInTime)} · ultimo rinnovo token ${fmt(u.metadata.lastRefreshTime)} · members[] legacy: ${legacy ?? 'garage assente'}`);
}
console.log(allOk ? '\n✔ Tutti hanno usato la v2: la pulizia dei members[] si può pianificare.' : '\n✖ Non ancora: rimandare la pulizia dei members[].');
process.exit(allOk ? 0 : 1);
