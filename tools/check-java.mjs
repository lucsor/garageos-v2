#!/usr/bin/env node
// Verifica che Java 21+ sia disponibile per gli emulatori Firebase (eseguito prima di ogni suite di test).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const help = `
  Installa Temurin 21 (una volta):  winget install --id EclipseAdoptium.Temurin.21.JDK -e
  (macOS: brew install --cask temurin@21 · Linux: pacchetto openjdk-21-jdk)
  Poi apri un NUOVO terminale, così il PATH aggiornato viene letto.`;

function version(bin) {
  const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });   // java -version scrive su stderr
  return r.error ? null : `${r.stdout || ''}${r.stderr || ''}`;
}
let out = version('java');
let where = 'PATH';
if (!out?.includes('version') && process.env.JAVA_HOME) {
  const bin = join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (existsSync(bin)) { out = version(bin); where = 'JAVA_HOME (non nel PATH: gli emulatori potrebbero non trovarlo)'; }
}
const m = out?.match(/version "(\d+)/);
if (!m) { console.error(`✖ Java non trovato: gli emulatori Firebase richiedono Java 21+.${help}`); process.exit(1); }
if (Number(m[1]) < 21) { console.error(`✖ Java ${m[1]} trovato (${where}), serve Java 21+.${help}`); process.exit(1); }
console.log(`✔ Java ${m[1]} (${where})`);
