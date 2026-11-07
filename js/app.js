// GarageOS — applicazione (modulo ES caricato da index.html, nessun build step)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, where, writeBatch, runTransaction, serverTimestamp, Timestamp,
  onSnapshot, setDoc, deleteDoc, query, orderBy, getDoc, arrayUnion, arrayRemove, deleteField,
  connectFirestoreEmulator, waitForPendingWrites, terminate, clearIndexedDbPersistence
} from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut as fbSignOut, connectAuthEmulator, signInWithCredential
} from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js';

import { esc, safeImg, daysUntil, badgeClass, TYPE_EMOJI, MECH_TYPES, getMechType, formatDate, formatCurrency, addYears } from './utils.js';
import { csvSafe, downloadCSV } from './csv.js';
import { mechCostInfo } from './costs.js';

// ===== FIREBASE CONFIG =====
const firebaseConfig = {
  apiKey: "AIzaSyDPNSgCqWvfyJ6YSP_E9JU9HufgtwYJfII",
  authDomain: "garageos-879bc.firebaseapp.com",
  projectId: "garageos-879bc",
  storageBucket: "garageos-879bc.firebasestorage.app",
  messagingSenderId: "388016073061",
  appId: "1:388016073061:web:8b3dd0073f622bd950598c"
};

const app  = initializeApp(firebaseConfig);
// Cache locale persistente (IndexedDB, condivisa tra schede): l'app mostra i dati anche offline
// e le modifiche fatte offline vengono inviate al ritorno della rete. Se IndexedDB non è disponibile
// (es. alcune modalità private) l'SDK ripiega sulla cache in memoria.
const db   = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// ===== SVILUPPO: emulatori locali (attivi SOLO su localhost con ?emulator) =====
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
try { if (IS_LOCAL && new URLSearchParams(location.search).has('emulator')) sessionStorage.setItem('garageos_emu', '1'); } catch(e) {}
const USE_EMULATOR = IS_LOCAL && (() => { try { return sessionStorage.getItem('garageos_emu') === '1'; } catch(e) { return false; } })();
if (USE_EMULATOR) {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  console.warn('[GarageOS] Emulatori locali attivi');
}

// ===== STATE =====
let currentUser = null;
let garageId    = null;
let isOwner     = false;
let currentTab  = 'garage';
let currentSubTab = 'meccanica';
const emptyData = () => ({
  vehicles: [], tires: [], mechs: [],
  memberUids: [], memberInfo: {}, legacyMembers: [], invites: [],
  garageOwner: null, garageName: '',
});
let data = emptyData();
let _unsubscribers = [];
const INVITE_DAYS = 7;

// ===== SECURITY: HTML ESCAPING =====

// ===== CONFIRM (sostituisce confirm nativo) =====
function showConfirm(msg) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirm-modal');
    document.getElementById('confirm-msg').textContent = msg;
    overlay.classList.add('open');
    const yes = document.getElementById('confirm-yes');
    const no  = document.getElementById('confirm-no');
    const done = val => {
      overlay.classList.remove('open');
      yes.onclick = no.onclick = null;
      resolve(val);
    };
    yes.onclick = () => done(true);
    no.onclick  = () => done(false);
    overlay.onclick = e => { if (e.target === overlay) done(false); };
  });
}

// ===== TOAST =====
function _showToast(msg, color = 'green') {
  let t = document.getElementById('_toast');
  if (!t) {
    t = document.createElement('div');
    t.id = '_toast';
    t.style.cssText = `position:fixed;bottom:calc(74px + 20px);left:50%;transform:translateX(-50%);
      padding:12px 24px;border-radius:100px;font-weight:700;font-size:14px;z-index:9999;
      transition:opacity 0.4s;pointer-events:none;box-shadow:0 8px 32px rgba(0,0,0,0.3);max-width:90vw;text-align:center`;
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.background = color === 'red' ? 'var(--red)' : color === 'yellow' ? 'var(--yellow)' : 'var(--green)';
  t.style.color = '#fff';
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 3200);
}

// ===== AUTH =====
// ===== LOGIN =====
const LOGIN_BOX_HTML = document.querySelector('.login-box')?.innerHTML || '';
// Ripristina la schermata di login con il pulsante (mai lasciare l'utente su "Accesso in corso…" senza via d'uscita)
function restoreLoginBox() {
  try { localStorage.removeItem('garageos_auth_pending'); } catch(e) {}
  const box = document.querySelector('.login-box');
  if (box && LOGIN_BOX_HTML) box.innerHTML = LOGIN_BOX_HTML;
}
function showLoginWaiting(title, sub) {
  const box = document.querySelector('.login-box');
  if (!box) return;
  box.innerHTML = `
    <div class="login-logo">Garage<span>OS</span></div>
    <div style="color:var(--ink-2);margin-top:20px;font-size:15px;font-weight:700">${esc(title)}</div>
    <div style="color:var(--ink-2);font-size:12px;margin-top:8px">${esc(sub)}</div>
    <button class="btn btn-secondary btn-sm" style="margin-top:18px" data-action="cancel-login">Annulla</button>`;
}
// Messaggi chiari per gli errori di login più comuni
function loginErrorMessage(e) {
  const code = e?.code || '';
  if (code.startsWith('auth/requests-from-referer-'))
    return 'Accesso bloccato: questo indirizzo non è tra quelli ammessi dalla chiave API (Google Cloud → Credenziali → restrizioni sito web).';
  if (code === 'auth/unauthorized-domain')
    return 'Dominio non autorizzato: aggiungilo in Firebase Console → Authentication → Authorized domains.';
  if (code === 'auth/network-request-failed') return 'Connessione assente: riprova quando sei online.';
  if (code === 'auth/internal-error' && /domain/i.test(e?.message || ''))
    return 'Impossibile verificare il dominio dell’app (restrizioni della chiave API o domini autorizzati).';
  return 'Accesso non riuscito' + (code ? ` (${code})` : '') + '.';
}

getRedirectResult(auth).then(result => {
  // nessun utente dal redirect: si esce dallo stato "in corso" (prima restava bloccato per sempre)
  if (!result?.user && localStorage.getItem('garageos_auth_pending')) restoreLoginBox();
  else localStorage.removeItem('garageos_auth_pending');
}).catch(e => {
  restoreLoginBox();
  if (e.code && e.code !== 'auth/no-auth-event') {
    console.error('Redirect result error:', e.code, e.message);
    _showToast(loginErrorMessage(e), 'red');
  }
});

async function signInWithGoogle() {
  if (USE_EMULATOR) {
    // Emulatore Auth: accetta un ID token Google non firmato (solo test locali)
    const who = (new URLSearchParams(location.search).get('as') || 'alice').replace(/[^a-z0-9]/gi, '');
    const token = JSON.stringify({ sub: who, email: `${who}@example.com`, email_verified: true, name: who });
    await signInWithCredential(auth, GoogleAuthProvider.credential(token));
    return;
  }
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
    localStorage.removeItem('garageos_auth_pending');
    return;
  } catch(e) {
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    // il redirect ha senso SOLO se il popup non può aprirsi; per ogni altro errore il redirect fallirebbe allo stesso modo
    const POPUP_UNAVAILABLE = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'];
    if (!POPUP_UNAVAILABLE.includes(e.code)) {
      console.error('Login fallito:', e.code, e.message);
      _showToast(loginErrorMessage(e), 'red');
      return;
    }
    console.warn('Popup non disponibile, uso redirect:', e.code);
  }
  try {
    localStorage.setItem('garageos_auth_pending', '1');
    showLoginWaiting('⏳ Reindirizzamento a Google…', 'Verrai riportato sull’app dopo il login');
    await signInWithRedirect(auth, provider);
  } catch(e) {
    restoreLoginBox();
    console.error('Redirect fallito:', e.code, e.message);
    _showToast(loginErrorMessage(e), 'red');
  }
}
// Pulizia completa dello stato di sessione (logout esplicito, token revocato, logout da un'altra scheda)
function resetSession() {
  _unsubscribers.forEach(u => u());
  _unsubscribers = [];
  clearTimeout(_retryTimer);
  _resolving = null;
  currentUser = null; garageId = null; isOwner = false;
  data = emptyData();
  renderAll();
}

async function signOutUser() {
  toggleUserMenu(false);
  // Modifiche fatte offline e non ancora inviate: uscendo (e svuotando la cache locale) andrebbero perse.
  const flushed = await Promise.race([
    waitForPendingWrites(db).then(() => true, () => true),
    new Promise(r => setTimeout(() => r(false), 4000)),
  ]);
  if (!flushed && !await showConfirm('Ci sono modifiche non ancora sincronizzate (sei offline?). Se esci adesso andranno perse. Uscire comunque?')) return;
  await fbSignOut(auth);
  resetSession();
  // La cache locale (IndexedDB) e la cache delle notifiche contengono i dati del garage:
  // su un dispositivo condiviso non devono restare a disposizione del prossimo utente.
  try { await caches.delete('garageos-notif'); } catch {}
  try { await terminate(db); await clearIndexedDbPersistence(db); }
  catch (e) { console.warn('cache locale non svuotata (altra scheda aperta?):', e.code || e); }
  window.location.reload();   // riparte con un'istanza Firestore nuova
}

function toggleUserMenu(force) {
  const m = document.getElementById('user-menu');
  if (force === false) { m.classList.remove('open'); return; }
  m.classList.toggle('open');
}
document.addEventListener('click', e => {
  if (!e.target.closest('#header-user-area')) toggleUserMenu(false);
});

onAuthStateChanged(auth, async user => {
  if (!user) {
    resetSession();
    if (localStorage.getItem('garageos_auth_pending')) {
      document.getElementById('login-screen').classList.remove('hidden');
      showLoginWaiting('⏳ Accesso in corso…', 'Completa il login su Google e torna qui');
      return;
    }
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app').classList.remove('visible');
    return;
  }
  currentUser = user;
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.add('visible');

  const avatarEl = document.getElementById('user-avatar');
  avatarEl.src = user.photoURL || '';
  avatarEl.style.display = user.photoURL ? '' : 'none';
  document.getElementById('menu-user-name').textContent = user.displayName || user.email;
  document.getElementById('menu-user-email').textContent = user.email;

  await enterApp();
});

