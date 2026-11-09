// E2E tema chiaro / scuro (v2.7.1) su emulatori, a 390 px:
//  - "Auto" segue prefers-color-scheme (emulato): token, color-scheme e meta theme-color
//  - selettore Auto / Chiaro / Scuro nel menu utente: la scelta vince sul sistema e resta dopo la ricarica
//  - contrasto WCAG AA misurato sul DOM reale: ogni testo visibile contro il suo fondo effettivo, in tutte le schede
//    e nelle finestre principali, in entrambi i temi (≥ 4.5:1; ≥ 3:1 per il testo grande)
//  - nessuna violazione CSP, nessun errore di pagina
// Prerequisiti: emulatori auth+firestore --project garageos-879bc, app su http://127.0.0.1:5173. Uso: node theme.e2e.mjs
// SHOTS=<cartella> salva gli screenshot chiaro/scuro (Garage, Scadenze, Spese annue).
import { chromium } from 'playwright-core';

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = 'garageos-879bc';
const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
const PROJECT = 'garageos-879bc';
const T = 60_000;
const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); console.log(`  ${cond ? '✔' : '✖'} ${msg}`); };
const iso = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const { adminDb } = await import('../../tools/admin/creds.mjs');
const db = adminDb();

await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, colorScheme: 'dark' });
await ctx.addInitScript(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
});
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('dialog', (d) => { problems.push(`dialog inatteso: ${d.message()}`); d.dismiss(); });

console.log('E2E tema chiaro / scuro\n');
await page.goto(`${APP}?emulator&as=themeowner`);
// schermata di login, sistema scuro, preferenza "Auto"
const state = () => page.evaluate(() => ({
  attr: document.documentElement.getAttribute('data-theme'),
  scheme: getComputedStyle(document.documentElement).colorScheme,
  page: getComputedStyle(document.documentElement).getPropertyValue('--page').trim(),
  card: getComputedStyle(document.querySelector('.login-box') || document.body).backgroundColor,
  meta: document.querySelector('meta[name="theme-color"]').content,
  pref: window.GarageTheme?.get(),
}));
let s = await state();
check(s.attr === null && s.pref === 'auto' && s.scheme === 'dark' && s.page === '#0e1a1e' && s.meta === '#071d23',
  `Auto + sistema scuro → tema scuro (data-theme ${s.attr}, color-scheme ${s.scheme}, --page ${s.page}, theme-color ${s.meta})`);
check(s.card === 'rgb(22, 38, 43)', `riquadro di login scuro (${s.card})`);
await page.emulateMedia({ colorScheme: 'light' });
await page.waitForFunction(() => document.querySelector('meta[name="theme-color"]').content === '#0c333d', null, { timeout: 3000 }).catch(() => {});
s = await state();
check(s.scheme === 'light' && s.page === '#eef2f3' && s.meta === '#0c333d', `Auto + sistema chiaro → tema chiaro, theme-color aggiornato senza ricaricare (${s.meta})`);

await page.click('[data-action="sign-in"]');
await page.waitForFunction(() => document.getElementById('garage-role').textContent === 'Proprietario'
  && document.getElementById('db-status').textContent.includes('Sync'), null, { timeout: T });
let uid = null;
for (let i = 0; i < 20 && !uid; i++) {
  uid = (await db.collection('users').where('email', '==', 'themeowner@example.com').get()).docs[0]?.id || null;
  if (!uid) await page.waitForTimeout(250);
}

// dati di esempio (admin SDK): tutti gli stati (verde, giallo, rosso), sospeso, interventi, rifornimenti, scadenze, pagamenti
const g = db.doc(`garages/${uid}`);
const now = new Date();
const ts = { createdAt: now, updatedAt: now, addedBy: 'themeowner@example.com' };
await g.collection('vehicles').doc('v1').set({ plate: 'TM123AA', model: 'Panda', type: 'auto', year: '2018', km: 52000, kmDate: iso(-3),
  bollo: iso(12), bolloCost: 250, revisione: iso(-5), assicurazione: iso(200), assicurazioneCost: 600, frozen: false, ...ts, createdAt: now.toISOString(), updatedAt: now.toISOString() });
await g.collection('vehicles').doc('v2').set({ plate: 'TM456BB', model: 'Vespa', type: 'moto', bollo: iso(400), frozen: true, frozenAt: now.toISOString(),
  createdAt: now.toISOString(), updatedAt: now.toISOString(), addedBy: 'themeowner@example.com' });
