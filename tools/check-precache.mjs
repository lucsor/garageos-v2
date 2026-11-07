#!/usr/bin/env node
// Ogni file dell'app in css/ e js/ deve essere nel PRECACHE di sw.js (altrimenti offline l'app resta bianca),
// e ogni voce locale del PRECACHE deve esistere. Uso: node tools/check-precache.mjs   (pre-commit e CI)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const block = (sw.match(/const PRECACHE = \[([\s\S]*?)\];/) || [])[1];
if (!block) { console.error('✖ PRECACHE non trovato in sw.js'); process.exit(1); }
const local = [...block.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
const files = ['css', 'js'].flatMap((d) => (existsSync(join(root, d)) ? readdirSync(join(root, d)).filter((f) => /\.(css|js)$/.test(f)).map((f) => `${d}/${f}`) : []));
const missing = files.filter((f) => !local.includes(f));
const dangling = local.filter((f) => !existsSync(join(root, f)));
if (missing.length) console.error(`✖ file dell'app non in PRECACHE (sw.js): ${missing.join(', ')}`);
if (dangling.length) console.error(`✖ voci di PRECACHE senza file: ${dangling.join(', ')}`);
if (missing.length || dangling.length) process.exit(1);
console.log(`✔ PRECACHE completo (${files.length} file in css/ e js/)`);