// Sequenza d'ingresso: eventuale invito nel link → risoluzione del garage → listener
async function enterApp() {
  await handleInviteLink();
  await resolveGarageWithRetry();
}

// ===== GARAGE RESOLUTION =====
// Un errore TRANSITORIO (rete, timeout, server non raggiungibile) non deve MAI modificare
// users/{uid}.garageId: si ritenta con backoff. Si torna al garage personale solo davanti a una
// risposta certa del server: permission-denied (rimosso), not-found, oppure uid non più in memberUids.
class TransientError extends Error {}
const DEFINITIVE_CODES = ['permission-denied', 'not-found'];
const isTransient = e => !DEFINITIVE_CODES.includes(e?.code);

let _retryTimer = null, _retryDelay = 2000, _resolving = null;
// Una sola risoluzione alla volta: 'online', handleLostAccess e onAuthStateChanged possono sovrapporsi
function resolveGarageWithRetry() {
  if (!_resolving) _resolving = _resolveOnce().finally(() => { _resolving = null; });
  return _resolving;
}
async function _resolveOnce() {
  clearTimeout(_retryTimer);
  if (!currentUser) return;
  const user = currentUser;
  try {
    await resolveGarage(user);
    if (currentUser !== user) return;   // utente cambiato nel frattempo
    _retryDelay = 2000;
    startListeners();
  } catch(e) {
    if (!(e instanceof TransientError)) throw e;
    console.warn('Risoluzione garage rinviata (errore transitorio):', e.message);
    setStatus('error');
    _showToast('Connessione assente: riprovo tra poco…', 'yellow');
    _retryTimer = setTimeout(resolveGarageWithRetry, _retryDelay);
    _retryDelay = Math.min(_retryDelay * 2, 60000);
  }
}
window.addEventListener('online', () => {
  if (currentUser && !garageId) resolveGarageWithRetry();
  else if (garageId) setStatus('online');
});
window.addEventListener('offline', () => { if (garageId) setStatus('cache'); });

async function resolveGarage(user) {
  const uref = doc(db, 'users', user.uid);
  let pointedGarage = null;
  try {
    const usnap = await getDoc(uref);
    if (usnap.exists()) pointedGarage = usnap.data().garageId || null;
  } catch(e) {
    // anche permission-denied qui (es. token non ancora pronto) va ritentato: mai riscrivere il puntatore
    throw new TransientError('users: ' + e.code);
  }

  if (pointedGarage && pointedGarage !== user.uid) {
    try {
      const gsnap = await getDoc(doc(db, 'garages', pointedGarage));
      if (gsnap.exists() && (gsnap.data().memberUids || []).includes(user.uid)) {
        garageId = pointedGarage;
        isOwner = false;
        return;
      }
    } catch(e) {
      if (isTransient(e)) throw new TransientError('garage: ' + e.code);
      // permission-denied = non sei più membro → si prosegue col garage personale
    }
    _showToast('Non fai più parte del garage condiviso: torni al tuo garage.', 'yellow');
  }

  const garageRef = doc(db, 'garages', user.uid);
  try {
    const garageSnap = await getDoc(garageRef);
    if (!garageSnap.exists()) {
      await setDoc(garageRef, {
        ownerUid: user.uid,
        ownerName: (user.displayName || user.email).slice(0, 100),
        ownerEmail: user.email,
        ownerPhoto: user.photoURL || '',
        members: [],
        memberUids: [],
        memberInfo: {},
        createdAt: serverTimestamp(),
      });
    }
  } catch(e) {
    if (isTransient(e)) throw new TransientError('own garage: ' + e.code);
    console.error('garage init failed:', e);
  }
  // il puntatore si riscrive solo se serve, e solo dopo una risposta certa del server
  if (pointedGarage !== user.uid) {
    try {
      await setDoc(uref, {
        garageId: user.uid,
        email: user.email,
        name: (user.displayName || user.email).slice(0, 100),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch(e) { console.warn('users doc write failed:', e.code); }
  }
  garageId = user.uid;
  isOwner = true;
}

// ===== INVITI (invites/{token}: 256 bit casuali, scadenza 7 giorni, uso singolo) =====
function newInviteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function handleInviteLink() {
  const params = new URLSearchParams(window.location.search);
  const cleanUrl = () => window.history.replaceState({}, '', window.location.pathname);
  if (params.has('join')) {   // link v2.1 (?join=<uid>&email=…): formato insicuro, non più accettato
    cleanUrl();
    _showToast('Questo link d’invito è del vecchio formato e non è più valido: chiedi un nuovo invito.', 'red');
    return;
  }
  const token = params.get('invite');
  if (!token) return;
  cleanUrl();
  if (!/^[a-f0-9]{64}$/.test(token)) { _showToast('Link d’invito non valido.', 'red'); return; }

  let inv;
  try {
    const snap = await getDoc(doc(db, 'invites', token));
    if (!snap.exists()) { _showToast('Invito non valido o revocato.', 'red'); return; }
    inv = snap.data();
  } catch(e) {
    _showToast(e.code === 'permission-denied'
      ? `Invito non valido, revocato o destinato a un altro account (sei connesso come ${currentUser.email}).`
      : 'Impossibile verificare l’invito: controlla la connessione e riapri il link.', 'red');
    return;
  }
  if (inv.usedAt) { _showToast('Questo invito è già stato usato.', 'red'); return; }
  if (!inv.expiresAt || inv.expiresAt.toMillis() <= Date.now()) { _showToast('Invito scaduto: chiedine uno nuovo.', 'red'); return; }
  if (inv.garageId === currentUser.uid) return;

  const gname = inv.garageName || `Garage di ${inv.invitedByName || 'famiglia'}`;
  if (!await showConfirm(`Entrare in «${gname}»? I dati del tuo garage personale restano salvati.`)) return;
  try {
    await acceptInvite(token, inv.garageId);
    _showToast('✅ Sei entrato nel garage di famiglia!');
  } catch(e) {
    console.error('accept invite failed:', e);
    _showToast('Impossibile accettare l’invito (scaduto, già usato o revocato).', 'red');
  }
}

// Ingresso atomico: consumo dell'invito + aggiunta a memberUids/memberInfo + puntatore users,
// tutto nello stesso batch (le regole lo verificano con get()/getAfter()).
async function acceptInvite(token, gid) {
  const u = currentUser;
  const name = (u.displayName || u.email).slice(0, 100);
  const b = writeBatch(db);
  b.update(doc(db, 'invites', token), { usedAt: serverTimestamp(), usedBy: u.uid });
  b.update(doc(db, 'garages', gid), {
    memberUids: arrayUnion(u.uid),
    [`memberInfo.${u.uid}`]: {
      email: u.email.toLowerCase(), name, photo: (u.photoURL || '').slice(0, 2048),
      joinedAt: serverTimestamp(), inviteId: token,
    },
  });
  b.set(doc(db, 'users', u.uid), { garageId: gid, email: u.email, name, updatedAt: serverTimestamp() }, { merge: true });
  await b.commit();
}

// Accesso perso mentre l'app è aperta (rimosso dal proprietario): si torna al garage personale.
let _lostAccessHandled = false;
async function handleLostAccess() {
  if (_lostAccessHandled || isOwner) return;
  _lostAccessHandled = true;
  _unsubscribers.forEach(u => u()); _unsubscribers = [];
  garageId = null;
  data = emptyData();
  try { await resolveGarageWithRetry(); } finally { _lostAccessHandled = false; }
}
function onListenError(err) {
  console.error(err);
  if (err?.code === 'permission-denied' && !isOwner) handleLostAccess();
  else setStatus('error');
}

// ===== REAL-TIME LISTENERS =====
function startListeners() {
  setStatus('loading');
  _unsubscribers.forEach(u => u());
  _unsubscribers = [];
  const base = `garages/${garageId}`;

  const u1 = onSnapshot(
    query(collection(db, base + '/vehicles'), orderBy('plate')),
    snap => {
      data.vehicles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setStatus(snap.metadata.fromCache && !navigator.onLine ? 'cache' : 'online');
      renderAll();
      saveDeadlineSnapshot().then(() => triggerDeadlineCheck());
    },
    onListenError
  );
  const u2 = onSnapshot(
    query(collection(db, base + '/tires'), orderBy('date', 'desc')),
    snap => { data.tires = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderAll(); },
    onListenError
  );
  const u3 = onSnapshot(
    query(collection(db, base + '/mechs'), orderBy('date', 'desc')),
    snap => { data.mechs = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderAll(); },
    onListenError
  );
  const u4 = onSnapshot(
    doc(db, 'garages', garageId),
    snap => {
      if (!snap.exists()) return;
      const g = snap.data();
      const prevUids = data.memberUids;
      data.memberUids = g.memberUids || [];
      data.memberInfo = g.memberInfo || {};
      data.legacyMembers = g.members || [];
      data.garageName = g.garageName || '';
      data.garageOwner = { name: g.ownerName, email: g.ownerEmail, photo: g.ownerPhoto, uid: g.ownerUid };
      if (!isOwner && currentUser && !data.memberUids.includes(currentUser.uid)) { handleLostAccess(); return; }
      const joined = data.memberUids.find(u => !prevUids.includes(u));
      if (prevUids.length && joined) {
        const p = memberProfile(joined);
        _showToast('✅ ' + (p.name || p.email || 'Un nuovo membro') + ' è entrato nel garage!');
      }
      renderHeader();
      renderFamiglia();
      renderStats();
    },
    onListenError
  );
  _unsubscribers = [u1, u2, u3, u4];
  if (isOwner) {
    const u5 = onSnapshot(
      query(collection(db, 'invites'), where('garageId', '==', garageId)),
      snap => { data.invites = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderFamiglia(); },
      err => console.error('invites:', err)
    );
    _unsubscribers.push(u5);
  }
}

// ===== STATUS =====
function setStatus(state) {
  const el = document.getElementById('db-status');
  if (!el) return;
  const cfg = {
    loading: { text: '⏳ Connessione…' },
    online:  { text: '● Sync' },
    cache:   { text: '● Offline · dati locali' },
    error:   { text: '● Offline' },
  }[state];
  el.style.color = state === 'online' ? '#4fe3b0' : state === 'error' ? '#ff9ba0' : state === 'cache' ? '#ffc555' : 'rgba(255,255,255,0.75)';
  el.textContent = cfg.text;
}

// ===== FIRESTORE CRUD =====
// Gli ID dei documenti sono generati SOLO da Firestore (mai dall'utente): vedi newId().
function vDoc(name, id) { return doc(db, `garages/${garageId}/${name}/${id}`); }
// Una scrittura è applicata SUBITO alla cache locale, ma la promessa si risolve solo alla conferma del server:
// offline non arriverebbe mai (modale bloccata in caricamento). Dopo 2,5 s la si considera "in coda":
// verrà inviata al ritorno della rete; un eventuale rifiuto successivo viene comunque mostrato.
async function written(p) {
  const QUEUED = Symbol('queued');
  const r = await Promise.race([p, new Promise(res => setTimeout(() => res(QUEUED), 2500))]);
  if (r === QUEUED) {
    p.catch(e => _showToast('Modifica non sincronizzata: ' + (e.code || e.message), 'red'));
    _showToast('Salvato sul dispositivo: verrà sincronizzato appena torna la rete', 'yellow');
  }
}
function newId(name) { return doc(collection(db, `garages/${garageId}/${name}`)).id; }
async function addVehicle(v) { const { id, ...rest } = v; await setDoc(vDoc('vehicles', id), rest); }
async function addTire(t)    { const { id, ...rest } = t; await setDoc(vDoc('tires', id), rest); }
async function addMech(m)    { const { id, ...rest } = m; await setDoc(vDoc('mechs', id), rest); }
async function removeVehicle(id) {
  // tutte insieme: offline una cancellazione "attende" il server e bloccherebbe le successive
  await Promise.all([
    deleteDoc(vDoc('vehicles', id)),
    ...data.tires.filter(t => t.vehicleId === id).map(t => deleteDoc(vDoc('tires', t.id))),
    ...data.mechs.filter(m => m.vehicleId === id).map(m => deleteDoc(vDoc('mechs', m.id))),
  ]);
}
async function removeTire(id) { await deleteDoc(vDoc('tires', id)); }
async function removeMech(id) { await deleteDoc(vDoc('mechs', id)); }

// ===== FAMIGLIA =====
// memberUids = accesso (fonte di verità); memberInfo[uid] = profilo; members[] = legacy (solo visualizzazione)
function memberProfile(uid) {
  const info = data.memberInfo[uid];
  if (info) return info;
  const old = data.legacyMembers.find(m => m.uid === uid);
  return old ? { email: old.email, name: old.name, photo: old.photo } : { email: '', name: 'Membro', photo: '' };
}
const isPendingInvite = i => !i.usedAt && i.expiresAt && i.expiresAt.toMillis() > Date.now();

async function sendInvite() {
  const email = document.getElementById('invite-email').value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) { _showToast('Inserisci un indirizzo email valido', 'red'); return; }
  if (!isOwner) { _showToast('Solo il proprietario può invitare membri', 'red'); return; }
  if (email === (currentUser.email || '').toLowerCase()) { _showToast('Non puoi invitare te stesso', 'yellow'); return; }
  if (data.memberUids.some(u => (memberProfile(u).email || '').toLowerCase() === email)) { _showToast('È già membro del garage', 'yellow'); return; }
  if (data.invites.some(i => i.email === email && isPendingInvite(i))) { _showToast('C’è già un invito valido per questo indirizzo', 'yellow'); return; }

  const token = newInviteToken();
  try {
    await setDoc(doc(db, 'invites', token), {
      garageId, email,
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
      // 7 giorni meno 10 minuti di margine per gli orologi dei dispositivi (le regole impongono ≤ 7 giorni)
      expiresAt: Timestamp.fromMillis(Date.now() + INVITE_DAYS * 86400000 - 10 * 60000),
      usedAt: null, usedBy: null,
      garageName: (data.garageName || '').slice(0, 40),
      invitedByName: (currentUser.displayName || currentUser.email).slice(0, 100),
    });
  } catch(e) { _showToast('Errore nella creazione dell’invito: ' + e.message, 'red'); return; }

  const link = `${window.location.href.split('?')[0]}?invite=${token}`;
  document.getElementById('share-link-text').textContent = link;
  document.getElementById('share-link-box').style.display = 'flex';
  const fb = document.getElementById('invite-feedback');
  fb.textContent = `✅ Invito creato per ${email}: valido ${INVITE_DAYS} giorni, utilizzabile una sola volta. Copia il link e mandaglielo!`;
  fb.style.display = 'block';
  document.getElementById('invite-email').value = '';
}

function copyShareLink() {
  const text = document.getElementById('share-link-text').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('.copy-btn');
    btn.textContent = '✅ Copiato!';
    setTimeout(() => btn.textContent = 'Copia', 2000);
  });
}

