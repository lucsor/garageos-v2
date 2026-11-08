// Rifornimenti, consumi e spese annue (v2.6). Funzioni pure, testabili in Node: niente DOM, niente Firebase.
// Modello dei dati e algoritmi: docs/v2.6.md
import { mechCostInfo } from './costs.js';

// Limiti: devono coincidere con refuelOk() in firestore.rules
export const LIMITS = { kmMax: 9999999, litersMax: 500, amountMax: 10000, noteMax: 200 };
// Tipi di intervento che corrispondono a una scadenza del veicolo (creati da "✅ Rinnovata" o inseriti a mano):
// finiscono nella categoria "scadenze" invece che "interventi"
export const PAID_DEADLINE_TYPES = ['bollo', 'revisione', 'assicurazione'];
// Intervallo plausibile di consumo (km/l): fuori da qui un tratto è quasi certamente un errore di km o litri
export const PLAUSIBLE_KML = [1, 100];

// ===== INSERIMENTO: numeri all'italiana =====
// Decimali con la virgola ("1,5") o col punto ("1.5"), UN solo separatore. Respinti come ambigui:
//  - valori con entrambi i separatori ("1.500,5") o con più separatori ("1.500.000");
//  - più cifre decimali di quante ne abbia senso il campo (importo "1.500" = 1500 € o 1,5 €? → respinto).
// Restituisce un numero finito ≥ 0, null per il campo vuoto, NaN per un valore non valido.
export function parseDecimal(input, maxDecimals = 2) {
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? input : NaN;
  const s = String(input ?? '').trim().replace(/\s+/g, '');
  if (s === '') return null;
  const m = s.match(/^(\d+)(?:[.,](\d+))?$/);
  if (!m || (m[2] && m[2].length > maxDecimals)) return NaN;
  return Number(m[1] + (m[2] ? '.' + m[2] : ''));
}
// Km: solo interi. Ammesso il separatore delle migliaia (punto o spazio) a gruppi di 3: "45.000" = 45000.
// Respinti i decimali ("45000,5") e i gruppi irregolari ("45.00").
export function parseKm(input) {
  if (typeof input === 'number') return Number.isInteger(input) && input >= 0 ? input : NaN;
  const s = String(input ?? '').trim();
  if (s === '') return null;
  if (/^\d+$/.test(s)) return Number(s);
  if (/^\d{1,3}([. ]\d{3})+$/.test(s)) return Number(s.replace(/[. ]/g, ''));
  return NaN;
}
// Lettura tollerante (dati legacy o scritti a mano): numero vero, oppure stringa numerica; altrimenti null
export function toNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const n = parseDecimal(v, 3);
  return Number.isFinite(n) ? n : null;
}
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

// Dati del modulo → documento per Firestore (solo numeri veri). { ok, doc } oppure { ok: false, errors: {campo: messaggio} }
// (addedBy, createdAt e updatedAt li aggiunge chi salva: email e timestamp del server)
export function refuelFromForm(f) {
  const errors = {};
  const km = parseKm(f.km);
  const liters = parseDecimal(f.liters, 3);
  const amount = parseDecimal(f.amount, 2);
  const note = String(f.note ?? '').trim();
  if (!f.vehicleId) errors.vehicleId = 'Seleziona un veicolo';
  if (!isDate(f.date)) errors.date = 'Inserisci la data';
  if (Number.isNaN(km)) errors.km = 'Km non validi: solo numeri interi (es. 45000 o 45.000)';
  else if (km !== null && km > LIMITS.kmMax) errors.km = 'Km troppo alti';
  if (liters === null) errors.liters = 'Inserisci i litri';
  else if (Number.isNaN(liters)) errors.liters = 'Litri non validi: usa la virgola per i decimali (es. 38,5)';
  else if (liters <= 0 || liters > LIMITS.litersMax) errors.liters = `I litri devono essere tra 0 e ${LIMITS.litersMax}`;
  if (amount === null) errors.amount = 'Inserisci l\'importo';
  else if (Number.isNaN(amount)) errors.amount = 'Importo non valido: usa la virgola per i centesimi (es. 62,40), senza punto delle migliaia';
  else if (amount > LIMITS.amountMax) errors.amount = 'Importo troppo alto';
  if (note.length > LIMITS.noteMax) errors.note = `Note: al massimo ${LIMITS.noteMax} caratteri`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    doc: {
      vehicleId: f.vehicleId, date: f.date, km,
      liters: round(liters, 3), amount: round(amount, 2),
      full: f.full !== false, note,
    },
  };
}

// ===== CONSUMI =====
// Ordine cronologico: data, poi km (stesso giorno), poi id (stabile)
export function sortRefuels(list) {
  return [...list].sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))
    || (toNum(a.km) ?? Infinity) - (toNum(b.km) ?? Infinity)
    || String(a.id || '').localeCompare(String(b.id || '')));
}

