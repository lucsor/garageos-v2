// E2E avviso "vecchia icona" (arrivo dal redirect della v1 con ?from=v1):
//  - arrivo con ?from=v1 → avviso visibile (anche sopra la schermata di login), parametro tolto dall'URL
//    (gli altri parametri restano), testo esatto
//  - "Installa": Android con beforeinstallprompt → prompt vero; Android senza prompt → istruzioni menu ⋮;
//    iPhone → "Condividi → Aggiungi alla schermata Home"
//  - "Ho capito" → non ricompare, nemmeno arrivando di nuovo con ?from=v1
//  - app installata (display-mode: standalone) → non compare, ma il parametro viene tolto lo stesso
//  - app già installata ma aperta nel browser (niente beforeinstallprompt, getInstalledRelatedApps → [app]) →
//    "L'app è già installata: aprila dalla schermata Home…", nessun pulsante "Installa" muto
//  - l'avviso spinge giù il contenuto dell'app (non lo copre)
//  - senza ?from=v1 → non compare; nessuna violazione CSP, nessun errore
// Prerequisiti: emulatori auth+firestore --project garageos-879bc, app su http://127.0.0.1:5173. Uso: node legacy-banner.e2e.mjs
import { chromium } from 'playwright-core';

const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
const T = 30_000;
const TEXT = 'Stai usando la vecchia icona. Installa la nuova app e cancella quella vecchia dalla schermata Home.';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); console.log(`  ${cond ? '✔' : '✖'} ${msg}`); };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function open({ ua = ANDROID, standalone = false, installPrompt = null, relatedApps = undefined } = {}) {
  const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 390, height: 800 } });
  await ctx.addInitScript(({ standalone, installPrompt, relatedApps }) => {
    if (relatedApps !== undefined) navigator.getInstalledRelatedApps = async () => relatedApps;   // Chrome Android
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    if (standalone) {   // come l'app installata aperta dalla sua icona
      const mm = window.matchMedia.bind(window);
      window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q));
    }
    if (installPrompt) {   // Chrome Android: evento beforeinstallprompt simulato
      window.__prompted = 0;
      addEventListener('load', () => setTimeout(() => {
        const e = new Event('beforeinstallprompt', { cancelable: true });
        e.prompt = async () => { window.__prompted++; };
        e.userChoice = Promise.resolve({ outcome: installPrompt });
        dispatchEvent(e);
      }, 50));
    }
  }, { standalone, installPrompt, relatedApps });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { ctx, page };
}
const clickInstall = async (page) => {   // il messaggio arriva dopo il controllo (asincrono) dell'app installata
  await page.click('#legacy-install');
  await page.waitForFunction(() => !document.getElementById('legacy-help').hidden, null, { timeout: 5000 }).catch(() => {});
};
const visible = (page) => page.$eval('#legacy-banner', (el) => !el.hidden && getComputedStyle(el).display !== 'none');
const settle = (page) => page.waitForFunction(() => typeof document.getElementById('legacy-banner')?.hidden === 'boolean' && document.readyState === 'complete', null, { timeout: T }).then(() => page.waitForTimeout(400));
// Escluse solo:
// - l'iframe dell'emulatore di Auth (getRedirectResult con UA mobile): esiste anche su main e non in produzione,
//   dove frame-src contiene già l'authDomain;
// - il ping di telemetria di Google (apis.google.com/js/gen_204) del caricatore gapi con UA mobile: compare a caso,
//   è bloccato dalla CSP senza effetti e non porta dati dell'app (rendeva la CI rossa in modo casuale).
const IGNORED_CSP = (x) => x === 'frame-src http://127.0.0.1:9099' || /^connect-src https:\/\/apis\.google\.com\/js\/gen_204/.test(x);
const cspOk = async (page, name) => { const v = (await page.evaluate(() => window.__csp)).filter((x) => !IGNORED_CSP(x)); check(v.length === 0, `${name}: nessuna violazione CSP${v.length ? ' (' + v.join('; ') + ')' : ''}`); };

console.log('E2E avviso "vecchia icona"\n');

console.log('Android, arrivo dalla v1');
let { ctx, page } = await open();
await page.goto(`${APP}?emulator&from=v1`);
await settle(page);
check(await visible(page), 'avviso visibile');
check((await page.textContent('#legacy-banner .lb-text')).trim() === TEXT, 'testo esatto');
const u = new URL(page.url());
check(!u.search.includes('from='), `parametro tolto dall'URL (${u.pathname}${u.search})`);
check(u.search === '?emulator', 'gli altri parametri restano invariati');
check(await page.evaluate(() => { const b = document.getElementById('legacy-banner').getBoundingClientRect(); const el = document.elementFromPoint(b.left + b.width / 2, b.top + 10); return !!el?.closest('#legacy-banner'); }),
  'sopra la schermata di login (non coperto)');
check(await page.isVisible('#login-screen'), 'login visibile sotto');
await clickInstall(page);
check(/⋮.*Installa app/.test(await page.textContent('#legacy-help')) && await page.isVisible('#legacy-help'), 'senza prompt del browser: istruzioni del menu ⋮');
check(await page.$eval('#legacy-help', (h) => h.classList.contains('lb-strong')), 'istruzioni in evidenza');
await page.click('#legacy-dismiss');
check(!(await visible(page)), '"Ho capito" chiude l\'avviso');
await page.goto(`${APP}?emulator&from=v1`);
await settle(page);
check(!(await visible(page)), 'dopo "Ho capito" non ricompare (nuovo arrivo con ?from=v1)');
check(!page.url().includes('from='), 'parametro tolto anche quando l\'avviso non compare');
await cspOk(page, 'Android');
await ctx.close();