async function revokeInvite(token) {
  const inv = data.invites.find(i => i.id === token);
  if (!inv || !await showConfirm(`Annullare l’invito per ${inv.email}?`)) return;
  try { await deleteDoc(doc(db, 'invites', token)); } catch(e) { _showToast('Errore: ' + e.message, 'red'); }
}

// Rimozione da parte del proprietario: accesso, profilo e voce legacy tolti nella stessa transazione
async function removeMember(uid) {
  if (!isOwner || !data.memberUids.includes(uid)) return;
  const p = memberProfile(uid);
  if (!await showConfirm(`Rimuovere ${p.name || p.email} dal garage?`)) return;
  const garageRef = doc(db, 'garages', garageId);
  try {
    await runTransaction(db, async tx => {
      const snap = await tx.get(garageRef);
      const legacyMembers = (snap.data().members || []).filter(m => m.uid !== uid);
      tx.update(garageRef, { memberUids: arrayRemove(uid), [`memberInfo.${uid}`]: deleteField(), members: legacyMembers });
    });
    _showToast('Membro rimosso');
  } catch(e) { _showToast('Errore: ' + e.message, 'red'); }
}

// Pulizia delle voci legacy di members[] (vecchi inviti ?join= o membri v1 senza accesso)
async function removeLegacyMember(email) {
  if (!isOwner || !await showConfirm(`Eliminare la voce ${email}? (vecchio formato, non ha accesso al garage)`)) return;
  const garageRef = doc(db, 'garages', garageId);
  try {
    await runTransaction(db, async tx => {
      const snap = await tx.get(garageRef);
      const memberUids = snap.data().memberUids || [];
      const legacyMembers = (snap.data().members || []).filter(m => m.email !== email || memberUids.includes(m.uid));
      tx.update(garageRef, { members: legacyMembers });
    });
  } catch(e) { _showToast('Errore: ' + e.message, 'red'); }
}

// Un membro esce da solo: toglie solo sé stesso e torna al proprio garage
async function leaveGarage() {
  if (isOwner || !currentUser) return;
  if (!await showConfirm('Uscire dal garage di famiglia? Potrai rientrare solo con un nuovo invito.')) return;
  const uid = currentUser.uid;
  const b = writeBatch(db);
  b.update(doc(db, 'garages', garageId), { memberUids: arrayRemove(uid), [`memberInfo.${uid}`]: deleteField() });
  b.set(doc(db, 'users', uid), { garageId: uid, updatedAt: serverTimestamp() }, { merge: true });
  try {
    _lostAccessHandled = true;   // evita che il listener reagisca alla propria uscita
    _unsubscribers.forEach(u => u()); _unsubscribers = [];
    await b.commit();
    garageId = null; data = emptyData();
    _showToast('Sei uscito dal garage di famiglia');
    await resolveGarageWithRetry();
  } catch(e) {
    _showToast('Errore: ' + e.message, 'red');
    startListeners();
  } finally { _lostAccessHandled = false; }
}

// ===== UTILS =====

// Popola filtro tipi meccanica
document.getElementById('mech-filter-type').innerHTML =
  '<option value="">Tutti i tipi</option>' +
  MECH_TYPES.map(t => `<option value="${t.id}">${t.label}</option>`).join('');

// ===== EXPORT CSV =====
let _costInfoFor = null, _costInfo = new Map();
function costInfo() {
  if (_costInfoFor !== data.mechs) { _costInfo = mechCostInfo(data.mechs); _costInfoFor = data.mechs; }
  return _costInfo;
}
const mechCost = m => costInfo().get(m.id)?.counted ?? (parseFloat(m.cost) || 0);
const sumCost = list => list.reduce((s, m) => s + mechCost(m), 0);

