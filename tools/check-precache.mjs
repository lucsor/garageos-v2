#!/usr/bin/env node
// Ogni file dell'app in css/ e js/ deve essere nel PRECACHE di sw.js (altrimenti offline l'app resta bianca),
// e ogni voce locale del PRECACHE deve esistere. Uso: node tools/check-precache.mjs   (pre-commit e CI)
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const block = (sw.match(/const PRECACHE = \[([\s\S]*?)\];/) || [])[1];
if (!block) { console.error('✖ PRECACHE non trovato in sw.js'); process.exit(1); }
const local = [...block.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
const walk = (d) => (existsSync(join(root, d)) ? readdirSync(join(root, d)).flatMap((f) => {
  const rel = `${d}/${f}`;
  return statSync(join(root, rel)).isDirectory() ? walk(rel) : /\.(css|js|mjs)$/.test(f) ? [rel] : [];
}) : []);
const files = ['css', 'js'].flatMap(walk);
// ogni <link rel="modulepreload"> / <script src> / <link rel="stylesheet"> locale di index.html deve esistere
const html = readFileSync(join(root, 'index.html'), 'utf8');
const refs = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="(?!https?:|data:)([^"]+\.(?:js|css))"/g)].map((m) => m[1].replace(/^\.\//, ''));
const brokenRefs = refs.filter((f) => !existsSync(join(root, f)));
if (brokenRefs.length) { console.error(`✖ index.html fa riferimento a file inesistenti: ${brokenRefs.join(', ')}`); process.exit(1); }
const missing = files.filter((f) => !local.includes(f));
const dangling = local.filter((f) => !existsSync(join(root, f)));
if (missing.length) console.error(`✖ file dell'app non in PRECACHE (sw.js): ${missing.join(', ')}`);
if (dangling.length) console.error(`✖ voci di PRECACHE senza file: ${dangling.join(', ')}`);
if (missing.length || dangling.length) process.exit(1);
console.log(`✔ PRECACHE completo (${files.length} file in css/ e js/)`);
