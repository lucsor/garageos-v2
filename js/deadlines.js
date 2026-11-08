// Scadenze: quelle dei veicoli (bollo, revisione, assicurazione) e quelle personalizzate
// (garages/{g}/deadlines, v2.4) in un'unica lista. Funzioni pure, testabili in Node.

// Tipi di scadenza personalizzata: devono coincidere con deadlineKinds() in firestore.rules
export const DEADLINE_KINDS = [
  { id: 'tagliando',  label: 'Tagliando',            icon: '🔧' },
  { id: 'ztl',        label: 'Permesso ZTL',         icon: '🚦' },
  { id: 'bollino',    label: 'Bollino blu',          icon: '🌿' },
  { id: 'telepass',   label: 'Telepass',             icon: '🛣️' },
  { id: 'estintore',  label: 'Estintore',            icon: '🧯' },
  { id: 'seggiolino', label: 'Seggiolino',           icon: '👶' },
  { id: 'parcheggio', label: 'Abbonamento parcheggio', icon: '🅿️' },
  { id: 'gomme',      label: 'Cambio gomme',         icon: '🛞' },
  { id: 'patente',    label: 'Patente',              icon: '🪪' },
  { id: 'altro',      label: 'Altro',                icon: '📌' },
];
export const REPEAT_OPTIONS = [
  { months: null, label: 'Nessuna' },
  { months: 1, label: 'Ogni mese' },
  { months: 6, label: 'Ogni 6 mesi' },
  { months: 12, label: 'Ogni anno' },
  { months: 24, label: 'Ogni 2 anni' },
  { months: 36, label: 'Ogni 3 anni' },
  { months: 60, label: 'Ogni 5 anni' },
  { months: 120, label: 'Ogni 10 anni' },
];
export const deadlineKind = (id) => DEADLINE_KINDS.find((k) => k.id === id) || DEADLINE_KINDS[DEADLINE_KINDS.length - 1];

const VEHICLE_KINDS = [
  { kind: 'bollo', label: 'Bollo', icon: '📋' },
  { kind: 'revisione', label: 'Revisione', icon: '🔍' },
  { kind: 'assicurazione', label: 'Assicurazione', icon: '🛡️' },
];
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Lista unica, ordinata per data. Esclusi i veicoli "congelati" e le loro scadenze personalizzate.
// item: { source: 'vehicle'|'custom', key, kind, label, icon, date, cost, vehicle|null, deadline? }
export function collectDeadlines(vehicles = [], custom = [], { vehicleId = '' } = {}) {
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const items = [];
  for (const v of vehicles) {
    if (v.frozen || (vehicleId && v.id !== vehicleId)) continue;
    for (const k of VEHICLE_KINDS) {
      if (!isDate(v[k.kind])) continue;
      const label = k.kind === 'assicurazione' && v.assicurazioneCompany ? `${k.label} ${v.assicurazioneCompany}` : k.label;
      items.push({ source: 'vehicle', key: `${v.id}-${k.kind}`, kind: k.kind, label, icon: k.icon, date: v[k.kind], cost: v[k.kind + 'Cost'], vehicle: v });
    }
  }
  for (const d of custom) {
    if (!isDate(d.due)) continue;
    const v = d.vehicleId ? byId.get(d.vehicleId) || null : null;
    if (v?.frozen) continue;
    if (vehicleId && d.vehicleId !== vehicleId) continue;
    const k = deadlineKind(d.kind);
    items.push({ source: 'custom', key: `dl-${d.id}`, kind: k.id, label: d.label || k.label, icon: k.icon, date: d.due, cost: d.cost, vehicle: v, deadline: d });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
}

// Prossima data di una scadenza ricorrente: +N mesi, con il giorno limitato alla fine del mese
// (31 gennaio + 1 mese = 28/29 febbraio, non 3 marzo).
export function advanceDue(due, months) {
  const [y, m, d] = due.split('-').map(Number);
  const total = (m - 1) + months;
  const ny = y + Math.floor(total / 12), nm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

// Dati del modulo → documento per Firestore (numeri veri, null per i campi vuoti)
export function deadlineFromForm(f) {
  const cost = f.cost === '' || f.cost == null ? null : Number(String(f.cost).replace(',', '.'));
  const rep = f.repeatMonths === '' || f.repeatMonths == null ? null : Number(f.repeatMonths);
  return {
    kind: deadlineKind(f.kind).id,
    label: String(f.label || '').trim().slice(0, 60) || deadlineKind(f.kind).label,
    vehicleId: f.vehicleId || null,
    due: f.due,
    repeatMonths: Number.isInteger(rep) && rep >= 1 && rep <= 120 ? rep : null,
    cost: Number.isFinite(cost) && cost >= 0 ? Math.round(cost * 100) / 100 : null,
    note: String(f.note || '').trim().slice(0, 500),
  };
}