function vehicleLabel(id) {
  const v = data.vehicles.find(v => v.id === id);
  return v ? `${v.plate} ${v.model}` : 'Veicolo rimosso';
}
function exportMechsCSV() {
  const filterV = document.getElementById('mech-filter-vehicle').value;
  const filterT = document.getElementById('mech-filter-type').value;
  const mechs = data.mechs
    .filter(m => (!filterV || m.vehicleId === filterV) && (!filterT || m.type === filterT))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (mechs.length === 0) { _showToast('Nessun intervento da esportare', 'yellow'); return; }
  const rows = [['Data', 'Veicolo', 'Intervento', 'Km', 'Costo (€)', 'Officina', 'Note', 'Inserito da']];
  mechs.forEach(m => rows.push([
    m.date || '', vehicleLabel(m.vehicleId), getMechType(m.type).label,
    m.km || '', costInfo().get(m.id)?.included ? 'incluso' : (m.cost || ''), m.garage || '', m.note || '', m.addedBy || ''
  ]));
  const tot = sumCost(mechs);
  rows.push([]);
  rows.push(['', '', 'TOTALE', '', tot, '', '', '']);
  downloadCSV(`garageos-interventi-${new Date().toISOString().split('T')[0]}.csv`, rows);
  _showToast('⬇️ CSV interventi scaricato');
}
function exportTiresCSV() {
  const filterV = document.getElementById('tire-filter-vehicle').value;
  const tires = data.tires
    .filter(t => !filterV || t.vehicleId === filterV)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (tires.length === 0) { _showToast('Nessun cambio gomme da esportare', 'yellow'); return; }
  const seasons = { invernale: 'Invernale', estivo: 'Estivo', allseason: '4 Stagioni' };
  const rows = [['Data', 'Veicolo', 'Stagione', 'Km', 'Prossimo cambio (km)', 'Marca', 'Misura', 'Note']];
  tires.forEach(t => rows.push([
    t.date || '', vehicleLabel(t.vehicleId), seasons[t.season] || t.season,
    t.km || '', t.kmNext || '', t.brand || '', t.size || '', t.note || ''
  ]));
  downloadCSV(`garageos-gomme-${new Date().toISOString().split('T')[0]}.csv`, rows);
  _showToast('⬇️ CSV gomme scaricato');
}

// ===== NOTIFICHE =====
async function saveDeadlineSnapshot() {
  try {
    const deadlines = [];
    data.vehicles.filter(v => !v.frozen).forEach(v => {
      if (v.bollo) deadlines.push({ plate: v.plate, label: 'Bollo', date: v.bollo });
      if (v.revisione) deadlines.push({ plate: v.plate, label: 'Revisione', date: v.revisione });
      if (v.assicurazione) deadlines.push({ plate: v.plate, label: 'Assicurazione', date: v.assicurazione });
    });
    const cache = await caches.open('garageos-notif');
    const prev = await cache.match('notif-data');
    const lastNotified = prev ? ((await prev.json()).lastNotified || 0) : 0;
    await cache.put('notif-data', new Response(
      JSON.stringify({ deadlines, lastNotified }),
      { headers: { 'Content-Type': 'application/json' } }
    ));
  } catch(e) { console.warn('snapshot notifiche fallito:', e); }
}

async function enableNotifications() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    _showToast('Notifiche non supportate su questo browser', 'red'); return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { _showToast('Permesso notifiche negato', 'yellow'); return; }
  await saveDeadlineSnapshot();
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) {
      try {
        await reg.periodicSync.register('garageos-check', { minInterval: 12 * 3600 * 1000 });
        _showToast('🔔 Notifiche attive: controllo scadenze in background');
      } catch(e) {
        _showToast('🔔 Notifiche attive (controllo all’apertura dell’app)');
      }
    } else {
      _showToast('🔔 Notifiche attive (controllo all’apertura dell’app)');
    }
    reg.showNotification('GarageOS', {
      body: 'Notifiche attivate: ti avviserò quando una scadenza è a meno di 10 giorni.',
      icon: 'icon-192.png', badge: 'icon-192.png',
    });
  } catch(e) { _showToast('Errore attivazione notifiche: ' + e.message, 'red'); }
}

function triggerDeadlineCheck() {
  if (('Notification' in window) && Notification.permission === 'granted' && navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'CHECK_DEADLINES' });
  }
}

// ===== RINNOVO SCADENZE (bollo +1 anno, revisione +2) =====
async function renewDeadline(vid, kind) {
  const v = data.vehicles.find(x => x.id === vid);
  if (!v) return;
  const conf = {
    bollo:     { field: 'bollo',     costField: 'bolloCost',     label: 'Bollo',     years: 1 },
    revisione: { field: 'revisione', costField: 'revisioneCost', label: 'Revisione', years: 2 },
  }[kind];
  if (!conf || !v[conf.field]) return;
  const newDate = addYears(v[conf.field], conf.years);
  const costMsg = v[conf.costField] ? ` Registro €${Number(v[conf.costField]).toLocaleString('it-IT')} nello storico.` : '';
  if (!await showConfirm(`Segnare ${conf.label} di ${v.plate} come rinnovato? Nuova scadenza: ${formatDate(newDate)}.${costMsg}`)) return;
  try {
    const now = new Date().toISOString();
    await written(Promise.all([addVehicle({ ...v, [conf.field]: newDate, updatedAt: now }), addMech({
      id: newId('mechs'), vehicleId: vid, type: kind,
      date: now.split('T')[0], km: v.km || '',
      cost: v[conf.costField] || '', garage: '',
      note: `Rinnovo ${conf.label} — nuova scadenza ${formatDate(newDate)}`,
      createdAt: now, updatedAt: now,
      addedBy: currentUser?.email || '?',
    })]));
    _showToast(`✅ ${conf.label} rinnovato · prossima scadenza ${formatDate(newDate)}`);
  } catch(e) { _showToast('Errore: ' + e.message, 'red'); }
}

// ===== MECH TYPE MULTI-SELECT =====
let _selectedMechTypes = [];
function buildMechTypeGrid(selectedIds = []) {
  _selectedMechTypes = Array.isArray(selectedIds) ? [...selectedIds] : (selectedIds ? [selectedIds] : []);
  const grid = document.getElementById('mech-type-grid');
  if (!grid) return;
  grid.innerHTML = MECH_TYPES.map(t => {
    const sel = _selectedMechTypes.includes(t.id);
    return `<button type="button" class="mech-type-btn ${sel ? 'selected' : ''}" data-action="toggle-mech-type" data-type="${esc(t.id)}">
      <span class="mt-icon">${t.icon}</span><span>${t.label}</span>
    </button>`;
  }).join('');
  updateSelectedTags();
}
function toggleMechType(id) {
  const idx = _selectedMechTypes.indexOf(id);
  if (idx >= 0) _selectedMechTypes.splice(idx, 1); else _selectedMechTypes.push(id);
  document.getElementById('m-type').value = _selectedMechTypes.join(',');
  document.getElementById('m-type-error').style.display = 'none';
  document.querySelectorAll('.mech-type-btn').forEach(btn =>
    btn.classList.toggle('selected', _selectedMechTypes.includes(btn.dataset.type)));
  updateSelectedTags();
}
function updateSelectedTags() {
  const wrap = document.getElementById('m-selected-tags');
  if (!wrap) return;
  wrap.innerHTML = _selectedMechTypes.map(id => {
    const t = getMechType(id);
    return `<span class="mech-selected-tag">${esc(t.icon)} ${esc(t.label)}
      <button type="button" data-action="toggle-mech-type" data-type="${esc(id)}" title="Rimuovi">×</button></span>`;
  }).join('');
}

// ===== MODAL =====
function openModal(id) {
  const m = document.getElementById(id);
  if (id === 'vehicle-modal' && !document.getElementById('v-edit-id').value) {
    m.querySelectorAll('input:not(#v-edit-id), textarea').forEach(el => { el.value = ''; });
    const typeEl = document.getElementById('v-type');
    if (typeEl) typeEl.selectedIndex = 0;
    const frozenEl = document.getElementById('v-frozen');
    if (frozenEl) frozenEl.selectedIndex = 0;
  }
  m.classList.add('open');
  if (id === 'tire-modal') populateVehicleSelect('t-vehicle');
  if (id === 'mech-modal') {
    populateVehicleSelect('m-vehicle');
    if (!document.getElementById('m-edit-id').value) {
      document.getElementById('m-type').value = '';
      buildMechTypeGrid([]);
    }
  }
  const today = new Date().toISOString().split('T')[0];
  m.querySelectorAll('input[type="date"]').forEach(inp => { if (!inp.value) inp.value = today; });
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (id === 'vehicle-modal') {
    document.getElementById('v-edit-id').value = '';
    document.getElementById('vehicle-modal-title').textContent = 'Aggiungi Veicolo';
    document.getElementById('btn-save-vehicle').textContent = 'Salva Veicolo';
  }
  if (id === 'tire-modal') {
    document.getElementById('t-edit-id').value = '';
    document.getElementById('tire-modal-title').textContent = 'Registra Cambio Gomme';
    document.getElementById('btn-save-tire').textContent = 'Salva';
  }
  if (id === 'mech-modal') {
    document.getElementById('m-edit-id').value = '';
    document.getElementById('mech-modal-title').textContent = 'Aggiungi Intervento';
    document.getElementById('btn-save-mech').textContent = 'Salva';
    buildMechTypeGrid([]);
  }
}
document.querySelectorAll('.modal-overlay:not(#confirm-modal)').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); });
});
function populateVehicleSelect(selectId) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = data.vehicles.length === 0
    ? '<option value="">— Nessun veicolo —</option>'
    : data.vehicles.map(v => `<option value="${esc(v.id)}">${v.frozen ? '🧊 ' : ''}${esc(v.plate)} — ${esc(v.model)}</option>`).join('');
}

// ===== NOME GARAGE =====
function openGarageName() {
  if (!isOwner) return;
  document.getElementById('g-name').value = data.garageName || '';
  openModal('garage-name-modal');
}

async function saveGarageName() {
  const name = document.getElementById('g-name').value.trim();
  setButtonLoading('btn-save-gname', true);
  try {
    await setDoc(doc(db, 'garages', garageId), { garageName: name }, { merge: true });
    closeModal('garage-name-modal');
    data.garageName = name;
    renderHeader();
  } catch(e) { _showToast('Errore: ' + e.message, 'red'); }
  setButtonLoading('btn-save-gname', false);
}

