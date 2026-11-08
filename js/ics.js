// Calendario: export delle scadenze in formato iCalendar (.ics, RFC 5545), con promemoria.
// Funzioni pure (testabili in Node) + consegna del file (condivisione o download) che usa il DOM.
// Il file .ics è generato nel browser e passato all'app Calendario dell'utente: nessun nostro server.
// ECCEZIONE: il link "Google Calendar" (googleCalendarUrl) manda titolo e veicolo a calendar.google.com,
// solo se l'utente lo tocca (l'interfaccia lo dice); l'importo previsto non viene incluso.

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
// data reale (2027-02-31 non passa: new Date la farebbe diventare 3 marzo)
const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

// Scadenze dei veicoli attivi (non "congelati"), da oggi in avanti, ordinate per data.
// custom = scadenze personalizzate (garages/{g}/deadlines, F2): { id, kind, label, vehicleId|null, due, cost, … }
export function deadlineEvents(vehicles, { today = localToday(), vehicleId = '', custom = [], icons = {} } = {}) {
  const events = [];
  for (const v of vehicles || []) {
    if (v.frozen || (vehicleId && v.id !== vehicleId)) continue;
    for (const kind of Object.keys(KINDS)) {
      const date = v[kind];
      if (!validDate(date) || date < today) continue;
      events.push(deadlineEvent(v, kind));
    }
  }
  const byId = new Map((vehicles || []).map((v) => [v.id, v]));
  for (const d of custom || []) {
    const v = d.vehicleId ? byId.get(d.vehicleId) || null : null;
    if (v?.frozen || (vehicleId && d.vehicleId !== vehicleId)) continue;
    if (!validDate(d.due) || d.due < today) continue;
    events.push(customDeadlineEvent(d, v, icons[d.kind]));
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

// Scadenza personalizzata: UID per documento, senza la data (come per i veicoli: "Fatto" su una
// ricorrente sposta l'evento invece di duplicarlo nei calendari che gestiscono gli aggiornamenti).
export function customDeadlineEvent(d, v = null, icon = '📌') {
  const where = v ? `${v.model || ''} (${v.plate || ''})`.trim() : 'Tutto il garage';
  const lines = [where];
  if (d.note) lines.push(String(d.note));
  if (typeof d.cost === 'number' && d.cost > 0) lines.push(`Importo previsto: € ${d.cost}`);
  lines.push('Promemoria creato da GarageOS: https://lucsor.github.io/garageos-v2/');
  const label = String(d.label || '').trim() || 'Scadenza';
  return {
    uid: `dl-${d.id}@garageos`,
    date: d.due,
    summary: `${icon || '📌'} ${label}${v?.plate ? ' — ' + v.plate : ''}`,
    description: lines.join('\n'),
    publicDetails: lines.filter((l) => !l.startsWith('Importo') && l !== String(d.note || '')).join('\n'),   // Google: niente importo né note
    reminderLabel: `${label}${v?.plate ? ' ' + v.plate : ''}`,
  };
}

export function deadlineEvent(v, kind) {
  const k = KINDS[kind];
  const label = kind === 'assicurazione' && v.assicurazioneCompany ? `${k.label} ${v.assicurazioneCompany}` : k.label;
  const cost = v[kind + 'Cost'];
  const lines = [`${v.model || ''} (${v.plate || ''})`.trim()];
  if (cost) lines.push(`Importo previsto: € ${cost}`);
  lines.push('Promemoria creato da GarageOS: https://lucsor.github.io/garageos-v2/');
  return {
    // UID per veicolo e tipo, SENZA la data: dopo un rinnovo, reimportando il file, i calendari che
    // gestiscono gli aggiornamenti (iPhone, Outlook) spostano l'evento invece di duplicarlo (SEQUENCE più alto).
    // Google Calendar, all'importazione, può comunque creare un duplicato.
    uid: `${v.id}-${kind}@garageos`,
    date: v[kind],
    summary: `${k.icon} ${label} — ${v.plate || ''}`.trim(),
    description: lines.join('\n'),
    publicDetails: lines.filter((l) => !l.startsWith('Importo')).join('\n'),   // per il link Google: senza importo
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
      `LAST-MODIFIED:${stamp(now)}`,
      `SEQUENCE:${Math.floor(now.getTime() / 60000)}`,     // cresce nel tempo: l'ultima esportazione vince
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

// "Aggiungi a Google Calendar" per una singola scadenza: link a calendar.google.com (nessun server nostro).
// Utile su Android, dove Google Calendar ignora i VALARM dei file .ics importati: con il link l'evento
// usa le notifiche predefinite dell'utente per gli eventi "tutto il giorno".
export function googleCalendarUrl(e) {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.summary,
    dates: `${ymd(e.date)}/${ymd(nextDay(e.date))}`,
    details: e.publicDetails ?? e.description,
  });
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}

// Tipo di dispositivo, solo per scegliere testi e modalità di consegna del file
export function deviceKind(nav = globalThis.navigator) {
  const ua = nav?.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints || 0) > 1)) return 'ios';
  return 'other';
}

// Su telefono la prima scelta è il foglio di condivisione con il file (Web Share API): nella PWA installata
// su iPhone il download di un blob può non aprire nulla. Se la condivisione di file non è supportata
// (es. Chrome Android non ammette i .ics) o fallisce, si scarica il file. Va chiamata dentro il click.
export async function shareOrDownloadICS(filename, text, title, nav = globalThis.navigator) {
  if (deviceKind(nav) !== 'other' && typeof File === 'function') {
    const file = new File([text], filename, { type: 'text/calendar' });
    let can = false;
    try { can = !!nav.canShare?.({ files: [file] }); } catch {}
    if (can) {
      try { await nav.share({ files: [file], title }); return 'shared'; }
      catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
    }
  }
  downloadICS(filename, text);
  return 'downloaded';
}

export function downloadICS(filename, text) {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
