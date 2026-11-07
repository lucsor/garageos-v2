// Test delle regole Firestore di GarageOS — Firebase Emulator + @firebase/rules-unit-testing
// Suite dell'AUDIT (flusso di join v2.1). Uso: RULES=<file regole> npm run test:audit
// Serve a misurare le regole PUBBLICATE o le baseline A/B; per firestore.rules usare rules.test.mjs.
// I casi descrivono i REQUISITI di sicurezza: un test rosso = falla nella regola testata.
import { test, describe, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, arrayUnion,
} from 'firebase/firestore';

const RULES = process.env.RULES || 'baseline/A-permissive.rules';
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');

// Attori
const OWNER = 'alice';            // garageId = uid del proprietario (modello v2)
const MEMBER = 'bob';             // membro attivo
const INVITEE = 'carol';          // invitata, status pending
const STRANGER = 'mallory';       // utente Google qualunque, nessun invito
const GID = OWNER;

let env;
const ctx = (uid) => env.authenticatedContext(uid, { email: `${uid}@example.com` }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const gref = (db) => doc(db, 'garages', GID);

const member = (uid, status = 'active') => ({
  email: `${uid}@example.com`, uid: status === 'active' ? uid : '', name: uid, photo: '',
  status, invitedAt: '2026-01-01T00:00:00.000Z',
});

async function seed() {
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'garages', GID), {
      ownerUid: OWNER, ownerName: 'Alice', ownerEmail: 'alice@example.com', ownerPhoto: '',
      members: [member(MEMBER), member(INVITEE, 'pending')],
      memberUids: [MEMBER], createdAt: '2026-01-01T00:00:00.000Z', garageName: 'Casa',
    });
    await setDoc(doc(db, 'garages', GID, 'vehicles', 'v1'), {
      plate: 'AB123CD', model: 'Panda', km: '50000', bollo: '2026-12-31', addedBy: 'alice@example.com',
    });
    await setDoc(doc(db, 'users', OWNER), { garageId: OWNER, email: 'alice@example.com' });
    await setDoc(doc(db, 'users', MEMBER), { garageId: GID, email: 'bob@example.com' });
  });
}

// Flusso di join ESATTAMENTE come in index.html:1165-1188 (checkJoinLink)
async function v2Join(uid) {
  const db = ctx(uid);
  const snap = await getDoc(gref(db));
  const members = snap.data().members || [];
  const email = `${uid}@example.com`;
  const idx = members.findIndex((m) => m.email === email);
  const me = { email, uid, name: uid, photo: '', status: 'active', invitedAt: '2026-01-01T00:00:00.000Z' };
  if (idx >= 0) members[idx] = me; else members.push(me);
  await setDoc(gref(db), { members, memberUids: arrayUnion(uid) }, { merge: true });
}

