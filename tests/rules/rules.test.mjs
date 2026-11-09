// Test di firestore.rules (hotfix sicurezza v2.2) — Firebase Emulator + @firebase/rules-unit-testing
// Uso: npm test   (RULES=<percorso> per testare un altro file)
// Gli ID P/A/V corrispondono ai 34 casi dell'audit (docs/AUDIT.md §3); P11, A06, A18 usano il NUOVO
// flusso di invito (invites/{token}). I*/M* sono i casi aggiunti per inviti e membri.
import { test, describe, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, collectionGroup, query, where,
  arrayUnion, arrayRemove, deleteField, serverTimestamp, writeBatch, Timestamp,
} from 'firebase/firestore';

const RULES = process.env.RULES || '../../firestore.rules';
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');

const OWNER = 'alice', MEMBER = 'bob', INVITEE = 'carol', STRANGER = 'mallory', OTHER_OWNER = 'zed';
const GID = OWNER;
const DAY = 86_400_000;
const tok = (c) => c.repeat(64);
const T_CAROL = tok('a'), T_EXPIRED = tok('b'), T_USED = tok('c'), T_ZED = tok('d');

let env;
const email = (uid) => `${uid}@example.com`;
const ctx = (uid) => env.authenticatedContext(uid, { email: email(uid), email_verified: true }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const gref = (db, gid = GID) => doc(db, 'garages', gid);
const iref = (db, t) => doc(db, 'invites', t);
const info = (uid) => ({ email: email(uid), name: uid, photo: '', joinedAt: Timestamp.fromMillis(Date.now() - DAY), inviteId: tok('9') });
const legacy = (uid, status = 'active') => ({ email: email(uid), uid: status === 'active' ? uid : '', name: uid, photo: '', status, invitedAt: '2026-01-01T00:00:00.000Z' });
const invite = (gid, who, extra = {}) => ({
  garageId: gid, email: email(who), createdBy: gid, createdAt: Timestamp.now(),
  expiresAt: Timestamp.fromMillis(Date.now() + 3 * DAY), usedAt: null, usedBy: null,
  garageName: 'Casa', invitedByName: gid, ...extra,
});

async function seed() {
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(gref(db), {
      ownerUid: OWNER, ownerName: 'Alice', ownerEmail: email(OWNER), ownerPhoto: '',
      members: [legacy(MEMBER), legacy(INVITEE, 'pending')],
      memberUids: [MEMBER], memberInfo: { [MEMBER]: info(MEMBER) },
      createdAt: '2026-01-01T00:00:00.000Z', garageName: 'Casa',
    });
    await setDoc(gref(db, OTHER_OWNER), { ownerUid: OTHER_OWNER, members: [], memberUids: [], memberInfo: {} });
    // veicolo legacy: id uid() della v2.1 e numeri salvati come stringa
    await setDoc(doc(db, 'garages', GID, 'vehicles', 'mk1abc2def'), {
      plate: 'AB123CD', model: 'Panda', km: '50000', bollo: '2026-12-31', addedBy: email(OWNER),
    });
    await setDoc(doc(db, 'users', OWNER), { garageId: OWNER, email: email(OWNER) });
    await setDoc(doc(db, 'users', MEMBER), { garageId: GID, email: email(MEMBER) });
    await setDoc(iref(db, T_CAROL), invite(GID, INVITEE));
    await setDoc(iref(db, T_EXPIRED), invite(GID, INVITEE, { expiresAt: Timestamp.fromMillis(Date.now() - DAY) }));
    await setDoc(iref(db, T_USED), invite(GID, INVITEE, { usedAt: Timestamp.now(), usedBy: INVITEE }));
    await setDoc(iref(db, T_ZED), invite(OTHER_OWNER, INVITEE, { createdBy: OTHER_OWNER }));
  });
}

