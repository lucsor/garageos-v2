// E2E calendario (.ics) su emulatori: scadenze → file .ics scaricato davvero dal browser.
//  - "📅 Calendario" scarica tutte le scadenze FUTURE dei veicoli attivi, con 2 promemoria ciascuna
//  - il pulsante 📅 su una scadenza apre la scelta: file .ics (solo quell'evento) o link Google Calendar;
//    nessun 📅 sulle scadenze già passate
//  - Android: nota sui promemoria ignorati da Google Calendar, Google Calendar come prima scelta,
//    file scaricato (Chrome non condivide i .ics)
//  - iPhone: il file passa dal foglio di condivisione (Web Share API, simulata), non dal download
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
const icsButtons = await page.$$eval('[data-action="cal-choice"]', (b) => b.map((x) => x.dataset.kind));
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

check(await page.textContent('#cal-android-note') === '', 'desktop: nessuna nota Android');
await page.click('[data-action="cal-choice"][data-kind="bollo"]');
await page.waitForSelector('#cal-modal.open', { timeout: T });
const g = new URL(await page.getAttribute('#cal-google', 'href'));
check(g.hostname === 'calendar.google.com' && g.searchParams.get('dates') === `${bollo.replace(/-/g, '')}/${(() => { const d = new Date(bollo + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10).replace(/-/g, ''); })()}`,
  `link Google Calendar per la singola scadenza (${g.searchParams.get('dates')})`);
check(await page.$eval('#cal-options', (b) => b.firstElementChild.id) === 'cal-file', 'desktop: prima scelta il file .ics con i promemoria');
check(/inviati a Google \(l'importo no\)/.test(await page.textContent('#cal-note')), 'la finestra avvisa che con Google Calendar i dati vanno a Google');
check(!new URL(await page.getAttribute('#cal-google', 'href')).searchParams.get('details').includes('Importo'), 'nessun importo nel link Google');
await page.keyboard.press('Escape');
check(!(await page.$eval('#cal-modal', (m) => m.classList.contains('open'))), 'Esc chiude la finestra');
check(await page.getAttribute('#cal-modal .modal', 'role') === 'dialog', 'finestra con role="dialog"');
await page.click('[data-action="cal-choice"][data-kind="bollo"]');
await page.waitForSelector('#cal-modal.open', { timeout: T });
[dl] = await Promise.all([page.waitForEvent('download', { timeout: T }), page.click('#cal-file')]);
ics = (await read(dl)).replace(/\r\n /g, '');
check(dl.suggestedFilename() === 'garageos-bollo-ca123ln.ics', `singola scadenza: ${dl.suggestedFilename()}`);
check((ics.match(/^BEGIN:VEVENT/gm) || []).length === 1 && /SUMMARY:📋 Bollo — CA123LN/.test(ics), 'un solo evento, "📋 Bollo — CA123LN"');

check(!(await page.$eval('#cal-modal', (m) => m.classList.contains('open'))), 'la finestra si chiude dopo la scelta del file');
const csp = [...new Set(await page.evaluate(() => window.__csp))];
check(csp.length === 0, `nessuna violazione CSP${csp.length ? ': ' + csp.join(' | ') : ''}`);

// ── Android (UA di Chrome Android): nota, Google Calendar per primo, file scaricato
async function openAs(ua, init) {
  const c = await browser.newContext({ acceptDownloads: true, userAgent: ua, hasTouch: true });
  if (init) await c.addInitScript(init);
  const p = await c.newPage();
  p.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await p.goto(`${APP}?emulator&as=caluser`);
  await p.click('[data-action="sign-in"]');
  await p.waitForSelector('.vehicle-card', { timeout: T });
  await p.click('#nav-scadenze');
  await p.waitForSelector('.scadenza-item', { timeout: T });
  return { c, p };
}
{
  const { c, p } = await openAs('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36');
  check(/Google Calendar i promemoria del file \.ics vengono ignorati/.test(await p.textContent('#cal-android-note')), 'Android: nota sui promemoria ignorati da Google Calendar');
  await p.click('[data-action="cal-choice"][data-kind="bollo"]');
  await p.waitForSelector('#cal-modal.open', { timeout: T });
  check(await p.$eval('#cal-options', (b) => b.firstElementChild.id) === 'cal-google', 'Android: prima scelta "Google Calendar"');
  check(/notifiche predefinite/.test(await p.textContent('#cal-note')), 'Android: nota sulle notifiche predefinite di Google Calendar');
  await p.click('[data-action="close-modal"][data-modal="cal-modal"]');
  const [d] = await Promise.all([p.waitForEvent('download', { timeout: T }), p.click('[data-action="ics-all"]')]);
  check(/\.ics$/.test(d.suggestedFilename()), 'Android: "📅 Calendario" scarica il file (condivisione .ics non supportata da Chrome)');
  await c.close();
}
// ── iPhone (UA iOS + Web Share API simulata): il file passa dal foglio di condivisione
{
  const { c, p } = await openAs('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', () => {
    window.__shared = [];
    Object.defineProperty(navigator, 'canShare', { value: (d) => !!d?.files?.length, configurable: true });
    Object.defineProperty(navigator, 'share', { value: async (d) => { window.__shared.push({ name: d.files[0].name, type: d.files[0].type, text: await d.files[0].text() }); }, configurable: true });
  });
  let downloaded = false;
  p.on('download', () => { downloaded = true; });
  await p.click('[data-action="ics-all"]');
  await p.waitForTimeout(1500);
  const sh = await p.evaluate(() => window.__shared);
  check(sh.length === 1 && /\.ics$/.test(sh[0].name) && sh[0].type === 'text/calendar' && sh[0].text.includes('BEGIN:VCALENDAR'), `iPhone: file .ics passato al foglio di condivisione (${sh.map((x) => x.name).join(', ')})`);
  check(!downloaded, 'iPhone: nessun download quando la condivisione riesce');
  await c.close();
}
await browser.close();
if (problems.length) { console.log('\n✖ PROBLEMI:\n' + problems.map((p) => '  - ' + p).join('\n')); process.exit(1); }
console.log('\n✔ Calendario .ics OK');