// ===== TABS =====
const TAB_META = {
  garage:   { title: '',                 sub: '' },
  scadenze: { title: 'Scadenze',         sub: 'Bollo, revisione e assicurazione' },
  officina: { title: 'Officina',         sub: 'Interventi meccanici e gomme' },
  famiglia: { title: 'Garage di Famiglia', sub: 'Condividi il garage con i tuoi familiari' },
};
function switchTab(name, vehicleId) {
  currentTab = name;
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById('section-' + name).classList.add('active');
  document.getElementById('nav-' + name).classList.add('active');

  document.getElementById('hero').style.display = name === 'garage' ? '' : 'none';
  const head = document.getElementById('page-head');
  if (name === 'garage') { head.style.display = 'none'; }
  else {
    head.style.display = '';
    document.getElementById('page-title').textContent = TAB_META[name].title;
    document.getElementById('page-sub').textContent = TAB_META[name].sub;
  }

  updateFab();

  if (vehicleId) {
    if (name === 'scadenze') { const s = document.getElementById('scad-filter-vehicle'); if (s) s.value = vehicleId; }
    if (name === 'officina') {
      const s1 = document.getElementById('mech-filter-vehicle'); if (s1) s1.value = vehicleId;
      const s2 = document.getElementById('tire-filter-vehicle'); if (s2) s2.value = vehicleId;
    }
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
  renderAll();
}

function switchSubTab(name) {
  currentSubTab = name;
  document.getElementById('seg-meccanica').classList.toggle('active', name === 'meccanica');
  document.getElementById('seg-pneumatici').classList.toggle('active', name === 'pneumatici');
  document.getElementById('subsection-meccanica').style.display = name === 'meccanica' ? '' : 'none';
  document.getElementById('subsection-pneumatici').style.display = name === 'pneumatici' ? '' : 'none';
  updateFab();
}

function updateFab() {
  const fab = document.getElementById('fab');
  const show = currentTab === 'garage' || currentTab === 'officina';
  fab.classList.toggle('show', show);
}
function fabAction() {
  if (currentTab === 'garage') openModal('vehicle-modal');
  else if (currentTab === 'officina') openModal(currentSubTab === 'meccanica' ? 'mech-modal' : 'tire-modal');
}

// ===== BUTTON LOADING =====
function setButtonLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.style.opacity = loading ? '0.6' : '1';
  if (loading) btn.dataset.orig = btn.textContent;
  btn.textContent = loading ? 'Salvataggio…' : (btn.dataset.orig || 'Salva');
}

// ===== VEHICLE CRUD =====
function openEditVehicle(id) {
  const v = data.vehicles.find(x => x.id === id);
  if (!v) return;
  document.getElementById('v-edit-id').value = v.id;
  document.getElementById('v-plate').value = v.plate || '';
  document.getElementById('v-model').value = v.model || '';
  document.getElementById('v-year').value = v.year || '';
  document.getElementById('v-km').value = v.km || '';
  document.getElementById('v-km-date').value = v.kmDate || '';
  document.getElementById('v-tagliando-int').value = v.tagliandoInt || '';
  document.getElementById('v-bollo').value = v.bollo || '';
  document.getElementById('v-bollo-cost').value = v.bolloCost || '';
  document.getElementById('v-revisione').value = v.revisione || '';
  document.getElementById('v-revisione-cost').value = v.revisioneCost || '';
  document.getElementById('v-assicurazione').value = v.assicurazione || '';
  document.getElementById('v-assicurazione-cost').value = v.assicurazioneCost || '';
  document.getElementById('v-assicurazione-company').value = v.assicurazioneCompany || '';
  document.getElementById('v-note').value = v.note || '';
  document.getElementById('v-frozen').value = v.frozen ? '1' : '';
  if (v.type) document.getElementById('v-type').value = v.type;
  document.getElementById('vehicle-modal-title').textContent = 'Modifica Veicolo';
  document.getElementById('btn-save-vehicle').textContent = 'Aggiorna Veicolo';
  openModal('vehicle-modal');
}

async function saveVehicle() {
  const plate = document.getElementById('v-plate').value.trim().toUpperCase();
  const model = document.getElementById('v-model').value.trim();
  if (!plate || !model) { _showToast('Targa e modello sono obbligatori', 'red'); return; }
  const editId = document.getElementById('v-edit-id').value;
  const isEdit = !!editId;
  const existing = isEdit ? data.vehicles.find(x => x.id === editId) : null;
  const v = {
    id: isEdit ? editId : newId('vehicles'),
    plate, model,
    type: document.getElementById('v-type').value,
    year: document.getElementById('v-year').value,
    km: document.getElementById('v-km').value,
    kmDate: document.getElementById('v-km-date').value,
    tagliandoInt: document.getElementById('v-tagliando-int').value,
    bollo: document.getElementById('v-bollo').value,
    bolloCost: document.getElementById('v-bollo-cost').value,
    revisione: document.getElementById('v-revisione').value,
    revisioneCost: document.getElementById('v-revisione-cost').value,
    assicurazione: document.getElementById('v-assicurazione').value,
    assicurazioneCost: document.getElementById('v-assicurazione-cost').value,
    assicurazioneCompany: document.getElementById('v-assicurazione-company').value,
    note: document.getElementById('v-note').value,
    frozen: document.getElementById('v-frozen').value === '1',
    frozenAt: document.getElementById('v-frozen').value === '1'
      ? (existing?.frozenAt || new Date().toISOString()) : '',
    createdAt: isEdit ? (existing?.createdAt || new Date().toISOString()) : new Date().toISOString(),
    addedBy: isEdit ? (existing?.addedBy || currentUser?.email || '?') : (currentUser?.email || '?'),
    updatedAt: new Date().toISOString(),
  };
  setButtonLoading('btn-save-vehicle', true);
  try {
    await written(addVehicle(v));
    closeModal('vehicle-modal');
  } catch(e) { _showToast('Errore: ' + e.message, 'red'); }
  setButtonLoading('btn-save-vehicle', false);
}

async function deleteVehicle(id) {
  if (!await showConfirm('Eliminare questo veicolo e tutti i suoi dati?')) return;
  try { await written(removeVehicle(id)); } catch(e) { _showToast('Errore: ' + e.message, 'red'); }
}

// ===== TIRE CRUD =====
function openEditTire(id) {
  const t = data.tires.find(x => x.id === id);
  if (!t) return;
  populateVehicleSelect('t-vehicle');
  document.getElementById('t-edit-id').value = t.id;
  document.getElementById('t-vehicle').value = t.vehicleId || '';
  document.getElementById('t-season').value  = t.season   || 'invernale';
  document.getElementById('t-date').value    = t.date     || '';
  document.getElementById('t-km').value      = t.km       || '';
  document.getElementById('t-km-next').value = t.kmNext   || '';
  document.getElementById('t-brand').value   = t.brand    || '';
  document.getElementById('t-size').value    = t.size     || '';
  document.getElementById('t-note').value    = t.note     || '';
  document.getElementById('tire-modal-title').textContent = 'Modifica Cambio Gomme';
  document.getElementById('btn-save-tire').textContent = 'Aggiorna';
  openModal('tire-modal');
}

