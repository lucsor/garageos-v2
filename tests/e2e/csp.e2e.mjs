// E2E: CSP + flussi principali su emulatori (Chrome installato, nessun browser scaricato).
// Prerequisiti: emulatori avviati (firebase emulators:start --only auth,firestore --project garageos-879bc)
//               e app servita su http://127.0.0.1:5173 (python -m http.server 5173 --bind 127.0.0.1)
// Uso: npm run test:csp
import { chromium } from 'playwright-core';

const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
const PROJECT = 'garageos-879bc';
const T = 60_000;
const problems = [];
const log = (...a) => console.log('  ·', ...a);

// emulatori puliti a ogni esecuzione
await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function openUser(name, extra = '') {
  const ctx = await browser.newContext();               // storage separato per utente
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.__csp.push(`${e.violatedDirective} ← ${e.blockedURI || 'inline'} (${e.sourceFile}:${e.lineNumber})`));
  });
  page.on('pageerror', (e) => problems.push(`[${name}] pageerror: ${e.message}`));
  page.on('dialog', async (d) => { problems.push(`[${name}] DIALOG (possibile XSS): ${d.message()}`); await d.dismiss(); });
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(`[${name}] console: ${m.text()}`); });
  await page.exposeFunction('__toastLog', (t) => console.log(`    [toast ${name}] ${t}`));
  await page.addInitScript(() => {
    new MutationObserver(() => { const t = document.getElementById('_toast'); if (t && t.textContent !== window.__lastToast) { window.__lastToast = t.textContent; window.__toastLog(t.textContent); } })
      .observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.goto(`${APP}?emulator&as=${name}${extra}`);
  await page.click('[data-action="sign-in"]');
  return page;
}
const role = (page, r) => page.waitForFunction((r) => document.getElementById('garage-role').textContent === r, r, { timeout: T });

console.log('E2E CSP — ' + APP);
// 0) regressione: flag di login "in corso" rimasto in localStorage non deve bloccare la schermata di accesso
{
  const ctx0 = await browser.newContext();
  const p0 = await ctx0.newPage();
  p0.on('pageerror', (e) => problems.push(`[login-bloccato] pageerror: ${e.message}`));
  await p0.goto(`${APP}?emulator`);
  await p0.evaluate(() => localStorage.setItem('garageos_auth_pending', '1'));
  await p0.reload();
  try {
    await p0.waitForSelector('[data-action="sign-in"]', { timeout: T });
    log('flag "accesso in corso" orfano: pulsante di login ripristinato');
  } catch { problems.push('schermata bloccata su "Accesso in corso…" senza pulsante'); }
  await ctx0.close();
}
// 1) alice: login, garage, veicolo con payload XSS nel modello
const alice = await openUser('alice');
await role(alice, 'Proprietario');
await alice.waitForFunction(() => document.getElementById('garage-title').textContent.includes('Il mio Garage'), null, { timeout: T });
log('alice: login + garage creato');
await alice.click('#fab');
await alice.fill('#v-plate', 'AB123CD');
await alice.fill('#v-model', '"><img src=x onerror=alert(1)>');
await alice.fill('#v-note', '=HYPERLINK("http://evil","x")');
await alice.click('[data-action="save-vehicle"]');
await alice.waitForSelector('.vehicle-card .vc-model', { timeout: T });
const modelText = await alice.textContent('.vehicle-card .vc-model');
if (modelText !== '"><img src=x onerror=alert(1)>') problems.push('modello non mostrato come testo: ' + modelText);
if (await alice.$('.vehicle-card img')) problems.push('XSS: <img> iniettata nel DOM');
log('alice: veicolo salvato, payload mostrato come testo');

// 2) invito
await alice.click('#nav-famiglia');
await alice.fill('#invite-email', 'carol@example.com');
await alice.click('[data-action="send-invite"]');
await alice.waitForFunction(() => document.getElementById('share-link-text').textContent.includes('invite='), null, { timeout: T });
const link = await alice.textContent('#share-link-text');
const token = new URL(link).searchParams.get('invite');
if (!/^[a-f0-9]{64}$/.test(token)) problems.push('token non valido: ' + token);
log('alice: invito creato (token 64 hex)');

// 3) carol accetta
const carol = await openUser('carol', `&invite=${token}`);
await carol.waitForSelector('#confirm-modal.open', { timeout: T });
await carol.click('#confirm-yes');
await carol.waitForFunction(() => document.getElementById('garage-title').textContent === 'Garage di alice', null, { timeout: T });
log('carol: entrata nel garage di alice');
await alice.waitForFunction(() => document.getElementById('family-grid').textContent.includes('carol@example.com') &&
  !!document.querySelector('[data-action="remove-member"]'), null, { timeout: T });
log('alice: vede carol tra i membri (realtime)');

// 4) riuso dello stesso link
const carol2 = await openUser('carol', `&invite=${token}`);
await carol2.waitForFunction(() => (document.getElementById('_toast')?.textContent || '').includes('già stato usato'), null, { timeout: T });
log('carol: riuso dello stesso link rifiutato');

await alice.click('#nav-officina');
// 5) rimozione: carol torna al proprio garage
await alice.click('#nav-famiglia');
await alice.click('[data-action="remove-member"]');
await alice.click('#confirm-yes');
await carol.waitForFunction(() => document.getElementById('garage-role').textContent === 'Proprietario', null, { timeout: T });
log('alice rimuove carol → carol torna al proprio garage');

for (const [n, p] of [['alice', alice], ['carol', carol], ['carol2', carol2]]) {
  for (const v of await p.evaluate(() => window.__csp)) problems.push(`[${n}] CSP violation: ${v}`);
}
await browser.close();
if (problems.length) { console.log('\n✖ PROBLEMI:\n' + problems.map((p) => '  - ' + p).join('\n')); process.exit(1); }
console.log('\n✔ Nessuna violazione CSP, nessun dialog/errore di pagina, flussi OK');
