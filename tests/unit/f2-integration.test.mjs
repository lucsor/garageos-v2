// Unit test dell'integrazione F2 (scadenze personalizzate) nel calendario .ics e nei promemoria push.
// Uso: node --test tests/unit/f2-integration.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deadlineEvents, customDeadlineEvent, buildICS } from '../../js/ics.js';
import { customDeadlines, vehicleDeadlines, planForUser, normalizePrefs, buildMessage } from '../../tools/admin/reminders-lib.mjs';

const V = [
  { id: 'v1', plate: 'AB123CD', model: 'Panda', bollo: '2027-01-31' },
  { id: 'v2', plate: 'ZZ999ZZ', model: 'Vecchia', frozen: true },
];
const C = [
  { id: 'd1', kind: 'ztl', label: 'Permesso ZTL Milano', vehicleId: 'v1', due: '2027-01-10', cost: 80.5, note: 'rinnovo online' },
  { id: 'd2', kind: 'estintore', label: 'Estintore', vehicleId: null, due: '2026-12-01', cost: null },
  { id: 'd3', kind: 'tagliando', label: 'Tagliando', vehicleId: 'v2', due: '2026-12-05' },     // veicolo congelato
  { id: 'd4', kind: 'altro', label: 'Passata', vehicleId: null, due: '2026-01-01' },           // nel passato
  { id: 'd5', kind: 'altro', label: 'Data rotta', vehicleId: null, due: '2026-02-31' },
];

test('.ics: le personalizzate future entrano nel calendario, con UID per documento', () => {
  const ev = deadlineEvents(V, { today: '2026-11-07', custom: C, icons: { ztl: '🚦', estintore: '🧯' } });
  assert.deepEqual(ev.map((e) => e.uid), ['dl-d2@garageos', 'dl-d1@garageos', 'v1-bollo@garageos']);
  assert.equal(ev[0].summary, '🧯 Estintore', 'senza veicolo: niente targa');
  assert.equal(ev[1].summary, '🚦 Permesso ZTL Milano — AB123CD');
  assert.match(ev[1].description, /Importo previsto: € 80\.5/);
  assert.ok(!/Importo|rinnovo online/.test(ev[1].publicDetails), 'link Google: né importo né note');
  const only = deadlineEvents(V, { today: '2026-11-07', custom: C, vehicleId: 'v1' });
  assert.deepEqual(only.map((e) => e.uid), ['dl-d1@garageos', 'v1-bollo@garageos'], 'filtro per veicolo: escluse quelle del garage');
  const ics = buildICS([customDeadlineEvent({ id: 'x', label: 'A; b, c', due: '2027-05-05' })]);
  assert.match(ics, /SUMMARY:📌 A\\; b\\, c/, 'testo escapato');
});

test('promemoria: personalizzate con chiave per documento, "Garage" senza veicolo, esclusi congelati e date non valide', () => {
  const dl = customDeadlines(C, V);
  assert.deepEqual(dl.map((d) => d.key), ['d:d1', 'd:d2', 'd:d4']);
  assert.equal(dl[1].plate, 'Garage');
  assert.equal(customDeadlines([{ id: 'z', label: 'x', vehicleId: 'cancellato', due: '2027-01-01' }], V).length, 0, 'veicolo eliminato: esclusa');
  assert.equal(customDeadlines([{ id: 'y', label: '  a\n\tb  '.repeat(1), due: '2027-01-01' }], V)[0].label, 'a b');
  const plan = planForUser({ uid: 'u', garageId: 'g', prefs: normalizePrefs({ enabled: true }), today: '2026-11-30', deadlines: [...vehicleDeadlines(V), ...dl] });
  assert.deepEqual(plan.map((p) => p.label), ['Estintore'], 'tra 1 giorno: solo l\'estintore');
  assert.match(buildMessage(plan).body, /^Garage · Estintore: domani/);
});
