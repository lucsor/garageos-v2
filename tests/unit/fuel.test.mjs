// Unit test di js/fuel.js (rifornimenti, consumi, spese annue). Uso: node --test tests/unit/fuel.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseDecimal, parseKm, toNum, refuelFromForm, sortRefuels, consumption, spendingRows, totalsByYear,
  refuelCsvRows, spendingCsvRows, csvNum, fmtNum, yearOf, LIMITS, deadlineExtras,
  paymentPrefill, paymentFromForm, paymentExtras, PAYMENT_LIMITS,
} from '../../js/fuel.js';
import { collectDeadlines } from '../../js/deadlines.js';

const r = (id, date, km, liters, amount, full = true, extra = {}) => ({ id, vehicleId: 'v1', date, km, liters, amount, full, ...extra });
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('parseDecimal: virgola o punto, un solo separatore, ambigui respinti', () => {
  assert.equal(parseDecimal('1,5'), 1.5);
  assert.equal(parseDecimal('1.5'), 1.5);
  assert.equal(parseDecimal(' 62,40 '), 62.4);
  assert.equal(parseDecimal('70'), 70);
  assert.equal(parseDecimal(''), null);
  assert.equal(parseDecimal(null), null);
  for (const bad of ['1.500,5', '1,500.5', '1.500.000', '1,2,3', 'abc', '-5', '1e3', '12,345', ',5', '5,']) {
    assert.ok(Number.isNaN(parseDecimal(bad)), bad);
  }
  assert.equal(parseDecimal('38,567', 3), 38.567);           // litri: fino a 3 decimali
  assert.ok(Number.isNaN(parseDecimal('1.500')));             // importo: "1.500" ambiguo (1500 € o 1,5 €?)
});

test('parseKm: interi, migliaia col punto ammesse, decimali respinti', () => {
  assert.equal(parseKm('45000'), 45000);
  assert.equal(parseKm('45.000'), 45000);
  assert.equal(parseKm('1.234.567'), 1234567);
  assert.equal(parseKm('0'), 0);
  assert.equal(parseKm(''), null);
  for (const bad of ['45000,5', '45.00', '4.5', '-10', 'km', '45,000']) assert.ok(Number.isNaN(parseKm(bad)), bad);
  assert.equal(parseKm(12000), 12000);
  assert.ok(Number.isNaN(parseKm(12.5)));
});

test('toNum: tollera i valori legacy salvati come stringa', () => {
  assert.equal(toNum(42), 42);
  assert.equal(toNum('42'), 42);
  assert.equal(toNum('42,5'), 42.5);
  assert.equal(toNum('42.5'), 42.5);
  assert.equal(toNum(''), null);
  assert.equal(toNum(undefined), null);
  assert.equal(toNum({}), null);
  assert.equal(toNum(NaN), null);
});

test('refuelFromForm: produce solo numeri, pieno di default, errori chiari', () => {
  const ok = refuelFromForm({ vehicleId: 'v1', date: '2026-11-07', km: '45.000', liters: '38,5', amount: '62,40', note: '  Q8  ' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.doc, { vehicleId: 'v1', date: '2026-11-07', km: 45000, liters: 38.5, amount: 62.4, full: true, note: 'Q8' });
  for (const k of ['km', 'liters', 'amount']) assert.equal(typeof ok.doc[k], 'number');
  assert.equal(refuelFromForm({ vehicleId: 'v1', date: '2026-11-07', km: '', liters: '10', amount: '15', full: false }).doc.km, null);
  assert.equal(refuelFromForm({ vehicleId: 'v1', date: '2026-11-07', km: '1', liters: '10', amount: '15', full: false }).doc.full, false);
  const bad = refuelFromForm({ vehicleId: '', date: 'ieri', km: '45000,5', liters: '0', amount: '1.500,5', note: 'x'.repeat(LIMITS.noteMax + 1) });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['amount', 'date', 'km', 'liters', 'note', 'vehicleId']);
  assert.equal(refuelFromForm({ vehicleId: 'v1', date: '2026-11-07', liters: '', amount: '' }).ok, false);
  assert.equal(refuelFromForm({ vehicleId: 'v1', date: '2026-11-07', liters: '501', amount: '1' }).errors.liters.includes('500'), true);
});

test('consumi: pieno, parziale, pieno → litri e importi sommati dopo il primo pieno', () => {
  const c = consumption([
    r('a', '2026-01-01', 10000, 40, 70),
    r('b', '2026-01-10', 10300, 20, 36, false),
    r('c', '2026-01-20', 10800, 20, 40),
  ]);
  assert.equal(c.segments.length, 1);
  assert.equal(c.measuredKm, 800);
  assert.equal(c.measuredLiters, 40);
  assert.equal(c.measuredAmount, 76);
  assert.equal(c.kmPerL, 20);
  near(c.eurPerKm, 0.095);
  near(c.l100km, 5);
  assert.equal(c.totalLiters, 80);
  assert.equal(c.totalAmount, 146);
  near(c.pricePerL, 146 / 80);
});

