#!/usr/bin/env node
// BACKUP in SOLA LETTURA di tutto Firestore (collezioni radice + sottocollezioni a qualunque profondità).
//   node export-firestore.mjs [--out <file>]
// Output: JSON con documenti indicizzati per percorso completo; i tipi Firestore sono codificati
// ({"__t":"ts",...}) così il ripristino è senza perdite. Il file contiene dati personali: NON committarlo.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Timestamp, GeoPoint, DocumentReference } from './creds.mjs';
import { adminDb, PROJECT_ID, whoami } from './creds.mjs';

const args = process.argv.slice(2);
const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : `${repoRoot}/backup/firestore-${ymd}.json`);

export function encode(v) {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Timestamp) return { __t: 'ts', s: v.seconds, n: v.nanoseconds };
  if (v instanceof GeoPoint) return { __t: 'geo', lat: v.latitude, lng: v.longitude };
  if (v instanceof DocumentReference) return { __t: 'ref', path: v.path };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { __t: 'bytes', b64: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(encode);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
}

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
