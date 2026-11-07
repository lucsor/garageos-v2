// Verifiche statiche dei workflow GitHub (sicurezza e keepalive). Uso: node --test tests/unit/workflows.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wf = readFileSync(new URL('../../.github/workflows/reminders.yml', import.meta.url), 'utf8');
// blocco di un job: dalla riga "  <nome>:" alla riga del job successivo
const job = (name) => {
  const m = wf.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][\\w-]*:\\n|$)`));
  assert.ok(m, `job ${name} presente`);
  return m[1];
};
// massimo intervallo (giorni) tra due esecuzioni di un'espressione cron "min ora giorno-mese mese giorno-sett"
function maxGapDays(cron) {
  const [, , dom, mon, dow] = cron.trim().split(/\s+/);
  if (mon !== '*') return 365;
  if (dom === '*' && dow === '*') return 1;
  if (dom === '*' && dow !== '*') return 7;
  return 31;
}

test('keepalive: gira a ogni esecuzione pianificata, molto prima dei 60 giorni di inattività', () => {
  const crons = [...wf.matchAll(/cron:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(crons.length >= 1, 'almeno un cron');
  const gap = Math.min(...crons.map(maxGapDays));
  assert.ok(gap < 60, `intervallo massimo tra le esecuzioni: ${gap} giorni (< 60)`);
  assert.equal(gap, 1, 'giornaliero: 59 giorni di margine');
  const k = job('keepalive');
  assert.ok(!/if:\s*github\.event_name\s*==\s*'workflow_dispatch'/.test(k), 'il keepalive non è limitato al lancio manuale');
  assert.match(k, /actions:\s*write/, 'permesso actions: write per riattivare il workflow');
  assert.match(k, /gh api -X PUT "repos\/\$\{\{ github\.repository \}\}\/actions\/workflows\/reminders\.yml\/enable"/, 'chiama l\'API "enable" per QUESTO workflow');
  assert.match(k, /test "\$state" = "active"/, 'verifica che il workflow risulti attivo, altrimenti fallisce');
});

test('il nome del file usato dal keepalive è quello del workflow', () => {
  const name = new URL('../../.github/workflows/reminders.yml', import.meta.url).pathname.split('/').pop();
  assert.ok(wf.includes(`/actions/workflows/${name}/enable`));
});

test('invio: solo main, nessun trigger dalle PR, OIDC senza chiavi, dry-run di default, live solo con la variabile', () => {
  assert.ok(!/pull_request/.test(wf), 'nessun trigger pull_request (i segreti/identità non vanno mai al codice delle PR)');
  assert.match(wf, /\npermissions:\n  contents: read\n/, 'permessi di default minimi');
  const s = job('send');
  assert.match(s, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(s, /id-token: write/);
  assert.match(s, /google-github-actions\/auth@v2/);
  assert.ok(!/credentials_json|GOOGLE_APPLICATION_CREDENTIALS|secrets\./.test(s), 'nessuna chiave JSON né segreti');
  assert.match(s, /REMINDERS_ALLOW_LIVE: \$\{\{ vars\.REMINDERS_ALLOW_LIVE \}\}/);
  assert.match(wf, /default: dry-run/);
  assert.match(s, /environment: reminders/);
});

test('lo script rifiuta il live senza REMINDERS_ALLOW_LIVE=yes', () => {
  const src = readFileSync(new URL('../../tools/admin/send-reminders.mjs', import.meta.url), 'utf8');
  assert.match(src, /mode === 'live' && process\.env\.REMINDERS_ALLOW_LIVE === 'yes' \? 'live' : 'dry-run'/);
});