// Consumo calcolato SOLO tra due pieni: dal pieno A (escluso) al pieno B (incluso) si sommano litri e importi
// di tutti i rifornimenti (anche parziali) e si dividono per i km percorsi (km di B − km di A).
//  - prima del primo pieno con i km: rifornimenti non misurabili (non si sa quanto c'era nel serbatoio);
//  - pieno senza km: il tratto non si può misurare e la catena riparte dal pieno successivo con i km;
//  - km in calo rispetto al rifornimento precedente: segnalati ('km_regression'); il tratto che chiude con km ≤ di
//    partenza è scartato; consumi fuori da PLAUSIBLE_KML scartati ('implausible');
//  - parziali dopo l'ultimo pieno: "in sospeso" fino al prossimo pieno.
export function consumption(refuels) {
  const rs = sortRefuels(refuels).map((r) => ({
    id: r.id, date: r.date, full: r.full !== false,
    km: toNum(r.km), liters: toNum(r.liters) ?? 0, amount: toNum(r.amount) ?? 0,
  }));
  const flags = {};
  const flag = (id, why) => { (flags[id] ||= []).push(why); };
  const segments = [];
  let anchor = null, accL = 0, accE = 0, prevKm = null;
  for (const r of rs) {
    if (r.km !== null) {
      if (prevKm !== null && r.km < prevKm) flag(r.id, 'km_regression');
      prevKm = r.km;
    }
    if (!anchor) {
      if (r.full && r.km !== null) { anchor = r; accL = 0; accE = 0; }
      continue;
    }
    accL += r.liters; accE += r.amount;
    if (!r.full) continue;
    const seg = { fromId: anchor.id, toId: r.id, from: anchor.date, to: r.date, liters: accL, amount: accE, km: null, valid: false, reason: '' };
    if (r.km === null) { seg.reason = 'missing_km'; anchor = null; }
    else {
      seg.km = r.km - anchor.km;
      if (seg.km <= 0) seg.reason = 'km_regression';
      else if (accL <= 0) seg.reason = 'no_liters';
      else {
        const kml = seg.km / accL;
        if (kml < PLAUSIBLE_KML[0] || kml > PLAUSIBLE_KML[1]) seg.reason = 'implausible';
        else { seg.valid = true; seg.kmPerL = kml; seg.eurPerKm = accE / seg.km; }
      }
      anchor = r;
    }
    accL = 0; accE = 0;
    segments.push(seg);
  }
  const ok = segments.filter((s) => s.valid);
  const mKm = ok.reduce((s, x) => s + x.km, 0);
  const mL = ok.reduce((s, x) => s + x.liters, 0);
  const mE = ok.reduce((s, x) => s + x.amount, 0);
  const totalLiters = rs.reduce((s, r) => s + r.liters, 0);
  const totalAmount = rs.reduce((s, r) => s + r.amount, 0);
  return {
    count: rs.length, segments, flags,
    measuredKm: mKm, measuredLiters: mL, measuredAmount: mE,
    kmPerL: mKm > 0 ? mKm / mL : null,
    l100km: mKm > 0 ? (mL / mKm) * 100 : null,
    eurPerKm: mKm > 0 ? mE / mKm : null,
    pendingLiters: anchor ? accL : 0,
    totalLiters, totalAmount,
    pricePerL: totalLiters > 0 ? totalAmount / totalLiters : null,
  };
}

// ===== SPESE ANNUE =====
// "Pagato" = tutto ciò che ha un importo inserito, contato nell'anno della SUA data (decisione del 2026-11-08):
//  - interventi: costi degli interventi (mechs), deduplicati con mechCostInfo (gruppi multi-tipo);
//  - scadenze:   interventi di tipo bollo/revisione/assicurazione + voci `extras` (scadenze con importo:
//                bollo/revisione/assicurazione del veicolo alla loro data, scadenze personalizzate alla data `due`);
//  - carburante: importi dei rifornimenti.
// `extras`: [{ vehicleId, date, amount, category }] con category in CATEGORIES (default 'scadenze'); vedi deadlineExtras().
export const CATEGORIES = ['interventi', 'scadenze', 'carburante'];
export const yearOf = (date) => (typeof date === 'string' && /^\d{4}-/.test(date) ? Number(date.slice(0, 4)) : null);

