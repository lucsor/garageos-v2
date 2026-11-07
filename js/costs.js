// ===== COSTI DEGLI INTERVENTI MULTI-TIPO =====
// Un salvataggio con N tipi crea N documenti con lo stesso createdAt (stesso veicolo e data) = un "gruppo".
// - Gruppo legacy (v2.2 e precedenti): ogni documento ha lo STESSO costo → si conta una volta sola.
// - Gruppo nuovo (v2.3): costo solo sul primo documento, gli altri vuoti → "incluso".
// - Costi diversi nello stesso gruppo (modificati a mano): sono costi reali, si contano tutti.
export function mechCostInfo(mechs) {
  const groups = new Map();
  for (const m of mechs) {
    if (!m.createdAt) continue;
    const k = `${m.vehicleId}|${m.date}|${m.createdAt}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(m);
  }
  const info = new Map();   // id → { counted: number, included: bool, payer?: id del documento che porta il costo }
  for (const m of mechs) info.set(m.id, { counted: parseFloat(m.cost) || 0, included: false });
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const withCost = g.filter(m => (parseFloat(m.cost) || 0) > 0);
    const sameCost = withCost.length > 1 && withCost.every(m => parseFloat(m.cost) === parseFloat(withCost[0].cost));
    const payer = [...withCost].sort((a, b) => a.id.localeCompare(b.id))[0];
    for (const m of g) {
      if (sameCost && m !== payer) info.set(m.id, { counted: 0, included: true, payer: payer.id });
      else if (!withCost.includes(m) && withCost.length) info.set(m.id, { counted: 0, included: true, payer: payer.id });
    }
  }
  return info;
}
