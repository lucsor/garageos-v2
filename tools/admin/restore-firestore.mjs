#!/usr/bin/env node
// RIPRISTINO da backup JSON (export-firestore.mjs). DRY RUN di default.
//   node restore-firestore.mjs --target emulator   [--file <backup.json>] [--only <prefisso>] [--apply]
//   node restore-firestore.mjs --target production [--file <backup.json>] [--only <prefisso>] [--apply]
// - Riscrive ogni documento del backup ESATTAMENTE com'era (set completo, tipi preservati).
// - NON cancella i documenti creati dopo il backup (es. invites/*): li elenca soltanto.
// - --only limita il ripristino a un prefisso di percorso (es. garages/<gid> oppure users/<uid>).
// - --target emulator richiede FIRESTORE_EMULATOR_HOST; --target production lo vieta (niente scambi accidentali).
import { adminDb, PROJECT_ID, whoami } from './creds.mjs';
import { loadBackup, latestBackup, decode, encode } from './restore-lib.mjs';
import { isDeepStrictEqual } from 'node:util';

const argv = process.argv.slice(2);
const opt = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
const target = opt('--target');
const file = opt('--file') || latestBackup();
const only = opt('--only');
const APPLY = argv.includes('--apply');
const emu = !!process.env.FIRESTORE_EMULATOR_HOST;
if (!['emulator', 'production'].includes(target)) { console.error('Specifica --target emulator|production'); process.exit(2); }
if (target === 'emulator' && !emu) { console.error('--target emulator richiede FIRESTORE_EMULATOR_HOST'); process.exit(2); }
if (target === 'production' && emu) { console.error('--target production con FIRESTORE_EMULATOR_HOST impostato: rifiuto'); process.exit(2); }

const { meta, documents } = loadBackup(file);
const db = adminDb();
const paths = Object.keys(documents).filter((p) => !only || p === only || p.startsWith(only + '/')).sort();
console.log(`Ripristino ${file}\n  export del ${meta.exportedAt} → ${target.toUpperCase()} (${PROJECT_ID}) come ${whoami()} — ${APPLY ? 'APPLY' : 'DRY RUN'}`);

let same = 0, changed = 0, missing = 0;
const changedList = [];
for (const p of paths) {
  const cur = await db.doc(p).get();
  if (!cur.exists) { missing++; changedList.push(`  + ${p} (mancante, verrà ricreato)`); continue; }
  if (isDeepStrictEqual(encode(cur.data()), documents[p])) same++;
  else { changed++; changedList.push(`  ~ ${p} (diverso dal backup, verrà riportato com'era)`); }
}
console.log(`Documenti nel backup${only ? ` (filtro ${only})` : ''}: ${paths.length} · identici: ${same} · diversi: ${changed} · mancanti: ${missing}`);
changedList.slice(0, 50).forEach((l) => console.log(l));

// documenti esistenti NON presenti nel backup: solo elencati
async function walk(cols, acc) {
  for (const c of cols) for (const r of await c.listDocuments()) {
    if ((!only || r.path.startsWith(only)) && !(r.path in documents) && (await r.get()).exists) acc.push(r.path);
    await walk(await r.listCollections(), acc);
  }
  return acc;
}
const extra = await walk(only ? [] : await db.listCollections(), []);
if (extra.length) console.log(`Documenti presenti ora ma non nel backup (NON cancellati): ${extra.length}\n` + extra.slice(0, 30).map((p) => '  · ' + p).join('\n'));

if (!APPLY) { console.log('\nDRY RUN: nessuna scrittura.'); process.exit(0); }
const toWrite = paths.filter((p) => changedList.some((l) => l.includes(` ${p} `)));
for (let i = 0; i < toWrite.length; i += 400) {
  const batch = db.batch();
  toWrite.slice(i, i + 400).forEach((p) => batch.set(db.doc(p), decode(documents[p], db)));
  await batch.commit();
}
console.log(`\n✔ Scritti ${toWrite.length} documenti (gli identici non sono stati toccati).`);
