// Unit test delle scadenze (js/deadlines.js). Uso: node --test tests/unit/deadlines.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectDeadlines, advanceDue, deadlineFromForm, DEADLINE_KINDS, deadlineKind } from '../../js/deadlines.js';

const V = [
  { id: 'v1', plate: 'AB123CD', model: 'Panda', bollo: '2027-01-31', revisione: '2026-12-01', assicurazione: '2027-03-15', assicurazioneCompany: 'Allianz' },
  { id: 'v2', plate: 'ZZ999ZZ', model: 'Vecchia', frozen: true, bollo: '2027-02-01' },
];
const C = [
  { id: 'd1', kind: 'ztl', label: 'Permesso ZTL Milano', vehicleId: 'v1', due: '2027-01-10', repeatMonths: 12 },
  { id: 'd2', kind: 'estintore', label: '', vehicleId: null, due: '2026-12-20' },
  { id: 'd3', kind: 'telepass', label: 'Telepass', vehicleId: 'v2', due: '2026-12-02' },     // veicolo congelato
  { id: 'd4', kind: 'sconosciuto', label: 'Strana', due: '2027-05-05' },
  { id: 'd5', kind: 'altro', label: 'Data rotta', due: '05/05/2027' },
];

test('lista unica ordinata: veicoli + personalizzate, esclusi congelati e date non valide', () => {
  const items = collectDeadlines(V, C);
  assert.deepEqual(items.map((i) => i.key), ['v1-revisione', 'dl-d2', 'dl-d1', 'v1-bollo', 'v1-assicurazione', 'dl-d4']);
  const est = items.find((i) => i.key === 'dl-d2');
  assert.equal(est.label, 'Estintore', 'etichetta vuota → nome del tipo');
  assert.equal(est.vehicle, null, 'scadenza di tutto il garage');
  assert.equal(items.find((i) => i.key === 'dl-d4').icon, '📌', 'tipo sconosciuto → "Altro"');
  assert.equal(items.find((i) => i.key === 'v1-assicurazione').label, 'Assicurazione Allianz');
});

test('filtro per veicolo: solo le sue (le scadenze di tutto il garage escluse)', () => {
  assert.deepEqual(collectDeadlines(V, C, { vehicleId: 'v1' }).map((i) => i.key), ['v1-revisione', 'dl-d1', 'v1-bollo', 'v1-assicurazione']);
});

test('ricorrenza: +N mesi con fine mese e cambio d\'anno', () => {
  assert.equal(advanceDue('2027-01-10', 12), '2028-01-10');
  assert.equal(advanceDue('2027-01-31', 1), '2027-02-28');
  assert.equal(advanceDue('2028-01-31', 1), '2028-02-29', 'bisestile');
  assert.equal(advanceDue('2026-11-30', 3), '2027-02-28');
  assert.equal(advanceDue('2026-12-15', 6), '2027-06-15');
  assert.equal(advanceDue('2026-08-31', 120), '2036-08-31');
});

test('modulo → documento: numeri veri, null per i vuoti, limiti', () => {
  assert.deepEqual(deadlineFromForm({ kind: 'ztl', label: '  ZTL  ', vehicleId: '', due: '2027-01-10', repeatMonths: '12', cost: '80,5', note: ' x ' }),
    { kind: 'ztl', label: 'ZTL', vehicleId: null, due: '2027-01-10', repeatMonths: 12, cost: 80.5, note: 'x' });
  const d = deadlineFromForm({ kind: 'boh', label: '', vehicleId: 'v1', due: '2027-01-10', repeatMonths: '', cost: '', note: '' });
  assert.equal(d.kind, 'altro');
  assert.equal(d.label, 'Altro');
  assert.equal(d.repeatMonths, null);
  assert.equal(d.cost, null);
  assert.equal(deadlineFromForm({ kind: 'ztl', due: '2027-01-01', cost: '-5' }).cost, null);
  assert.equal(deadlineFromForm({ kind: 'ztl', due: '2027-01-01', repeatMonths: '0' }).repeatMonths, null);
  assert.equal(deadlineFromForm({ kind: 'ztl', due: '2027-01-01', label: 'x'.repeat(80) }).label.length, 60);
});

test('i tipi del client coincidono con quelli ammessi dalle regole', () => {
  const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  const m = rules.match(/function deadlineKinds\(\) \{\s*return \[([^\]]*)\]/);
  assert.ok(m, 'deadlineKinds() nelle regole');
  const ruleKinds = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  assert.deepEqual(DEADLINE_KINDS.map((k) => k.id).sort(), ruleKinds);
  assert.equal(deadlineKind('ztl').label, 'Permesso ZTL');
});