async function saveTire() {
  const vid = document.getElementById('t-vehicle').value;
  if (!vid) { _showToast('Seleziona un veicolo', 'red'); return; }
  const editId = document.getElementById('t-edit-id').value;
  const isEdit = !!editId;
  const existing = isEdit ? data.tires.find(x => x.id === editId) : null;
  const t = {
    id: isEdit ? editId : newId('tires'),
    vehicleId: vid,
    season:  document.getElementById('t-season').value,
    date:    document.getElementById('t-date').value,
    km:      document.getElementById('t-km').value,
    kmNext:  document.getElementById('t-km-next').value,
    brand:   document.getElementById('t-brand').value,
    size:    document.getElementById('t-size').value,
    note:    document.getElementById('t-note').value,
    createdAt: isEdit ? (existing?.createdAt || new Date().toISOString()) : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  setButtonLoading('btn-save-tire', true);
  try { await written(addTire(t)); closeModal('tire-modal'); }
  catch(e) { _showToast('Errore: ' + e.message, 'red'); }
  setButtonLoading('btn-save-tire', false);
}

async function deleteTire(id) {
  if (!await showConfirm('Eliminare questo cambio gomme?')) return;
  try { await written(removeTire(id)); } catch(e) { _showToast('Errore: ' + e.message, 'red'); }
}

// ===== MECH CRUD =====
function openEditMech(id) {
  const m = data.mechs.find(x => x.id === id);
  if (!m) return;
  populateVehicleSelect('m-vehicle');
  document.getElementById('m-edit-id').value  = m.id;
  document.getElementById('m-vehicle').value  = m.vehicleId || '';
  document.getElementById('m-date').value     = m.date      || '';
  document.getElementById('m-km').value       = m.km        || '';
  document.getElementById('m-cost').value     = m.cost      || '';
  document.getElementById('m-garage').value   = m.garage    || '';
  document.getElementById('m-note').value     = m.note      || '';
  buildMechTypeGrid(m.type ? [m.type] : []);
  document.getElementById('m-type').value = m.type || '';
  document.getElementById('mech-modal-title').textContent = 'Modifica Intervento';
  document.getElementById('btn-save-mech').textContent = 'Aggiorna';
  openModal('mech-modal');
}

async function saveMech() {
  const vid    = document.getElementById('m-vehicle').value;
  const editId = document.getElementById('m-edit-id').value;
  const isEdit = !!editId;
  if (!vid) { _showToast('Seleziona un veicolo', 'red'); return; }
  if (_selectedMechTypes.length === 0) {
    document.getElementById('m-type-error').style.display = 'block'; return;
  }
  const existing = isEdit ? data.mechs.find(x => x.id === editId) : null;
  const base = {
    vehicleId: vid,
    date:   document.getElementById('m-date').value,
    km:     document.getElementById('m-km').value,
    cost:   document.getElementById('m-cost').value,
    garage: document.getElementById('m-garage').value,
    note:   document.getElementById('m-note').value,
    createdAt: isEdit ? (existing?.createdAt || new Date().toISOString()) : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    addedBy: isEdit ? (existing?.addedBy || currentUser?.email || '?') : (currentUser?.email || '?'),
  };
  setButtonLoading('btn-save-mech', true);
  try {
    if (isEdit) {
      await written(addMech({ ...base, id: editId, type: _selectedMechTypes[0] }));
    } else {
      // Più tipi = più documenti (modello attuale): il costo va SOLO sul primo, gli altri risultano "inclusi".
      // (Prima ogni documento riceveva l'intero costo → totali moltiplicati per il numero di tipi.)
      await written(Promise.all(_selectedMechTypes.map((type, i) =>
        addMech({ ...base, id: newId('mechs'), type, cost: i === 0 ? base.cost : '' }))));
    }
    closeModal('mech-modal');
    ['m-km','m-cost','m-garage','m-note'].forEach(id => document.getElementById(id).value = '');
  } catch(e) { _showToast('Errore: ' + e.message, 'red'); }
  setButtonLoading('btn-save-mech', false);
}

async function deleteMech(id) {
  if (!await showConfirm('Eliminare questo intervento?')) return;
  try { await written(removeMech(id)); } catch(e) { _showToast('Errore: ' + e.message, 'red'); }
}

// ===== RENDER: HEADER + HERO =====
function renderHeader() {
  const owner = data.garageOwner;
  const fallback = owner && !isOwner ? `Garage di ${owner.name?.split(' ')[0] || 'famiglia'}` : 'Il mio Garage';
  const title = data.garageName || fallback;
  document.getElementById('garage-title').innerHTML = esc(title) + (isOwner ? ' <span class="caret" title="Rinomina">✎</span>' : '');
  document.getElementById('garage-role').textContent = isOwner ? 'Proprietario' : 'Membro';
}

function nextDeadline() {
  let best = null;
  data.vehicles.filter(v => !v.frozen).forEach(v => {
    [['Bollo', v.bollo], ['Revisione', v.revisione], ['Assicurazione', v.assicurazione]].forEach(([label, date]) => {
      if (!date) return;
      const d = daysUntil(date);
      if (d === null) return;
      if (!best || d < best.days) best = { days: d, label, plate: v.plate, date };
    });
  });
  return best;
}

function renderHero() {
  const pill = document.getElementById('hero-pill');
  const pillText = document.getElementById('hero-pill-text');
  const sub = document.getElementById('hero-sub');
  const best = nextDeadline();
  if (!best) {
    pill.className = 'hero-pill';
    pillText.textContent = 'Tutto ok';
    sub.textContent = 'Aggiungi le scadenze dei tuoi veicoli';
    return;
  }
  const d = best.days;
  const cls = badgeClass(d);
  pill.className = 'hero-pill' + (cls === 'green' ? '' : ' ' + cls);
  pillText.textContent = d < 0 ? 'Scadenza superata!' : cls === 'red' ? 'In scadenza!' : cls === 'yellow' ? 'Scadenza vicina' : 'Nella norma';
  const when = d < 0 ? `${Math.abs(d)} ${Math.abs(d) === 1 ? 'giorno' : 'giorni'} fa`
             : d === 0 ? 'oggi'
             : `tra ${d} ${d === 1 ? 'giorno' : 'giorni'}`;
  sub.innerHTML = `Prossima: <b>${esc(best.label)}</b> · ${esc(best.plate)} · ${esc(formatDate(best.date))} (${when})`;
}

// ===== RENDER: STATS + VEICOLI =====
function renderStats() {
  const statsRow = document.getElementById('stats-row');
  const totalCosts = sumCost(data.mechs);
  const membersN = data.memberUids.length + 1;
  const frozenN = data.vehicles.filter(v => v.frozen).length;
  const activeN = data.vehicles.length - frozenN;
  statsRow.innerHTML = `
    <div class="stat-card"><div class="stat-value">${activeN}</div><div class="stat-label">Veicoli${frozenN ? ` (+${frozenN} 🧊)` : ''}</div></div>
    <div class="stat-card"><div class="stat-value">${data.mechs.length}</div><div class="stat-label">Interventi</div></div>
    <div class="stat-card"><div class="stat-value accent">€${Math.round(totalCosts).toLocaleString('it-IT')}</div><div class="stat-label">Costi totali</div></div>
    <div class="stat-card"><div class="stat-value">${membersN}</div><div class="stat-label">Membri</div></div>`;
}

function vehicleBadges(v) {
  const parts = [];
  const mk = (label, date, cost, company) => {
    const d = daysUntil(date);
    if (d === null) return;
    const cls = badgeClass(d);
    const costStr = cost ? ' · €' + Number(cost).toLocaleString('it-IT') : '';
    const compStr = company ? ' ' + esc(company) : '';
    parts.push(`<span class="badge ${cls}"><span class="status-dot"></span>${esc(label)}${compStr}: ${d >= 0 ? d + 'gg' : 'SCADUTO'}${costStr}</span>`);
  };
  mk('Bollo', v.bollo, v.bolloCost);
  mk('Revisione', v.revisione, v.revisioneCost);
  mk('Assic.', v.assicurazione, v.assicurazioneCost, v.assicurazioneCompany);
  return parts.join('');
}

function renderDashboard() {
  renderStats();
  renderHero();
  const grid = document.getElementById('vehicle-grid');
  if (data.vehicles.length === 0) {
    grid.innerHTML = `<div class="add-vehicle-card" data-action="open-modal" data-modal="vehicle-modal"><div class="add-icon emoji">🚗</div><span>Aggiungi il tuo primo veicolo</span></div>`;
    return;
  }
  const sorted = [...data.vehicles].sort((a, b) => (a.frozen ? 1 : 0) - (b.frozen ? 1 : 0));
  grid.innerHTML = sorted.map(v => {
    const vMechs = data.mechs.filter(m => m.vehicleId === v.id);
    const vCost = sumCost(vMechs);
    const costLine = vMechs.length
      ? `<div class="vc-meta" style="margin-top:4px">🔧 ${vMechs.length} interventi · <b style="color:var(--ink)">€${Math.round(vCost).toLocaleString('it-IT')}</b></div>`
      : '';
    const addedBy = v.addedBy ? `<div style="font-size:11.5px;color:var(--ink-2);margin-top:5px">Aggiunto da ${esc(v.addedBy)}</div>` : '';
    const frozenBadge = v.frozen
      ? `<span class="badge frozen">🧊 Congelato${v.frozenAt ? ' dal ' + esc(formatDate(v.frozenAt)) : ''}</span>`
      : '';
    return `
      <div class="vehicle-card${v.frozen ? ' frozen' : ''}">
        <div class="vc-header">
          <div>
            <div style="font-size:26px;line-height:1;margin-bottom:8px" class="emoji">${TYPE_EMOJI[v.type] || '🚗'}</div>
            <span class="vc-plate">${esc(v.plate)}</span>
          </div>
          <div style="display:flex;gap:7px">
            <button class="icon-btn" data-action="edit-vehicle" data-id="${esc(v.id)}" title="Modifica">✏️</button>
            <button class="icon-btn danger" data-action="delete-vehicle" data-id="${esc(v.id)}" title="Elimina">🗑️</button>
          </div>
        </div>
        <div class="vc-model">${esc(v.model)}</div>
        <div class="vc-meta">${v.year ? esc(v.year) + ' · ' : ''}${v.km ? Number(v.km).toLocaleString('it-IT') + ' km' : ''}${v.kmDate ? ' <span style="opacity:0.65">al ' + esc(formatDate(v.kmDate)) + '</span>' : ''}</div>
        ${costLine}
        ${addedBy}
        <div class="vc-badges">${v.frozen ? frozenBadge : vehicleBadges(v)}</div>
        <div class="vc-actions">
          ${v.frozen ? '' : `<button class="btn btn-secondary btn-sm" data-action="tab" data-tab="scadenze" data-vehicle="${esc(v.id)}">📅 Scadenze</button>`}
          <button class="btn btn-secondary btn-sm" data-action="tab" data-tab="officina" data-vehicle="${esc(v.id)}">🔧 Storico</button>
        </div>
      </div>`;
  }).join('') + `<div class="add-vehicle-card" data-action="open-modal" data-modal="vehicle-modal"><div class="add-icon">＋</div><span>Aggiungi veicolo</span></div>`;
}

// ===== RENDER: SCADENZE =====
function renderScadenze() {
  const sel = document.getElementById('scad-filter-vehicle');
  const filterV = sel.value;
  const list = document.getElementById('scadenze-list');
  sel.innerHTML = '<option value="">Tutti i veicoli</option>' +
    data.vehicles.map(v => `<option value="${esc(v.id)}" ${filterV === v.id ? 'selected' : ''}>${v.frozen ? '🧊 ' : ''}${esc(v.plate)} — ${esc(v.model)}</option>`).join('');
  let items = [];
  data.vehicles.filter(v => !v.frozen && (!filterV || v.id === filterV)).forEach(v => {
    if (v.bollo) items.push({ vehicle: v, kind: 'bollo', date: v.bollo, icon: '📋', label: 'Bollo', cost: v.bolloCost });
    if (v.revisione) items.push({ vehicle: v, kind: 'revisione', date: v.revisione, icon: '🔍', label: 'Revisione', cost: v.revisioneCost });
    if (v.assicurazione) items.push({ vehicle: v, kind: 'assicurazione', date: v.assicurazione, icon: '🛡️', label: v.assicurazioneCompany ? 'Assicurazione ' + v.assicurazioneCompany : 'Assicurazione', cost: v.assicurazioneCost });
  });
  if (items.length === 0) { list.innerHTML = `<div class="empty-state"><div class="empty-icon">📅</div><p>Nessuna scadenza registrata.</p></div>`; return; }
  items.sort((a, b) => new Date(a.date) - new Date(b.date));
  const colors = { green: 'var(--green)', yellow: 'var(--yellow)', red: 'var(--red)' };
  const softs = { green: 'var(--green-soft)', yellow: 'var(--yellow-soft)', red: 'var(--red-soft)' };
  list.innerHTML = items.map(item => {
    const days = daysUntil(item.date);
    const cls = badgeClass(days) || 'green';
    const daysText = days === null ? '?' : days < 0 ? 'SCADUTO' : days === 0 ? 'OGGI' : days + ' gg';
    const pct = days === null ? 100 : Math.max(3, Math.min(100, 100 - (days / 365) * 100));
    return `<div class="scadenza-item">
      <div class="sc-icon-wrap emoji" style="background:${softs[cls]}">${item.icon}</div>
      <div class="sc-info">
        <div class="sc-title">${esc(item.label)} — ${esc(item.vehicle.plate)}${item.cost ? ` <span style="color:var(--green);font-size:13px">· €${Number(item.cost).toLocaleString('it-IT')}</span>` : ''}</div>
        <div class="sc-sub">${esc(item.vehicle.model)} · Scade: ${esc(formatDate(item.date))}</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${colors[cls]}"></div></div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
        <div class="sc-days" style="color:${colors[cls]}">${daysText}</div>
        ${item.kind !== 'assicurazione' ? `<button class="btn btn-primary btn-sm" style="padding:6px 12px;font-size:12px" data-action="renew" data-id="${esc(item.vehicle.id)}" data-kind="${esc(item.kind)}">✅ Rinnovata</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ===== RENDER: PNEUMATICI =====
function renderPneumatici() {
  const sel = document.getElementById('tire-filter-vehicle');
  const filterV = sel.value;
  const grid = document.getElementById('tire-grid');
  sel.innerHTML = '<option value="">Tutti i veicoli</option>' +
    data.vehicles.map(v => `<option value="${esc(v.id)}" ${filterV === v.id ? 'selected' : ''}>${v.frozen ? '🧊 ' : ''}${esc(v.plate)} — ${esc(v.model)}</option>`).join('');
  const tires = data.tires.filter(t => !filterV || t.vehicleId === filterV).sort((a, b) => new Date(b.date) - new Date(a.date));
  if (tires.length === 0) { grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🛞</div><p>Nessun cambio gomme registrato.</p></div>`; return; }
  grid.innerHTML = tires.map(t => {
    const v = data.vehicles.find(v => v.id === t.vehicleId);
    const vLabel = v ? `${esc(v.plate)} — ${esc(v.model)}` : 'Veicolo rimosso';
    const seasonLabel = { invernale: '❄️ Invernale', estivo: '☀️ Estivo', allseason: '🌦️ 4 Stagioni' }[t.season] || esc(t.season);
    return `<div class="tire-card">
      <div class="tire-header">
        <div class="tire-icon-e" style="font-size:24px">🛞</div>
        <div style="flex:1;min-width:0"><div style="font-weight:800;font-size:14px">${vLabel}</div></div>
        <span class="tire-season ${esc(t.season)}">${seasonLabel}</span>
        <div style="display:flex;gap:6px">
          <button class="icon-btn" data-action="edit-tire" data-id="${esc(t.id)}" title="Modifica">✏️</button>
          <button class="icon-btn danger" data-action="delete-tire" data-id="${esc(t.id)}" title="Elimina">🗑️</button>
        </div>
      </div>
      <div class="tire-detail">📅 <strong>${esc(formatDate(t.date))}</strong>${t.km ? ' · ' + Number(t.km).toLocaleString('it-IT') + ' km' : ''}</div>
      ${t.brand ? `<div class="tire-detail">🏷️ <strong>${esc(t.brand)}</strong>${t.size ? ' — ' + esc(t.size) : ''}</div>` : ''}
      ${t.kmNext ? `<div class="tire-detail">⏭️ Prossimo: <strong>${Number(t.kmNext).toLocaleString('it-IT')} km</strong></div>` : ''}
      ${t.note ? `<div class="tire-detail" style="font-size:12.5px;margin-top:8px">${esc(t.note)}</div>` : ''}
    </div>`;
  }).join('');
}

// ===== RENDER: MECCANICA =====
function mechItemHTML(m) {
  const v = data.vehicles.find(v => v.id === m.vehicleId);
  const vLabel = v ? `${esc(v.plate)} — ${esc(v.model)}` : 'Veicolo rimosso';
  const mt = getMechType(m.type);
  const ci = costInfo().get(m.id);
  const payer = ci?.included ? data.mechs.find(x => x.id === ci.payer) : null;
  const payerLabel = payer ? getMechType(payer.type).label : 'un altro tipo dello stesso intervento';
  return `<div class="mech-item">
    <div class="mech-icon-wrap" style="background:${mt.color}1c">${mt.icon}</div>
    <div class="mech-info">
      <div class="mech-title">${esc(mt.label)}</div>
      <div class="mech-sub">${vLabel} · ${esc(formatDate(m.date))}${m.km ? ' · ' + Number(m.km).toLocaleString('it-IT') + ' km' : ''}${m.garage ? ' · 🏪 ' + esc(m.garage) : ''}</div>
      ${ci?.included ? `<div class="mech-incl">🔗 Costo già conteggiato in «${esc(payerLabel)}»</div>` : ''}
      ${m.note ? `<div class="mech-note">${esc(m.note)}</div>` : ''}
      ${m.addedBy ? `<div style="font-size:11px;color:var(--ink-2);margin-top:4px">${esc(m.addedBy)}</div>` : ''}
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
      <div class="mech-cost">${ci?.included ? `<span class="badge incl" title="Costo già conteggiato in «${esc(payerLabel)}»">incluso</span>` : formatCurrency(m.cost)}</div>
      <div style="display:flex;gap:6px">
        <button class="icon-btn" data-action="edit-mech" data-id="${esc(m.id)}" title="Modifica">✏️</button>
        <button class="icon-btn danger" data-action="delete-mech" data-id="${esc(m.id)}" title="Elimina">🗑️</button>
      </div>
    </div>
  </div>`;
}

function toggleYearGroup(year) {
  const header = document.getElementById('yh-' + year);
  const body   = document.getElementById('yb-' + year);
  if (!header || !body) return;
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  header.classList.toggle('open', !isOpen);
}

function renderMeccanica() {
  const selV = document.getElementById('mech-filter-vehicle');
  const selT = document.getElementById('mech-filter-type');
  const filterV = selV.value, filterT = selT.value;
  const list = document.getElementById('mech-list');
  selV.innerHTML = '<option value="">Tutti i veicoli</option>' +
    data.vehicles.map(v => `<option value="${esc(v.id)}" ${filterV === v.id ? 'selected' : ''}>${v.frozen ? '🧊 ' : ''}${esc(v.plate)} — ${esc(v.model)}</option>`).join('');

  let mechs = data.mechs
    .filter(m => (!filterV || m.vehicleId === filterV) && (!filterT || m.type === filterT))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (mechs.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🔧</div><p>Nessun intervento registrato.</p></div>`;
    return;
  }

  const byYear = {};
  mechs.forEach(m => {
    const yr = m.date ? new Date(m.date).getFullYear() : 'N/D';
    (byYear[yr] = byYear[yr] || []).push(m);
  });
  const years = Object.keys(byYear).sort((a, b) => b - a);
  const totalCost = sumCost(mechs);

  let html = `<div class="mech-summary">${mechs.length} interventi · ${years.length} ${years.length === 1 ? 'anno' : 'anni'} · Totale: <strong>€${totalCost.toLocaleString('it-IT')}</strong></div>`;

  // Grafico costi per anno (se almeno 2 anni)
  const chronoYears = [...years].reverse().slice(-8).filter(y => y !== 'N/D');
  const yearCosts = chronoYears.map(y => sumCost(byYear[y]));
  const maxCost = Math.max(...yearCosts, 1);
  if (chronoYears.length >= 2 && maxCost > 0) {
    html += `<div class="cost-chart">` + chronoYears.map((y, i) => {
      const h = Math.max(4, Math.round((yearCosts[i] / maxCost) * 92));
      return `<div class="cc-col">
        <div class="cc-val">${yearCosts[i] > 0 ? '€' + Math.round(yearCosts[i]).toLocaleString('it-IT') : ''}</div>
        <div class="cc-bar" style="height:${h}px"></div>
        <div class="cc-year">${y}</div>
      </div>`;
    }).join('') + `</div>`;
  }

  years.forEach((yr, idx) => {
    const items = byYear[yr];
    const yrCost = sumCost(items);
    const isCurrentYear = yr == new Date().getFullYear();
    const autoOpen = idx === 0 || isCurrentYear;
    html += `<div class="year-group">
      <div class="year-header ${autoOpen ? 'open' : ''}" id="yh-${yr}" data-action="toggle-year" data-year="${esc(yr)}">
        <div class="year-header-left">
          <span class="year-label">${yr}</span>
          <span class="year-count">${items.length}</span>
          ${isCurrentYear ? `<span style="font-size:11px;color:var(--green);font-weight:800">● in corso</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:14px">
          ${yrCost > 0 ? `<span class="year-cost">€${yrCost.toLocaleString('it-IT')}</span>` : ''}
          <span class="year-chevron">▼</span>
        </div>
      </div>
      <div class="year-body ${autoOpen ? 'open' : ''}" id="yb-${yr}">
        ${items.map(m => mechItemHTML(m)).join('')}
      </div>
    </div>`;
  });
  list.innerHTML = html;
}

// ===== RENDER: FAMIGLIA =====
function renderFamiglia() {
  const grid = document.getElementById('family-grid');
  if (!grid) return;
  const owner = data.garageOwner;
  const meTag = ' <span style="color:var(--green);font-size:11px">(tu)</span>';
  const avatar = (photo, fallback = '👤') => safeImg(photo)
    ? `<img class="family-avatar" src="${esc(safeImg(photo))}" alt="" referrerpolicy="no-referrer">`
    : `<div class="family-avatar-placeholder">${fallback}</div>`;
  const card = (left, name, sub, right) => `<div class="family-card">${left}
      <div class="family-info"><div class="family-name">${name}</div><div class="family-email">${sub}</div></div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">${right}</div>
    </div>`;
  let html = '';
  if (owner) {
    const isMe = currentUser && owner.uid === currentUser.uid;
    html += card(avatar(owner.photo), esc(owner.name) + (isMe ? meTag : ''), esc(owner.email),
      '<span class="family-role owner">👑 Proprietario</span>');
  }
  // Membri attivi: SOLO chi è in memberUids (unica fonte di verità per l'accesso)
  data.memberUids.forEach(uid => {
    const m = memberProfile(uid);
    const isMe = currentUser && uid === currentUser.uid;
    const action = isOwner
      ? `<button class="btn btn-danger btn-sm" data-action="remove-member" data-uid="${esc(uid)}">Rimuovi</button>`
      : isMe ? `<button class="btn btn-danger btn-sm" data-action="leave-garage">Esci</button>` : '';
    html += card(avatar(m.photo), esc(m.name || m.email) + (isMe ? meTag : ''), esc(m.email),
      `<span class="family-role member">Membro</span>${action}`);
  });
  if (isOwner) {
    // Inviti (nuovo formato): in attesa o scaduti; quelli usati non si mostrano
    data.invites.filter(i => !i.usedAt).forEach(i => {
      const valid = isPendingInvite(i);
      const sub = valid ? `Scade il ${esc(formatDate(i.expiresAt.toDate()))}` : 'Invito scaduto';
      html += card('<div class="family-avatar-placeholder">✉️</div>', esc(i.email), sub,
        `<span class="family-role pending">${valid ? 'In attesa' : 'Scaduto'}</span>
         <button class="btn btn-danger btn-sm" data-action="revoke-invite" data-id="${esc(i.id)}">${valid ? 'Annulla' : 'Elimina'}</button>`);
    });
    // Voci legacy senza accesso (vecchi inviti ?join= o membri v1 non migrati)
    data.legacyMembers.filter(m => !data.memberUids.includes(m.uid)).forEach(m => {
      html += card('<div class="family-avatar-placeholder">🕸️</div>', esc(m.email),
        'Vecchio formato: nessun accesso, va reinvitato',
        `<span class="family-role pending">Non valido</span>
         <button class="btn btn-danger btn-sm" data-action="remove-legacy" data-email="${esc(m.email)}">Elimina</button>`);
    });
  }
  grid.innerHTML = html || '<div style="color:var(--ink-2);font-size:13px">Nessun membro ancora.</div>';
  document.getElementById('invite-box').style.display = isOwner ? '' : 'none';
}

// ===== PROMEMORIA KM (gomme + tagliando) =====
function kmAlerts() {
  const chips = [];
  const SOGLIA = 2000; // avvisa quando mancano meno di 2000 km
  data.vehicles.filter(v => !v.frozen && v.km).forEach(v => {
    const km = Number(v.km);
    const lastTire = data.tires
      .filter(t => t.vehicleId === v.id && t.kmNext)
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    if (lastTire) {
      const delta = Number(lastTire.kmNext) - km;
      if (delta <= 0) chips.push({ cls: 'red', tab: 'officina', text: `${esc(v.plate)} · Gomme: cambio da fare` });
      else if (delta <= SOGLIA) chips.push({ cls: 'yellow', tab: 'officina', text: `${esc(v.plate)} · Gomme tra ~${delta.toLocaleString('it-IT')} km` });
    }
    if (v.tagliandoInt) {
      const lastTag = data.mechs
        .filter(m => m.vehicleId === v.id && m.type === 'tagliando' && m.km)
        .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
      if (lastTag) {
        const delta = Number(lastTag.km) + Number(v.tagliandoInt) - km;
        if (delta <= 0) chips.push({ cls: 'red', tab: 'officina', text: `${esc(v.plate)} · Tagliando da fare` });
        else if (delta <= SOGLIA) chips.push({ cls: 'yellow', tab: 'officina', text: `${esc(v.plate)} · Tagliando tra ~${delta.toLocaleString('it-IT')} km` });
      }
    }
  });
  return chips;
}

// ===== RENDER: AVVISI =====
function renderNotifications() {
  const wrap = document.getElementById('notif-wrap');
  const chips = [];
  data.vehicles.filter(v => !v.frozen).forEach(v => {
    const checks = [['Bollo', daysUntil(v.bollo)], ['Revisione', daysUntil(v.revisione)], ['Assic.', daysUntil(v.assicurazione)]];
    checks.forEach(([label, d]) => {
      if (d !== null && d <= 30) chips.push({
        cls: d <= 10 ? 'red' : 'yellow',
        tab: 'scadenze',
        text: `${esc(v.plate)} · ${label}: ${d <= 0 ? 'SCADUTO' : d + 'gg'}`
      });
    });
  });
  const badge = document.getElementById('scad-badge');
  if (chips.length > 0) { badge.textContent = chips.length; badge.classList.add('show'); }
  else badge.classList.remove('show');

  const all = chips.concat(kmAlerts());
  if (all.length === 0 || currentTab !== 'garage') { wrap.classList.remove('has'); wrap.innerHTML = ''; return; }
  wrap.classList.add('has');
  wrap.innerHTML = all.map(c => `<span class="notif-chip ${c.cls}" data-action="tab" data-tab="${esc(c.tab)}">${c.text}</span>`).join('');
}

// ===== RENDER ALL =====
function renderAll() {
  renderHeader();
  renderDashboard();
  renderScadenze();
  renderPneumatici();
  renderMeccanica();
  renderFamiglia();
  renderNotifications();
}

// ===== EVENT DELEGATION =====
// Nessun handler inline (onclick=…): gli elementi dichiarano data-action / data-change e
// i parametri in data-* (sempre escapati con esc()). Questo rende possibile una CSP senza 'unsafe-inline'.
const ACTIONS = {
  'apply-update':     () => applyUpdate(),
  'sign-in':          () => signInWithGoogle(),
  'cancel-login':     () => restoreLoginBox(),
  'sign-out':         () => signOutUser(),
  'user-menu':        () => toggleUserMenu(),
  'garage-name':      () => openGarageName(),
  'tab':              d => { toggleUserMenu(false); switchTab(d.tab, d.vehicle); },
  'enable-notif':     () => { toggleUserMenu(false); enableNotifications(); },
  'subtab':           d => switchSubTab(d.sub),
  'fab':              () => fabAction(),
  'open-modal':       d => openModal(d.modal),
  'close-modal':      d => closeModal(d.modal),
  'csv-mechs':        () => exportMechsCSV(),
  'csv-tires':        () => exportTiresCSV(),
  'send-invite':      () => sendInvite(),
  'copy-link':        () => copyShareLink(),
  'revoke-invite':    d => revokeInvite(d.id),
  'remove-member':    d => removeMember(d.uid),
  'remove-legacy':    d => removeLegacyMember(d.email),
  'leave-garage':     () => leaveGarage(),
  'save-vehicle':     () => saveVehicle(),
  'save-tire':        () => saveTire(),
  'save-mech':        () => saveMech(),
  'save-garage-name': () => saveGarageName(),
  'edit-vehicle':     d => openEditVehicle(d.id),
  'delete-vehicle':   d => deleteVehicle(d.id),
  'renew':            d => renewDeadline(d.id, d.kind),
  'edit-tire':        d => openEditTire(d.id),
  'delete-tire':      d => deleteTire(d.id),
  'edit-mech':        d => openEditMech(d.id),
  'delete-mech':      d => deleteMech(d.id),
  'toggle-year':      d => toggleYearGroup(d.year),
  'toggle-mech-type': d => toggleMechType(d.type),
};
const CHANGES = {
  'scadenze':   () => renderScadenze(),
  'meccanica':  () => renderMeccanica(),
  'pneumatici': () => renderPneumatici(),
};
// Azioni che scrivono su Firestore: bloccate finché il garage non è risolto (evita scritture su garages/null)
const NEEDS_GARAGE = new Set(['fab', 'open-modal', 'save-vehicle', 'save-tire', 'save-mech', 'save-garage-name',
  'send-invite', 'revoke-invite', 'remove-member', 'remove-legacy', 'leave-garage', 'renew',
  'delete-vehicle', 'delete-tire', 'delete-mech', 'edit-vehicle', 'edit-tire', 'edit-mech']);
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.action];
  if (!fn) return;
  if (NEEDS_GARAGE.has(el.dataset.action) && !garageId) {
    _showToast('Connessione al garage in corso: riprova tra un attimo', 'yellow');
    return;
  }
  fn(el.dataset, el, e);
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (el && CHANGES[el.dataset.change]) CHANGES[el.dataset.change]();
});

// ===== SERVICE WORKER =====
let _swWaiting = null;
function applyUpdate() {
  if (_swWaiting) { _swWaiting.postMessage({ type: 'SKIP_WAITING' }); }
  else { window.location.reload(); }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.update().catch(() => {});   // offline: nessun controllo aggiornamenti, non è un errore
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          _swWaiting = newWorker;
          document.getElementById('update-banner').classList.add('show');
        }
      });
    });
    if (reg.waiting && navigator.serviceWorker.controller) {
      _swWaiting = reg.waiting;
      document.getElementById('update-banner').classList.add('show');
    }
  }).catch(err => console.log('SW registration failed:', err));
  // Ricarica SOLO se un SW controllava già la pagina (= aggiornamento richiesto dall'utente) e una volta sola.
  // Alla prima installazione clients.claim() fa scattare controllerchange: prima ricaricava la pagina,
  // anche durante il popup di login.
  // La condizione va valutata a OGNI cambio: prima installazione = da nessun controller a uno (niente reload);
  // aggiornamento = da un controller a un altro (reload), anche se nella stessa sessione c'era stata l'installazione.
  let _controller = navigator.serviceWorker.controller;
  let _refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const hadController = !!_controller;
    _controller = navigator.serviceWorker.controller;
    if (!hadController || _refreshing) return;
    _refreshing = true;
    window.location.reload();
  });
}

// ===== INIT =====
setStatus('loading');
updateFab();
renderAll();