export function spendingRows({ mechs = [], refuels = [], extras = [] } = {}) {
  const info = mechCostInfo(mechs);
  const rows = new Map();   // "anno|veicolo" → riga
  let undated = 0;
  const add = (vehicleId, date, cat, amount, liters = 0) => {
    if (!(amount > 0) && !(liters > 0)) return;
    const year = yearOf(date);
    if (year === null) { undated += amount > 0 ? amount : 0; return; }
    const k = `${year}|${vehicleId || ''}`;
    let r = rows.get(k);
    if (!r) rows.set(k, r = { year, vehicleId: vehicleId || '', interventi: 0, scadenze: 0, carburante: 0, total: 0, liters: 0 });
    if (amount > 0) { r[cat] += amount; r.total += amount; }
    r.liters += liters;
  };
  for (const m of mechs) {
    const c = info.get(m.id)?.counted ?? 0;
    add(m.vehicleId, m.date, PAID_DEADLINE_TYPES.includes(m.type) ? 'scadenze' : 'interventi', c);
  }
  for (const r of refuels) add(r.vehicleId, r.date, 'carburante', toNum(r.amount) ?? 0, toNum(r.liters) ?? 0);
  for (const e of extras) add(e.vehicleId, e.date, CATEGORIES.includes(e.category) ? e.category : 'scadenze', toNum(e.amount) ?? 0);
  const list = [...rows.values()].map((r) => ({
    ...r, interventi: round(r.interventi, 2), scadenze: round(r.scadenze, 2), carburante: round(r.carburante, 2),
    total: round(r.total, 2), liters: round(r.liters, 3),
  }));
  list.sort((a, b) => a.year - b.year || a.vehicleId.localeCompare(b.vehicleId));
  return { rows: list, undated: round(undated, 2) };
}
// Scadenze con importo → voci di spesa (extras). `items` = collectDeadlines(vehicles, deadlines) di js/deadlines.js
// (veicoli sospesi già esclusi). Ogni scadenza conta UNA volta, nell'anno della sua data (la prossima: quelle già
// passate e rinnovate restano solo come interventi). Doppio conteggio evitato: una scadenza del veicolo NON conta se
// nello stesso anno lo stesso veicolo ha già un intervento dello stesso tipo (es. bollo pagato a mano).
export function deadlineExtras(items = [], mechs = []) {
  const paid = new Set(mechs.filter((m) => PAID_DEADLINE_TYPES.includes(m.type) && yearOf(m.date) !== null)
    .map((m) => `${m.vehicleId}|${m.type}|${yearOf(m.date)}`));
  const out = [];
  for (const it of items) {
    // importi legacy come stringa: al massimo 2 decimali ("1.500" è ambiguo → ignorato, come nell'inserimento)
    const amount = typeof it.cost === 'string' ? parseDecimal(it.cost, 2) : toNum(it.cost);
    const year = yearOf(it.date);
    if (!(amount > 0) || year === null) continue;
    const vehicleId = it.vehicle?.id || '';
    if (it.source === 'vehicle' && paid.has(`${vehicleId}|${it.kind}|${year}`)) continue;
    out.push({ vehicleId, date: it.date, amount, category: 'scadenze' });
  }
  return out;
}
// Totali per anno (eventualmente di un solo veicolo), in ordine cronologico
export function totalsByYear(rows, vehicleId = '') {
  const by = new Map();
  for (const r of rows) {
    if (vehicleId && r.vehicleId !== vehicleId) continue;
    const t = by.get(r.year) || { year: r.year, interventi: 0, scadenze: 0, carburante: 0, total: 0 };
    for (const c of [...CATEGORIES, 'total']) t[c] = round(t[c] + r[c], 2);
    by.set(r.year, t);
  }
  return [...by.values()].sort((a, b) => a.year - b.year);
}

// ===== CSV (le celle passano poi da csvSafe/downloadCSV in js/csv.js) =====
// Numeri con la virgola decimale e senza separatore delle migliaia: Excel/LibreOffice in italiano li leggono come numeri
export const csvNum = (n, d = 2) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(d).replace('.', ',') : '');
export function refuelCsvRows(refuels, vehicleLabel = (id) => id) {
  const c = new Map();
  const byV = new Map();
  for (const r of refuels) (byV.get(r.vehicleId) || byV.set(r.vehicleId, []).get(r.vehicleId)).push(r);
  for (const list of byV.values()) Object.entries(consumption(list).flags).forEach(([id, f]) => c.set(id, f));
  const rows = [['Data', 'Veicolo', 'Km', 'Litri', 'Importo (€)', '€/litro', 'Pieno', 'Note', 'Inserito da', 'Avvisi']];
  for (const r of sortRefuels(refuels)) {
    const l = toNum(r.liters), a = toNum(r.amount), km = toNum(r.km);
    rows.push([
      r.date || '', vehicleLabel(r.vehicleId), km === null ? '' : String(km), csvNum(l, 2), csvNum(a, 2),
      l && a !== null ? csvNum(a / l, 3) : '', r.full !== false ? 'sì' : 'no', r.note || '', r.addedBy || '',
      (c.get(r.id) || []).includes('km_regression') ? 'km inferiori al rifornimento precedente' : '',
    ]);
  }
  return rows;
}
export function spendingCsvRows(rows, vehicleLabel = (id) => id) {
  const out = [['Anno', 'Veicolo', 'Interventi (€)', 'Scadenze (€)', 'Carburante (€)', 'Totale (€)', 'Litri']];
  for (const r of rows) out.push([String(r.year), vehicleLabel(r.vehicleId), csvNum(r.interventi), csvNum(r.scadenze), csvNum(r.carburante), csvNum(r.total), csvNum(r.liters)]);
  return out;
}

// ===== FORMATTAZIONE =====
export const fmtNum = (n, d = 2) => (typeof n === 'number' && Number.isFinite(n)
  ? n.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
export const fmtEuro = (n) => '€ ' + fmtNum(n, 2);