await g.collection('mechs').doc('m1').set({ vehicleId: 'v1', type: 'olio_motore', date: iso(-40), cost: 120, km: 50000, note: 'Officina sotto casa', createdAt: now.toISOString() });
await g.collection('mechs').doc('m2').set({ vehicleId: 'v1', type: 'tagliando', date: iso(-400), cost: 300, km: 40000, createdAt: now.toISOString() });
await g.collection('tires').doc('t1').set({ vehicleId: 'v1', season: 'invernale', date: iso(-20), km: '51000', brand: 'Michelin', size: '175/65 R14', createdAt: now.toISOString(), updatedAt: now.toISOString() });
await g.collection('refuels').doc('r1').set({ vehicleId: 'v1', date: iso(-30), km: 50500, liters: 35, amount: 62.4, full: true, note: '', ...ts });
await g.collection('refuels').doc('r2').set({ vehicleId: 'v1', date: iso(-10), km: 51200, liters: 38.5, amount: 66.1, full: true, note: '', ...ts });
await g.collection('refuels').doc('r3').set({ vehicleId: 'v1', date: iso(-5), km: 51000, liters: 10, amount: 18, full: false, note: '', ...ts });
await g.collection('deadlines').doc('d1').set({ kind: 'ztl', label: 'ZTL Milano', vehicleId: 'v1', due: iso(25), repeatMonths: 12, cost: 80.5, note: 'Rinnovo online', ...ts });
await g.collection('deadlines').doc('d2').set({ kind: 'estintore', label: 'Estintore', vehicleId: null, due: iso(-2), repeatMonths: null, cost: null, ...ts });
await g.collection('payments').doc('p1').set({ deadlineId: 'd1', kind: 'ztl', label: 'ZTL Milano', vehicleId: 'v1', date: iso(-1), amount: 80.5, ...ts });
await g.collection('payments').doc('p2').set({ deadlineId: 'dx', kind: 'telepass', label: 'Telepass', vehicleId: 'v1', date: iso(-60), amount: 12, ...ts, editedBy: 'themeowner@example.com' });
await page.waitForFunction(() => document.querySelectorAll('.vehicle-card').length === 2, null, { timeout: T });

// ── misura del contrasto sul DOM ──
async function contrastScan(label) {
  return page.evaluate((label) => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
    const over = (f, b) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3])).concat(1);
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const root = getComputedStyle(document.documentElement);
    const hex = (v) => { const h = v.trim().replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1); };
    const gradTop = hex(root.getPropertyValue('--grad-top'));
    // fondo effettivo: si risale componendo i fondi semitrasparenti; un gradiente vale --grad-top (testata/login)
    const bgOf = (el) => {
      const layers = [];
      for (let e = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.backgroundImage.includes('gradient') && !e.classList.contains('sp-planned')) { layers.push(gradTop); break; }
        const c = parse(cs.backgroundColor);
        if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
      }
      let base = layers.length && layers[layers.length - 1][3] >= 1 ? layers.pop() : parse(getComputedStyle(document.body).backgroundColor);
      while (layers.length) base = over(layers.pop(), base);
      return base;
    };
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('body *')) {
      if (!el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true })) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      if (!own || !/[\p{L}\p{N}€]/u.test(own)) continue;              // solo emoji/simboli: esclusi (non è testo)
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.closest('.modal-overlay:not(.open), #_toast, [hidden], .sr-only')) continue;
      const cs = getComputedStyle(el);
      let op = 1; for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
      const fg0 = parse(cs.color); if (!fg0) continue;
      const bg = bgOf(el);
      const fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * op], bg);
      const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      const min = large ? 3 : 4.5;
      const cr = ratio(fg, bg);
      if (cr < min) {
        const key = `${el.className}|${cs.color}|${bg.map(Math.round).join(',')}`;
        if (!seen.has(key)) { seen.add(key); out.push(`[${label}] "${own.slice(0, 30)}" (${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}) ${cr.toFixed(2)}:1 < ${min}`); }
      }
    }
    return out;
  }, label);
}

async function visitAll(theme) {
  const fails = [];
  const scan = async (label) => { fails.push(...await contrastScan(`${theme} · ${label}`)); };
  await page.click('#nav-garage'); await page.waitForTimeout(400); await scan('Garage');
  await page.click('#nav-scadenze'); await page.waitForTimeout(400); await scan('Scadenze');
  await page.click('#nav-officina'); await page.click('#seg-meccanica');
  await page.click('.year-header >> nth=0').catch(() => {}); await page.waitForTimeout(300); await scan('Officina · meccanica');
  await page.click('#seg-pneumatici'); await page.waitForTimeout(300); await scan('Officina · pneumatici');
  await page.click('#nav-famiglia'); await page.waitForTimeout(300); await scan('Famiglia');
  await page.click('#nav-spese'); await page.click('#seg-rifornimenti'); await page.waitForTimeout(300); await scan('Spese · rifornimenti');
  await page.click('#seg-annue'); await page.waitForTimeout(300); await scan('Spese · annue');
  await page.click('#seg-pagamenti'); await page.waitForTimeout(300); await scan('Spese · pagamenti');
  await page.click('#pay-list [data-action="pay-edit"] >> nth=0'); await page.waitForSelector('#payment-edit-modal.open'); await page.waitForTimeout(500);   // fine dell'animazione di apertura
  await page.fill('#pe-amount', 'x'); await page.click('[data-action="pay-save"]'); await scan('Modifica pagamento (con errore)');
  await page.click('#payment-edit-modal [data-action="close-modal"]');
  await page.click('#nav-garage'); await page.click('[data-action="edit-vehicle"] >> nth=0'); await page.waitForSelector('#vehicle-modal.open'); await page.waitForTimeout(500);
  await scan('Modifica veicolo'); await page.click('#vehicle-modal [data-action="close-modal"]');
  await page.click('#user-initial'); await page.waitForSelector('#user-menu.open'); await page.waitForTimeout(300); await scan('Menu utente');
  await page.click('#nav-garage', { force: true });
  return fails;
}

