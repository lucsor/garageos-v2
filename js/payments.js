// Registro dei pagamenti (v2.7.0): funzioni pure, testate in tests/unit/payments.test.mjs (niente DOM, niente Firebase).
// I pagamenti nascono dal "✅ Fatto" di una scadenza (garages/{g}/payments). Dal registro si correggono solo importo,
// data ed etichetta (le regole bloccano il resto); eliminano il proprietario del garage o chi li ha registrati.
import { paymentFromForm, toNum } from './fuel.js';

export const LABEL_MAX = 60;   // = reqStr(d, 'label', 60) in paymentOk() di firestore.rules
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Filtro veicolo: '' = tutti, '-' = senza veicolo (tutto il garage), '?' = veicoli rimossi, altrimenti l'id del veicolo.
// `knownVehicleIds` serve solo per '?': un pagamento con un vehicleId che non esiste più è di un veicolo rimosso.
export function paymentLedger(payments = [], { year = null, vehicleId = '', knownVehicleIds = null } = {}) {
  const known = knownVehicleIds ? new Set(knownVehicleIds) : null;
  const matchVehicle = (p) => {
    if (!vehicleId) return true;
    if (vehicleId === '-') return !p.vehicleId;
    if (vehicleId === '?') return !!p.vehicleId && !!known && !known.has(p.vehicleId);
    return p.vehicleId === vehicleId;
  };
  return payments
    .filter((p) => isDate(p.date))
    .filter((p) => year == null || Number(p.date.slice(0, 4)) === year)
    .filter(matchVehicle)
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.id ?? '').localeCompare(String(a.id ?? '')));
}

// Anni presenti nel registro, dal più recente
export function ledgerYears(payments = []) {
  return [...new Set(payments.filter((p) => isDate(p.date)).map((p) => Number(p.date.slice(0, 4))))].sort((a, b) => b - a);
}

// Totale in centesimi interi (0,1 + 0,2 = 0,3 esatti); importi non numerici ignorati
export function ledgerTotal(rows = []) {
  return rows.reduce((s, p) => {
    const n = toNum(p.amount);
    return s + (n > 0 ? Math.round(n * 100) : 0);
  }, 0) / 100;
}

// Modulo di modifica → { ok, patch, changed } con SOLO i campi cambiati tra amount/date/label, oppure { ok: false, error }.
// editedBy e updatedAt li aggiunge chi salva (email e ora del server), come richiesto dalle regole.
export function paymentPatch(form, original) {
  const label = String(form.label ?? '').trim();
  if (!label || label.length > LABEL_MAX) return { ok: false, error: `La descrizione è obbligatoria (al massimo ${LABEL_MAX} caratteri)` };
  const res = paymentFromForm({ amount: form.amount, date: form.date });
  if (!res.ok) return res;
  if (!res.amount) return { ok: false, error: 'Importo mancante: per togliere un pagamento usa «Elimina»' };
  const patch = {};
  if (res.amount !== toNum(original.amount)) patch.amount = res.amount;
  if (res.date !== original.date) patch.date = res.date;
  if (label !== original.label) patch.label = label;
  return { ok: true, patch, changed: Object.keys(patch).length > 0 };
}

// Stessa logica della regola di delete: proprietario del garage, oppure autore del pagamento (email senza maiuscole)
export function canDeletePayment(p, { isOwner = false, email = '' } = {}) {
  if (isOwner) return true;
  const me = String(email || '').toLowerCase();
  return !!me && String(p?.addedBy || '').toLowerCase() === me;
}
