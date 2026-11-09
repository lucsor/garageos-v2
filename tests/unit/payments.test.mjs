// Unit test di js/payments.js (registro pagamenti, v2.7.0) e del flag "previsto" di js/fuel.js.
// Uso: node --test tests/unit/payments.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paymentLedger, ledgerYears, ledgerTotal, paymentPatch, canDeletePayment, LABEL_MAX } from '../../js/payments.js';
import { deadlineExtras, paymentExtras, spendingRows, totalsByYear, spendingCsvRows } from '../../js/fuel.js';
import { collectDeadlines } from '../../js/deadlines.js';

const P = [
  { id: 'a', date: '2026-03-01', amount: 80.5, vehicleId: 'v1', label: 'ZTL', addedBy: 'bob@example.com' },
  { id: 'b', date: '2026-11-08', amount: 30, vehicleId: null, label: 'Estintore', addedBy: 'alice@example.com' },
  { id: 'c', date: '2025-12-31', amount: 10, vehicleId: 'gone', label: 'Telepass', addedBy: 'bob@example.com' },
  { id: 'd', date: '2026-11-08', amount: 5, vehicleId: 'v1', label: 'Parcheggio', addedBy: 'Bob@Example.com' },
  { id: 'e', date: '', amount: 99, vehicleId: 'v1', label: 'senza data' },
];

test('registro: più recenti prima (a parità di data, per id), righe senza data escluse', () => {
  assert.deepEqual(paymentLedger(P).map((p) => p.id), ['d', 'b', 'a', 'c']);
  assert.deepEqual(ledgerYears(P), [2026, 2025]);
});

test('registro: filtri per anno, veicolo, senza veicolo, veicoli rimossi', () => {
  assert.deepEqual(paymentLedger(P, { year: 2025 }).map((p) => p.id), ['c']);
  assert.deepEqual(paymentLedger(P, { vehicleId: 'v1' }).map((p) => p.id), ['d', 'a']);
  assert.deepEqual(paymentLedger(P, { vehicleId: '-' }).map((p) => p.id), ['b']);
  assert.deepEqual(paymentLedger(P, { vehicleId: '?', knownVehicleIds: ['v1'] }).map((p) => p.id), ['c']);
  assert.deepEqual(paymentLedger(P, { year: 2026, vehicleId: 'v1' }).map((p) => p.id), ['d', 'a']);
  assert.deepEqual(paymentLedger(P, { year: 2024 }), []);
});

test('totale in centesimi: 0,1 + 0,2 = 0,3 esatti; importi non validi ignorati', () => {
  assert.equal(ledgerTotal([{ amount: 0.1 }, { amount: 0.2 }]), 0.3);
  assert.equal(ledgerTotal([{ amount: 80.5 }, { amount: 'x' }, { amount: -3 }, { amount: null }]), 80.5);
  assert.equal(ledgerTotal(paymentLedger(P, { year: 2026 })), 115.5);
  assert.equal(ledgerTotal([]), 0);
});

test('paymentPatch: solo i campi cambiati, virgola, errori', () => {
  const o = P[0];
  assert.deepEqual(paymentPatch({ label: 'ZTL', amount: '80,50', date: '2026-03-01' }, o), { ok: true, patch: {}, changed: false });
  assert.deepEqual(paymentPatch({ label: ' ZTL ', amount: '75', date: '2026-03-01' }, o), { ok: true, patch: { amount: 75 }, changed: true });
  assert.deepEqual(paymentPatch({ label: 'ZTL Milano', amount: '80.5', date: '2026-03-02' }, o),
    { ok: true, patch: { date: '2026-03-02', label: 'ZTL Milano' }, changed: true });
  assert.equal(paymentPatch({ label: '', amount: '80', date: '2026-03-01' }, o).ok, false);
  assert.equal(paymentPatch({ label: 'x'.repeat(LABEL_MAX + 1), amount: '80', date: '2026-03-01' }, o).ok, false);
  assert.match(paymentPatch({ label: 'ZTL', amount: '', date: '2026-03-01' }, o).error, /Elimina/);
  assert.match(paymentPatch({ label: 'ZTL', amount: '0', date: '2026-03-01' }, o).error, /Elimina/);
  assert.equal(paymentPatch({ label: 'ZTL', amount: '1.500,5', date: '2026-03-01' }, o).ok, false);   // migliaia ambigue
  assert.equal(paymentPatch({ label: 'ZTL', amount: '80', date: '' }, o).ok, false);
  assert.equal(paymentPatch({ label: 'ZTL', amount: '1000001', date: '2026-03-01' }, o).ok, false);
});

test('canDeletePayment: proprietario o autore (email senza maiuscole), come le regole', () => {
  assert.equal(canDeletePayment(P[1], { isOwner: true, email: 'bob@example.com' }), true);
  assert.equal(canDeletePayment(P[0], { isOwner: false, email: 'BOB@example.com' }), true);
  assert.equal(canDeletePayment(P[3], { isOwner: false, email: 'bob@example.com' }), true);
  assert.equal(canDeletePayment(P[1], { isOwner: false, email: 'bob@example.com' }), false);
  assert.equal(canDeletePayment({ addedBy: '' }, { isOwner: false, email: '' }), false);
  assert.equal(canDeletePayment(P[0], {}), false);
});

test('pagato / previsto: scadenze future previste, passate e pagamenti pagati; CSV con la colonna Previsto', () => {
  const today = '2026-11-09';
  const vehicles = [{ id: 'v1', plate: 'AB123CD', bollo: '2026-05-01', bolloCost: 250, assicurazione: '2026-12-01', assicurazioneCost: 600 }];
  const deadlines = [{ id: 'd1', kind: 'ztl', label: 'ZTL', vehicleId: 'v1', due: '2027-01-15', cost: 80.5 }];
  const ex = deadlineExtras(collectDeadlines(vehicles, deadlines), [], today);
  const by = Object.fromEntries(ex.map((e) => [e.date, e.planned]));
  assert.deepEqual(by, { '2026-05-01': false, '2026-12-01': true, '2027-01-15': true });
  assert.ok(deadlineExtras(collectDeadlines(vehicles, deadlines), []).every((e) => e.planned === false), 'senza today: niente previsto');
  assert.ok(paymentExtras([{ date: '2027-02-01', amount: 10 }]).every((e) => e.planned === false), 'un pagamento non è mai previsto');
  const pays = paymentExtras([{ vehicleId: 'v1', date: '2026-11-08', amount: 82.3 }]);
  const { rows } = spendingRows({ extras: [...ex, ...pays] });
  const years = totalsByYear(rows);
  assert.deepEqual(years.map((y) => [y.year, y.scadenze, y.total, y.planned]), [[2026, 332.3, 332.3, 600], [2027, 0, 0, 80.5]]);
  const csv = spendingCsvRows(rows, () => 'AB123CD');
  assert.equal(csv[0].at(-1), 'Previsto (€)');
  assert.deepEqual(csv.find((r) => r[0] === '2027'), ['2027', 'AB123CD', '0,00', '0,00', '0,00', '0,00', '0,00', '80,50']);
});

test('regole: i campi modificabili dal registro coincidono con firestore.rules', () => {
  const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  const block = rules.match(/match \/payments\/\{id\} \{([\s\S]*?)\n      \}/)[1];
  assert.match(block, /touched\(\)\.hasOnly\(\['amount', 'date', 'label', 'editedBy', 'updatedAt'\]\)/);
  assert.match(rules, new RegExp(`reqStr\\(d, 'label', ${LABEL_MAX}\\)`));
});