describe(`Regole: ${RULES}`, () => {
  before(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-garageos',
      firestore: { rules: readFileSync(new URL(RULES, import.meta.url), 'utf8'), host, port: Number(port) },
    });
  });
  after(async () => { await env?.cleanup(); });
  beforeEach(async () => { await env.clearFirestore(); await seed(); });

  describe('POSITIVI (devono passare)', () => {
    test('P01 proprietario legge il proprio garage', () => assertSucceeds(getDoc(gref(ctx(OWNER)))));
    test('P02 nuovo utente crea il proprio garage (id = uid)', () =>
      assertSucceeds(setDoc(doc(ctx('dave'), 'garages', 'dave'), {
        ownerUid: 'dave', ownerName: 'Dave', ownerEmail: 'dave@example.com', ownerPhoto: '',
        members: [], memberUids: [], createdAt: '2026-01-01T00:00:00.000Z',
      })));
    test('P03 proprietario rinomina il garage', () =>
      assertSucceeds(setDoc(gref(ctx(OWNER)), { garageName: 'Garage Rossi' }, { merge: true })));
    test('P04 proprietario invita (aggiunge pending a members)', () =>
      assertSucceeds(setDoc(gref(ctx(OWNER)), {
        members: [member(MEMBER), member(INVITEE, 'pending'), member('erin', 'pending')],
      }, { merge: true })));
    test('P05 proprietario rimuove un membro', () =>
      assertSucceeds(setDoc(gref(ctx(OWNER)), { members: [member(INVITEE, 'pending')], memberUids: [] }, { merge: true })));
    test('P06 membro legge il garage', () => assertSucceeds(getDoc(gref(ctx(MEMBER)))));
    test('P07 membro legge i veicoli', () => assertSucceeds(getDocs(collection(ctx(MEMBER), 'garages', GID, 'vehicles'))));
    test('P08 membro aggiunge un veicolo valido', () =>
      assertSucceeds(setDoc(doc(ctx(MEMBER), 'garages', GID, 'vehicles', 'mk1abc'), { plate: 'ZZ999ZZ', model: 'Golf' })));
    test('P09 proprietario modifica un veicolo', () =>
      assertSucceeds(setDoc(doc(ctx(OWNER), 'garages', GID, 'vehicles', 'v1'), { plate: 'AB123CD', model: 'Panda 4x4' })));
    test('P10 utente legge/scrive il proprio users/{uid}', async () => {
      await assertSucceeds(getDoc(doc(ctx(MEMBER), 'users', MEMBER)));
      await assertSucceeds(setDoc(doc(ctx(MEMBER), 'users', MEMBER), { updatedAt: 'x' }, { merge: true }));
    });
    test('P11 invitata (pending) accetta l’invito con il flusso v2', () => assertSucceeds(v2Join(INVITEE)));
    test('P12 membro esce dal garage togliendo SOLO sé stesso (oggi manca la UI "Esci")', () =>
      assertSucceeds(updateDoc(gref(ctx(MEMBER)), { memberUids: [] })));
  });

  describe('ATTACCHI (devono fallire)', () => {
    test('A01 non autenticato legge un garage', () => assertFails(getDoc(gref(anon()))));
    test('A02 estraneo loggato legge un garage altrui (email/nomi/foto dei membri)', () =>
      assertFails(getDoc(gref(ctx(STRANGER)))));
    test('A03 estraneo elenca TUTTI i garage (query della v1)', () =>
      assertFails(getDocs(collection(ctx(STRANGER), 'garages'))));
    test('A04 estraneo legge i veicoli', () =>
      assertFails(getDocs(collection(ctx(STRANGER), 'garages', GID, 'vehicles'))));
    test('A05 estraneo scrive un veicolo', () =>
      assertFails(setDoc(doc(ctx(STRANGER), 'garages', GID, 'vehicles', 'x'), { plate: 'X', model: 'X' })));
    test('A06 estraneo SENZA invito entra nel garage con il link ?join=<uid>&email=<sua>', () =>
      assertFails(v2Join(STRANGER)));
    test('A07 estraneo si aggiunge solo a memberUids (SDK diretto)', () =>
      assertFails(updateDoc(gref(ctx(STRANGER)), { memberUids: arrayUnion(STRANGER) })));
    test('A08 membro aggiunge un terzo uid a memberUids', () =>
      assertFails(updateDoc(gref(ctx(MEMBER)), { memberUids: [MEMBER, STRANGER] })));
    test('A09 membro rimuove un altro membro / svuota memberUids', async () => {
      await env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), 'garages', GID), { memberUids: [MEMBER, 'zoe'] }));
      await assertFails(updateDoc(gref(ctx(MEMBER)), { memberUids: [MEMBER] }));
    });
    test('A11 membro si appropria del garage cambiando ownerUid', () =>
      assertFails(updateDoc(gref(ctx(MEMBER)), { ownerUid: MEMBER })));
    test('A12 membro rinomina il garage (in UI è solo del proprietario)', () =>
      assertFails(updateDoc(gref(ctx(MEMBER)), { garageName: 'pwned' })));
    test('A13 membro riscrive members[] (cancella voci / inietta membri finti)', () =>
      assertFails(updateDoc(gref(ctx(MEMBER)), { members: [member('fake')] })));
    test('A14 estraneo inietta in members[] una email con payload XSS', () =>
      assertFails(setDoc(gref(ctx(STRANGER)), {
        members: [member(MEMBER), member(INVITEE, 'pending'),
          { email: "x');alert(document.domain);//", uid: '', name: 'x', photo: '', status: 'active' }],
      }, { merge: true })));
    test('A15 membro cancella il documento garage', () => assertFails(deleteDoc(gref(ctx(MEMBER)))));
    test('A16 estraneo crea un garage con id altrui', () =>
      assertFails(setDoc(doc(ctx(STRANGER), 'garages', 'victim'), { ownerUid: STRANGER, members: [], memberUids: [] })));
    test('A17 estraneo legge users/{uid} di un altro', () => assertFails(getDoc(doc(ctx(STRANGER), 'users', OWNER))));
    test('A18 invito riusabile: carol rimossa rientra con lo stesso link', async () => {
      await v2Join(INVITEE).catch(() => {});
      await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'garages', GID),
        { members: [member(MEMBER)], memberUids: [MEMBER] }, { merge: true }));
      await assertFails(v2Join(INVITEE));
    });
  });

  describe('VALIDAZIONE (devono fallire)', () => {
    test('V01 veicolo con note da 900 KB', () =>
      assertFails(setDoc(doc(ctx(MEMBER), 'garages', GID, 'vehicles', 'big'), { plate: 'A', model: 'B', note: 'x'.repeat(900_000) })));
    test('V02 veicolo con km di tipo errato (mappa)', () =>
      assertFails(setDoc(doc(ctx(MEMBER), 'garages', GID, 'vehicles', 'typ'), { plate: 'A', model: 'B', km: { evil: true } })));
    test('V03 veicolo senza targa', () =>
      assertFails(setDoc(doc(ctx(MEMBER), 'garages', GID, 'vehicles', 'nop'), { model: 'B' })));
    test("V04 docId con apice (XSS in onclick=\"openEditVehicle('${v.id}')\")", () =>
      assertFails(setDoc(doc(ctx(MEMBER), 'garages', GID, 'vehicles', "x');alert(document.domain);('"), { plate: 'A', model: 'B' })));
    test('V05 sottocollezione arbitraria (es. garages/{gid}/spam)', () =>
      assertFails(setDoc(doc(ctx(MEMBER), 'garages', GID, 'spam', 'a'), { x: 1 })));
  });
});
