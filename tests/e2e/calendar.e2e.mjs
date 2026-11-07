// E2E calendario (.ics) su emulatori: scadenze → file .ics scaricato davvero dal browser.
//  - "📅 Calendario" scarica tutte le scadenze FUTURE dei veicoli attivi, con 2 promemoria ciascuna
//  - il pulsante 📅 su una scadenza scarica solo quell'evento; nessun 📅 sulle scadenze già passate
//  - nessuna violazione CSP
// Prerequisiti: emulatori auth+firestore --project garageos-879bc, app su http://127.0.0.1:5173. Uso: node calendar.e2e.mjs
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
const PROJECT = 'garageos-879bc';
const T = 60_000;
const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); console.log(`  ${cond ? '✔' : '✖'} ${msg}`); };
const iso = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ acceptDownloads: true });
await ctx.addInitScript(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
});
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

console.log('E2E calendario (.ics)\n');
await page.goto(`${APP}?emulator&as=caluser`);
await page.click('[data-action="sign-in"]');
await page.waitForFunction(() => document.getElementById('garage-role').textContent === 'Proprietario', null, { timeout: T });

const bollo = iso(40), assic = iso(90), revPassata = iso(-10);
await page.click('#fab');
await page.fill('#v-plate', 'CA123LN');
await page.fill('#v-model', 'Panda; "calendario"');
await page.fill('#v-bollo', bollo);
await page.fill('#v-revisione', revPassata);
await page.fill('#v-assicurazione', assic);
await page.click('[data-action="save-vehicle"]');
await page.waitForFunction(() => document.querySelectorAll('.vehicle-card').length === 1, null, { timeout: T });

await page.click('#nav-scadenze');
await page.waitForSelector('.scadenza-item', { timeout: T });
const icsButtons = await page.$$eval('[data-action="ics-one"]', (b) => b.map((x) => x.dataset.kind));
check(JSON.stringify(icsButtons.sort()) === '["assicurazione","bollo"]', `📅 solo sulle scadenze future (${icsButtons.join(', ')}), non sulla revisione passata`);

const read = async (dl) => readFileSync(await dl.path(), 'utf8');
let [dl] = await Promise.all([page.waitForEvent('download', { timeout: T }), page.click('[data-action="ics-all"]')]);
let ics = await read(dl);
const unf = ics.replace(/\r\n /g, '');
check(/^garageos-scadenze-\d{4}-\d{2}-\d{2}\.ics$/.test(dl.suggestedFilename()), `file: ${dl.suggestedFilename()}`);
check(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.trimEnd().endsWith('END:VCALENDAR'), 'file iCalendar valido (inizio/fine, CRLF)');
check((unf.match(/^BEGIN:VEVENT/gm) || []).length === 2, 'due eventi (bollo e assicurazione), la revisione passata esclusa');
check(unf.includes(`DTSTART;VALUE=DATE:${bollo.replace(/-/g, '')}`) && unf.includes(`DTSTART;VALUE=DATE:${assic.replace(/-/g, '')}`), 'date corrette, eventi tutto il giorno');
check((unf.match(/^BEGIN:VALARM/gm) || []).length === 4, 'due promemoria per evento');
check(unf.includes('Panda\\; "calendario"'), 'testo dell\'utente escapato (punto e virgola)');

[dl] = await Promise.all([page.waitForEvent('download', { timeout: T }), page.click('[data-action="ics-one"][data-kind="bollo"]')]);
ics = (await read(dl)).replace(/\r\n /g, '');
check(dl.suggestedFilename() === 'garageos-bollo-ca123ln.ics', `singola scadenza: ${dl.suggestedFilename()}`);
check((ics.match(/^BEGIN:VEVENT/gm) || []).length === 1 && /SUMMARY:📋 Bollo — CA123LN/.test(ics), 'un solo evento, "📋 Bollo — CA123LN"');

const csp = [...new Set(await page.evaluate(() => window.__csp))];
check(csp.length === 0, `nessuna violazione CSP${csp.length ? ': ' + csp.join(' | ') : ''}`);
await browser.close();
if (problems.length) { console.log('\n✖ PROBLEMI:\n' + problems.map((p) => '  - ' + p).join('\n')); process.exit(1); }
console.log('\n✔ Calendario .ics OK');
