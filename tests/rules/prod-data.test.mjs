// Test delle NUOVE regole sui DATI REALI: backup di produzione importato nell'emulatore + migrazione mirata.
// I dati e il piano stanno FUORI dal repo (GARAGEOS_BACKUP_DIR, default ~/Documents/garageos-backup):
//   firestore-YYYYMMDD.json, auth-users-YYYYMMDD.json, migration-plan.json {garage, uids[]}
// Se mancano, la suite viene saltata. Uso: npm run test:prod-data
// Nessuna email/uid reale è scritta nel codice: i ruoli sono ricavati dai dati.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, arrayRemove, writeBatch, serverTimestamp, Timestamp,
} from 'firebase/firestore';

const PROJECT = 'demo-garageos-prod';
process.env.GCLOUD_PROJECT = PROJECT;                       // per gli script admin (emulatore)
const DIR = process.env.GARAGEOS_BACKUP_DIR || join(homedir(), 'Documents', 'garageos-backup');
const planFile = join(DIR, 'migration-plan.json');
const haveData = existsSync(planFile);
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');

describe('Dati reali + migrazione con le nuove regole', { skip: !haveData && `manca ${planFile}` }, () => {
  let env, adminDb, backup, plan, authUsers, migrate, encode, latestBackup;
  const short = (u) => u.slice(0, 6) + '…';
  const emailOf = (uid) => authUsers.find((u) => u.uid === uid)?.email;
  const ctx = (uid) => env.authenticatedContext(uid, { email: emailOf(uid) || `${uid}@example.com`, email_verified: true }).firestore();
  const D = () => backup.documents;
  const sub = (gid, c) => Object.keys(D()).filter((p) => p.startsWith(`garages/${gid}/${c}/`)).length;
  const garages = () => Object.keys(D()).filter((p) => /^garages\/[^/]+$/.test(p)).map((p) => p.split('/')[1]);
  const friends = () => garages().filter((g) => g !== plan.garage && sub(g, 'vehicles') > 0);   // garage propri con dati

  async function snapshotAll() {           // stato completo dell'emulatore (codificato) via admin
    const out = {};
    async function walk(cols) { for (const c of cols) for (const r of await c.listDocuments()) {
      const s = await r.get(); if (s.exists) out[r.path] = encode(s.data()); await walk(await r.listCollections()); } }
    await walk(await adminDb.listCollections());
    return out;
  }
  const lookupUser = async (uid) => { const u = authUsers.find((x) => x.uid === uid); return u && { email: u.email, displayName: u.displayName }; };

  before(async () => {
    const lib = await import('../../tools/admin/restore-lib.mjs');
    const creds = await import('../../tools/admin/creds.mjs');
    migrate = await import('../../tools/admin/migrate-lib.mjs');
    ({ encode, latestBackup } = lib);
    backup = lib.loadBackup(latestBackup('firestore-', DIR));
    authUsers = JSON.parse(readFileSync(latestBackup('auth-users-', DIR), 'utf8')).users;
    plan = JSON.parse(readFileSync(planFile, 'utf8'));
    adminDb = creds.adminDb();
    env = await initializeTestEnvironment({
      projectId: PROJECT,
      firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host, port: Number(port) },
    });
    globalThis.__decode = (v) => lib.decode(v, adminDb);
  });
  after(async () => { await env?.cleanup(); });

  async function loadBackupIntoEmulator() {
    await env.clearFirestore();
    const paths = Object.keys(D());
    for (let i = 0; i < paths.length; i += 400) {
      const b = adminDb.batch();
      paths.slice(i, i + 400).forEach((p) => b.set(adminDb.doc(p), globalThis.__decode(D()[p])));
      await b.commit();
    }
  }
  async function runMigration() {
    const p = await migrate.planMigration(adminDb, plan.garage, plan.uids, lookupUser);
    assert.ok(p.ok, p.errors?.join('; '));
    await migrate.applyMigration(adminDb, plan.garage, p);
  }

  beforeEach(async () => { await loadBackupIntoEmulator(); await runMigration(); });

  // ── migrazione
  test('PD01 import completo del backup + migrazione: tocca SOLO memberUids e crea i users dei migrati', async () => {
    const now = await snapshotAll();
    const touched = new Set([`garages/${plan.garage}`, ...plan.uids.map((u) => `users/${u}`)]);
    for (const p of Object.keys(D())) if (!touched.has(p)) assert.deepEqual(now[p], D()[p], `documento cambiato: ${p}`);
    const g = now[`garages/${plan.garage}`], gb = D()[`garages/${plan.garage}`];
    const { memberUids, ...rest } = g; const { memberUids: mb, ...restB } = gb;
    assert.deepEqual(rest, restB, 'campi del garage diversi da memberUids modificati');
    assert.deepEqual([...memberUids].sort(), [...new Set([...(mb || []), ...plan.uids])].sort());
    for (const u of plan.uids) assert.equal(now[`users/${u}`].garageId, plan.garage);
    const extra = Object.keys(now).filter((p) => !(p in D()) && !touched.has(p));
    assert.deepEqual(extra, [], 'documenti inattesi creati');
  });
  test('PD02 migrazione idempotente: un secondo piano non ha modifiche', async () => {
    const p = await migrate.planMigration(adminDb, plan.garage, plan.uids, lookupUser);
    assert.equal(p.garage.changed, false);
    assert.ok(p.users.every((u) => !u.changed));
  });
  test('PD03 il garage proprio (vuoto o no) di ogni migrato resta intatto e leggibile da lui', async () => {
    for (const u of plan.uids) {
      if (!(`garages/${u}` in D())) continue;
      const s = await assertSucceeds(getDoc(doc(ctx(u), 'garages', u)));
      assert.deepEqual(encode(s.data()), D()[`garages/${u}`]);
    }
  });

  // ── amici con garage proprio (proprietari)
  test('PF01 ogni amico legge il proprio garage e tutte le sottocollezioni (conteggi = backup)', async () => {
    assert.ok(friends().length >= 1);
    for (const g of friends()) {
      const db = ctx(g);
      await assertSucceeds(getDoc(doc(db, 'garages', g)));
      for (const c of ['vehicles', 'mechs', 'tires']) {
        const s = await assertSucceeds(getDocs(collection(db, 'garages', g, c)));
        assert.equal(s.size, sub(g, c), `${short(g)} ${c}`);
      }
    }
  });
  test('PF02 primo avvio v2.2 di ogni amico: trova il SUO garage, non ne crea uno nuovo, scrive solo users/{uid}', async () => {
    const beforeAll = await snapshotAll();
    for (const g of friends()) {
      const db = ctx(g);
      // stessa sequenza di resolveGarage() in index.html
      const us = await assertSucceeds(getDoc(doc(db, 'users', g)));
      assert.equal(us.exists(), false, 'gli amici non hanno ancora users/{uid}');
      const gs = await assertSucceeds(getDoc(doc(db, 'garages', g)));
      assert.equal(gs.exists(), true, 'il garage esistente viene trovato → nessuna creazione');
      await assertSucceeds(setDoc(doc(db, 'users', g), { garageId: g, email: emailOf(g), name: 'x', updatedAt: serverTimestamp() }, { merge: true }));
    }
    const afterAll = await snapshotAll();
    const added = Object.keys(afterAll).filter((p) => !(p in beforeAll));
    assert.deepEqual(added.sort(), friends().map((g) => `users/${g}`).sort(), 'solo i users/{uid} degli amici');
    assert.equal(Object.keys(afterAll).filter((p) => /^garages\/[^/]+$/.test(p)).length, garages().length, 'nessun garage nuovo');
  });
  test('PF03 ogni amico modifica i propri dati come prima (km, rinnovo {...v}, interventi, gomme, rinomina)', async () => {
    for (const g of friends()) {
      const db = ctx(g);
      const vpath = Object.keys(D()).find((p) => p.startsWith(`garages/${g}/vehicles/`));
      const vid = vpath.split('/').pop();
      const v = globalThis.__decode(D()[vpath]);
      await assertSucceeds(updateDoc(doc(db, 'garages', g, 'vehicles', vid), { km: '123456', updatedAt: new Date().toISOString() }));
      await assertSucceeds(setDoc(doc(db, 'garages', g, 'vehicles', vid), { ...v, bollo: '2027-12-31', updatedAt: new Date().toISOString() }));
      const mref = doc(collection(db, 'garages', g, 'mechs'));
      await assertSucceeds(setDoc(mref, { vehicleId: vid, type: 'tagliando', date: '2026-11-07', km: '123456', cost: '150', garage: '', note: '', createdAt: 'x', updatedAt: 'x', addedBy: 'test' }));
      await assertSucceeds(updateDoc(mref, { cost: '160' }));
      await assertSucceeds(deleteDoc(mref));
      const tref = doc(collection(db, 'garages', g, 'tires'));
      await assertSucceeds(setDoc(tref, { vehicleId: vid, season: 'invernale', date: '2026-11-07', km: '', kmNext: '', brand: '', size: '', note: '' }));
      await assertSucceeds(setDoc(doc(db, 'garages', g), { garageName: 'Garage test' }, { merge: true }));
    }
  });
  test('PF04 ogni amico NON legge i garage degli altri (né quello di Luca)', async () => {
    for (const g of friends()) for (const other of garages().filter((x) => x !== g)) {
      await assertFails(getDoc(doc(ctx(g), 'garages', other)));
      await assertFails(getDocs(collection(ctx(g), 'garages', other, 'vehicles')));
    }
  });
  test('PF05 inviti v1 pending nei garage degli amici: intatti (li reinviteranno loro)', async () => {
    const now = await snapshotAll();
    for (const g of friends()) assert.deepEqual(now[`garages/${g}`].members, D()[`garages/${g}`].members);
  });
  test('PF06 un amico può creare un invito v2.2 dal proprio garage', async () => {
    const g = friends().find((x) => (D()[`garages/${x}`].members || []).length) || friends()[0];
    const token = 'e'.repeat(64);
    await assertSucceeds(setDoc(doc(ctx(g), 'invites', token), {
      garageId: g, email: 'nuovo.invitato@example.com', createdBy: g, createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 6 * 86400000), usedAt: null, usedBy: null,
    }));
  });

  // ── membri migrati
  test('PM01 i migrati leggono il garage di famiglia e tutti i dati (conteggi = backup)', async () => {
    for (const u of plan.uids) {
      const db = ctx(u);
      const us = await assertSucceeds(getDoc(doc(db, 'users', u)));
      assert.equal(us.data().garageId, plan.garage);
      await assertSucceeds(getDoc(doc(db, 'garages', plan.garage)));
      for (const c of ['vehicles', 'mechs', 'tires']) {
        const s = await assertSucceeds(getDocs(collection(db, 'garages', plan.garage, c)));
        assert.equal(s.size, sub(plan.garage, c));
      }
    }
  });
  test('PM02 i migrati modificano i dati di famiglia (veicolo, intervento)', async () => {
    for (const u of plan.uids) {
      const db = ctx(u);
      const vpath = Object.keys(D()).find((p) => p.startsWith(`garages/${plan.garage}/vehicles/`));
      await assertSucceeds(updateDoc(doc(db, ...vpath.split('/')), { km: '99999' }));
      const mref = doc(collection(db, 'garages', plan.garage, 'mechs'));
      await assertSucceeds(setDoc(mref, { vehicleId: vpath.split('/').pop(), type: 'altro', date: '2026-11-07', cost: '10' }));
      await assertSucceeds(deleteDoc(mref));
    }
  });
  test('PM03 i migrati NON rinominano, non tolgono altri, non cambiano proprietario', async () => {
    const [a, b] = plan.uids;
    const db = ctx(a);
    await assertFails(updateDoc(doc(db, 'garages', plan.garage), { garageName: 'x' }));
    if (b) await assertFails(updateDoc(doc(db, 'garages', plan.garage), { memberUids: arrayRemove(b) }));
    await assertFails(updateDoc(doc(db, 'garages', plan.garage), { ownerUid: a }));
    await assertFails(updateDoc(doc(db, 'garages', plan.garage), { members: [] }));
  });
  test('PM04 un migrato può uscire da solo (e tornare al proprio garage)', async () => {
    const u = plan.uids[0];
    const db = ctx(u);
    const b = writeBatch(db);
    b.update(doc(db, 'garages', plan.garage), { memberUids: arrayRemove(u) });
    b.set(doc(db, 'users', u), { garageId: u }, { merge: true });
    await assertSucceeds(b.commit());
  });

  // ── proprietario (Luca)
  test('PL01 il proprietario rimuove un migrato in modo coerente e invita un nuovo membro', async () => {
    const db = ctx(plan.garage);
    await assertSucceeds(updateDoc(doc(db, 'garages', plan.garage), { memberUids: arrayRemove(plan.uids[0]) }));
    await assertSucceeds(setDoc(doc(db, 'invites', 'f'.repeat(64)), {
      garageId: plan.garage, email: 'nuovo.familiare@example.com', createdBy: plan.garage, createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 6 * 86400000), usedAt: null, usedBy: null,
    }));
  });
  test('PL02 il proprietario modifica tutti i propri veicoli legacy (riscrittura completa)', async () => {
    const db = ctx(plan.garage);
    for (const p of Object.keys(D()).filter((x) => x.startsWith(`garages/${plan.garage}/vehicles/`))) {
      await assertSucceeds(setDoc(doc(db, ...p.split('/')), { ...globalThis.__decode(D()[p]), updatedAt: new Date().toISOString() }));
    }
  });

  // ── estranei e documenti fuori modello
  test('PX01 un estraneo non legge nessun garage né utente', async () => {
    for (const g of garages()) await assertFails(getDoc(doc(ctx('estraneo'), 'garages', g)));
    for (const u of plan.uids) await assertFails(getDoc(doc(ctx('estraneo'), 'users', u)));
  });
  test('PX02 i documenti alla radice fuori dal modello restano dove sono e non sono accessibili', async () => {
    const roots = Object.keys(D()).filter((p) => !p.startsWith('garages/') && !p.startsWith('users/'));
    const now = await snapshotAll();
    for (const p of roots) {
      assert.deepEqual(now[p], D()[p]);
      await assertFails(getDoc(doc(ctx(plan.garage), ...p.split('/'))));
    }
  });
});
