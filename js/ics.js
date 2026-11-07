// Calendario: export delle scadenze in formato iCalendar (.ics, RFC 5545), con promemoria.
// Funzioni pure (testabili in Node) + downloadICS che usa il DOM. Nessun dato lascia il dispositivo:
// il file viene generato nel browser e aperto/importato dall'app Calendario dell'utente.

const KINDS = {
  bollo:         { label: 'Bollo',         icon: '📋' },
  revisione:     { label: 'Revisione',     icon: '🔍' },
  assicurazione: { label: 'Assicurazione', icon: '🛡️' },
};
// Promemoria: alle 9:00 di 7 giorni prima e del giorno prima (gli eventi sono "tutto il giorno",
// quindi il trigger è relativo alla mezzanotte di inizio: -P6DT15H = 9:00 di 7 giorni prima).
export const ALARMS = [
  { trigger: '-P6DT15H', text: 'tra 7 giorni' },
  { trigger: '-PT15H',   text: 'domani' },
];

// Testo secondo RFC 5545 §3.3.11: backslash, punto e virgola, virgola e a capo vanno escapati.
// Gli a capo diventano "\n" letterale: un valore non può mai iniziare una nuova proprietà.
export function icsEscape(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

// Righe al massimo di 75 ottetti UTF-8 (§3.1): si spezza con CRLF + spazio, senza tagliare un carattere.
export function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '', curLen = 0, limit = 75;
  for (const ch of line) {                       // for…of itera per code point (emoji incluse)
    const n = enc.encode(ch).length;
    if (curLen + n > limit) { out.push(cur); cur = ''; curLen = 0; limit = 74; }   // le righe di continuazione hanno lo spazio iniziale
    cur += ch; curLen += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const ymd = (dateStr) => dateStr.replace(/-/g, '');
function nextDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function stamp(now) { return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
// data di oggi nel fuso del dispositivo (toISOString darebbe la data UTC: sbagliata vicino alla mezzanotte)
export function localToday(d = new Date()) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z'));

// Scadenze dei veicoli attivi (non "congelati"), da oggi in avanti, ordinate per data.
export function deadlineEvents(vehicles, { today = localToday(), vehicleId = '' } = {}) {
  const events = [];
  for (const v of vehicles || []) {
    if (v.frozen || (vehicleId && v.id !== vehicleId)) continue;
    for (const kind of Object.keys(KINDS)) {
      const date = v[kind];
      if (!validDate(date) || date < today) continue;
      events.push(deadlineEvent(v, kind));
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

export function deadlineEvent(v, kind) {
  const k = KINDS[kind];
  const label = kind === 'assicurazione' && v.assicurazioneCompany ? `${k.label} ${v.assicurazioneCompany}` : k.label;
  const cost = v[kind + 'Cost'];
  const lines = [`${v.model || ''} (${v.plate || ''})`.trim()];
  if (cost) lines.push(`Importo previsto: € ${cost}`);
  lines.push('Promemoria creato da GarageOS: https://lucsor.github.io/garageos-v2/');
  return {
    // UID stabile: reimportando il file, i calendari che lo supportano aggiornano l'evento invece di duplicarlo
    uid: `${v.id}-${kind}-${v[kind]}@garageos`,
    date: v[kind],
    summary: `${k.icon} ${label} — ${v.plate || ''}`.trim(),
    description: lines.join('\n'),
    reminderLabel: `${label} ${v.plate || ''}`.trim(),
  };
}

export function buildICS(events, { now = new Date(), calName = 'GarageOS — scadenze' } = {}) {
  const L = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GarageOS//Scadenze//IT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(calName)}`,
  ];
  for (const e of events) {
    L.push(
      'BEGIN:VEVENT',
      `UID:${icsEscape(e.uid)}`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${ymd(e.date)}`,
      `DTEND;VALUE=DATE:${ymd(nextDay(e.date))}`,
      `SUMMARY:${icsEscape(e.summary)}`,
      `DESCRIPTION:${icsEscape(e.description)}`,
      'TRANSP:TRANSPARENT',                     // non occupa il calendario come "impegnato"
    );
    for (const a of ALARMS) {
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:${a.trigger}`,
        `DESCRIPTION:${icsEscape(`${e.reminderLabel} scade ${a.text}`)}`, 'END:VALARM');
    }
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(foldLine).join('\r\n') + '\r\n';
}

// Nome file sicuro (niente caratteri strani da targhe o etichette)
export function icsFilename(...parts) {
  return 'garageos-' + parts.map((p) => String(p).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).filter(Boolean).join('-') + '.ics';
}

export function downloadICS(filename, text) {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
