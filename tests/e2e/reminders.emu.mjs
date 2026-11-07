// Script di invio dei promemoria sull'EMULATORE Firestore, con FCM simulato (FCM non ha un emulatore).
// Verifica: dry-run senza scritture né invii; una notifica per utente; dettagli/senza dettagli, mai importi;
// ex membri, preferenze spente, veicoli congelati esclusi; token morti e vecchi rimossi; idempotenza
// (stesso giorno, giorni successivi, due run); errori temporanei → riprova; solo un utente; log senza dati personali.
// Prerequisiti: emulatore firestore su 127.0.0.1:8080. Uso: node reminders.emu.mjs
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
const PROJECT = 'demo-garageos-push';
const { initializeApp, getFirestore, FieldValue, Timestamp } = await import('../../tools/admin/admin-sdk.mjs');
const { run } = await import('../../tools/admin/send-reminders.mjs');
const { romeToday } = await import('../../tools/admin/reminders-lib.mjs');

const db = getFirestore(initializeApp({ projectId: PROJECT }, 'reminders-test'));
const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); console.log(`  ${cond ? '✔' : '✖'} ${msg}`); };
const DAY = 86_400_000;
const NOW = new Date('2026-11-07T06:17:00Z');
const day = (n, base = NOW) => { const d = new Date(Date.parse(romeToday(base) + 'T00:00:00Z') + n * DAY); return d.toISOString().slice(0, 10); };
const at = (n) => new Date(NOW.getTime() + n * DAY);

const OWNER = 'uidOwnerQ7', MEMBER = 'uidMemberK3', EX = 'uidExMbrZ9', OFF = 'uidOffW2', STALE = 'uidStaleR5';
const PLATE = 'PLT77XX', SECRET_COST = '987';

async function reset() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const b = db.batch();
  b.set(db.doc(`garages/${OWNER}`), { ownerUid: OWNER, memberUids: [MEMBER], memberInfo: {} });
  b.set(db.doc(`garages/${OWNER}/vehicles/v1`), { plate: PLATE, model: 'Panda', bollo: day(7), bolloCost: SECRET_COST, revisione: day(30), assicurazione: day(100) });
  b.set(db.doc(`garages/${OWNER}/vehicles/v2`), { plate: 'FROZEN1', model: 'Vecchia', frozen: true, bollo: day(1) });
  // scadenze personalizzate (F2): una del garage alla stessa data della revisione, una del veicolo congelato (esclusa)
  b.set(db.doc(`garages/${OWNER}/deadlines/dz`), { kind: 'ztl', label: 'Permesso ZTL', vehicleId: null, due: day(30), cost: 99 });
  b.set(db.doc(`garages/${OWNER}/deadlines/df`), { kind: 'tagliando', label: 'Tagliando', vehicleId: 'v2', due: day(1) });
  b.set(db.doc(`users/${OWNER}`), { garageId: OWNER, push: { enabled: true, days: [30, 7, 1], details: true } });
  b.set(db.doc(`users/${MEMBER}`), { garageId: OWNER, push: { enabled: true, details: false } });
  b.set(db.doc(`users/${EX}`), { garageId: OWNER, push: { enabled: true } });                 // non più in memberUids
  b.set(db.doc(`users/${OFF}`), { garageId: OWNER, push: { enabled: false } });
  b.set(db.doc(`users/${STALE}`), { garageId: STALE, push: { enabled: true } });
  b.set(db.doc(`garages/${STALE}`), { ownerUid: STALE, memberUids: [] });
  const tok = (uid, id, token, seenDaysAgo = 1) => b.set(db.doc(`users/${uid}/pushTokens/${id}`), {
    token, platform: 'android', createdAt: Timestamp.fromDate(at(-100)), lastSeenAt: Timestamp.fromDate(at(-seenDaysAgo)) });
  tok(OWNER, 'a1', 'tok-owner-phone'); tok(OWNER, 'a2', 'tok-owner-dead'); tok(MEMBER, 'b1', 'tok-member');
  tok(EX, 'c1', 'tok-ex'); tok(OFF, 'd1', 'tok-off'); tok(STALE, 'e1', 'tok-stale', 90);
  await b.commit();
}
function fakeMessaging({ fail = {} } = {}) {
  const calls = [];
  return {
    calls,
    async sendEachForMulticast(msg) {
      calls.push(msg);
      return { responses: msg.tokens.map((t) => fail[t] ? { success: false, error: { code: fail[t] } } : { success: true }) };
    },
  };
}
const lines = [];
const go = (opts) => run({ db, FieldValue, Timestamp, log: (l) => lines.push(l), ...opts });
const count = async (path) => (await db.collection(path).get()).size;

console.log('Promemoria: script di invio sull\'emulatore\n');
await reset();

// ── dry-run
let m = fakeMessaging();
let st = await go({ messaging: m, now: NOW, mode: 'dry-run' });
check(m.calls.length === 0 && await count('pushLog') === 0 && !(await db.doc('pushStatus/heartbeat').get()).exists, 'dry-run: nessun invio, nessuna scrittura');
check(st.notifications === 2 && st.skippedNotMember === 1 && st.skippedDisabled === 1 && st.staleTokensRemoved === 1, `dry-run conta: 2 notifiche, 1 ex membro, 1 disattivato, 1 token vecchio (${JSON.stringify(st)})`);
check((await db.doc(`users/${STALE}/pushTokens/e1`).get()).exists, 'dry-run: il token vecchio NON viene cancellato');

