#!/usr/bin/env node
// Elenco account Firebase Auth (SOLA LETTURA): uid, email, provider, creazione, ultimo accesso.
//   node export-auth-users.mjs [--out <file>]     (default: backup/auth-users-YYYYMMDD.json, fuori da git)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { initializeApp, refreshToken, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { PROJECT_ID, whoami } from './creds.mjs';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : `${repoRoot}/backup/auth-users-${ymd}.json`);

let credential;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) credential = applicationDefault();
else {
  const { configstore } = require('firebase-tools/lib/configstore');
  const api = require('firebase-tools/lib/api');
  credential = refreshToken({ type: 'authorized_user', client_id: api.clientId(), client_secret: api.clientSecret(),
    refresh_token: configstore.get('tokens').refresh_token });
}
const auth = getAuth(initializeApp({ credential, projectId: PROJECT_ID }));
const users = [];
let pageToken;
do {
  const page = await auth.listUsers(1000, pageToken);
  for (const u of page.users) users.push({
    uid: u.uid, email: u.email || null, emailVerified: u.emailVerified, displayName: u.displayName || null,
    providers: u.providerData.map((p) => p.providerId), created: u.metadata.creationTime, lastSignIn: u.metadata.lastSignInTime,
    disabled: u.disabled,
  });
  pageToken = page.pageToken;
} while (pageToken);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ meta: { projectId: PROJECT_ID, exportedAt: new Date().toISOString(), by: whoami() }, users }, null, 1));
console.log(`Account Auth: ${users.length} → ${out}`);
