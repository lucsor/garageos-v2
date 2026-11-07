#!/usr/bin/env node
// BACKUP in SOLA LETTURA di tutto Firestore (collezioni radice + sottocollezioni a qualunque profondità).
//   node export-firestore.mjs [--out <file>]
// Output: JSON con documenti indicizzati per percorso completo; i tipi Firestore sono codificati
// ({"__t":"ts",...}) così il ripristino è senza perdite. Il file contiene dati personali: NON committarlo.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKUP_DIR } from './creds.mjs';
import { encode } from './restore-lib.mjs';
import { adminDb, PROJECT_ID, whoami } from './creds.mjs';

const args = process.argv.slice(2);
const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const out = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : `${BACKUP_DIR}/firestore-${ymd}.json`);


const db = adminDb();
const documents = {};
const counts = {};
async function walk(collections) {
  for (const col of collections) {
    const key = col.path.replace(/\/[^/]+\/(?=[^/]+$)/g, '/*/');   // garages/abc/vehicles → garages/*/vehicles
    // listDocuments include anche i documenti "fantasma" (solo sottocollezioni, senza campi)
    const refs = await col.listDocuments();
    for (const ref of refs) {
      const snap = await ref.get();
      if (snap.exists) {
        documents[ref.path] = encode(snap.data());
        counts[key] = (counts[key] || 0) + 1;
      } else {
        counts[key + ' (solo sottocollezioni)'] = (counts[key + ' (solo sottocollezioni)'] || 0) + 1;
      }
      await walk(await ref.listCollections());
    }
  }
}

console.log(`Export Firestore ${PROJECT_ID} come ${whoami()} (sola lettura)…`);
await walk(await db.listCollections());
mkdirSync(dirname(out), { recursive: true });
const payload = { meta: { projectId: PROJECT_ID, exportedAt: new Date().toISOString(), by: whoami(), format: 'garageos-export/1', counts }, documents };
writeFileSync(out, JSON.stringify(payload, null, 1));
console.log('File:', out);
console.log('Documenti per collezione:');
for (const [k, n] of Object.entries(counts).sort()) console.log(`  ${k.padEnd(40)} ${n}`);
console.log(`  ${'TOTALE'.padEnd(40)} ${Object.keys(documents).length}`);
