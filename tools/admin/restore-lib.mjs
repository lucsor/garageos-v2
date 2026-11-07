// Lettura/decodifica dei backup JSON prodotti da export-firestore.mjs (formato garageos-export/1).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Timestamp, GeoPoint, DocumentReference } from '@google-cloud/firestore';
import { BACKUP_DIR } from './creds.mjs';

export function latestBackup(prefix = 'firestore-', dir = BACKUP_DIR) {
  const f = readdirSync(dir).filter((x) => x.startsWith(prefix) && x.endsWith('.json')).sort().pop();
  if (!f) throw new Error(`Nessun backup ${prefix}*.json in ${dir}`);
  return join(dir, f);
}

export function loadBackup(file = latestBackup()) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (data.meta?.format !== 'garageos-export/1') throw new Error('Formato backup non riconosciuto: ' + file);
  return data;
}

/** Decodifica i tipi codificati ({__t:...}). `T` permette di usare i tipi dell'SDK client nei test. */
export function decode(v, db, T = { Timestamp, GeoPoint }) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => decode(x, db, T));
  switch (v.__t) {
    case 'ts': return new T.Timestamp(v.s, v.n);
    case 'geo': return new T.GeoPoint(v.lat, v.lng);
    case 'ref': return db.doc(v.path);
    case 'bytes': return Buffer.from(v.b64, 'base64');
    default: return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x, db, T)]));
  }
}

// Codifica dei tipi Firestore per il JSON (inverso di decode)
export function encode(v) {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Timestamp) return { __t: 'ts', s: v.seconds, n: v.nanoseconds };
  if (v instanceof GeoPoint) return { __t: 'geo', lat: v.latitude, lng: v.longitude };
  if (v instanceof DocumentReference) return { __t: 'ref', path: v.path };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { __t: 'bytes', b64: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(encode);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
}