// Accettazione invito come in index.html (acceptInvite): UN batch con invito + garage + users
async function accept(uid, token, { gid = GID, consume = true, join = true, users = true, addUids = [], infoOverride = {} } = {}) {
  const db = ctx(uid);
  const b = writeBatch(db);
  if (consume) b.update(iref(db, token), { usedAt: serverTimestamp(), usedBy: uid });
  if (join) b.update(gref(db, gid), {
    memberUids: arrayUnion(uid, ...addUids),
    [`memberInfo.${uid}`]: { email: email(uid), name: uid, photo: '', joinedAt: serverTimestamp(), inviteId: token, ...infoOverride },
  });
  if (users) b.set(doc(db, 'users', uid), { garageId: gid, email: email(uid), name: uid, updatedAt: serverTimestamp() }, { merge: true });
  return b.commit();
}
const newInvite = (uid, extra = {}, id = randomBytes(32).toString('hex')) => {
  const db = ctx(uid);
  return setDoc(iref(db, id), {
    garageId: uid, email: email(INVITEE), createdBy: uid, createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 7 * DAY - 10 * 60_000), usedAt: null, usedBy: null,
    garageName: 'Casa', invitedByName: 'Alice', ...extra,
  });
};

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
      assertSucceeds(setDoc(gref(ctx('dave'), 'dave'), {
        ownerUid: 'dave', ownerName: 'Dave', ownerEmail: email('dave'), ownerPhoto: '',
        members: [], memberUids: [], memberInfo: {}, createdAt: serverTimestamp(),
      })));
    test('P03 proprietario rinomina il garage', () =>
      assertSucceeds(setDoc(gref(ctx(OWNER)), { garageName: 'Garage Rossi' }, { merge: true })));
    test('P04 proprietario crea un invito (token 256 bit, scadenza 7 giorni)', () => assertSucceeds(newInvite(OWNER)));
    test('P05 proprietario rimuove un membro in modo coerente', () =>
      assertSucceeds(updateDoc(gref(ctx(OWNER)), {
        memberUids: arrayRemove(MEMBER), [`memberInfo.${MEMBER}`]: deleteField(), members: [legacy(INVITEE, 'pending')],
      })));
    test('P06 membro legge il garage', () => assertSucceeds(getDoc(gref(ctx(MEMBER)))));
    test('P07 membro legge i veicoli', () => assertSucceeds(getDocs(collection(ctx(MEMBER), 'garages', GID, 'vehicles'))));
    test('P08 membro aggiunge un veicolo con ID generato da Firestore', () => {
      const db = ctx(MEMBER);
      const ref = doc(collection(db, 'garages', GID, 'vehicles'));
      return assertSucceeds(setDoc(ref, { plate: 'ZZ999ZZ', model: 'Golf', km: 12000, bolloCost: 180 }));
    });
    test('P09 proprietario modifica un veicolo legacy (id uid(), km stringa)', () =>
      assertSucceeds(setDoc(doc(ctx(OWNER), 'garages', GID, 'vehicles', 'mk1abc2def'),
        { plate: 'AB123CD', model: 'Panda 4x4', km: '51000', bollo: '2027-12-31', updatedAt: '2026-11-07T10:00:00.000Z' })));
    test('P10 utente legge/scrive il proprio users/{uid}', async () => {
      await assertSucceeds(getDoc(doc(ctx(MEMBER), 'users', MEMBER)));
      await assertSucceeds(setDoc(doc(ctx(MEMBER), 'users', MEMBER), { updatedAt: serverTimestamp() }, { merge: true }));
    });
    test('P11 invitata accetta l’invito (invito + garage + users in un batch)', async () => {
      await assertSucceeds(accept(INVITEE, T_CAROL));
      await assertSucceeds(getDocs(collection(ctx(INVITEE), 'garages', GID, 'vehicles')));
    });
    test('P12 membro esce dal garage togliendo solo sé stesso', () => {
      const db = ctx(MEMBER);
      const b = writeBatch(db);
      b.update(gref(db), { memberUids: arrayRemove(MEMBER), [`memberInfo.${MEMBER}`]: deleteField() });
      b.set(doc(db, 'users', MEMBER), { garageId: MEMBER }, { merge: true });
      return assertSucceeds(b.commit());
    });
    test('P13 proprietario elenca i propri inviti', () =>
      assertSucceeds(getDocs(query(collection(ctx(OWNER), 'invites'), where('garageId', '==', OWNER)))));
    test('P14 invitata legge il proprio invito', () => assertSucceeds(getDoc(iref(ctx(INVITEE), T_CAROL))));
    test('P15 proprietario revoca un invito', () => assertSucceeds(deleteDoc(iref(ctx(OWNER), T_CAROL))));
  });

  describe('ATTACCHI (devono fallire)', () => {
    test('A01 non autenticato legge un garage', () => assertFails(getDoc(gref(anon()))));
    test('A02 estraneo loggato legge un garage altrui', () => assertFails(getDoc(gref(ctx(STRANGER)))));
    test('A03 estraneo elenca TUTTI i garage (query della v1)', () => assertFails(getDocs(collection(ctx(STRANGER), 'garages'))));
    test('A04 estraneo legge i veicoli', () => assertFails(getDocs(collection(ctx(STRANGER), 'garages', GID, 'vehicles'))));
    test('A05 estraneo scrive un veicolo', () =>
      assertFails(setDoc(doc(ctx(STRANGER), 'garages', GID, 'vehicles', 'x'), { plate: 'X', model: 'X' })));
    test('A06 estraneo SENZA invito entra (token inventato)', () => assertFails(accept(STRANGER, tok('e'))));
    test('A07 estraneo si aggiunge solo a memberUids (SDK diretto)', () =>
      assertFails(updateDoc(gref(ctx(STRANGER)), { memberUids: arrayUnion(STRANGER) })));
    test('A08 membro aggiunge un terzo uid a memberUids', () =>
      assertFails(updateDoc(gref(ctx(MEMBER)), { memberUids: [MEMBER, STRANGER] })));
    test('A09 membro rimuove un altro membro', async () => {
      await env.withSecurityRulesDisabled((c) => updateDoc(gref(c.firestore()), { memberUids: [MEMBER, 'zoe'] }));
      await assertFails(updateDoc(gref(ctx(MEMBER)), { memberUids: arrayRemove('zoe') }));
    });
    test('A11 membro si appropria del garage cambiando ownerUid', () => assertFails(updateDoc(gref(ctx(MEMBER)), { ownerUid: MEMBER })));
    test('A12 membro rinomina il garage', () => assertFails(updateDoc(gref(ctx(MEMBER)), { garageName: 'pwned' })));
    test('A13 membro riscrive members[] legacy', () => assertFails(updateDoc(gref(ctx(MEMBER)), { members: [legacy('fake')] })));
    test('A14 estraneo inietta in members[] una email con payload XSS', () =>
      assertFails(setDoc(gref(ctx(STRANGER)), {
        members: [{ email: "x');alert(document.domain);//", uid: '', name: 'x', photo: '', status: 'active' }],
      }, { merge: true })));
    test('A15 membro cancella il documento garage', () => assertFails(deleteDoc(gref(ctx(MEMBER)))));
    test('A16 estraneo crea un garage con id altrui', () =>
      assertFails(setDoc(gref(ctx(STRANGER), 'victim'), { ownerUid: STRANGER, members: [], memberUids: [] })));
    test('A17 estraneo legge users/{uid} di un altro', () => assertFails(getDoc(doc(ctx(STRANGER), 'users', OWNER))));
    test('A18 invito riusabile: invito già usato non fa rientrare', () => assertFails(accept(INVITEE, T_USED)));
  });

  describe('INVITI (devono fallire)', () => {
    test('I01 un membro crea un invito per il garage del proprietario', () =>
      assertFails(setDoc(iref(ctx(MEMBER), randomBytes(32).toString('hex')), { ...invite(GID, 'erin'), createdBy: MEMBER, createdAt: serverTimestamp() })));
    test('I02 invito con scadenza a 30 giorni', () =>
      assertFails(newInvite(OWNER, { expiresAt: Timestamp.fromMillis(Date.now() + 30 * DAY) })));
    test('I03 token corto o non esadecimale', async () => {
      await assertFails(newInvite(OWNER, {}, 'abc123'));
      await assertFails(newInvite(OWNER, {}, 'Z'.repeat(64)));
    });
    test('I04 invito creato già "usato"', () => assertFails(newInvite(OWNER, { usedAt: serverTimestamp(), usedBy: INVITEE })));
    test('I05 estraneo elenca gli inviti del garage', () =>
      assertFails(getDocs(query(collection(ctx(STRANGER), 'invites'), where('garageId', '==', OWNER)))));
    test('I06 estraneo legge un invito conoscendo il token', () => assertFails(getDoc(iref(ctx(STRANGER), T_CAROL))));
    test('I07 invitata usa un invito scaduto', () => assertFails(accept(INVITEE, T_EXPIRED)));
    test('I08 entra senza consumare l’invito', () => assertFails(accept(INVITEE, T_CAROL, { consume: false })));
    test('I09 consuma l’invito senza entrare', () => assertFails(accept(INVITEE, T_CAROL, { join: false, users: false })));
    test('I10 altro account usa il token di carol', () => assertFails(accept(STRANGER, T_CAROL)));
    test('I11 invito del garage zed usato per entrare nel garage alice', () => assertFails(accept(INVITEE, T_ZED)));
    test('I12 entrando aggiunge anche un complice', () => assertFails(accept(INVITEE, T_CAROL, { addUids: [STRANGER] })));
    test('I13 membro cancella un invito', () => assertFails(deleteDoc(iref(ctx(MEMBER), T_CAROL))));
    test('I14 proprietario allunga la scadenza di un invito', () =>
      assertFails(updateDoc(iref(ctx(OWNER), T_CAROL), { expiresAt: Timestamp.fromMillis(Date.now() + 365 * DAY) })));
    test('I15 entrando dichiara un’email diversa da quella del token', () =>
      assertFails(accept(INVITEE, T_CAROL, { infoOverride: { email: email(OWNER) } })));
    test('I16 users/{uid} punta a un garage di cui non è membro', () =>
      assertFails(setDoc(doc(ctx(STRANGER), 'users', STRANGER), { garageId: GID })));
    test('I17 email non verificata', () => {
      const db = env.authenticatedContext(INVITEE, { email: email(INVITEE), email_verified: false }).firestore();
      const b = writeBatch(db);
      b.update(iref(db, T_CAROL), { usedAt: serverTimestamp(), usedBy: INVITEE });
      b.update(gref(db), { memberUids: arrayUnion(INVITEE), [`memberInfo.${INVITEE}`]: { email: email(INVITEE), joinedAt: serverTimestamp(), inviteId: T_CAROL } });
      return assertFails(b.commit());
    });
  });

  // (1) invites: GET puntuale sì (proprietario o email invitata), LIST no — tranne il proprietario sui propri inviti
  describe('INVITI — get vs list', () => {
    test('L01 invitata: GET del proprio invito conoscendo il token → consentito', () =>
      assertSucceeds(getDoc(iref(ctx(INVITEE), T_CAROL))));
    test('L02 invitata: LIST filtrando per la propria email → negato', () =>
      assertFails(getDocs(query(collection(ctx(INVITEE), 'invites'), where('email', '==', email(INVITEE))))));
    test('L03 invitata: LIST filtrando per garageId → negato', () =>
      assertFails(getDocs(query(collection(ctx(INVITEE), 'invites'), where('garageId', '==', GID)))));
    test('L04 qualunque utente: LIST senza filtri → negato', async () => {
      await assertFails(getDocs(collection(ctx(STRANGER), 'invites')));
      await assertFails(getDocs(collection(ctx(MEMBER), 'invites')));
    });
    test('L05 proprietario: LIST senza filtro (tutti gli inviti) → negato', () =>
      assertFails(getDocs(collection(ctx(OWNER), 'invites'))));
    test('L06 proprietario: LIST filtrata su un garage altrui → negato', () =>
      assertFails(getDocs(query(collection(ctx(OWNER), 'invites'), where('garageId', '==', OTHER_OWNER)))));
    test('L07 proprietario: LIST dei propri inviti (where garageId == uid) → consentito (serve alla UI)', () =>
      assertSucceeds(getDocs(query(collection(ctx(OWNER), 'invites'), where('garageId', '==', OWNER)))));
    test('L08 non autenticato: GET con token → negato', () => assertFails(getDoc(iref(anon(), T_CAROL))));
  });

  // (2) riuso dello STESSO token e scadenza
  describe('INVITI — riuso e scadenza', () => {
    test('R01 stesso token: primo uso ok, secondo uso subito dopo → negato', async () => {
      await assertSucceeds(accept(INVITEE, T_CAROL));
      await assertFails(accept(INVITEE, T_CAROL));
    });
    test('R02 stesso token dopo la rimozione da parte del proprietario → negato', async () => {
      await assertSucceeds(accept(INVITEE, T_CAROL));
      await assertSucceeds(updateDoc(gref(ctx(OWNER)), { memberUids: arrayRemove(INVITEE), [`memberInfo.${INVITEE}`]: deleteField() }));
      await assertFails(accept(INVITEE, T_CAROL));
    });
    test('R03 stesso token dopo un’uscita volontaria → negato', async () => {
      await assertSucceeds(accept(INVITEE, T_CAROL));
      const db = ctx(INVITEE);
      const b = writeBatch(db);
      b.update(gref(db), { memberUids: arrayRemove(INVITEE), [`memberInfo.${INVITEE}`]: deleteField() });
      b.set(doc(db, 'users', INVITEE), { garageId: INVITEE }, { merge: true });
      await assertSucceeds(b.commit());
      await assertFails(accept(INVITEE, T_CAROL));
    });
    test('R04 token usato: nessuno può "ri-azzerarlo" (usedAt → null)', async () => {
      await assertSucceeds(accept(INVITEE, T_CAROL));
      await assertFails(updateDoc(iref(ctx(INVITEE), T_CAROL), { usedAt: null, usedBy: null }));
      await assertFails(updateDoc(iref(ctx(OWNER), T_CAROL), { usedAt: null, usedBy: null }));
    });
    test('R05 token usato da carol: un altro utente con lo stesso token → negato', async () => {
      await assertSucceeds(accept(INVITEE, T_CAROL));
      await assertFails(accept(STRANGER, T_CAROL));
    });
    test('E01 invito scaduto (1 secondo fa) → ingresso negato', async () => {
      await env.withSecurityRulesDisabled((c) => setDoc(iref(c.firestore(), tok('f')), invite(GID, INVITEE, { expiresAt: Timestamp.fromMillis(Date.now() - 1000) })));
      await assertFails(accept(INVITEE, tok('f')));
    });
    test('E02 invito scaduto: anche il solo consumo è negato', async () => {
      await assertFails(updateDoc(iref(ctx(INVITEE), T_EXPIRED), { usedAt: serverTimestamp(), usedBy: INVITEE }));
    });
    test('E03 creare un invito già scaduto → negato', () =>
      assertFails(newInvite(OWNER, { expiresAt: Timestamp.fromMillis(Date.now() - DAY) })));
    test('E04 creare un invito con expiresAt non-timestamp (stringa) → negato', () =>
      assertFails(newInvite(OWNER, { expiresAt: '2099-01-01' })));
  });

  // Dati di produzione "strani" non devono bloccare il proprietario/i membri (revisione H1/H2)
  describe('COMPATIBILITÀ LEGACY', () => {
    const legacyVehicle = { plate: 'ABCDEFGHIJKLMNOP', model: 'Vecchia', km: '1000', frozenAt: null, colore: 'rosso', note: 'n'.repeat(2500) };
    const seedLegacyVehicle = () => env.withSecurityRulesDisabled((c) =>
      setDoc(doc(c.firestore(), 'garages', GID, 'vehicles', 'legacy1'), legacyVehicle));
    test('LG01 rinomina di un garage con campo sconosciuto → consentito', async () => {
      await env.withSecurityRulesDisabled((c) => updateDoc(gref(c.firestore()), { inviteCode: 'xyz' }));
      await assertSucceeds(setDoc(gref(ctx(OWNER)), { garageName: 'Nuovo' }, { merge: true }));
    });
    test('LG02 rinomina di un garage senza ownerUid → consentito', async () => {
      await env.withSecurityRulesDisabled((c) => updateDoc(gref(c.firestore()), { ownerUid: deleteField() }));
      await assertSucceeds(setDoc(gref(ctx(OWNER)), { garageName: 'Nuovo' }, { merge: true }));
    });
    test('LG03 rimozione di un membro da un garage con 21 memberUids → consentito', async () => {
      const many = Array.from({ length: 21 }, (_, i) => `u${i}`);
      await env.withSecurityRulesDisabled((c) => updateDoc(gref(c.firestore()), { memberUids: many, memberInfo: {} }));
      await assertSucceeds(updateDoc(gref(ctx(OWNER)), { memberUids: arrayRemove('u3') }));
    });
    test('LG04 modifica km di un veicolo legacy (targa 16 car., null, campo extra, nota 2500) → consentito', async () => {
      await seedLegacyVehicle();
      await assertSucceeds(updateDoc(doc(ctx(MEMBER), 'garages', GID, 'vehicles', 'legacy1'), { km: '2000' }));
    });
    test('LG05 rinnovo con {...v} (riscrittura completa, valori legacy invariati) → consentito', async () => {
      await seedLegacyVehicle();
      await assertSucceeds(setDoc(doc(ctx(MEMBER), 'garages', GID, 'vehicles', 'legacy1'), { ...legacyVehicle, bollo: '2027-01-31', updatedAt: '2026-11-07T00:00:00Z' }));
    });
    test('LG06 salvataggio dal form che elimina il campo sconosciuto → consentito', async () => {
      await seedLegacyVehicle();
      const { colore, ...rest } = legacyVehicle;
      await assertSucceeds(setDoc(doc(ctx(MEMBER), 'garages', GID, 'vehicles', 'legacy1'), rest));
    });
    test('LG07 ma cambiare la targa in una da 16 caratteri → negato', async () => {
      await seedLegacyVehicle();
      await assertFails(updateDoc(doc(ctx(MEMBER), 'garages', GID, 'vehicles', 'legacy1'), { plate: 'ZYXWVUTSRQPONMLK' }));
    });
    test('LG08 e aggiungere un campo sconosciuto in update → negato', async () => {
      await seedLegacyVehicle();
      await assertFails(updateDoc(doc(ctx(MEMBER), 'garages', GID, 'vehicles', 'legacy1'), { isAdmin: true }));
    });
    test('LG09 togliere la targa in update → negato', async () => {
      await seedLegacyVehicle();
      await assertFails(updateDoc(doc(ctx(MEMBER), 'garages', GID, 'vehicles', 'legacy1'), { plate: deleteField() }));
    });
    test('LG10 un membro legacy senza memberInfo può uscire', async () => {
      await env.withSecurityRulesDisabled((c) => updateDoc(gref(c.firestore()), { memberInfo: deleteField() }));
      await assertSucceeds(updateDoc(gref(ctx(MEMBER)), { memberUids: arrayRemove(MEMBER) }));
    });
  });

  describe('VINCOLI AGGIUNTIVI (devono fallire)', () => {
    test('X01 un membro esistente "brucia" un invito alla propria email', async () => {
      await env.withSecurityRulesDisabled((c) => setDoc(iref(c.firestore(), tok('7')), invite(GID, MEMBER)));
      await assertFails(updateDoc(iref(ctx(MEMBER), tok('7')), { usedAt: serverTimestamp(), usedBy: MEMBER }));
    });
    test('X02 ingresso in un garage che ha già 20 membri', async () => {
      const many = Array.from({ length: 20 }, (_, i) => `u${i}`);
      await env.withSecurityRulesDisabled((c) => updateDoc(gref(c.firestore()), { memberUids: many, memberInfo: {} }));
      await assertFails(accept(INVITEE, T_CAROL));
    });
    test('X03 il proprietario aggiunge un campo sconosciuto al garage', () =>
      assertFails(updateDoc(gref(ctx(OWNER)), { isAdmin: true })));
    test('X04 il proprietario rinomina con un nome da 41 caratteri', () =>
      assertFails(updateDoc(gref(ctx(OWNER)), { garageName: 'x'.repeat(41) })));
  });

  describe('MEMBRI (devono fallire)', () => {
    test('M01 proprietario toglie l’accesso ma lascia il profilo (incoerenza)', () =>
      assertFails(updateDoc(gref(ctx(OWNER)), { memberUids: arrayRemove(MEMBER) })));
    test('M02 membro esce e intanto toglie un altro', async () => {
      await env.withSecurityRulesDisabled((c) => updateDoc(gref(c.firestore()), { memberUids: [MEMBER, 'zoe'] }));
      await assertFails(updateDoc(gref(ctx(MEMBER)), { memberUids: [], [`memberInfo.${MEMBER}`]: deleteField() }));
    });
    test('M03 proprietario aggiunge un uid direttamente (bypass invito)', () =>
      assertFails(updateDoc(gref(ctx(OWNER)), { memberUids: arrayUnion(STRANGER) })));
    test('M04 membro modifica il profilo di un altro membro', async () => {
      await env.withSecurityRulesDisabled((c) => updateDoc(gref(c.firestore()), { memberUids: [MEMBER, 'zoe'], 'memberInfo.zoe': info('zoe') }));
      await assertFails(updateDoc(gref(ctx(MEMBER)), { 'memberInfo.zoe.name': 'hacked' }));
    });
  });

  describe('VALIDAZIONE (devono fallire)', () => {
    test('V01 veicolo con note da 900 KB', () =>
      assertFails(setDoc(doc(ctx(MEMBER), 'garages', GID, 'vehicles', 'big'), { plate: 'A', model: 'B', note: 'x'.repeat(900_000) })));
    test('V02 veicolo con km di tipo errato (mappa)', () =>
      assertFails(setDoc(doc(ctx(MEMBER), 'garages', GID, 'vehicles', 'typ'), { plate: 'A', model: 'B', km: { evil: true } })));
    test('V03 veicolo senza targa', () => assertFails(setDoc(doc(ctx(MEMBER), 'garages', GID, 'vehicles', 'nop'), { model: 'B' })));
    test('V04 docId con apice (XSS)', () =>
      assertFails(setDoc(doc(ctx(MEMBER), 'garages', GID, 'vehicles', "x');alert(document.domain);('"), { plate: 'A', model: 'B' })));
    test('V05 sottocollezione arbitraria', () => assertFails(setDoc(doc(ctx(MEMBER), 'garages', GID, 'spam', 'a'), { x: 1 })));
    test('V06 gomme con stagione non valida', () =>
      assertFails(setDoc(doc(ctx(MEMBER), 'garages', GID, 'tires', 't1'), { vehicleId: 'mk1abc2def', season: '<img src=x>' })));
    test('V07 intervento con type contenente apici', () =>
      assertFails(setDoc(doc(ctx(MEMBER), 'garages', GID, 'mechs', 'm1'), { vehicleId: 'mk1abc2def', type: "x');alert(1)//" })));
    test('V08 veicolo con campo sconosciuto', () =>
      assertFails(setDoc(doc(ctx(MEMBER), 'garages', GID, 'vehicles', 'unk'), { plate: 'A', model: 'B', isAdmin: true })));
  });

  describe('SCADENZE PERSONALIZZATE (deadlines, v2.4)', () => {
    const dref = (db, id = 'd1', gid = GID) => doc(db, 'garages', gid, 'deadlines', id);
    const dl = (uid, extra = {}) => ({
      kind: 'ztl', label: 'Permesso ZTL', vehicleId: 'mk1abc2def', due: '2027-03-31', repeatMonths: 12,
      cost: 80, note: 'rinnovo online', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), addedBy: email(uid), ...extra,
    });
    const seedDl = () => env.withSecurityRulesDisabled((c) => setDoc(dref(c.firestore()), {
      kind: 'telepass', label: 'Telepass', vehicleId: null, due: '2027-01-15', repeatMonths: 12, cost: 30,
      createdAt: Timestamp.fromMillis(Date.now() - DAY), updatedAt: Timestamp.fromMillis(Date.now() - DAY), addedBy: email(OWNER),
    }));

    test('DL01 membro crea una scadenza completa (numeri veri, timestamp del server)', () =>
      assertSucceeds(setDoc(dref(ctx(MEMBER), 'n1'), dl(MEMBER))));
    test('DL02 scadenza minima, per tutto il garage (senza veicolo)', () =>
      assertSucceeds(setDoc(dref(ctx(OWNER), 'n2'), {
        kind: 'estintore', label: 'Estintore', due: '2027-06-01', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), addedBy: email(OWNER),
      })));
    test('DL03 membro legge, elenca e cancella', async () => {
      await seedDl();
      await assertSucceeds(getDoc(dref(ctx(MEMBER))));
      await assertSucceeds(getDocs(collection(ctx(MEMBER), 'garages', GID, 'deadlines')));
      await assertSucceeds(deleteDoc(dref(ctx(MEMBER))));
    });
    test('DL04 "Fatto" su una ricorrente: sposta la data in avanti', async () => {
      await seedDl();
      await assertSucceeds(updateDoc(dref(ctx(MEMBER)), { due: '2028-01-15', updatedAt: serverTimestamp() }));
    });
    test('DL05 estraneo non legge né scrive', async () => {
      await seedDl();
      await assertFails(getDoc(dref(ctx(STRANGER))));
      await assertFails(getDocs(collection(ctx(STRANGER), 'garages', GID, 'deadlines')));
      await assertFails(setDoc(dref(ctx(STRANGER), 'x'), dl(STRANGER)));
      await assertFails(deleteDoc(dref(ctx(STRANGER))));
      await assertFails(getDoc(dref(anon())));
    });
    test('DL06 ex membro (uscito) non scrive più', async () => {
      await env.withSecurityRulesDisabled((c) => updateDoc(gref(c.firestore()), { memberUids: [], memberInfo: {} }));
      await assertFails(setDoc(dref(ctx(MEMBER), 'x'), dl(MEMBER)));
    });
    test('DL07 validazione in create: tipo, etichetta, data, ricorrenza, importo, campi, id', async () => {
      const bad = [
        { kind: '<img src=x>' }, { kind: 'admin' }, { label: '' }, { label: 'x'.repeat(61) },
        { due: '31/03/2027' }, { due: '2027-3-1' }, { due: 20270331 },
        { repeatMonths: 0 }, { repeatMonths: 121 }, { repeatMonths: 1.5 }, { repeatMonths: '12' },
        { cost: '80' }, { cost: -1 }, { cost: { evil: 1 } }, { note: 'x'.repeat(501) },
        { vehicleId: "x');alert(1)//" }, { isAdmin: true },
      ];
      for (const b of bad) await assertFails(setDoc(dref(ctx(MEMBER), 'b'), dl(MEMBER, b)));
      await assertFails(setDoc(dref(ctx(MEMBER), "x');alert(1);('"), dl(MEMBER)));
    });
    test('DL08 timestamp e autore non falsificabili', async () => {
      await assertFails(setDoc(dref(ctx(MEMBER), 'c1'), dl(MEMBER, { createdAt: Timestamp.fromMillis(0) })));
      await assertFails(setDoc(dref(ctx(MEMBER), 'c2'), dl(MEMBER, { updatedAt: '2026-01-01T00:00:00Z' })));
      await assertFails(setDoc(dref(ctx(MEMBER), 'c3'), dl(MEMBER, { addedBy: email(OWNER) })));
      const { createdAt, ...noCreated } = dl(MEMBER);
      await assertFails(setDoc(dref(ctx(MEMBER), 'c4'), noCreated));
    });
    test('DL09 update: validazione completa e campi immutabili', async () => {
      await seedDl();
      const db = ctx(MEMBER);
      await assertFails(updateDoc(dref(db), { label: '', updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(dref(db), { cost: 'tanto', updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(dref(db), { due: '2028-01-15' }));
      await assertFails(updateDoc(dref(db), { addedBy: email(MEMBER), updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(dref(db), { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(dref(db), { kind: 'admin', updatedAt: serverTimestamp() }));
      await assertSucceeds(updateDoc(dref(db), { repeatMonths: null, cost: null, note: 'ok', updatedAt: serverTimestamp() }));
    });
    test('DL10 nessuna scrittura nelle scadenze di un altro garage', () =>
      assertFails(setDoc(dref(ctx(MEMBER), 'z1', OTHER_OWNER), dl(MEMBER))));
  });

  describe('PROMEMORIA PUSH (pushTokens, preferenze, registro)', () => {
    const TOKEN = 'fcm:APA91b-' + 'x'.repeat(140);
    const sha = (s) => createHash('sha256').update(s).digest('hex');
    const tref = (db, uid, token = TOKEN, id = sha(token)) => doc(db, 'users', uid, 'pushTokens', id);
    const tok = (extra = {}) => ({ token: TOKEN, platform: 'android', createdAt: serverTimestamp(), lastSeenAt: serverTimestamp(), appVersion: '2.5.0', ...extra });
    const seedTok = (uid) => env.withSecurityRulesDisabled((c) => setDoc(tref(c.firestore(), uid), {
      token: TOKEN, platform: 'ios', createdAt: Timestamp.fromMillis(Date.now() - DAY), lastSeenAt: Timestamp.fromMillis(Date.now() - DAY),
    }));

    test('PU01 utente registra, legge, elenca, aggiorna e cancella il PROPRIO token', async () => {
      const db = ctx(MEMBER);
      await assertSucceeds(setDoc(tref(db, MEMBER), tok()));
      await assertSucceeds(getDoc(tref(db, MEMBER)));
      await assertSucceeds(getDocs(collection(db, 'users', MEMBER, 'pushTokens')));
      await assertSucceeds(updateDoc(tref(db, MEMBER), { lastSeenAt: serverTimestamp(), appVersion: '2.5.1' }));
      await assertSucceeds(deleteDoc(tref(db, MEMBER)));
    });
    test('PU02 nessuno legge o tocca i token altrui (nemmeno il proprietario del garage)', async () => {
      await seedTok(MEMBER);
      for (const who of [OWNER, INVITEE, STRANGER]) {
        const db = ctx(who);
        await assertFails(getDoc(tref(db, MEMBER)));
        await assertFails(getDocs(collection(db, 'users', MEMBER, 'pushTokens')));
        await assertFails(deleteDoc(tref(db, MEMBER)));
        await assertFails(setDoc(tref(db, MEMBER, 'other-token'), tok({ token: 'other-token' })));
      }
      await assertFails(getDoc(tref(anon(), MEMBER)));
    });
    test('PU03 query collectionGroup su tutti i token: negata', async () => {
      await seedTok(MEMBER);
      await assertFails(getDocs(collectionGroup(ctx(MEMBER), 'pushTokens')));
      await assertFails(getDocs(query(collectionGroup(ctx(OWNER), 'pushTokens'), where('platform', '==', 'ios'))));
    });
    test('PU04 ID = SHA-256 del token, campi e tipi validati', async () => {
      const db = ctx(MEMBER);
      await assertFails(setDoc(doc(db, 'users', MEMBER, 'pushTokens', 'a'.repeat(64)), tok()));         // ID non corrispondente
      await assertFails(setDoc(doc(db, 'users', MEMBER, 'pushTokens', 'qualsiasi'), tok()));
      for (const bad of [{ platform: 'windows95' }, { token: '' }, { token: 'x'.repeat(4097) }, { appVersion: 'x'.repeat(21) }, { extra: 1 }]) {
        const t = bad.token ?? TOKEN;
        await assertFails(setDoc(tref(db, MEMBER, t, sha(t)), tok(bad)));
      }
    });
    test('PU05 timestamp del server obbligatori; token e createdAt immutabili', async () => {
      const db = ctx(MEMBER);
      await assertFails(setDoc(tref(db, MEMBER), tok({ createdAt: Timestamp.fromMillis(0) })));
      await assertFails(setDoc(tref(db, MEMBER), tok({ lastSeenAt: Timestamp.fromMillis(0) })));
      await seedTok(MEMBER);
      await assertFails(updateDoc(tref(db, MEMBER), { appVersion: '9' }));                             // senza lastSeenAt del server
      await assertFails(updateDoc(tref(db, MEMBER), { token: 'altro', lastSeenAt: serverTimestamp() }));
      await assertFails(updateDoc(tref(db, MEMBER), { createdAt: serverTimestamp(), lastSeenAt: serverTimestamp() }));
    });
    test('PU06 preferenze valide nel proprio users/{uid}', async () => {
      const db = ctx(MEMBER);
      await assertSucceeds(setDoc(doc(db, 'users', MEMBER), { push: { enabled: true, days: [30, 7, 1], details: true } }, { merge: true }));
      await assertSucceeds(setDoc(doc(db, 'users', MEMBER), { push: { enabled: false } }, { merge: true }));
      await assertSucceeds(setDoc(doc(db, 'users', MEMBER), { push: { enabled: true, days: [0], details: false } }, { merge: true }));
    });
    test('PU07 preferenze non valide respinte', async () => {
      const db = ctx(MEMBER);
      const bad = [
        { enabled: 'sì' }, { details: 1 }, { days: [] }, { days: [30, 7, 1, 2, 3, 5] }, { days: [8] }, { days: [-1] },
        { days: ['30'] }, { days: 30 }, { evil: true },
      ];
      for (const b of bad) await assertFails(setDoc(doc(db, 'users', MEMBER), { push: b }, { merge: true }));
      await assertFails(setDoc(doc(db, 'users', MEMBER), { push: 'on' }, { merge: true }));
      await assertFails(setDoc(doc(ctx(OWNER), 'users', MEMBER), { push: { enabled: true } }, { merge: true }));
    });
    test('PU08 registro degli invii e heartbeat: nessuna scrittura dai client; heartbeat leggibile', async () => {
      await env.withSecurityRulesDisabled(async (c) => {
        await setDoc(doc(c.firestore(), 'pushLog', 'x'), { at: Timestamp.now() });
        await setDoc(doc(c.firestore(), 'pushStatus', 'heartbeat'), { lastRunAt: Timestamp.now(), mode: 'dry-run' });
      });
      const db = ctx(MEMBER);
      await assertFails(getDoc(doc(db, 'pushLog', 'x')));
      await assertFails(getDocs(collection(db, 'pushLog')));
      await assertFails(setDoc(doc(db, 'pushLog', 'y'), { at: serverTimestamp() }));
      await assertFails(deleteDoc(doc(db, 'pushLog', 'x')));
      await assertSucceeds(getDoc(doc(db, 'pushStatus', 'heartbeat')));
      await assertFails(getDoc(doc(anon(), 'pushStatus', 'heartbeat')));
      await assertFails(setDoc(doc(db, 'pushStatus', 'heartbeat'), { lastRunAt: serverTimestamp() }));
      await assertFails(getDocs(collection(db, 'pushStatus')));
    });
  });

  describe('RIFORNIMENTI (refuels, v2.6)', () => {
    const VID = 'mk1abc2def';
    const rref = (db, id = 'r1') => doc(db, 'garages', GID, 'refuels', id);
    const ok = (uid = MEMBER, extra = {}) => ({
      vehicleId: VID, date: '2026-11-07', km: 45000, liters: 38.5, amount: 62.4, full: true, note: 'Q8',
      addedBy: email(uid), createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra,
    });
    const seedRefuel = () => env.withSecurityRulesDisabled((c) => setDoc(rref(c.firestore()), {
      vehicleId: VID, date: '2026-11-01', km: 44000, liters: 40, amount: 70, full: true, note: '',
      addedBy: email(OWNER), createdAt: Timestamp.fromMillis(Date.now() - DAY), updatedAt: Timestamp.fromMillis(Date.now() - DAY),
    }));

    test('RF01 proprietario e membro creano, leggono, modificano e cancellano', async () => {
      await assertSucceeds(setDoc(rref(ctx(OWNER), 'a'), ok(OWNER)));
      await assertSucceeds(setDoc(rref(ctx(MEMBER), 'b'), ok(MEMBER, { km: null, full: false, note: '' })));
      await assertSucceeds(setDoc(rref(ctx(MEMBER), 'c'), (({ note, ...x }) => x)(ok(MEMBER))));   // note facoltativa
      await assertSucceeds(getDocs(collection(ctx(MEMBER), 'garages', GID, 'refuels')));
      await assertSucceeds(updateDoc(rref(ctx(MEMBER), 'a'), { liters: 40, amount: 70, updatedAt: serverTimestamp() }));
      await assertSucceeds(deleteDoc(rref(ctx(OWNER), 'b')));
    });
    test('RF02 non membri e anonimi: niente lettura né scrittura', async () => {
      await seedRefuel();
      for (const db of [ctx(STRANGER), ctx(INVITEE), anon()]) {
        await assertFails(getDoc(rref(db)));
        await assertFails(getDocs(collection(db, 'garages', GID, 'refuels')));
        await assertFails(setDoc(rref(db, 'x'), ok(STRANGER)));
        await assertFails(updateDoc(rref(db), { amount: 1, updatedAt: serverTimestamp() }));
        await assertFails(deleteDoc(rref(db)));
      }
    });
    test('RF03 km, litri e importo come stringa: negati (create e update)', async () => {
      const db = ctx(MEMBER);
      for (const bad of [{ km: '45000' }, { liters: '38,5' }, { amount: '62.40' }, { full: 'true' }, { km: 4.5 }]) {
        await assertFails(setDoc(rref(db, 'x'), ok(MEMBER, bad)));
      }
      await seedRefuel();
      await assertFails(updateDoc(rref(db), { km: '45000', updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(rref(db), { amount: '70', updatedAt: serverTimestamp() }));
    });
    test('RF04 valori fuori misura negati', async () => {
      const db = ctx(MEMBER);
      for (const bad of [{ km: -1 }, { km: 10_000_000 }, { liters: 0 }, { liters: -5 }, { liters: 501 }, { amount: -0.01 },
        { amount: 10_001 }, { date: '07/11/2026' }, { date: '' }, { note: 'x'.repeat(201) }, { vehicleId: "x');alert(1)//" }]) {
        await assertFails(setDoc(rref(db, 'x'), ok(MEMBER, bad)));
      }
    });
    test('RF05 chiavi extra o mancanti negate', async () => {
      const db = ctx(MEMBER);
      await assertFails(setDoc(rref(db, 'x'), ok(MEMBER, { station: 'Q8' })));
      await assertFails(setDoc(rref(db, 'x'), (({ full, ...x }) => x)(ok(MEMBER))));
      await assertFails(setDoc(rref(db, 'x'), (({ km, ...x }) => x)(ok(MEMBER))));
      await seedRefuel();
      await assertFails(updateDoc(rref(db), { isAdmin: true, updatedAt: serverTimestamp() }));
    });
    test('RF06 addedBy falsificato negato in create', async () => {
      await assertFails(setDoc(rref(ctx(MEMBER), 'x'), ok(MEMBER, { addedBy: email(OWNER) })));
      await assertFails(setDoc(rref(ctx(MEMBER), 'x'), ok(MEMBER, { addedBy: '' })));
    });
    test('RF07 update che cambia addedBy o createdAt negato', async () => {
      await seedRefuel();
      const db = ctx(MEMBER);
      await assertFails(updateDoc(rref(db), { addedBy: email(MEMBER), updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(rref(db), { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    });
    test('RF08 timestamp del server obbligatori', async () => {
      const db = ctx(MEMBER);
      await assertFails(setDoc(rref(db, 'x'), ok(MEMBER, { createdAt: Timestamp.fromMillis(Date.now()) })));
      await assertFails(setDoc(rref(db, 'x'), ok(MEMBER, { updatedAt: Timestamp.fromMillis(0) })));
      await assertFails(setDoc(rref(db, 'x'), ok(MEMBER, { createdAt: '2026-11-07T10:00:00.000Z' })));
      await seedRefuel();
      await assertFails(updateDoc(rref(db), { amount: 71 }));                                         // senza updatedAt
      await assertFails(updateDoc(rref(db), { amount: 71, updatedAt: Timestamp.fromMillis(Date.now()) }));
    });
    test('RF09 veicolo inesistente negato (create e cambio veicolo)', async () => {
      await assertFails(setDoc(rref(ctx(MEMBER), 'x'), ok(MEMBER, { vehicleId: 'nonesiste' })));
      await seedRefuel();
      await assertFails(updateDoc(rref(ctx(MEMBER)), { vehicleId: 'nonesiste', updatedAt: serverTimestamp() }));
    });
    test('RF10 un garage non scrive nei rifornimenti di un altro', async () => {
      await assertFails(setDoc(doc(ctx(OTHER_OWNER), 'garages', GID, 'refuels', 'x'), ok(OTHER_OWNER)));
      await assertFails(getDocs(collection(ctx(OTHER_OWNER), 'garages', GID, 'refuels')));
    });
  });

  describe('PAGAMENTI DELLE SCADENZE (payments, v2.6.1)', () => {
    const pref = (db, id = 'p1') => doc(db, 'garages', GID, 'payments', id);
    const ok = (uid = MEMBER, extra = {}) => ({
      deadlineId: 'dl1abc', kind: 'ztl', label: 'Permesso ZTL', vehicleId: 'mk1abc2def', date: '2026-11-08', amount: 80.5,
      addedBy: email(uid), createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra,
    });
    const seed = () => env.withSecurityRulesDisabled((c) => setDoc(pref(c.firestore()), {
      deadlineId: 'dl1abc', kind: 'ztl', label: 'Permesso ZTL', vehicleId: null, date: '2026-11-01', amount: 80,
      addedBy: email(OWNER), createdAt: Timestamp.fromMillis(Date.now() - DAY), updatedAt: Timestamp.fromMillis(Date.now() - DAY),
    }));

    test('PY01 i membri creano (anche senza veicolo), leggono, modificano e cancellano', async () => {
      await assertSucceeds(setDoc(pref(ctx(OWNER), 'a'), ok(OWNER)));
      await assertSucceeds(setDoc(pref(ctx(MEMBER), 'b'), ok(MEMBER, { vehicleId: null })));
      await assertSucceeds(setDoc(pref(ctx(MEMBER), 'c'), (({ vehicleId, ...x }) => x)(ok(MEMBER))));
      await assertSucceeds(getDocs(collection(ctx(MEMBER), 'garages', GID, 'payments')));
      await assertSucceeds(updateDoc(pref(ctx(MEMBER), 'a'), { amount: 90, editedBy: email(MEMBER), updatedAt: serverTimestamp() }));
      await assertSucceeds(deleteDoc(pref(ctx(OWNER), 'b')));
    });
    test('PY02 non membri, anonimi e altri garage: niente', async () => {
      await seed();
      for (const db of [ctx(STRANGER), ctx(INVITEE), anon(), ctx(OTHER_OWNER)]) {
        await assertFails(getDoc(pref(db)));
        await assertFails(getDocs(collection(db, 'garages', GID, 'payments')));
        await assertFails(setDoc(pref(db, 'x'), ok(STRANGER)));
        await assertFails(deleteDoc(pref(db)));
      }
    });
    test('PY03 importo: solo numero > 0 e ≤ 1.000.000', async () => {
      const db = ctx(MEMBER);
      for (const bad of [{ amount: '80,50' }, { amount: 0 }, { amount: -1 }, { amount: 1_000_001 }, { amount: null }]) {
        await assertFails(setDoc(pref(db, 'x'), ok(MEMBER, bad)));
      }
      await seed();
      await assertFails(updateDoc(pref(db), { amount: '90', editedBy: email(MEMBER), updatedAt: serverTimestamp() }));
    });
    test('PY04 campi non validi, extra o mancanti negati', async () => {
      const db = ctx(MEMBER);
      for (const bad of [{ kind: 'bollo' }, { date: '08/11/2026' }, { label: '' }, { label: 'x'.repeat(61) },
        { deadlineId: "x');//" }, { vehicleId: "x');//" }, { cost: 80 }]) {
        await assertFails(setDoc(pref(db, 'x'), ok(MEMBER, bad)));
      }
      await assertFails(setDoc(pref(db, 'x'), (({ deadlineId, ...x }) => x)(ok(MEMBER))));
      await assertFails(setDoc(pref(db, 'x'), (({ date, ...x }) => x)(ok(MEMBER))));
    });
    test('PY05 addedBy e timestamp: chi scrive, del server, immutabili', async () => {
      const db = ctx(MEMBER);
      await assertFails(setDoc(pref(db, 'x'), ok(MEMBER, { addedBy: email(OWNER) })));
      await assertFails(setDoc(pref(db, 'x'), ok(MEMBER, { createdAt: Timestamp.fromMillis(Date.now()) })));
      await seed();
      await assertFails(updateDoc(pref(db), { addedBy: email(MEMBER), updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(pref(db), { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(pref(db), { amount: 91 }));
    });

    // v2.7.0 — registro pagamenti: update ristretto, delete solo autore o proprietario (docs/PIANO-v2.7.md §2.2;
    // prefisso PY- perché P01…P10 sono già i casi dell'audit)
    const ed = (uid = MEMBER, extra = {}) => ({ editedBy: email(uid), updatedAt: serverTimestamp(), ...extra });
    const seedBy = (uid, id = 'p1') => env.withSecurityRulesDisabled((c) => setDoc(pref(c.firestore(), id), {
      deadlineId: 'dl1abc', kind: 'ztl', label: 'Permesso ZTL', vehicleId: 'mk1abc2def', date: '2026-11-01', amount: 80,
      addedBy: email(uid), createdAt: Timestamp.fromMillis(Date.now() - DAY), updatedAt: Timestamp.fromMillis(Date.now() - DAY),
    }));
    test('PY-P01 un membro corregge importo, data ed etichetta (editedBy = sé, updatedAt = ora del server)', async () => {
      await seed();
      const db = ctx(MEMBER);
      await assertSucceeds(updateDoc(pref(db), ed(MEMBER, { amount: 75 })));
      await assertSucceeds(updateDoc(pref(db), ed(MEMBER, { date: '2026-10-31', label: 'ZTL Milano' })));
      await assertSucceeds(setDoc(pref(ctx(OWNER)), ed(OWNER, { amount: 76.5 }), { merge: true }));
    });
    test('PY-P02 data in formato non valido: negata', async () => {
      await seed();
      for (const date of ['31/10/2026', '2026-1-1', '', 20261031]) {
        await assertFails(updateDoc(pref(ctx(MEMBER)), ed(MEMBER, { date })));
      }
    });
    test('PY-P03 deadlineId, kind e vehicleId non si cambiano', async () => {
      await seed();
      const db = ctx(MEMBER);
      await assertFails(updateDoc(pref(db), ed(MEMBER, { deadlineId: 'altro1' })));
      await assertFails(updateDoc(pref(db), ed(MEMBER, { kind: 'telepass' })));
      await assertFails(updateDoc(pref(db), ed(MEMBER, { vehicleId: 'mk1abc2def' })));
    });
    test('PY-P04 addedBy e createdAt non si cambiano', async () => {
      await seed();
      const db = ctx(MEMBER);
      await assertFails(updateDoc(pref(db), ed(MEMBER, { addedBy: email(MEMBER) })));
      await assertFails(updateDoc(pref(db), ed(MEMBER, { createdAt: serverTimestamp() })));
    });
    test('PY-P05 editedBy diverso da chi scrive, mancante, o updatedAt non del server: negato', async () => {
      await seed();
      const db = ctx(MEMBER);
      await assertFails(updateDoc(pref(db), ed(MEMBER, { amount: 70, editedBy: email(OWNER) })));
      await assertFails(updateDoc(pref(db), { amount: 70, updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(pref(db), ed(MEMBER, { amount: 70, updatedAt: Timestamp.fromMillis(Date.now()) })));
      await assertFails(updateDoc(pref(db), ed(MEMBER, { amount: 70, editedBy: 'x'.repeat(255) })));
    });
    test('PY-P06 create con editedBy: negata', async () => {
      await assertFails(setDoc(pref(ctx(MEMBER), 'x'), ok(MEMBER, { editedBy: email(MEMBER) })));
      await assertSucceeds(setDoc(pref(ctx(MEMBER), 'x'), ok(MEMBER)));
    });
    test('PY-P07 l’autore (membro) elimina il proprio pagamento', async () => {
      await seedBy(MEMBER);
      await assertSucceeds(deleteDoc(pref(ctx(MEMBER))));
    });
    test('PY-P08 un membro non autore non elimina', async () => {
      await seedBy(OWNER);
      await assertFails(deleteDoc(pref(ctx(MEMBER))));
    });
    test('PY-P09 il proprietario elimina anche i pagamenti altrui', async () => {
      await seedBy(MEMBER);
      await assertSucceeds(deleteDoc(pref(ctx(OWNER))));
    });
    test('PY-P10 estranei, anonimi e altri garage: niente lettura, modifica o eliminazione', async () => {
      await seedBy(MEMBER);
      for (const [db, who] of [[ctx(STRANGER), STRANGER], [ctx(INVITEE), INVITEE], [anon(), STRANGER], [ctx(OTHER_OWNER), OTHER_OWNER]]) {
        await assertFails(getDoc(pref(db)));
        await assertFails(updateDoc(pref(db), ed(who, { amount: 1 })));
        await assertFails(deleteDoc(pref(db)));
      }
    });
  });
});
