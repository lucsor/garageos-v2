#!/usr/bin/env node
// Invio giornaliero dei promemoria delle scadenze (GitHub Actions, piano Spark: niente Cloud Functions).
//   node send-reminders.mjs --target emulator|production [--mode dry-run|live] [--only-uid <uid>]
// Default: DRY RUN (calcola e conta, non scrive e non invia). "live" richiede anche REMINDERS_ALLOW_LIVE=yes.
// I log sono PUBBLICI (repo pubblico): si stampano solo conteggi, mai email, targhe o uid.
//
// Flusso: token (collectionGroup) → utenti con push.enabled → verifica membership del garage → scadenze →
// soglia di oggi per ciascuna → registro pushLog (create = idempotente) → UNA notifica per utente → pulizia.
import { pathToFileURL } from 'node:url';
import {
  romeToday, vehicleDeadlines, normalizePrefs, planForUser, buildMessage,
  DEAD_TOKEN_CODES, STALE_TOKEN_DAYS, LOG_RETENTION_DAYS,
} from './reminders-lib.mjs';

const DAY = 86_400_000;

// db: Firestore dell'Admin SDK; messaging: { sendEachForMulticast(msg) } (vero o finto nei test)
export async function run({ db, messaging, FieldValue, Timestamp, now = new Date(), mode = 'dry-run', onlyUid = null, log = console.log }) {
  const live = mode === 'live';
  const today = romeToday(now);
  const st = { users: 0, skippedDisabled: 0, skippedNotMember: 0, tokens: 0, notifications: 0, items: 0,
    alreadySent: 0, sendFailures: 0, deadTokensRemoved: 0, staleTokensRemoved: 0, logsPruned: 0 };

  // 1) token di tutti i dispositivi, raggruppati per utente
  const byUid = new Map();
  for (const d of (await db.collectionGroup('pushTokens').get()).docs) {
    const uid = d.ref.parent.parent.id;
    if (onlyUid && uid !== onlyUid) continue;
    const t = d.data();
    if (typeof t.token !== 'string' || !t.token) continue;
    const lastSeen = t.lastSeenAt?.toMillis?.() ?? 0;
    if (now.getTime() - lastSeen > STALE_TOKEN_DAYS * DAY) {             // dispositivo non più usato
      st.staleTokensRemoved++;
      if (live) await d.ref.delete();
      continue;
    }
    (byUid.get(uid) || byUid.set(uid, []).get(uid)).push({ ref: d.ref, token: t.token });
    st.tokens++;
  }

  const garages = new Map();     // garageId → { doc, deadlines } (letti una volta)
  async function garage(gid) {
    if (!garages.has(gid)) {
      const g = await db.doc(`garages/${gid}`).get();
      const vehicles = g.exists ? (await db.collection(`garages/${gid}/vehicles`).get()).docs.map((v) => ({ id: v.id, ...v.data() })) : [];
      garages.set(gid, { g, deadlines: vehicleDeadlines(vehicles) });
    }
    return garages.get(gid);
  }

  for (const [uid, tokens] of byUid) {
    const u = await db.doc(`users/${uid}`).get();
    const prefs = normalizePrefs(u.exists ? u.data().push : null);
    if (!prefs.enabled) { st.skippedDisabled++; continue; }
    const gid = (u.exists && u.data().garageId) || uid;
    const { g, deadlines } = await garage(gid);
    // l'utente deve essere ANCORA proprietario o membro: un users/{uid} vecchio non basta
    const member = g.exists && (gid === uid || (g.data().memberUids || []).includes(uid));
    if (!member) { st.skippedNotMember++; continue; }
    st.users++;

    const plan = planForUser({ uid, garageId: gid, prefs, deadlines, today });
    if (!plan.length) continue;

    // 2) registro: create() fallisce se l'invio di quella soglia c'è già (anche con due job in parallelo)
    const fresh = [];
    for (const it of plan) {
      const ref = db.doc(`pushLog/${it.logId}`);
      if (!live) {
        if ((await ref.get()).exists) st.alreadySent++; else fresh.push({ it, ref });
        continue;
      }
      try {
        await ref.create({ createdAt: FieldValue.serverTimestamp(), day: today, threshold: it.threshold });
        fresh.push({ it, ref });
      } catch (e) {
        if (e.code === 6 || /already exists/i.test(e.message)) st.alreadySent++; else throw e;
      }
    }
    if (!fresh.length) continue;
    st.items += fresh.length;
    st.notifications++;
    if (!live) continue;

    // 3) una sola notifica per utente, a tutti i suoi dispositivi
    const msg = buildMessage(fresh.map((f) => f.it), { details: prefs.details });
    const res = await messaging.sendEachForMulticast({
      tokens: tokens.map((t) => t.token),
      data: { title: msg.title, body: msg.body, url: './#scadenze', tag: 'garageos-reminders' },
      webpush: { headers: { Urgency: 'high', TTL: String(20 * 3600) } },
    });
    let delivered = 0;
    for (let i = 0; i < res.responses.length; i++) {
      const r = res.responses[i];
      if (r.success) { delivered++; continue; }
      st.sendFailures++;
      if (DEAD_TOKEN_CODES.has(r.error?.code)) { await tokens[i].ref.delete(); st.deadTokensRemoved++; }
    }
    // nessun dispositivo raggiunto per errori temporanei → si toglie il registro: il prossimo run riprova
    const allDead = res.responses.every((r) => !r.success && DEAD_TOKEN_CODES.has(r.error?.code));
    if (!delivered && !allDead) for (const f of fresh) await f.ref.delete();
  }

  // 4) pulizia del registro e heartbeat (solo live)
  if (live) {
    const old = await db.collection('pushLog').where('createdAt', '<', Timestamp.fromMillis(now.getTime() - LOG_RETENTION_DAYS * DAY)).limit(400).get();
    for (const d of old.docs) { await d.ref.delete(); st.logsPruned++; }
    await db.doc('pushStatus/heartbeat').set({ lastRunAt: FieldValue.serverTimestamp(), day: today, mode, notifications: st.notifications });
  }

  log(`Promemoria ${today} — ${live ? 'LIVE' : 'DRY RUN'}${onlyUid ? ' (un solo utente)' : ''}`);
  for (const [k, v] of Object.entries(st)) log(`  ${k}: ${v}`);
  return st;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const opt = (k, d = null) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const target = opt('--target');
  const mode = opt('--mode', 'dry-run');
  const onlyUid = opt('--only-uid') || null;
  const emu = !!process.env.FIRESTORE_EMULATOR_HOST;
  if (!['emulator', 'production'].includes(target)) { console.error('Specifica --target emulator|production'); process.exit(2); }
  if (target === 'emulator' && !emu) { console.error('--target emulator richiede FIRESTORE_EMULATOR_HOST'); process.exit(2); }
  if (target === 'production' && emu) { console.error('--target production con FIRESTORE_EMULATOR_HOST impostato: rifiuto'); process.exit(2); }
  if (!['dry-run', 'live'].includes(mode)) { console.error('--mode dry-run|live'); process.exit(2); }
  if (mode === 'live' && process.env.REMINDERS_ALLOW_LIVE !== 'yes') {
    console.error('Modalità live non consentita: serve REMINDERS_ALLOW_LIVE=yes (variabile del repo). Eseguo in dry-run.');
  }
  const effectiveMode = mode === 'live' && process.env.REMINDERS_ALLOW_LIVE === 'yes' ? 'live' : 'dry-run';
  if (onlyUid && !/^[A-Za-z0-9_-]{1,128}$/.test(onlyUid)) { console.error('--only-uid non valido'); process.exit(2); }

  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
  const { getMessaging } = await import('firebase-admin/messaging');
  const projectId = process.env.GCLOUD_PROJECT || 'garageos-879bc';
  const app = initializeApp(emu ? { projectId } : { credential: applicationDefault(), projectId });
  const messaging = emu
    ? { sendEachForMulticast: async () => { throw new Error('FCM non disponibile con l\'emulatore: usa --mode dry-run'); } }
    : getMessaging(app);
  try {
    await run({ db: getFirestore(app), messaging, FieldValue, Timestamp, mode: effectiveMode, onlyUid });
  } catch (e) {
    console.error('Errore:', e.code || '', String(e.message || e).slice(0, 300));   // niente dati personali nei messaggi d'errore di Firestore
    process.exit(1);
  }
}
