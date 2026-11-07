// Logica della migrazione mirata v1 → v2 (riusata dalla CLI e dai test sull'emulatore).
// Per ogni uid confermato: aggiunge l'uid a garages/{gid}.memberUids e fa puntare users/{uid} a gid.
// Non tocca nessun altro campo né documento. Idempotente.
import { FieldValue } from '@google-cloud/firestore';

/**
 * @param db     Firestore (admin)
 * @param gid    garage di destinazione
 * @param uids   uid da migrare
 * @param lookupUser async uid => ({ email, displayName } | null)   (Auth)
 * @param opts   { force }  salta i controlli "era membro v1" e "puntatore già su un altro garage condiviso"
 * @returns { ok, errors[], garage: {before, after, changed}, users: [{uid, exists, before, after, changed}] }
 */
export async function planMigration(db, gid, uids, lookupUser, opts = {}) {
  const errors = [];
  const gref = db.doc(`garages/${gid}`);
  const gsnap = await gref.get();
  if (!gsnap.exists) return { ok: false, errors: [`garages/${gid} non esiste`] };
  const g = gsnap.data();
  const before = g.memberUids || [];
  const legacy = g.members || [];
  const toAdd = [];
  const users = [];

  for (const uid of [...new Set(uids)]) {
    if (uid === gid) { errors.push(`${uid}: è il proprietario del garage`); continue; }
    const auth = await lookupUser(uid);
    if (!auth) { errors.push(`${uid}: non esiste in Firebase Auth`); continue; }
    const wasV1 = legacy.some((m) => m.status === 'active' && (m.uid === uid || (m.email || '').toLowerCase() === (auth.email || '').toLowerCase()));
    if (!wasV1 && !opts.force) { errors.push(`${uid} (${auth.email}): non risulta membro attivo in members[] di questo garage (usa --force se sei sicuro)`); continue; }
    if (!before.includes(uid)) toAdd.push(uid);

    const uref = db.doc(`users/${uid}`);
    const usnap = await uref.get();
    const ub = usnap.exists ? usnap.data() : null;
    if (ub?.garageId && ub.garageId !== gid && ub.garageId !== uid && !opts.force) {
      const other = await db.doc(`garages/${ub.garageId}`).get();
      if (other.exists && (other.data().memberUids || []).includes(uid)) {
        errors.push(`${uid}: users.garageId punta già a un altro garage condiviso (${ub.garageId}); non lo sposto senza --force`);
        continue;
      }
    }
    const after = ub ? { ...ub, garageId: gid } : { garageId: gid, email: auth.email || '', name: (auth.displayName || auth.email || '').slice(0, 100) };
    users.push({ uid, email: auth.email, exists: !!ub, before: ub, after, changed: !ub || ub.garageId !== gid });
  }
  if (before.length + toAdd.length > 20) errors.push(`memberUids supererebbe 20 elementi (${before.length + toAdd.length})`);

  return {
    ok: errors.length === 0, errors,
    garage: { path: gref.path, before, after: [...before, ...toAdd], toAdd, changed: toAdd.length > 0 },
    users,
  };
}

/** Applica il piano in UNA transazione, ricontrollando lo stato (idempotente). */
export async function applyMigration(db, gid, plan) {
  if (!plan.ok) throw new Error('Piano non valido: ' + plan.errors.join('; '));
  return db.runTransaction(async (tx) => {
    const gref = db.doc(`garages/${gid}`);
    const g = await tx.get(gref);
    const urefs = plan.users.map((u) => db.doc(`users/${u.uid}`));
    const usnaps = await Promise.all(urefs.map((r) => tx.get(r)));
    const current = g.data().memberUids || [];
    const missing = plan.garage.toAdd.filter((u) => !current.includes(u));
    if (missing.length) tx.update(gref, { memberUids: FieldValue.arrayUnion(...missing) });   // SOLO memberUids
    plan.users.forEach((u, i) => {
      if (!usnaps[i].exists) tx.create(urefs[i], u.after);                                  // nuovo: garageId, email, name
      else if (usnaps[i].data().garageId !== gid) tx.update(urefs[i], { garageId: gid });     // esistente: SOLO garageId
    });
    return { garageUpdated: missing.length, usersCreated: usnaps.filter((s) => !s.exists).length,
             usersUpdated: plan.users.filter((u, i) => usnaps[i].exists && usnaps[i].data().garageId !== gid).length };
  });
}

export function printPlan(plan, label = (u) => u) {
  const lines = [];
  if (plan.errors?.length) { lines.push('✖ ERRORI (nessuna scrittura possibile):'); plan.errors.forEach((e) => lines.push('  - ' + e)); }
  if (!plan.garage) return lines.join('\n');
  lines.push(`\n${plan.garage.path}`);
  if (!plan.garage.changed) lines.push('  = memberUids già aggiornato, nessuna modifica');
  else {
    lines.push(`  - memberUids: [${plan.garage.before.map(label).join(', ')}]`);
    lines.push(`  + memberUids: [${plan.garage.after.map(label).join(', ')}]`);
  }
  lines.push('  (tutti gli altri campi del garage: invariati)');
  for (const u of plan.users) {
    lines.push(`\nusers/${label(u.uid)}  (${u.email})`);
    if (!u.changed) lines.push('  = garageId già corretto, nessuna modifica');
    else if (!u.exists) { lines.push('  documento NON esiste → CREATE'); for (const [k, v] of Object.entries(u.after)) lines.push(`  + ${k}: ${JSON.stringify(k === 'garageId' ? label(v) : v)}`); }
    else lines.push(`  - garageId: ${label(u.before.garageId)}\n  + garageId: ${label(u.after.garageId)}   (UPDATE solo di questo campo)`);
  }
  return lines.join('\n');
}
