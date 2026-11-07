// Unit test della logica dei promemoria (tools/admin/reminders-lib.mjs). Uso: node --test tests/unit/reminders.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  romeToday, daysBetween, vehicleDeadlines, normalizePrefs, thresholdFor, planForUser, buildMessage, whenText, logId,
} from '../../tools/admin/reminders-lib.mjs';

test('oggi nel fuso di Roma (anche a cavallo della mezzanotte UTC e con l\'ora legale)', () => {
  assert.equal(romeToday(new Date('2026-11-07T06:17:00Z')), '2026-11-07');
  assert.equal(romeToday(new Date('2026-11-07T23:30:00Z')), '2026-11-08', 'in inverno Roma è UTC+1');
  assert.equal(romeToday(new Date('2026-07-07T22:30:00Z')), '2026-07-08', 'in estate Roma è UTC+2');
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
  assert.equal(daysBetween('2027-03-27', '2027-03-29'), 2, 'cambio dell\'ora');
});

test('scadenze dei veicoli: esclusi i congelati e le date non valide; targa troncata', () => {
  const dl = vehicleDeadlines([
    { id: 'v1', plate: 'AB123CD', bollo: '2026-12-01', revisione: '2027-02-31', assicurazione: '' },
    { id: 'v2', plate: 'ZZ', frozen: true, bollo: '2026-12-01' },
    { id: 'v3', plate: 'X'.repeat(40), assicurazione: '2027-01-01' },
  ]);
  assert.deepEqual(dl.map((d) => d.key), ['v:v1:bollo', 'v:v3:assicurazione']);
  assert.equal(dl[1].plate.length, 15);
});

test('preferenze: default 30/7/1, disattivate se non esplicitamente attive, dettagli sì per default', () => {
  assert.deepEqual(normalizePrefs(undefined), { enabled: false, days: [1, 7, 30], details: true });
  assert.deepEqual(normalizePrefs({ enabled: true }), { enabled: true, days: [1, 7, 30], details: true });
  assert.deepEqual(normalizePrefs({ enabled: true, days: [7, 0, 7, 500, 'x'], details: false }), { enabled: true, days: [0, 7], details: false });
});

test('soglia: la più piccola che copre i giorni mancanti; recupero dei giorni saltati; scadute da troppo escluse', () => {
  const days = [1, 7, 30];
  assert.equal(thresholdFor(45, days), null);
  assert.equal(thresholdFor(30, days), 30);
  assert.equal(thresholdFor(12, days), 30, 'tra 30 e 7: resta la 30 (già inviata o da recuperare)');
  assert.equal(thresholdFor(7, days), 7);
  assert.equal(thresholdFor(5, days), 7, 'job saltato il giorno dei 7: recupera');
  assert.equal(thresholdFor(1, days), 1);
  assert.equal(thresholdFor(0, days), 1);
  assert.equal(thresholdFor(-3, days), 1, 'scaduta da poco: una notifica (la soglia 1 se non già inviata)');
  assert.equal(thresholdFor(-8, days), null, 'scaduta da più di 7 giorni: niente');
});

test('una sola notifica per soglia: la chiave del registro dipende da utente, scadenza, data e soglia', () => {
  const base = { uid: 'u1', garageId: 'g1', prefs: normalizePrefs({ enabled: true }), deadlines: [{ key: 'v:v1:bollo', date: '2026-12-07', label: 'Bollo', plate: 'AB' }] };
  const a = planForUser({ ...base, today: '2026-11-30' });   // d = 7
  const b = planForUser({ ...base, today: '2026-12-02' });   // d = 5 → stessa soglia 7
  const c = planForUser({ ...base, today: '2026-12-06' });   // d = 1 → soglia 1
  assert.equal(a[0].logId, b[0].logId, 'giorni diversi, stessa soglia → stessa chiave (niente doppioni)');
  assert.notEqual(a[0].logId, c[0].logId);
  const renewed = planForUser({ ...base, deadlines: [{ ...base.deadlines[0], date: '2027-12-07' }], today: '2027-11-30' });
  assert.notEqual(a[0].logId, renewed[0].logId, 'dopo il rinnovo (data nuova) le soglie ripartono');
  assert.notEqual(logId('u1', 'g1', 'k', 'd', 7), logId('u2', 'g1', 'k', 'd', 7), 'per utente');
});

test('messaggio: targa e tipo, mai importi; versione senza dettagli; massimo 4 righe', () => {
  const items = [1, 7, 0, -2, 3].map((d, i) => ({ plate: `P${i}`, label: 'Bollo', days: d, cost: 999 }));
  const m = buildMessage(items);
  assert.equal(m.title, 'GarageOS — 5 scadenze');
  assert.equal(m.body.split('\n').length, 5);
  assert.match(m.body, /^P0 · Bollo: domani/);
  assert.match(m.body, /e altre 1$/);
  assert.ok(!/999|€/.test(m.body), 'nessun importo');
  const anon = buildMessage(items.slice(0, 1), { details: false });
  assert.equal(anon.title, 'GarageOS — 1 scadenza');
  assert.ok(!/P0|Bollo/.test(anon.body), 'senza dettagli: niente targa né tipo');
  assert.deepEqual([-3, -1, 0, 1, 9].map(whenText), ['scaduta da 3 giorni', 'scaduta ieri', 'oggi', 'domani', 'tra 9 giorni']);
});
