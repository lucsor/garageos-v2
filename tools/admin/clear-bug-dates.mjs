#!/usr/bin/env node
// PULIZIA delle date riempite dal vecchio bug di openModal (fino alla v2.6.0 ogni campo data vuoto diventava "oggi"):
// svuota bollo / revisione / assicurazione di un veicolo quando sono UGUALI al giorno di creazione del veicolo.
// DRY RUN di default: mostra cosa cambierebbe e non scrive nulla.
//   node clear-bug-dates.mjs --target emulator   [--only garages/<g>/vehicles/<v>] [--apply]
//   node clear-bug-dates.mjs --target production [--only garages/<g>/vehicles/<v>] [--apply]
// - "Giorno di creazione" = data di createdAt in UTC oppure in ora italiana (il bug usava la data locale del telefono).
// - Il valore scritto è "" (stringa vuota), lo stesso che l'app salva per una data lasciata vuota.
// - Con --apply ogni veicolo si aggiorna in una transazione che RICONTROLLA il valore: se nel frattempo qualcuno
//   ha cambiato la data, quel campo non viene toccato.
// - Non tocca importi, km, "km al", né altri documenti. Prima di --apply in produzione: backup fresco (docs/DEPLOY.md).
import { adminDb, PROJECT_ID, whoami } from './creds.mjs';

const FIELDS = ['bollo', 'revisione', 'assicurazione'];
const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const target = arg('--target');
const only = arg('--only');
const APPLY = argv.includes('--apply');
const emu = !!process.env.FIRESTORE_EMULATOR_HOST;
if (!['emulator', 'production'].includes(target)) { console.error('Specifica --target emulator|production'); process.exit(2); }
if (target === 'emulator' && !emu) { console.error('--target emulator richiede FIRESTORE_EMULATOR_HOST'); process.exit(2); }
if (target === 'production' && emu) { console.error('--target production con FIRESTORE_EMULATOR_HOST impostato: rifiuto'); process.exit(2); }
if (only && !/^garages\/[^/]+\/vehicles\/[^/]+$/.test(only)) { console.error('--only deve essere garages/<g>/vehicles/<v>'); process.exit(2); }

// createdAt può essere una stringa ISO (app) o un Timestamp (admin): restituisce i giorni possibili 'AAAA-MM-GG'
export function creationDays(createdAt) {
  let d = null;
  if (typeof createdAt === 'string' && createdAt) d = new Date(createdAt);
  else if (createdAt?.toDate) d = createdAt.toDate();
  if (!d || Number.isNaN(d.getTime())) return [];
  const utc = d.toISOString().slice(0, 10);
  const rome = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(d);
  return [...new Set([utc, rome])];
}
export function bugFields(v) {
  const days = creationDays(v.createdAt);
  return FIELDS.filter((f) => typeof v[f] === 'string' && v[f] && days.includes(v[f]));
}

const db = adminDb();
console.log(`Pulizia date del bug — ${target.toUpperCase()} (${PROJECT_ID}) come ${whoami()} — ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);
const refs = only ? [db.doc(only)] : (await Promise.all((await db.collection('garages').listDocuments())
  .map((g) => g.collection('vehicles').listDocuments()))).flat();
const plan = [];
for (const ref of refs) {
  const snap = await ref.get();
  if (!snap.exists) { console.log(`  ${ref.path}: non esiste`); continue; }
  const v = snap.data();
  const fields = bugFields(v);
  if (!fields.length) continue;
  plan.push({ ref, fields, before: Object.fromEntries(fields.map((f) => [f, v[f]])) });
  console.log(`  ${ref.path}  ${v.plate || ''}  creato ${creationDays(v.createdAt).join('/')}  →  svuota ${fields.map((f) => `${f} (${v[f]})`).join(', ')}`);
}
console.log(`\n${plan.length} veicoli, ${plan.reduce((n, p) => n + p.fields.length, 0)} campi da svuotare.`);
if (!APPLY) { console.log('DRY RUN: nessuna scrittura. Aggiungi --apply per scrivere.'); process.exit(0); }

let written = 0, skipped = 0;
for (const p of plan) {
  await db.runTransaction(async (tx) => {
    const cur = (await tx.get(p.ref)).data() || {};
    const upd = {};
    for (const f of p.fields) { if (cur[f] === p.before[f]) upd[f] = ''; else skipped++; }
    if (Object.keys(upd).length) { tx.update(p.ref, upd); written += Object.keys(upd).length; }
  });
}
console.log(`✔ Applicato: ${written} campi svuotati${skipped ? `, ${skipped} saltati perché cambiati nel frattempo` : ''}.`);
const again = (await Promise.all(plan.map((p) => p.ref.get()))).filter((s) => bugFields(s.data()).length).length;
console.log(again ? `✖ Verifica: ${again} veicoli hanno ancora date del bug` : '✔ Verifica post-scrittura: nessuna data del bug rimasta');
