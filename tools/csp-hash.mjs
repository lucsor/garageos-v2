#!/usr/bin/env node
// Calcola gli hash SHA-256 degli <script> inline di index.html e li scrive nella CSP (meta tag).
//   node tools/csp-hash.mjs           → aggiorna l'hash nel file
//   node tools/csp-hash.mjs --check   → esce con codice 1 se l'hash nella CSP non corrisponde (per CI / prima del commit)
//   node tools/csp-hash.mjs --check --file <path>   → verifica un altro file
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// --file <percorso> per verificare un file diverso (es. la versione in staging, usata dal pre-commit hook)
const fileArg = process.argv.indexOf('--file');
const file = fileArg > 0 ? process.argv[fileArg + 1] : fileURLToPath(new URL('../index.html', import.meta.url));
const html = readFileSync(file, 'utf8');
if (html.includes('\r\n')) {
  console.error('index.html ha fine riga CRLF: il browser hasha con LF → hash errato. Converti in LF.');
  process.exit(1);
}

// script inline = <script ...> senza src
const inline = [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const hashes = inline.map((code) => `'sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}'`);

// Nessuno script inline (app divisa in moduli): la CSP deve usare 'self' e NON contenere 'unsafe-inline' né hash
if (inline.length === 0) {
  const csp = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1] || '';
  const scriptSrc = (csp.match(/script-src ([^;]*)/) || [])[1] || '';
  const ok = /'self'/.test(scriptSrc) && !/unsafe-inline|sha256-/.test(scriptSrc);
  console.log(ok ? "CSP OK (nessuno script inline, script-src 'self')" : `CSP NON valida senza script inline: script-src ${scriptSrc}`);
  process.exit(ok ? 0 : 1);
}
const metaRe = /(<meta http-equiv="Content-Security-Policy" content="[^"]*?script-src )((?:'sha256-[^']+' ?)+)/;
const m = html.match(metaRe);
if (!m) { console.error('Meta CSP con script-src \'sha256-…\' non trovato.'); process.exit(1); }
const current = m[2].trim().split(/\s+/);

if (process.argv.includes('--check')) {
  const ok = current.length === hashes.length && hashes.every((h) => current.includes(h));
  console.log(ok ? `CSP OK (${hashes.length} script inline)` : `CSP NON aggiornata:\n  attesi:   ${hashes.join(' ')}\n  presenti: ${current.join(' ')}`);
  process.exit(ok ? 0 : 1);
}
writeFileSync(file, html.replace(metaRe, `$1${hashes.join(' ')} `));
console.log(`CSP aggiornata con ${hashes.length} hash: ${hashes.join(' ')}`);
