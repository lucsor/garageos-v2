#!/usr/bin/env node
// Calcola gli hash SHA-256 degli <script> inline di index.html e li scrive nella CSP (meta tag).
//   node tools/csp-hash.mjs           → aggiorna l'hash nel file
//   node tools/csp-hash.mjs --check   → esce con codice 1 se l'hash nella CSP non corrisponde (per CI / prima del commit)
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../index.html', import.meta.url));
const html = readFileSync(file, 'utf8');
if (html.includes('\r\n')) {
  console.error('index.html ha fine riga CRLF: il browser hasha con LF → hash errato. Converti in LF.');
  process.exit(1);
}

// script inline = <script ...> senza src
const inline = [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const hashes = inline.map((code) => `'sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}'`);

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
