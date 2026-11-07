// Funzioni pure di formattazione e sicurezza (nessuna dipendenza da DOM o Firebase): testabili in Node.

// ===== SECURITY: HTML ESCAPING =====
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// Solo immagini https (foto profilo Google); qualsiasi altro schema viene scartato
export function safeImg(url) { return typeof url === 'string' && /^https:\/\//.test(url) ? url : ''; }

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const now = new Date(); now.setHours(0,0,0,0);
  const d = new Date(dateStr); d.setHours(0,0,0,0);
  return Math.ceil((d - now) / 86400000);
}
export function badgeClass(days) {
  if (days === null) return '';
  if (days <= 10) return 'red';
  if (days <= 60) return 'yellow';
  return 'green';
}
export const TYPE_EMOJI = { auto: '🚗', moto: '🏍️', suv: '🚙', furgone: '🚐' };
export const MECH_TYPES = [
  { id: 'olio_motore',    icon: '🛢️',  label: 'Olio Motore',              color: '#f59e0b' },
  { id: 'filtro_olio',    icon: '🔘',  label: 'Filtro Olio',              color: '#f59e0b' },
  { id: 'filtro_aria',    icon: '💨',  label: 'Filtro Aria',              color: '#60a5fa' },
  { id: 'filtro_carburante', icon: '⛽', label: 'Filtro Carburante',      color: '#f97316' },
  { id: 'filtro_abitacolo', icon: '🌬️', label: 'Filtro Abitacolo',       color: '#34d399' },
  { id: 'candele',        icon: '⚡',  label: 'Candele / Candelette',     color: '#eab308' },
  { id: 'lavavetri',      icon: '💧',  label: 'Liquido Lavavetri',        color: '#38bdf8' },
  { id: 'batteria',       icon: '🔋',  label: 'Batteria',                 color: '#22c55e' },
  { id: 'spazzole',       icon: '🪟',  label: 'Spazzole Tergicristallo',  color: '#64748b' },
  { id: 'pompa_acqua',    icon: '🌊',  label: 'Pompa Acqua',              color: '#38bdf8' },
  { id: 'paraflu',        icon: '🧊',  label: "Paraflu'",                 color: '#818cf8' },
  { id: 'cavi_candele',   icon: '🔌',  label: 'Sost. Cavi Candele',       color: '#eab308' },
  { id: 'bobina',         icon: '🔆',  label: 'Sostituzione Bobina',      color: '#fb923c' },
  { id: 'cuffie_giunti',  icon: '🔗',  label: 'Cuffie Giunti',            color: '#a78bfa' },
  { id: 'bracci_ant',     icon: '🔩',  label: 'Bracci Ant.',              color: '#78909c' },
  { id: 'bracci_post',    icon: '🔩',  label: 'Bracci Post.',             color: '#78909c' },
  { id: 'marmitta_centr', icon: '💨',  label: 'Marmitta Centr.',          color: '#6b7280' },
  { id: 'marmitta_post',  icon: '💨',  label: 'Marmitta Post.',           color: '#6b7280' },
  { id: 'cinghia_dist',   icon: '⚙️',  label: 'Cinghia Distribuzione',    color: '#f43f5e' },
  { id: 'cinghia_org',    icon: '⚙️',  label: 'Cinghia Organi Aus.',      color: '#ec4899' },
  { id: 'freni_ant',      icon: '🛑',  label: 'Freni Anteriori',          color: '#ef4444' },
  { id: 'freni_post',     icon: '🛑',  label: 'Freni Posteriori',         color: '#dc2626' },
  { id: 'dischi_ant',     icon: '⭕',  label: 'Dischi Freni Ant.',        color: '#f87171' },
  { id: 'dischi_post',    icon: '⭕',  label: 'Dischi Freni Post.',       color: '#f87171' },
  { id: 'tagliando',      icon: '📋',  label: 'Tagliando',                color: '#21b57e' },
  { id: 'bollo',          icon: '🧾',  label: 'Bollo (pagamento)',        color: '#2f86d6' },
  { id: 'revisione',      icon: '🔍',  label: 'Revisione',                color: '#0ea5a3' },
  { id: 'altro',          icon: '🔨',  label: 'Altro Intervento',         color: '#78909c' },
];
export function getMechType(id) { return MECH_TYPES.find(t => t.id === id) || { icon: '🔧', label: id, color: '#78909c' }; }
export function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function formatCurrency(n) { return n ? '€ ' + Number(n).toLocaleString('it-IT') : '—'; }
export function addYears(dateStr, n) {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() + n);
  return d.toISOString().split('T')[0];
}