// tema chiaro (Auto, sistema chiaro)
let fails = await visitAll('chiaro');
check(fails.length === 0, `contrasto AA nel tema chiaro su tutte le schede${fails.length ? ':\n      ' + fails.join('\n      ') : ''}`);
const shots = process.env.SHOTS;
const shoot = async (name) => { if (shots) await page.screenshot({ path: `${shots}/v2.7.1-${name}.png` }); };
if (shots) {
  for (const [nav, name, seg] of [['#nav-garage', 'garage'], ['#nav-scadenze', 'scadenze'], ['#nav-spese', 'spese-annue', '#seg-annue']]) {
    await page.click(nav); if (seg) await page.click(seg); await page.waitForTimeout(500); await shoot(`${name}-chiaro`);
  }
}

// selettore: "Scuro" con il sistema chiaro
await page.click('#nav-garage');
await page.click('#user-initial');
await page.waitForSelector('#user-menu.open');
check(await page.getAttribute('[data-action="theme"][data-choice="auto"]', 'aria-checked') === 'true', 'selettore: "Auto" selezionato all\'inizio');
await page.click('[data-action="theme"][data-choice="dark"]');
s = await state();
check(s.attr === 'dark' && s.scheme === 'dark' && s.page === '#0e1a1e' && s.meta === '#071d23' && s.pref === 'dark',
  `"Scuro" vince sul sistema chiaro (data-theme ${s.attr}, theme-color ${s.meta})`);
check(await page.getAttribute('[data-action="theme"][data-choice="dark"]', 'aria-checked') === 'true', 'selettore: "Scuro" segnato (aria-checked)');
await page.reload();
await page.waitForFunction(() => document.getElementById('garage-role').textContent === 'Proprietario', null, { timeout: T });
s = await state();
check(s.attr === 'dark' && s.meta === '#071d23', 'la scelta resta dopo la ricarica');

fails = await visitAll('scuro');
check(fails.length === 0, `contrasto AA nel tema scuro su tutte le schede${fails.length ? ':\n      ' + fails.join('\n      ') : ''}`);
if (shots) {
  for (const [nav, name, seg] of [['#nav-garage', 'garage'], ['#nav-scadenze', 'scadenze'], ['#nav-spese', 'spese-annue', '#seg-annue']]) {
    await page.click(nav); if (seg) await page.click(seg); await page.waitForTimeout(500); await shoot(`${name}-scuro`);
  }
}

// "Chiaro" con il sistema scuro, poi "Auto"
await page.emulateMedia({ colorScheme: 'dark' });
await page.click('#nav-garage');
await page.click('#user-initial');
await page.click('[data-action="theme"][data-choice="light"]');
s = await state();
check(s.attr === 'light' && s.scheme === 'light' && s.page === '#eef2f3' && s.meta === '#0c333d', `"Chiaro" vince sul sistema scuro (theme-color ${s.meta})`);
await page.click('[data-action="theme"][data-choice="auto"]');
s = await state();
check(s.attr === null && s.pref === 'auto' && s.scheme === 'dark' && s.meta === '#071d23', '"Auto" torna a seguire il sistema (scuro)');
check(await page.evaluate(() => { try { return localStorage.getItem('garageos_theme'); } catch { return 'x'; } }) === null, '"Auto" non lascia preferenze salvate');
check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'a 390 px nessuno scroll orizzontale');

const csp = [...new Set(await page.evaluate(() => window.__csp))];
check(csp.length === 0, `nessuna violazione CSP${csp.length ? ': ' + csp.join(' | ') : ''}`);
await ctx.close();
await browser.close();
if (problems.length) { console.log('\n✖ PROBLEMI:\n' + problems.map((p) => '  - ' + p).join('\n')); process.exit(1); }
console.log('\n✔ Tema chiaro / scuro OK');
