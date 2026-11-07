// Promemoria push (FCM web push) lato client. Lo script di invio gira su GitHub Actions (tools/admin/send-reminders.mjs).
// - il permesso si chiede SOLO dopo un tocco dell'utente ("Attiva su questo dispositivo"), mai all'avvio
// - token in users/{uid}/pushTokens/{sha256(token)}: solo il proprietario li legge (firestore.rules)
// - preferenze in users/{uid}.push = { enabled, days[], details }
// - token revocati/cambiati: controllati a ogni avvio; logout e "Disattiva" cancellano token e documento
import { doc, setDoc, updateDoc, deleteDoc, getDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js';

// Chiave pubblica VAPID (Console Firebase → Impostazioni progetto → Cloud Messaging → Certificati web push).
// È pubblica per natura. Vuota = promemoria non ancora configurati (il pulsante lo dice).
export const VAPID_PUBLIC_KEY = 'BM28RYLkXLERxMLnkCUn3gBxsksERfNQuVoO8rhunEFDNylD3PLtfRu7nfzIfedRmnN5OaoNyTfIObOhZNy1QjY';
export const DEFAULT_DAYS = [30, 7, 1];
export const DAY_OPTIONS = [60, 30, 14, 7, 3, 1, 0];    // sottoinsieme di pushDays() in firestore.rules
const LS_KEY = 'garageos_push';
const MESSAGING_SDK = 'https://www.gstatic.com/firebasejs/10.11.0/firebase-messaging.js';

export function platform(nav = globalThis.navigator) {
  const ua = nav?.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints || 0) > 1)) return 'ios';
  return 'desktop';
}
export function iosVersion(ua = globalThis.navigator?.userAgent || '') {
  const m = ua.match(/OS (\d+)[_.](\d+)/);
  return m ? Number(m[1]) + Number(m[2]) / 100 : null;
}
export function isStandalone(win = globalThis) {
  return !!(win.matchMedia?.('(display-mode: standalone)').matches || win.navigator?.standalone === true);
}
// 'ok' | 'ios-install' (iPhone, app non aggiunta alla Home) | 'ios-old' (< 16.4) | 'unsupported' | 'unconfigured'
export function supportState({ win = globalThis, emulator = false, vapid = VAPID_PUBLIC_KEY } = {}) {
  const nav = win.navigator;
  if (platform(nav) === 'ios') {
    const v = iosVersion(nav.userAgent);
    if (v !== null && v < 16.04) return 'ios-old';
    if (!isStandalone(win)) return 'ios-install';
  }
  if (!('Notification' in win) || !('serviceWorker' in (nav || {})) || !('PushManager' in win)) return 'unsupported';
  if (!vapid && !emulator) return 'unconfigured';
  return 'ok';
}
export async function sha256hex(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function readLocal() { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; } }
function writeLocal(v) { try { v ? localStorage.setItem(LS_KEY, JSON.stringify(v)) : localStorage.removeItem(LS_KEY); } catch {} }

export function createPush({ app, db, getUser, emulator = false }) {
  let messaging = null;
  async function getMessagingInstance() {
    if (messaging) return messaging;
    const m = await import(MESSAGING_SDK);
    if (!(await m.isSupported())) throw Object.assign(new Error('Push non supportate da questo browser'), { code: 'unsupported' });
    messaging = { mod: m, inst: m.getMessaging(app) };
    return messaging;
  }
  async function fetchToken() {
    const user = getUser();
    // Emulatore: FCM non esiste, un token finto permette di provare tutto il resto (regole, UI, script)
    if (emulator) return `emu-token-${user.uid}-${platform()}`;
    const { mod, inst } = await getMessagingInstance();
    return mod.getToken(inst, { vapidKey: VAPID_PUBLIC_KEY, serviceWorkerRegistration: await navigator.serviceWorker.ready });
  }
  const tokenRef = (uid, id) => doc(db, 'users', uid, 'pushTokens', id);

  async function saveToken(token) {
    const user = getUser();
    const id = await sha256hex(token);
    const prev = readLocal();
    if (prev?.uid === user.uid && prev.id !== id) await deleteDoc(tokenRef(user.uid, prev.id)).catch(() => {});
    try { await updateDoc(tokenRef(user.uid, id), { lastSeenAt: serverTimestamp() }); }          // già registrato
    catch { await setDoc(tokenRef(user.uid, id), { token, platform: platform(), createdAt: serverTimestamp(), lastSeenAt: serverTimestamp() }); }
    writeLocal({ uid: user.uid, id, seen: Date.now() });
    return id;
  }

  return {
    supportState: () => supportState({ emulator }),
    isActiveHere() {
      const l = readLocal();
      return !!(l && l.uid === getUser()?.uid && globalThis.Notification?.permission === 'granted');
    },
    // Dentro il tocco dell'utente: permesso → token → documento → preferenze attive
    async enableHere() {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return 'denied';
      await saveToken(await fetchToken());
      await setDoc(doc(db, 'users', getUser().uid), { push: { enabled: true } }, { merge: true });
      return 'enabled';
    },
    async disableHere() {
      const l = readLocal();
      const user = getUser();
      if (l?.uid === user?.uid) await deleteDoc(tokenRef(user.uid, l.id)).catch(() => {});
      if (!emulator) { try { const { mod, inst } = await getMessagingInstance(); await mod.deleteToken(inst); } catch {} }
      writeLocal(null);
    },
    // All'avvio (dopo il login): permesso revocato → via il documento; token cambiato → aggiornato;
    // altrimenti lastSeenAt al massimo una volta ogni 20 ore (lo script elimina i token non visti da 60 giorni).
    async refresh() {
      const l = readLocal();
      const user = getUser();
      if (!l || !user || l.uid !== user.uid || !navigator.onLine) return;
      if (globalThis.Notification?.permission !== 'granted') {
        await deleteDoc(tokenRef(user.uid, l.id)).catch(() => {});
        writeLocal(null);
        return 'revoked';
      }
      const token = await fetchToken().catch(() => null);
      if (!token) return;
      const id = await sha256hex(token);
      if (id !== l.id || Date.now() - (l.seen || 0) > 20 * 3600e3) await saveToken(token);
    },
    async loadPrefs() {
      const s = await getDoc(doc(db, 'users', getUser().uid));
      const p = s.exists() ? s.data().push || {} : {};
      return { enabled: p.enabled === true, days: Array.isArray(p.days) && p.days.length ? p.days : DEFAULT_DAYS, details: p.details !== false };
    },
    async savePrefs({ days, details }) {
      const d = [...new Set(days)].filter((x) => DAY_OPTIONS.includes(x)).sort((a, b) => b - a).slice(0, 5);
      if (!d.length) throw new Error('Scegli almeno un giorno di preavviso');
      await setDoc(doc(db, 'users', getUser().uid), { push: { enabled: true, days: d, details: !!details } }, { merge: true });
    },
    async heartbeat() {
      try { const s = await getDoc(doc(db, 'pushStatus', 'heartbeat')); return s.exists() ? s.data() : null; } catch { return null; }
    },
  };
}