test('consumi: un solo pieno (o solo parziali) → non calcolabile', () => {
  assert.equal(consumption([r('a', '2026-01-01', 10000, 40, 70)]).kmPerL, null);
  const p = consumption([r('a', '2026-01-01', 10000, 40, 70, false), r('b', '2026-01-05', 10400, 20, 35, false)]);
  assert.equal(p.kmPerL, null);
  assert.equal(p.eurPerKm, null);
  assert.equal(consumption([]).kmPerL, null);
  const pend = consumption([r('a', '2026-01-01', 10000, 40, 70), r('b', '2026-01-05', 10400, 20, 35, false)]);
  assert.equal(pend.pendingLiters, 20);
});

test('consumi: i parziali PRIMA del primo pieno non contano', () => {
  const c = consumption([
    r('p', '2025-12-20', 9500, 15, 27, false),
    r('a', '2026-01-01', 10000, 40, 70),
    r('c', '2026-01-20', 10600, 30, 54),
  ]);
  assert.equal(c.measuredLiters, 30);
  assert.equal(c.kmPerL, 20);
});

test('consumi: più tratti → media pesata (km totali / litri totali), non media delle medie', () => {
  const c = consumption([
    r('a', '2026-01-01', 0, 10, 10), r('b', '2026-01-02', 100, 10, 10),   // 10 km/l
    r('c', '2026-01-03', 1100, 50, 50),                                      // 20 km/l
  ]);
  assert.equal(c.segments.filter((s) => s.valid).length, 2);
  near(c.kmPerL, 1100 / 60);
});

test('consumi: km in calo segnalati, tratto scartato, la catena riparte', () => {
  const c = consumption([
    r('a', '2026-01-01', 10000, 40, 70),
    r('b', '2026-01-10', 9000, 40, 70),          // errore di battitura: km in calo
    r('c', '2026-01-20', 9800, 40, 70),
  ]);
  assert.deepEqual(c.flags, { b: ['km_regression'] });
  assert.equal(c.segments[0].valid, false);
  assert.equal(c.segments[0].reason, 'km_regression');
  assert.equal(c.segments[1].valid, true);         // b → c: 800 km / 40 l
  assert.equal(c.kmPerL, 20);
});

test('consumi: pieno senza km interrompe la catena; ordine di inserimento ininfluente', () => {
  const list = [
    r('c', '2026-01-20', 10800, 20, 40),
    r('a', '2026-01-01', 10000, 40, 70),
    r('x', '2026-01-10', null, 20, 36),          // pieno senza km
    r('d', '2026-02-01', 11400, 30, 60),
  ];
  const c = consumption(list);
  assert.equal(c.segments[0].reason, 'missing_km');
  assert.equal(c.segments.length, 2);             // a→x (scartato), c→d
  assert.equal(c.measuredKm, 600);
  assert.equal(c.kmPerL, 20);
  assert.deepEqual(sortRefuels(list).map((x) => x.id), ['a', 'x', 'c', 'd']);
});

test('consumi: tratti implausibili (fuori 1–100 km/l) esclusi', () => {
  const c = consumption([r('a', '2026-01-01', 10000, 40, 70), r('b', '2026-01-10', 110000, 40, 70)]);
  assert.equal(c.segments[0].reason, 'implausible');
  assert.equal(c.kmPerL, null);
});

test('consumi: valori legacy come stringhe e stesso giorno ordinato per km', () => {
  const c = consumption([
    r('b', '2026-01-01', '10500', '25', '45'),
    r('a', '2026-01-01', '10000', '40,0', '70'),
  ]);
  assert.equal(c.kmPerL, 20);
  assert.equal(c.measuredAmount, 45);
});

test('arrotondamenti e formattazione italiana', () => {
  assert.equal(fmtNum(20, 1), '20,0');
  assert.equal(fmtNum(0.095, 3), '0,095');
  assert.equal(fmtNum(1 / 3, 2), '0,33');
  assert.equal(fmtNum(null), '—');
  assert.equal(csvNum(62.4), '62,40');
  assert.equal(csvNum(1234.5), '1234,50');      // niente separatore delle migliaia
  assert.equal(csvNum(undefined), '');
  const f = refuelFromForm({ vehicleId: 'v', date: '2026-01-01', liters: '0,1', amount: '0,2' }).doc;
  assert.equal(f.liters + f.amount, 0.30000000000000004);   // numeri veri; la somma si arrotonda solo in uscita
  const s = spendingRows({ refuels: [r('a', '2026-01-01', 1, 0.1, 0.1), r('b', '2026-01-02', 2, 0.2, 0.2)] });
  assert.equal(s.rows[0].carburante, 0.3);
});