// ── primo invio reale
m = fakeMessaging({ fail: { 'tok-owner-dead': 'messaging/registration-token-not-registered' } });
st = await go({ messaging: m, now: NOW, mode: 'live' });
check(m.calls.length === 2, `una notifica per utente (proprietario e membro): ${m.calls.length}`);
const toOwner = m.calls.find((c) => c.tokens.includes('tok-owner-phone'));
const toMember = m.calls.find((c) => c.tokens.includes('tok-member'));
check(toOwner?.tokens.length === 2, 'al proprietario: entrambi i suoi dispositivi');
check(/PLT77XX · Bollo: tra 7 giorni/.test(toOwner?.data.body) && /PLT77XX · Revisione: tra 30 giorni/.test(toOwner?.data.body) && /Garage · Permesso ZTL: tra 30 giorni/.test(toOwner?.data.body), `dettagli: targa e tipo, anche le scadenze personalizzate ("Garage" senza veicolo) (${JSON.stringify(toOwner?.data.body)})`);
check(!toOwner?.data.body.includes(SECRET_COST) && !/€/.test(toOwner?.data.body), 'mai importi nella notifica');
check(!/FROZEN1|Assicurazione|Tagliando/.test(toOwner?.data.body), 'esclusi veicoli congelati e scadenze lontane');
check(!toMember?.data.body.includes(PLATE) && /3 scadenze/.test(toMember?.data.body), `"senza dettagli" per chi l'ha scelto (${JSON.stringify(toMember?.data.body)})`);
check(!m.calls.some((c) => c.tokens.includes('tok-ex') || c.tokens.includes('tok-off') || c.tokens.includes('tok-stale')), 'niente a ex membri, a chi ha disattivato, a token vecchi');
check(!(await db.doc(`users/${OWNER}/pushTokens/a2`).get()).exists && (await db.doc(`users/${OWNER}/pushTokens/a1`).get()).exists, 'token "non registrato" rimosso, quello buono resta');
check(!(await db.doc(`users/${STALE}/pushTokens/e1`).get()).exists, 'token non usato da 60+ giorni rimosso');
check(await count('pushLog') === 6 && (await db.doc('pushStatus/heartbeat').get()).exists, `registro: 6 voci (3 scadenze × 2 utenti) e heartbeat (${await count('pushLog')})`);

// ── idempotenza
m = fakeMessaging();
st = await go({ messaging: m, now: NOW, mode: 'live' });
check(m.calls.length === 0 && st.alreadySent === 6, 'secondo run nello stesso giorno: nessun doppione');
m = fakeMessaging();
await Promise.all([go({ messaging: m, now: at(6), mode: 'live' }), go({ messaging: m, now: at(6), mode: 'live' })]);
check(m.calls.length === 2, `due run IN PARALLELO il giorno della soglia 1: una sola notifica per utente (${m.calls.length})`);
m = fakeMessaging();
await go({ messaging: m, now: at(2), mode: 'live' });
check(m.calls.length === 0, 'giorni intermedi (soglia 7 già inviata): niente');

// ── errore temporaneo → si riprova al run successivo
await reset();
m = fakeMessaging({ fail: { 'tok-owner-phone': 'messaging/internal-error', 'tok-owner-dead': 'messaging/internal-error', 'tok-member': 'messaging/internal-error' } });
await go({ messaging: m, now: NOW, mode: 'live' });
check(await count('pushLog') === 0, 'invio fallito per errore temporaneo: registro annullato');
check((await db.doc(`users/${OWNER}/pushTokens/a1`).get()).exists, 'errore temporaneo: nessun token cancellato');
m = fakeMessaging();
await go({ messaging: m, now: NOW, mode: 'live' });
check(m.calls.length === 2, 'il run successivo riprova e invia');

// ── solo un utente (primo test reale sul tuo account)
await reset();
m = fakeMessaging();
st = await go({ messaging: m, now: NOW, mode: 'live', onlyUid: OWNER });
check(m.calls.length === 1 && m.calls[0].tokens.includes('tok-owner-phone') && st.notifications === 1, '--only-uid: solo quell\'utente');
check((await db.doc(`users/${STALE}/pushTokens/e1`).get()).exists, '--only-uid: nessuna pulizia sui token degli altri');

// ── log pubblici: solo conteggi
const leaked = lines.filter((l) => [OWNER, MEMBER, EX, OFF, STALE, PLATE, 'tok-', '@'].some((x) => l.includes(x)));
check(leaked.length === 0, `log senza uid, targhe, token o email${leaked.length ? ': ' + leaked.join(' | ') : ''}`);

// ── CLI: senza REMINDERS_ALLOW_LIVE=yes il "live" diventa dry-run; guardie sul target
{
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const script = fileURLToPath(new URL('../../tools/admin/send-reminders.mjs', import.meta.url));
  const cli = (args, env = {}) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, GCLOUD_PROJECT: PROJECT, REMINDERS_ALLOW_LIVE: '', ...env } });
  await reset();
  const r = cli(['--target', 'emulator', '--mode', 'live']);
  check(r.status === 0 && /DRY RUN/.test(r.stdout) && await count('pushLog') === 0, 'CLI: --mode live senza REMINDERS_ALLOW_LIVE=yes → dry-run, nessuna scrittura');
  check(cli(['--target', 'production']).status === 2, 'CLI: --target production con l\'emulatore impostato → rifiuto');
  check(cli(['--target', 'emulator', '--only-uid', '../x']).status === 2, 'CLI: --only-uid non valido → rifiuto');
}

if (problems.length) { console.log('\n✖ PROBLEMI:\n' + problems.map((p) => '  - ' + p).join('\n')); process.exit(1); }
console.log('\n✔ Script dei promemoria OK');
process.exit(0);
