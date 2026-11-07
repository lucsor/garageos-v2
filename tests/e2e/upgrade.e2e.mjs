// E2E AGGIORNAMENTO dalla versione in produzione (main) a quella del branch, come succede ai telefoni dopo un deploy:
//  1. il telefono ha la versione di main installata (SW attivo, cache piena, utente loggato, dati)
//  2. sul sito arriva la nuova versione: alla riapertura l'app funziona SUBITO (il vecchio SW la scarica dalla rete),
//     compare il banner, il tocco su "Aggiorna" fa un solo reload, la cache vecchia viene rimossa
//  3. offline dopo l'aggiornamento: l'app nuova (moduli compresi) si apre dalla cache
// Prerequisiti: emulatori auth+firestore --project garageos-879bc. Uso: node upgrade.e2e.mjs [ref-base, default main]
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = 'garageos-879bc';
const PORT = 5183;
const APP = `http://127.0.0.1:${PORT}/`;
const T = 60_000;
const BASE = process.argv[2] || 'main';
const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');
const site = mkdtempSync(join(tmpdir(), 'garageos-upgrade-'));
const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); console.log(`  ${cond ? '✔' : '✖'} ${msg}`); };
const git = (...a) => execFileSync('git', ['-c', 'safe.directory=*', '-C', repo, ...a], { maxBuffer: 64 << 20 });
const swVersion = (src) => (src.match(/const VERSION = '([^']+)'/) || [])[1];

// sito = versione BASE (dal git), poi sostituito con la versione del working tree
function publish(fromGit) {
  rmSync(site, { recursive: true, force: true });
  if (fromGit) {
    const files = git('ls-tree', '-r', '--name-only', BASE).toString().split('\n')
      .filter((f) => /^(index\.html|sw\.js|manifest\.json|icon-.*\.png|favicon\.ico|css\/.*|js\/.*)$/.test(f));
    for (const f of files) {
      const out = join(site, f);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, git('show', `${BASE}:${f}`));
    }
  } else {
    for (const f of ['index.html', 'sw.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'favicon.ico', 'css', 'js']) {
      if (existsSync(join(repo, f))) cpSync(join(repo, f), join(site, f), { recursive: true });
    }
    // come un deploy vero: file con data di modifica nuova (su Windows la copia conserva quella originale
    // e il server di test risponderebbe 304 al controllo di sw.js, nascondendo l'aggiornamento)
    const now = new Date();
    const touch = (d) => { for (const f of readdirSync(d)) { const x = join(d, f); if (statSync(x).isDirectory()) touch(x); else utimesSync(x, now, now); } };
    touch(site);
  }
}
let server;
const startServer = () => new Promise((res) => {
  server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: site, stdio: 'ignore' });
  setTimeout(res, 1200);
});
const stopServer = () => new Promise((res) => {
  if (!server || server.exitCode !== null || server.signalCode !== null || server.killed) return res();
  server.on('exit', res); server.kill();
});

await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });

const oldV = swVersion(git('show', `${BASE}:sw.js`).toString());
const newV = swVersion(readFileSync(join(repo, 'sw.js'), 'utf8'));
console.log(`E2E aggiornamento ${BASE} (${oldV}) → working tree (${newV})\n`);
publish(true);
await startServer();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
let navigations = 0;
page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++; });

// 1) versione vecchia installata e in uso
await page.goto(`${APP}?emulator&as=upuser`);
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: T });
await page.click('[data-action="sign-in"]');
await page.waitForFunction(() => document.getElementById('garage-role').textContent === 'Proprietario', null, { timeout: T });
await page.click('#fab');
await page.fill('#v-plate', 'UP123GR');
await page.fill('#v-model', 'Panda aggiornata');
await page.click('[data-action="save-vehicle"]');
await page.waitForFunction(() => document.querySelectorAll('.vehicle-card').length === 1, null, { timeout: T });
check((await page.evaluate(() => caches.keys())).includes(`garageos-v${oldV}`), `versione ${oldV} installata (cache garageos-v${oldV})`);

// 2) deploy della nuova versione → riapertura dell'app
await stopServer();
publish(false);
await startServer();
await page.goto(APP);                                      // l'utente riapre l'app
const opened = await page.waitForFunction(() => document.querySelectorAll('.vehicle-card').length === 1
  && document.getElementById('garage-role').textContent === 'Proprietario', null, { timeout: T }).then(() => true, () => false);
check(opened, 'alla riapertura dopo il deploy l\'app nuova funziona subito (servita dal vecchio SW), loggato, dati presenti');
const banner = await page.waitForSelector('#update-banner.show', { timeout: T }).then(() => true, () => false);
check(banner, 'compare il banner "Nuova versione"');
navigations = 0;
if (banner) await Promise.all([page.waitForNavigation({ timeout: T }), page.click('#update-banner')]);
await page.waitForTimeout(1500);
check(navigations === 1, `tocco su "Aggiorna": un solo reload (${navigations})`);
const keys = await page.evaluate(() => caches.keys());
check(keys.includes(`garageos-v${newV}`) && !keys.includes(`garageos-v${oldV}`), `cache aggiornata: ${keys.filter((k) => k.startsWith('garageos-v')).join(', ')}`);
const ok2 = await page.waitForFunction(() => document.querySelectorAll('.vehicle-card').length === 1, null, { timeout: T }).then(() => true, () => false);
check(ok2, 'dopo l\'aggiornamento l\'app funziona');

// 3) offline con la versione nuova
await stopServer();
await ctx.route(/127\.0\.0\.1:(8080|9099)|googleapis\.com|gstatic\.com|firebaseapp\.com/, (r) => r.abort());
await ctx.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
const off = await page.waitForFunction(() => document.querySelectorAll('.vehicle-card').length === 1
  && /Offline/.test(document.getElementById('db-status').textContent), null, { timeout: T }).then(() => true, () => false);
check(off, 'offline dopo l\'aggiornamento: app nuova (moduli compresi) aperta dalla cache, dati presenti');

await browser.close();
await stopServer();
rmSync(site, { recursive: true, force: true });
if (problems.length) { console.log('\n✖ PROBLEMI:\n' + problems.map((p) => '  - ' + p).join('\n')); process.exit(1); }
console.log('\n✔ Aggiornamento dalla versione in produzione OK');