test('spese annue: confini d\'anno dalla stringa della data (nessun fuso orario)', () => {
  assert.equal(yearOf('2025-12-31'), 2025);
  assert.equal(yearOf('2026-01-01'), 2026);
  assert.equal(yearOf(''), null);
  const { rows } = spendingRows({ refuels: [r('a', '2025-12-31', 1, 10, 20), r('b', '2026-01-01', 2, 10, 30)] });
  assert.deepEqual(rows.map((x) => [x.year, x.carburante]), [[2025, 20], [2026, 30]]);
});

test('spese annue: interventi deduplicati (mechCostInfo), scadenze pagate, carburante, extra (F2)', () => {
  const t = '2026-03-01T10:00:00.000Z';
  const mechs = [
    { id: 'm1', vehicleId: 'v1', date: '2026-03-01', createdAt: t, type: 'olio_motore', cost: '100' },
    { id: 'm2', vehicleId: 'v1', date: '2026-03-01', createdAt: t, type: 'filtro_olio', cost: '100' },   // gruppo legacy: stesso costo
    { id: 'm3', vehicleId: 'v1', date: '2026-04-01', createdAt: 'x', type: 'bollo', cost: 180 },
    { id: 'm4', vehicleId: 'v2', date: '2025-06-01', createdAt: 'y', type: 'revisione', cost: '79,00' },  // stringa con virgola: parseFloat → 79
    { id: 'm5', vehicleId: 'v2', date: '', createdAt: 'z', type: 'altro', cost: '50' },                    // senza data
  ];
  const refuels = [r('f1', '2026-05-01', 1000, 40, 70)];
  const extras = [{ vehicleId: 'v1', date: '2026-07-01', amount: 30, category: 'scadenze' }];
  const { rows, undated } = spendingRows({ mechs, refuels, extras });
  const v1 = rows.find((x) => x.year === 2026 && x.vehicleId === 'v1');
  assert.deepEqual({ i: v1.interventi, s: v1.scadenze, c: v1.carburante, t: v1.total, l: v1.liters }, { i: 100, s: 210, c: 70, t: 380, l: 40 });
  assert.equal(rows.find((x) => x.year === 2025).scadenze, 79);
  assert.equal(undated, 50);
  assert.deepEqual(totalsByYear(rows).map((y) => [y.year, y.total]), [[2025, 79], [2026, 380]]);
  assert.deepEqual(totalsByYear(rows, 'v2').map((y) => y.year), [2025]);
});

test('CSV: rifornimenti e spese con decimali alla italiana, avvisi km', () => {
  const rows = refuelCsvRows([
    r('a', '2026-01-01', 10000, 40, 70), r('b', '2026-01-10', 9000, 20.5, 36.9, false, { note: '=cmd', addedBy: 'x@y.it' }),
  ], (id) => `Veicolo ${id}`);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1].slice(0, 7), ['2026-01-01', 'Veicolo v1', '10000', '40,00', '70,00', '1,750', 'sì']);
  assert.deepEqual(rows[2].slice(2, 7), ['9000', '20,50', '36,90', '1,800', 'no']);
  assert.equal(rows[2][7], '=cmd');                // la neutralizzazione la fa csvSafe al momento del download
  assert.match(rows[2][9], /km inferiori/);
  const s = spendingCsvRows([{ year: 2026, vehicleId: 'v1', interventi: 100, scadenze: 0, carburante: 70.5, total: 170.5, liters: 40 }], () => 'AB123CD');
  assert.deepEqual(s[1], ['2026', 'AB123CD', '100,00', '0,00', '70,50', '170,50', '40,00', '0,00']);
  assert.deepEqual(s[0].slice(-3), ['Totale pagato (€)', 'Litri', 'Previsto (€)']);
});

test('i limiti del client coincidono con quelli di firestore.rules', () => {
  const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  const fn = rules.match(/function refuelOk\(d\) \{([\s\S]*?)\n    \}/)[1];
  assert.match(fn, new RegExp(`d\\.km <= ${LIMITS.kmMax}\\b`));
  assert.match(fn, new RegExp(`d\\.liters <= ${LIMITS.litersMax}\\b`));
  assert.match(fn, new RegExp(`d\\.amount <= ${LIMITS.amountMax}\\b`));
  assert.match(fn, new RegExp(`optStr\\(d, 'note', ${LIMITS.noteMax}\\)`));
});

