// Avviso "vecchia icona": chi tocca l'icona della v1 sulla Home arriva qui dal redirect di
// lucsor.github.io/garageOS/ con ?from=v1. Mostriamo come installare la v2 e togliere la vecchia icona.
// - il parametro si toglie subito dall'URL (history.replaceState): non finisce nei preferiti né nei link;
// - non compare se l'app è già installata (display-mode standalone, o installata da questo avviso) o dopo "Ho capito";
// - aperta nel browser con l'app già installata (Chrome non manda beforeinstallprompt): lo rileva con
//   navigator.getInstalledRelatedApps() (related_applications nel manifest) e dice di aprirla dalla Home;
//   se non si può sapere, "Installa" mostra in evidenza le istruzioni del menu ⋮ (il pulsante non resta mai muto).
import { deviceKind } from './ics.js';

export const KEY_DISMISSED = 'garageos_v1_banner_dismissed';
export const KEY_INSTALLED = 'garageos_v2_installed';
const V2_URL = 'lucsor.github.io/garageos-v2';

// Toglie SOLO "from=v1" dalla query, lasciando gli altri parametri esattamente come sono.
export function stripFromV1(search) {
  const parts = String(search || '').replace(/^\?/, '').split('&').filter(Boolean);
  const keep = parts.filter((p) => p !== 'from=v1');
  return { fromV1: keep.length !== parts.length, search: keep.length ? '?' + keep.join('&') : '' };
}

export const INSTALLED_MSG = "L'app è già installata: aprila dalla schermata Home e cancella la vecchia icona.";

// true = installata, false = non installata, null = non si può sapere (API assente: iPhone, desktop, Firefox…)
export async function detectInstalled(nav) {
  if (typeof nav?.getInstalledRelatedApps !== 'function') return null;
  try {
    const apps = await nav.getInstalledRelatedApps();
    return Array.isArray(apps) ? apps.length > 0 : null;
  } catch { return null; }
}

export function shouldShow({ fromV1, standalone, dismissed, installed }) {
  return !!fromV1 && !standalone && !dismissed && !installed;
}

export function installHelp(kind) {
  if (kind === 'ios') {
    return 'In Safari tocca Condividi (il quadrato con la freccia ↑), poi «Aggiungi alla schermata Home». '
      + `Se non vedi il pulsante, apri Safari e vai su ${V2_URL}. `
      + 'Poi tieni premuta la vecchia icona e scegli «Rimuovi app».';
  }
  return 'Apri il menu ⋮ di Chrome e tocca «Installa app» (o «Aggiungi a schermata Home»). '
    + `Se non vedi il menu, apri Chrome e vai su ${V2_URL}. `
    + 'Poi tieni premuta la vecchia icona e scegli «Disinstalla» o «Rimuovi».';
}

const isStandalone = (w) => ['standalone', 'fullscreen', 'minimal-ui']
  .some((m) => { try { return w.matchMedia(`(display-mode: ${m})`).matches; } catch { return false; } })
  || w.navigator.standalone === true;
const get = (w, k) => { try { return w.localStorage.getItem(k) === '1'; } catch { return false; } };
const set = (w, k) => { try { w.localStorage.setItem(k, '1'); } catch {} };

// Da chiamare una volta all'avvio, prima di qualsiasi altra lettura dell'URL.
export function initLegacyBanner(w = window) {
  const { fromV1, search } = stripFromV1(w.location.search);
  if (fromV1) w.history.replaceState(w.history.state, '', w.location.pathname + search + w.location.hash);
  w.addEventListener('appinstalled', () => set(w, KEY_INSTALLED));
  const show = shouldShow({ fromV1, standalone: isStandalone(w), dismissed: get(w, KEY_DISMISSED), installed: get(w, KEY_INSTALLED) });
  const el = w.document.getElementById('legacy-banner');
  if (!show || !el) return false;

  let deferred = null;   // evento beforeinstallprompt (Chrome/Android): il pulsante "Installa" apre il prompt vero
  let installed = false; // app già installata su questo dispositivo (aperta però nel browser)
  const help = w.document.getElementById('legacy-help');
  const installBtn = w.document.getElementById('legacy-install');
  const hide = () => { el.hidden = true; };
  const say = (text, strong = false) => {
    help.textContent = text;
    help.classList.toggle('lb-strong', strong);
    help.hidden = false;
  };
  const showInstalled = () => { installed = true; say(INSTALLED_MSG, true); installBtn.hidden = true; };
  w.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
  detectInstalled(w.navigator).then((r) => { if (r && !deferred && !el.hidden) showInstalled(); });
  installBtn.addEventListener('click', async () => {
    if (deferred) {
      const ev = deferred; deferred = null;
      try {
        await ev.prompt();
        const choice = await ev.userChoice;
        if (choice?.outcome === 'accepted') {
          set(w, KEY_INSTALLED);
          say('Fatto! Ora tieni premuta la vecchia icona sulla Home e scegli «Disinstalla» o «Rimuovi».');
          installBtn.hidden = true;
          return;
        }
      } catch { /* prompt non disponibile: mostriamo le istruzioni */ }
    }
    if (installed || await detectInstalled(w.navigator)) { showInstalled(); return; }
    say(installHelp(deviceKind(w.navigator)), true);   // nessun prompt: istruzioni in evidenza, mai un tocco a vuoto
  });
  w.document.getElementById('legacy-dismiss').addEventListener('click', () => { set(w, KEY_DISMISSED); hide(); });
  el.hidden = false;
  return true;
}
