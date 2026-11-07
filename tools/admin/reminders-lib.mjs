// Logica pura dei promemoria (nessun accesso a Firestore o FCM): testabile in Node.
// Usata da send-reminders.mjs (GitHub Actions).
import { createHash } from 'node:crypto';

export const DEFAULT_DAYS = [30, 7, 1];
export const MAX_OVERDUE_DAYS = 7;           // le scadenze passate da più di 7 giorni non si notificano più
const DAY = 86_400_000;

// "Oggi" nel fuso di Roma (il job gira alle 06:17 UTC: in Italia è già la stessa data)
export function romeToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
export const daysBetween = (today, date) => Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / DAY);

// Scadenze dei veicoli attivi. key stabile per veicolo+tipo; la data entra nella chiave del registro,
// così dopo un rinnovo (data nuova) le soglie ripartono.
const KINDS = [['bollo', 'Bollo'], ['revisione', 'Revisione'], ['assicurazione', 'Assicurazione']];
export function vehicleDeadlines(vehicles = []) {
  const out = [];
  for (const v of vehicles) {
    if (v.frozen) continue;
    for (const [kind, label] of KINDS) {
      if (!isDate(v[kind])) continue;
      out.push({ key: `v:${v.id}:${kind}`, date: v[kind], label, plate: String(v.plate || '').slice(0, 15) });
    }
  }
  return out;
}

export function normalizePrefs(push) {
  const days = Array.isArray(push?.days) && push.days.length
    ? [...new Set(push.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 90))].sort((a, b) => a - b)
    : DEFAULT_DAYS.slice().sort((a, b) => a - b);
  return { enabled: push?.enabled === true, days: days.length ? days : DEFAULT_DAYS.slice().sort((a, b) => a - b), details: push?.details !== false };
}

// Soglia da notificare oggi per una scadenza a `d` giorni: la PIÙ PICCOLA soglia t con d <= t.
// Se il job salta dei giorni, al run successivo si recupera la soglia giusta (una sola notifica).
// null = niente da notificare (troppo lontana, o scaduta da troppo).
export function thresholdFor(d, days) {
  if (d < -MAX_OVERDUE_DAYS) return null;
  const t = days.filter((x) => d <= x);
  return t.length ? Math.min(...t) : null;
}

export const logId = (...parts) => createHash('sha256').update(parts.join('|')).digest('hex');

// Cosa notificare a un utente oggi. sent(id) → true se già nel registro.
export function planForUser({ uid, garageId, prefs, deadlines, today }) {
  const items = [];
  for (const dl of deadlines) {
    const d = daysBetween(today, dl.date);
    const t = thresholdFor(d, prefs.days);
    if (t === null) continue;
    items.push({ ...dl, days: d, threshold: t, logId: logId(uid, garageId, dl.key, dl.date, t) });
  }
  return items.sort((a, b) => a.days - b.days || a.label.localeCompare(b.label));
}

export function whenText(d) {
  if (d < -1) return `scaduta da ${-d} giorni`;
  if (d === -1) return 'scaduta ieri';
  if (d === 0) return 'oggi';
  if (d === 1) return 'domani';
  return `tra ${d} giorni`;
}

// Testo della notifica: con dettagli targa + tipo (MAI importi); senza dettagli solo il numero.
export function buildMessage(items, { details = true } = {}) {
  const n = items.length;
  const title = n === 1 ? 'GarageOS — 1 scadenza' : `GarageOS — ${n} scadenze`;
  if (!details) return { title, body: n === 1 ? 'Hai una scadenza in arrivo: apri GarageOS per i dettagli.' : `Hai ${n} scadenze in arrivo: apri GarageOS per i dettagli.` };
  const lines = items.slice(0, 4).map((i) => `${i.plate} · ${i.label}: ${whenText(i.days)}`);
  if (n > 4) lines.push(`e altre ${n - 4}`);
  return { title, body: lines.join('\n') };
}

// Errori FCM che significano "token da buttare" (NON invalid-argument: può dipendere dal messaggio, non dal token)
export const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);
export const STALE_TOKEN_DAYS = 60;
export const LOG_RETENTION_DAYS = 400;
