// E2E: chi ha ancora la v1 installata (vecchio service worker + cache della v1) arriva alla v2 alla PRIMA
// apertura online, e non viene toccato niente della v2 sulla stessa origine.
// Il sito della v1 è servito in locale da due commit del repo lucsor/garageOS:
//   PRIMA = ultima v1 vera (7dfc0d2), DOPO = redirect + kill switch in produzione (origin/main).
// Il redirect punta all'indirizzo assoluto della v2 in produzione: il test intercetta quella richiesta
// (risponde una pagina finta) per non dipendere dalla rete e per verificare dove si arriva.
// Uso: node v1-redirect.e2e.mjs <percorso del clone di lucsor/garageOS>
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const V1 = process.argv[2];
if (!V1) { console.error('Uso: node v1-redirect.e2e.mjs <clone di lucsor/garageOS>'); process.exit(2); }
const PORT = 5184;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const V2 = 'https://lucsor.github.io/garageos-v2/';
const T = 30_000;
const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); console.log(`  ${cond ? '✔' : '✖'} ${msg}`); };
const git = (...a) => execFileSync('git', ['-c', 'safe.directory=*', '-C', V1, ...a], { maxBuffer: 64 << 20 });
const root = mkdtempSync(join(tmpdir(), 'garageos-v1-'));

function publish(ref) {
  rmSync(join(root, 'garageOS'), { recursive: true, force: true });
  for (const f of git('ls-tree', '-r', '--name-only', ref).toString().split('\n').filter(Boolean)) {
    const out = join(root, 'garageOS', f);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, git('show', `${ref}:${f}`));
  }
  const now = new Date();   // come un deploy: date nuove (altrimenti 304 al controllo di sw.js)
  const touch = (d) => { for (const f of readdirSync(d)) { const x = join(d, f); statSync(x).isDirectory() ? touch(x) : utimesSync(x, now, now); } };
  touch(root);
}
let server;
const start = () => new Promise((r) => { server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' }); setTimeout(r, 1200); });
const stop = () => new Promise((r) => { if (!server || server.exitCode !== null || server.killed) return r(); server.on('exit', r); server.kill(); });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function scenario(name, { oldRef, newRef, v2HasSw }) {
  console.log(`\n${name}`);
  publish(oldRef);
  await start();
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
  await ctx.route(/^https:\/\/lucsor\.github\.io\/garageos-v2\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>V2</title><h1 id="v2">GarageOS v2</h1>' }));
  // le risorse esterne della vecchia v1 (font, Firebase) non servono al test
  await ctx.route(/^https:\/\/(?!lucsor\.github\.io\/garageos-v2\/)/, (r) => r.abort());
  const page = await ctx.newPage();
  // 1) il telefono ha la v1 installata: SW attivo e cache
  await page.goto(`${ORIGIN}/garageOS/`);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: T }).catch(() => {});
  const before = await page.evaluate(async () => ({
    sw: (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname),
    caches: await caches.keys(),
  }));
  check(before.sw.includes('/garageOS/'), `v1 installata: SW con scope /garageOS/ (${before.sw.join(', ')})`);
  if (v2HasSw) {   // stessa origine: anche la v2 ha SW e cache, non devono essere toccati
    await page.evaluate(async () => { await (await caches.open('garageos-v2.4.1')).put('/x', new Response('v2')); });
  }
  await page.close();
  // 2) deploy del redirect; il telefono torna online e l'utente tocca la vecchia icona (start_url /garageOS/)
  await stop();
  publish(newRef);
  await start();
  const p2 = await ctx.newPage();
  const t0 = Date.now();
  await p2.goto(`${ORIGIN}/garageOS/`).catch(() => {});
  const arrived = await p2.waitForURL(V2, { timeout: 10_000 }).then(() => true, () => false);
  check(arrived, `prima apertura online → v2 (${p2.url()}, ${Date.now() - t0} ms)`);
  // 3) dopo: niente più v1 sul telefono, la v2 intatta
  const p3 = await ctx.newPage();
  await p3.goto(`${ORIGIN}/garageOS/manifest.json`);
  const after = await p3.evaluate(async () => ({
    sw: (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname),
    caches: await caches.keys(),
  }));
  check(!after.sw.includes('/garageOS/'), `SW della v1 rimosso (${after.sw.join(', ') || 'nessuno'})`);
  check(!after.caches.some((k) => /^garageos-v1\./.test(k)), `cache della v1 rimosse (${after.caches.join(', ') || 'nessuna'})`);
  if (v2HasSw) check(after.caches.includes('garageos-v2.4.1'), 'cache della v2 intatta');
  const p4 = await ctx.newPage();
  await p4.goto(`${ORIGIN}/garageOS/`).catch(() => {});
  check(await p4.waitForURL(V2, { timeout: 10_000 }).then(() => true, () => false), 'aperture successive → v2');
  await ctx.close();
  await stop();
}

await scenario('A) v1 installata, SW v1 attivo, prima apertura online dopo il deploy del redirect', { oldRef: '7dfc0d2', newRef: process.argv[3] || 'origin/main', v2HasSw: true });
await browser.close();
rmSync(root, { recursive: true, force: true });
if (problems.length) { console.log('\n✖ PROBLEMI:\n' + problems.map((p) => '  - ' + p).join('\n')); process.exit(1); }
console.log('\n✔ Redirect v1 → v2 alla prima apertura online');