console.log('\nAndroid con il prompt di installazione di Chrome');
({ ctx, page } = await open({ installPrompt: 'accepted' }));
await page.goto(`${APP}?emulator&from=v1`);
await settle(page);
await page.waitForTimeout(300);
await page.click('#legacy-install');
await page.waitForFunction(() => window.__prompted === 1, null, { timeout: 5000 }).catch(() => {});
check(await page.evaluate(() => window.__prompted) === 1, '"Installa" apre il prompt di installazione');
await page.waitForFunction(() => /Fatto!/.test(document.getElementById('legacy-help').textContent), null, { timeout: 5000 }).catch(() => {});
check(/Fatto!.*vecchia icona/.test(await page.textContent('#legacy-help')), 'dopo l\'installazione: "Fatto! … vecchia icona"');
check(!(await page.isVisible('#legacy-install')), 'pulsante "Installa" nascosto dopo l\'installazione');
await page.goto(`${APP}?emulator&from=v1`);
await settle(page);
check(!(await visible(page)), 'installata da qui → non ricompare');
await ctx.close();

console.log('\niPhone, arrivo dalla v1');
({ ctx, page } = await open({ ua: IPHONE }));
await page.goto(`${APP}?emulator&from=v1`);
await settle(page);
check(await visible(page), 'avviso visibile');
await clickInstall(page);
check(/Condividi.*Aggiungi alla schermata Home/.test(await page.textContent('#legacy-help')), 'istruzioni "Condividi → Aggiungi alla schermata Home"');
await cspOk(page, 'iPhone');
await ctx.close();

console.log('\nApp già installata (standalone)');
({ ctx, page } = await open({ standalone: true }));
await page.goto(`${APP}?emulator&from=v1`);
await settle(page);
check(!(await visible(page)), 'in standalone non compare');
check(!page.url().includes('from='), 'parametro tolto comunque');
await ctx.close();

console.log('\nAndroid, app già installata ma aperta nel browser (nessun beforeinstallprompt)');
const INSTALLED = "L'app è già installata: aprila dalla schermata Home e cancella la vecchia icona.";
({ ctx, page } = await open({ relatedApps: [{ platform: 'webapp', url: 'https://lucsor.github.io/garageos-v2/manifest.json' }] }));
await page.goto(`${APP}?emulator&from=v1`);
await settle(page);
check(await visible(page), 'avviso visibile');
await page.waitForFunction(() => !document.getElementById('legacy-help').hidden, null, { timeout: 5000 }).catch(() => {});
check((await page.textContent('#legacy-help')).trim() === INSTALLED && await page.isVisible('#legacy-help'), `messaggio "${INSTALLED}"`);
check(!(await page.isVisible('#legacy-install')), 'nessun pulsante "Installa" che non farebbe nulla');
check(await page.isVisible('#legacy-dismiss'), '"Ho capito" resta');
await page.click('#legacy-dismiss');
check(!(await visible(page)), '"Ho capito" chiude l\'avviso');
await page.goto(`${APP}?emulator&from=v1`);
await settle(page);
check(!(await visible(page)), 'non ricompare');
await cspOk(page, 'già installata');
await ctx.close();

console.log('\nAndroid, API presente ma app non installata');
({ ctx, page } = await open({ relatedApps: [] }));
await page.goto(`${APP}?emulator&from=v1`);
await settle(page);
check(await page.isVisible('#legacy-install') && await page.$eval('#legacy-help', (h) => h.hidden), 'nessun messaggio prima del tocco, "Installa" visibile');
await clickInstall(page);
check(/⋮/.test(await page.textContent('#legacy-help')) && await page.$eval('#legacy-help', (h) => h.classList.contains('lb-strong')), '"Installa" senza prompt → istruzioni del menu ⋮ in evidenza');
await ctx.close();

console.log('\nApp con accesso fatto: l\'avviso spinge giù il contenuto');
({ ctx, page } = await open());
await page.goto(`${APP}?emulator&as=lbuser`);
await page.click('[data-action="sign-in"]');
await page.waitForFunction(() => document.getElementById('garage-role').textContent === 'Proprietario', null, { timeout: T });
await page.goto(`${APP}?emulator&as=lbuser&from=v1`);
await page.waitForFunction(() => document.getElementById('garage-role').textContent === 'Proprietario', null, { timeout: T });
await settle(page);
check(await visible(page), 'avviso visibile sopra l\'app');
const box = await page.evaluate(() => ({ b: document.getElementById('legacy-banner').getBoundingClientRect().bottom, a: document.querySelector('#app .app-top').getBoundingClientRect().top }));
check(box.a >= box.b, `il contenuto inizia sotto l'avviso (avviso fino a ${Math.round(box.b)} px, app da ${Math.round(box.a)} px)`);
await page.click('#legacy-dismiss');
const topAfter = await page.evaluate(() => document.querySelector('#app .app-top').getBoundingClientRect().top);
check(topAfter < box.a, `chiuso l'avviso il contenuto risale (${Math.round(topAfter)} px)`);
await cspOk(page, 'app');
await ctx.close();

console.log('\nApertura normale');
({ ctx, page } = await open());
await page.goto(`${APP}?emulator`);
await settle(page);
check(!(await visible(page)), 'senza ?from=v1 non compare');
await ctx.close();

await browser.close();
if (problems.length) { console.log('\n✖ PROBLEMI:\n' + problems.map((p) => '  - ' + p).join('\n')); process.exit(1); }
console.log('\n✔ Avviso "vecchia icona" ok');
