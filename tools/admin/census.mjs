#!/usr/bin/env node
// CENSIMENTO offline (legge solo i file di backup, nessun accesso a Firestore).
//   node census.mjs [backup/firestore-YYYYMMDD.json] [backup/auth-users-YYYYMMDD.json]
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKUP_DIR } from './creds.mjs';

const latest = (prefix) => {
  const f = readdirSync(BACKUP_DIR).filter((x) => x.startsWith(prefix)).sort().pop();
  return f && `${BACKUP_DIR}/${f}`;
};
const fsFile = process.argv[2] || latest('firestore-');
const authFile = process.argv[3] || latest('auth-users-');
const { meta, documents: D } = JSON.parse(readFileSync(fsFile, 'utf8'));
const authUsers = authFile ? JSON.parse(readFileSync(authFile, 'utf8')).users : [];
const byUid = Object.fromEntries(authUsers.map((u) => [u.uid, u]));
const uidByEmail = Object.fromEntries(authUsers.filter((u) => u.email).map((u) => [u.email.toLowerCase(), u.uid]));

const docsIn = (prefix) => Object.entries(D).filter(([p]) => p.startsWith(prefix) && p.slice(prefix.length).split('/').length === 1);
const short = (uid) => (uid ? uid.slice(0, 6) + '…' : '—');
const who = (uid) => `${byUid[uid]?.email || '(email ignota)'} [${short(uid)}]`;
const date = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '—');

console.log(`Censimento da ${fsFile.split(/[\\/]/).pop()} (export ${meta.exportedAt})\n`);

// ── GARAGE
const garages = docsIn('garages/');
const membership = {};   // uid → [{gid, kind}]
const add = (uid, gid, kind) => { if (uid) (membership[uid] ||= []).push({ gid, kind }); };
console.log('══ GARAGE ══');
for (const [path, g] of garages) {
  const gid = path.split('/')[1];
  const vehicles = docsIn(`${path}/vehicles/`);
  const mechs = docsIn(`${path}/mechs/`);
  const tires = docsIn(`${path}/tires/`);
  const scad = vehicles.reduce((n, [, v]) => n + ['bollo', 'revisione', 'assicurazione'].filter((k) => v[k]).length, 0);
  const frozen = vehicles.filter(([, v]) => v.frozen).length;
  const uids = g.memberUids || [];
  const legacy = g.members || [];
  add(gid, gid, 'proprietario');
  console.log(`\n▶ garages/${short(gid)}  «${g.garageName || '(senza nome)'}»`);
  console.log(`  proprietario: ${g.ownerEmail || '?'} (${g.ownerName || '?'})  ${byUid[gid] ? '' : '⚠ uid non presente in Auth'}`);
  console.log(`  creato: ${typeof g.createdAt === 'string' ? g.createdAt.slice(0, 10) : JSON.stringify(g.createdAt)}   campi: ${Object.keys(g).sort().join(', ')}`);
  console.log(`  dati: ${vehicles.length} veicoli${frozen ? ` (${frozen} congelati)` : ''} · ${scad} scadenze · ${mechs.length} interventi · ${tires.length} cambi gomme`);
  console.log(`  memberUids (accesso v2): ${uids.length ? uids.map(who).join(', ') : '— nessuno'}`);
  uids.forEach((u) => add(u, gid, 'membro v2 (memberUids)'));
  if (g.memberInfo) console.log(`  memberInfo: ${Object.keys(g.memberInfo).map(short).join(', ') || '—'}`);
  if (legacy.length) {
    console.log('  members[] (formato v1/v2.1):');
    for (const m of legacy) {
      const uid = m.uid || uidByEmail[(m.email || '').toLowerCase()] || '';
      const access = uids.includes(uid) ? 'HA accesso v2' : 'NESSUN accesso v2';
      console.log(`    - ${m.email} · status=${m.status} · uid=${m.uid ? short(m.uid) : '(vuoto)'}${!m.uid && uid ? ` (in Auth: ${short(uid)})` : ''} · ${access}`);
      if (m.status === 'active' && !uids.includes(uid)) add(uid || `email:${m.email}`, gid, 'membro SOLO v1 (members[], senza memberUids)');
      if (m.status === 'pending') add(uid || `email:${m.email}`, gid, 'invito v1 pending');
    }
  }
}

// ── USERS
console.log('\n══ users/{uid} ══');
const usersDocs = docsIn('users/');
for (const [path, u] of usersDocs) {
  const uid = path.split('/')[1];
  const g = D[`garages/${u.garageId}`];
  const ok = !u.garageId ? '—' : u.garageId === uid ? 'garage proprio' : (g?.memberUids || []).includes(uid) ? 'membro valido' : '⚠ NON è in memberUids di quel garage';
  console.log(`  ${who(uid)} → garageId=${short(u.garageId)} (${ok})`);
}

// ── ALTRO
const other = Object.keys(D).filter((p) => !p.startsWith('garages/') && !p.startsWith('users/'));
if (other.length) {
  console.log('\n══ Documenti fuori dal modello ══');
  for (const p of other) console.log(`  ${p}: campi ${Object.keys(D[p]).sort().join(', ')}`);
}

// ── PERSONE
console.log('\n══ PERSONE (account Auth) ══');
for (const u of authUsers) {
  const m = membership[u.uid] || [];
  const ud = D[`users/${u.uid}`];
  console.log(`\n● ${u.email} [${short(u.uid)}]  creato ${date(u.created)} · ultimo accesso ${date(u.lastSignIn)}`);
  console.log(`  users/{uid}: ${ud ? `sì → ${short(ud.garageId)}` : 'NO'}`);
  for (const x of m) {
    const g = D[`garages/${x.gid}`];
    console.log(`  ${x.kind}: garages/${short(x.gid)} di ${g?.ownerEmail || '?'}`);
  }
  if (!m.length) console.log('  nessun garage');
}
const orphans = Object.keys(membership).filter((k) => k.startsWith('email:') || (!byUid[k]));
if (orphans.length) {
  console.log('\n══ Riferimenti senza account Auth ══');
  for (const k of orphans) for (const x of membership[k]) console.log(`  ${k.startsWith('email:') ? k.slice(6) : short(k)} → ${x.kind} in garages/${short(x.gid)}`);
}
