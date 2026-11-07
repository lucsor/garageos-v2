// Test unitari dei moduli puri (possibili solo dopo la divisione in moduli ES): node --test tests/unit
// Il test sui costi usa i DATI REALI del backup, se presente in GARAGEOS_BACKUP_DIR (altrimenti viene saltato).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mechCostInfo } from '../../js/costs.js';
import { esc, safeImg, daysUntil, badgeClass, getMechType, addYears, formatCurrency } from '../../js/utils.js';
import { csvSafe } from '../../js/csv.js';

const total = (mechs) => { const info = mechCostInfo(mechs); return mechs.reduce((s, m) => s + info.get(m.id).counted, 0); };
const m = (id, cost, extra = {}) => ({ id, vehicleId: 'v1', date: '2026-01-10', createdAt: '2026-01-10T10:00:00.000Z', type: 'olio_motore', cost, ...extra });

test('costi: gruppo legacy con costo ripetuto → contato una volta', () => {
  const g = [m('a', '100'), m('b', '100'), m('c', '100')];
  assert.equal(total(g), 100);
  const info = mechCostInfo(g);
  assert.equal([...info.values()].filter((x) => x.included).length, 2);
});
test('costi: nuovo salvataggio (costo solo sul primo) → costo una volta, altri "incluso"', () => {
  const g = [m('a', '250'), m('b', ''), m('c', '')];
  assert.equal(total(g), 250);
  assert.deepEqual(['a', 'b', 'c'].map((id) => mechCostInfo(g).get(id).included), [false, true, true]);
});
test('costi: costi diversi nello stesso gruppo sono tutti reali', () => {
  assert.equal(total([m('a', '100'), m('b', '40')]), 140);
});
test('costi: interventi separati (createdAt diversi) non si fondono', () => {
  assert.equal(total([m('a', '100'), m('b', '100', { createdAt: '2026-01-10T10:00:01.000Z' })]), 200);
});
test('costi: interventi senza createdAt o senza costo', () => {
  assert.equal(total([m('a', '50', { createdAt: undefined }), m('b', '50', { createdAt: undefined }), m('c', '')]), 100);
});

const DIR = process.env.GARAGEOS_BACKUP_DIR || join(homedir(), 'Documents', 'garageos-backup');
const backupFile = existsSync(DIR) && readdirSync(DIR).filter((f) => f.startsWith('firestore-') && f.endsWith('.json')).sort().pop();
test('costi: dati reali del backup — totali invariati e gruppi multi-tipo riconosciuti', { skip: !backupFile && 'backup assente' }, () => {
  const D = JSON.parse(readFileSync(join(DIR, backupFile), 'utf8')).documents;
  const byGarage = {};
  for (const [p, doc] of Object.entries(D)) {
    const s = p.split('/');
    if (s[0] === 'garages' && s[2] === 'mechs') (byGarage[s[1]] ||= []).push({ id: s[3], ...doc });
  }
  let groups = 0;
  for (const mechs of Object.values(byGarage)) {
    const naive = mechs.reduce((s, x) => s + (parseFloat(x.cost) || 0), 0);
    assert.equal(total(mechs), naive, 'sui dati reali nessun costo duplicato: totale invariato');
    const keys = mechs.map((x) => `${x.vehicleId}|${x.date}|${x.createdAt}`);
    groups += new Set(keys.filter((k, i) => keys.indexOf(k) !== i)).size;
  }
  assert.ok(groups >= 1, 'il backup contiene gruppi multi-tipo');
});

test('utils: esc neutralizza i caratteri HTML', () => {
  assert.equal(esc(`<img src=x onerror="a('b')">`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;');
  assert.equal(esc(null), '');
});
test('utils: safeImg accetta solo https', () => {
  assert.equal(safeImg('https://lh3.googleusercontent.com/a'), 'https://lh3.googleusercontent.com/a');
  for (const u of ['javascript:alert(1)', 'http://x/y.png', 'data:image/png;base64,AAA', 42]) assert.equal(safeImg(u), '');
});
test('utils: badge e scadenze', () => {
  assert.equal(badgeClass(null), '');
  assert.equal(badgeClass(5), 'red');
  assert.equal(badgeClass(30), 'yellow');
  assert.equal(badgeClass(90), 'green');
  assert.equal(daysUntil(''), null);
  assert.equal(addYears('2026-03-15', 2), '2028-03-15');
  assert.equal(getMechType('sconosciuto').label, 'sconosciuto');
  assert.equal(formatCurrency(''), '—');
});
test('csv: formula injection neutralizzata', () => {
  for (const v of ['=HYPERLINK("x")', '+1', '-2+3', '@SUM(A1)']) assert.ok(csvSafe(v).startsWith("'"), v);
  assert.equal(csvSafe('Tagliando'), 'Tagliando');
  assert.equal(csvSafe(-5), '-5');   // i numeri veri restano numeri
});