test('"pagato" = tutto ciò che ha un importo: scadenze dei veicoli e personalizzate nell’anno della loro data', () => {
  const vehicles = [
    { id: 'v1', plate: 'AB123CD', bollo: '2026-11-20', bolloCost: 250, revisione: '2027-03-01', revisioneCost: '79,02',
      assicurazione: '2026-12-01', assicurazioneCost: 600 },
    { id: 'v2', plate: 'SOSP', frozen: true, bollo: '2026-05-01', bolloCost: 100 },                  // sospeso: escluso
    { id: 'v3', plate: 'NOCOST', bollo: '2026-05-01', revisione: '', assicurazioneCost: 300 },       // senza importo o data: niente
  ];
  const deadlines = [
    { id: 'd1', kind: 'ztl', label: 'ZTL', vehicleId: 'v1', due: '2027-01-15', cost: 80.5 },
    { id: 'd2', kind: 'patente', label: 'Patente', vehicleId: null, due: '2028-06-01', cost: 120 },   // tutto il garage
    { id: 'd3', kind: 'altro', label: 'Senza importo', vehicleId: 'v1', due: '2026-12-24', cost: null },
  ];
  // bollo 2026 già pagato a mano (intervento "Bollo" nello stesso anno) → la scadenza del veicolo non si conta due volte
  const mechs = [{ id: 'm1', vehicleId: 'v1', type: 'bollo', date: '2026-11-10', cost: 250 }];
  const extras = deadlineExtras(collectDeadlines(vehicles, deadlines), mechs);
  const key = (e) => `${e.vehicleId}|${e.date}|${e.amount}`;
  assert.deepEqual(extras.map(key).sort(), ['v1|2026-12-01|600', 'v1|2027-01-15|80.5', 'v1|2027-03-01|79.02', '|2028-06-01|120'].sort());
  const { rows } = spendingRows({ mechs, refuels: [r('f1', '2026-10-01', 1000, 40, 70)], extras });
  const years = totalsByYear(rows);
  assert.deepEqual(years.map((y) => [y.year, y.scadenze, y.carburante, y.total]),
    [[2026, 850, 70, 920], [2027, 159.52, 0, 159.52], [2028, 120, 0, 120]]);
  assert.ok(rows.some((x) => x.year === 2028 && x.vehicleId === ''), 'scadenza di tutto il garage: riga senza veicolo');
  // importo legacy ambiguo ("1.500") ignorato, come nell'inserimento
  assert.equal(deadlineExtras(collectDeadlines([{ id: 'v9', assicurazione: '2026-01-01', assicurazioneCost: '1.500' }], [])).length, 0);
});

test('pagamenti del "✅ Fatto": precompilazione, modulo, spese annue, limiti = regole', () => {
  assert.equal(paymentPrefill(80.5), '80,5');
  assert.equal(paymentPrefill('80,50'), '80,5');
  assert.equal(paymentPrefill(null), '');
  assert.equal(paymentPrefill(0), '');
  assert.deepEqual(paymentFromForm({ amount: '80,50', date: '2026-11-08' }), { ok: true, amount: 80.5, date: '2026-11-08' });
  assert.deepEqual(paymentFromForm({ amount: '', date: '2026-11-08' }), { ok: true, amount: null, date: null });
  assert.deepEqual(paymentFromForm({ amount: '0', date: '' }), { ok: true, amount: null, date: null });
  assert.equal(paymentFromForm({ amount: '1.500,5', date: '2026-11-08' }).ok, false);
  assert.equal(paymentFromForm({ amount: '80', date: '' }).ok, false);
  assert.equal(paymentFromForm({ amount: '1000001', date: '2026-11-08' }).ok, false);
  const ex = paymentExtras([{ vehicleId: 'v1', date: '2026-11-08', amount: 80.5 }, { vehicleId: null, date: '2027-01-02', amount: 30 },
    { vehicleId: 'v1', date: '', amount: 10 }, { vehicleId: 'v1', date: '2026-01-01', amount: 0 }]);
  assert.deepEqual(ex, [{ vehicleId: 'v1', date: '2026-11-08', amount: 80.5, category: 'scadenze', planned: false },
    { vehicleId: '', date: '2027-01-02', amount: 30, category: 'scadenze', planned: false }]);
  const { rows } = spendingRows({ extras: ex });
  assert.equal(rows.find((r) => r.year === 2026 && r.vehicleId === 'v1').scadenze, 80.5);
  const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  assert.ok(rules.includes(`d.amount > 0 && d.amount <= ${PAYMENT_LIMITS.amountMax}`), 'limite importo = paymentOk()');
});
