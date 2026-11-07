#!/usr/bin/env node
// MIGRAZIONE km / importi / anno: da stringa a number. DRY RUN di default.
//   node migrate-numbers.mjs --target emulator   [--apply]
//   node migrate-numbers.mjs --target production [--apply]      ← NON eseguire prima del task D3 (vedi docs/PIANO.md):
//      il client deve prima saper LEGGERE i numeri, altrimenti ogni modifica li riscriverebbe come stringa.
// Regole di conversione (conservative, nessuna "interpretazione"):
//  - stringa strettamente numerica ("50000", "12.5", "12,5")  → number
//  - stringa vuota o solo spazi                                 → null   (le regole accettano null; il client lo tratta come vuoto)
//  - già number / null / campo assente                          → invariato
//  - tutto il resto ("1.500", "€ 120", "circa 100")             → NON toccato, elencato come "da sistemare a mano"
// Scrive SOLO i campi convertiti (update), in batch da 400; idempotente.
import { adminDb, PROJECT_ID, whoami } from './creds.mjs';

const FIELDS = {
  vehicles: ['year', 'km', 'tagliandoInt', 'bolloCost', 'revisioneCost', 'assicurazioneCost'],
  tires: ['km', 'kmNext'],
  mechs: ['km', 'cost'],
};
const argv = process.argv.slice(2);
const target = argv.includes('--target') ? argv[argv.indexOf('--target') + 1] : null;
const APPLY = argv.includes('--apply');
const emu = !!process.env.FIRESTORE_EMULATOR_HOST;
if (!['emulator', 'production'].includes(target)) { console.error('Specifica --target emulator|production'); process.exit(2); }
if (target === 'emulator' && !emu) { console.error('--target emulator richiede FIRESTORE_EMULATOR_HOST'); process.exit(2); }
if (target === 'production' && emu) { console.error('--target production con FIRESTORE_EMULATOR_HOST impostato: rifiuto'); process.exit(2); }

export function convert(v) {
  if (v === null || v === undefined || typeof v === 'number') return { kind: 'invariato' };
  if (typeof v !== 'string') return { kind: 'tipo inatteso' };
  const t = v.trim();
  if (t === '') return { kind: 'vuoto→null', value: null };
  if (/^-?\d+(\.\d+)?$/.test(t)) return { kind: 'convertibile', value: Number(t) };
  if (/^-?\d+,\d+$/.test(t)) return { kind: 'convertibile', value: Number(t.replace(',', '.')) };
  return { kind: 'ambiguo' };
}

const db = adminDb();
console.log(`Migrazione numeri — ${target.toUpperCase()} (${PROJECT_ID}) come ${whoami()} — ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);
const stats = {};       // "vehicles.km" → {convertibile, vuoto→null, invariato, ambiguo}
const updates = [];     // {ref, data}
const manual = [];
for (const g of await db.collection('garages').listDocuments()) {
  for (const [col, fields] of Object.entries(FIELDS)) {
    for (const d of (await g.collection(col).get()).docs) {
      const data = {};
      for (const f of fields) {
        if (!(f in d.data())) continue;
        const c = convert(d.data()[f]);
        const key = `${col}.${f}`;
        stats[key] ||= { convertibile: 0, 'vuoto→null': 0, invariato: 0, ambiguo: 0, 'tipo inatteso': 0 };
        stats[key][c.kind]++;
        if ('value' in c) data[f] = c.value;
        if (c.kind === 'ambiguo' || c.kind === 'tipo inatteso') manual.push(`${d.ref.path}.${f} = ${JSON.stringify(d.data()[f])}`);
      }
      if (Object.keys(data).length) updates.push({ ref: d.ref, data });
    }
  }
}
console.log('campo'.padEnd(28), 'convertibile', 'vuoto→null', 'invariato', 'ambiguo');
for (const [k, s] of Object.entries(stats).sort()) console.log(k.padEnd(28), String(s.convertibile).padStart(12), String(s['vuoto→null']).padStart(11), String(s.invariato).padStart(9), String(s.ambiguo + s['tipo inatteso']).padStart(7));
console.log(`\nDocumenti da aggiornare: ${updates.length} · campi: ${updates.reduce((n, u) => n + Object.keys(u.data).length, 0)}`);
if (manual.length) console.log(`Da sistemare a mano (${manual.length}):\n` + manual.map((m) => '  · ' + m.replace(/garages\/([A-Za-z0-9]{6})[A-Za-z0-9]+/, 'garages/$1…')).join('\n'));
if (updates[0]) console.log(`Esempio: ${updates[0].ref.path.replace(/garages\/([A-Za-z0-9]{6})[A-Za-z0-9]+/, 'garages/$1…')} → ${JSON.stringify(updates[0].data)}`);
if (!APPLY) { console.log('\nDRY RUN: nessuna scrittura.'); process.exit(0); }
for (let i = 0; i < updates.length; i += 400) {
  const b = db.batch(); updates.slice(i, i + 400).forEach((u) => b.update(u.ref, u.data)); await b.commit();
}
console.log(`\n✔ Aggiornati ${updates.length} documenti.`);
