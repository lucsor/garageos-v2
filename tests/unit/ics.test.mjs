// Unit test del calendario .ics (js/ics.js). Uso: node --test tests/unit/ics.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { icsEscape, foldLine, deadlineEvents, deadlineEvent, buildICS, icsFilename, localToday, ALARMS } from '../../js/ics.js';

const V = [
  { id: 'v1', plate: 'AB123CD', model: 'Panda', bollo: '2027-01-31', bolloCost: '275', revisione: '2026-11-01', assicurazione: '2027-03-15', assicurazioneCompany: 'Allianz', assicurazioneCost: '450' },
  { id: 'v2', plate: 'ZZ999ZZ', model: 'Vecchia', frozen: true, bollo: '2027-02-01' },
  { id: 'v3', plate: 'EF456GH', model: 'Golf', bollo: 'non valida', revisione: '' },
];
const unfold = (ics) => ics.replace(/\r\n /g, '');
const today = '2026-11-07';

test('escape RFC 5545: backslash, ; , e a capo; un valore non può iniziare una nuova proprietà', () => {
  assert.equal(icsEscape('a\\b;c,d\ne'), 'a\\\\b\\;c\\,d\\ne');
  const ics = buildICS([{ uid: 'x', date: '2027-01-01', summary: 'X\r\nATTENDEE:mailto:evil@example.com', description: 'ok', reminderLabel: 'X' }]);
  assert.ok(!/^ATTENDEE/m.test(unfold(ics)), 'nessuna riga ATTENDEE iniettata');
});

test('folding a 75 ottetti senza spezzare caratteri multibyte (emoji, accenti)', () => {
  const long = 'SUMMARY:' + '🛡️ Assicurazione città '.repeat(8);
  const folded = foldLine(long);
  const enc = new TextEncoder();
  for (const line of folded.split('\r\n')) assert.ok(enc.encode(line).length <= 75, `riga di ${enc.encode(line).length} ottetti`);
  assert.equal(folded.replace(/\r\n /g, ''), long, 'unfold restituisce la riga originale');
  assert.equal(foldLine('BREVE:ok'), 'BREVE:ok');
});

test('scadenze: solo veicoli attivi, solo date valide e future, ordinate', () => {
  const ev = deadlineEvents(V, { today });
  assert.deepEqual(ev.map((e) => e.uid), ['v1-bollo@garageos', 'v1-assicurazione@garageos']);
  assert.equal(deadlineEvents(V, { today, vehicleId: 'v3' }).length, 0);
  assert.equal(deadlineEvents(V, { today: '2026-10-01' }).length, 3, 'la revisione del 1/11 conta se oggi è prima');
});

test('evento: titolo, compagnia, importo, data tutto il giorno (DTEND = giorno dopo)', () => {
  const e = deadlineEvent(V[0], 'assicurazione');
  assert.equal(e.summary, '🛡️ Assicurazione Allianz — AB123CD');
  assert.match(e.description, /Importo previsto: € 450/);
  const ics = unfold(buildICS([deadlineEvent(V[0], 'bollo')], { now: new Date('2026-11-07T10:00:00Z') }));
  assert.match(ics, /DTSTART;VALUE=DATE:20270131\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20270201\r\n/);
  assert.match(ics, /DTSTAMP:20261107T100000Z\r\n/);
  const end = unfold(buildICS([{ ...deadlineEvent(V[0], 'bollo'), date: '2026-12-31' }]));
  assert.match(end, /DTEND;VALUE=DATE:20270101\r\n/, 'cambio di anno');
});

test('struttura del file: CRLF, VCALENDAR/VEVENT/VALARM bilanciati, due promemoria per evento', () => {
  const ics = buildICS(deadlineEvents(V, { today }));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'solo CRLF');
  const count = (re) => (ics.match(re) || []).length;
  assert.equal(count(/^BEGIN:VEVENT/gm), 2);
  assert.equal(count(/^END:VEVENT/gm), 2);
  assert.equal(count(/^BEGIN:VALARM/gm), 2 * ALARMS.length);
  assert.equal(count(/^END:VALARM/gm), 2 * ALARMS.length);
  assert.match(ics, /TRIGGER:-P6DT15H\r\n/);
  assert.match(ics, /TRIGGER:-PT15H\r\n/);
});

test('nome file sicuro e data locale', () => {
  assert.equal(icsFilename('bollo', 'AB 123/CD'), 'garageos-bollo-ab-123-cd.ics');
  assert.equal(icsFilename('scadenze', '', '2026-11-07'), 'garageos-scadenze-2026-11-07.ics');
  assert.match(localToday(), /^\d{4}-\d{2}-\d{2}$/);
});

test('link "Aggiungi a Google Calendar": evento tutto il giorno, testo codificato', async () => {
  const { googleCalendarUrl } = await import('../../js/ics.js');
  const u = new URL(googleCalendarUrl(deadlineEvent(V[0], 'bollo')));
  assert.equal(u.origin + u.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(u.searchParams.get('action'), 'TEMPLATE');
  assert.equal(u.searchParams.get('dates'), '20270131/20270201');
  assert.equal(u.searchParams.get('text'), '📋 Bollo — AB123CD');
  assert.match(u.searchParams.get('details'), /Panda \(AB123CD\)/);
});

test('dispositivo e consegna del file: condivisione su telefono, download altrove o se non supportata', async () => {
  const { deviceKind, shareOrDownloadICS } = await import('../../js/ics.js');
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';
  assert.equal(deviceKind({ userAgent: IPHONE }), 'ios');
  assert.equal(deviceKind({ userAgent: ANDROID }), 'android');
  assert.equal(deviceKind({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }), 'ios', 'iPad con UA desktop');
  assert.equal(deviceKind({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), 'other');
  // download finto (in Node non c'è il DOM)
  let downloads = 0;
  globalThis.document = { createElement: () => ({ click() { downloads++; } }) };
  const shared = [];
  const nav = (ua, can, shareImpl) => ({ userAgent: ua, canShare: () => can, share: shareImpl || (async (d) => { shared.push(d.files[0]); }) });
  assert.equal(await shareOrDownloadICS('a.ics', 'X', 't', nav(IPHONE, true)), 'shared');
  assert.equal(shared[0].name, 'a.ics');
  assert.equal(shared[0].type, 'text/calendar');
  assert.equal(await shareOrDownloadICS('a.ics', 'X', 't', nav(IPHONE, true, async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); })), 'cancelled');
  assert.equal(await shareOrDownloadICS('a.ics', 'X', 't', nav(IPHONE, true, async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); })), 'downloaded');
  assert.equal(await shareOrDownloadICS('a.ics', 'X', 't', nav(ANDROID, false)), 'downloaded', 'Chrome Android non condivide .ics');
  assert.equal(await shareOrDownloadICS('a.ics', 'X', 't', nav('Mozilla/5.0 (Windows NT 10.0)', true)), 'downloaded', 'desktop: sempre download');
  assert.equal(downloads, 3);
  delete globalThis.document;
});
