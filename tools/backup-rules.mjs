#!/usr/bin/env node
// Salva in docs/rules-backup/ le regole Firestore ATTUALMENTE PUBBLICATE (sola lettura, non pubblica nulla).
// Usa le credenziali della Firebase CLI (`firebase login`). Eseguire PRIMA di ogni deploy delle regole.
//   node tools/backup-rules.mjs [projectId]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../tests/rules/package.json', import.meta.url));
const { requireAuth } = require('firebase-tools/lib/requireAuth');
const rules = require('firebase-tools/lib/gcp/rules');

const { configstore } = require('firebase-tools/lib/configstore');

const projectId = process.argv[2] || 'garageos-879bc';
// stesse credenziali di `firebase login` (nessun token stampato o salvato)
await requireAuth({ user: configstore.get('user'), tokens: configstore.get('tokens') });
const name = await rules.getLatestRulesetName(projectId, 'cloud.firestore');
if (!name) { console.error('Nessuna regola Firestore pubblicata trovata.'); process.exit(1); }
const files = await rules.getRulesetContent(name);
const id = name.split('/').pop();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = fileURLToPath(new URL('../docs/rules-backup/', import.meta.url));
mkdirSync(dir, { recursive: true });
for (const f of files) {
  const out = `${dir}firestore.rules.${stamp}.${id}.rules`;
  writeFileSync(out, `// Backup regole pubblicate — progetto ${projectId}\n// ruleset: ${name}\n// salvato: ${new Date().toISOString()}\n${f.content}`);
  console.log('Salvato:', out);
}
