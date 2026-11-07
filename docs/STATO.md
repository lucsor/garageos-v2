# Stato del lavoro — 2026-11-07, pomeriggio (lavoro in autonomia)

> **Cosa ti serve fare, in ordine di priorità**
> 1. **Togliere `localhost:*` e `localhost:5173/*` dalla chiave API.** Google Cloud → API e servizi → Credenziali → "Browser key (auto created by Firebase)" → Siti web. Devono restare solo `https://lucsor.github.io/*` e `https://garageos-879bc.firebaseapp.com/*`.
> 2. **Mandare il link agli amici e alla famiglia** (testo pronto al §1.3) e **invitare francesco** dalla scheda Famiglia (invito v2.2).
> 3. **Decidere** i punti del §3, in ordine.
> 4. **Rivedere** `fix/v2.3` (v2.3.0) e poi `refactor/modules` (prototipo). Sono solo locali: nessun push, nessun deploy.

---

## 1. Deploy v2.2 (passi 1-5): completato

| Passo | Esito | Dettagli |
|---|---|---|
| Verifica preliminare | ✅ | Login Google reale su `localhost:5173`: Proprietario, Garage Soriente, 5 veicoli, **0 violazioni CSP** |
| 1. Regole | ✅ | Le regole pubblicate erano ancora identiche a `pre-v2.2.rules` (`d071b7de`). Deploy di `firestore.rules` + indici → ruleset **`63f90b2e`**, uguale byte per byte a `firestore.rules` (copia in `docs/rules-backup/post-v2.2.rules`) |
| 2. Migrazione | ✅ | Dry-run identico a quello approvato → apply → verifica → seconda esecuzione "Già migrato". Export prima e dopo (`~/Documents/garageos-backup/`): 73 → 75 documenti. **Cambiati solo** `memberUids` del tuo garage (+ alessandro, tiziana) e **creati solo** `users/` di alessandro e di tiziana |
| 3. App v2.2 | ✅ | PR [lucsor/garageos-v2#1](https://github.com/lucsor/garageos-v2/pull/1) → merge `e864c6f` → Pages build verde, `sw.js` 2.2.0 online |
| 4. Verifica in produzione | ✅ | v2.2 servita (CSP presente), banner "Nuova versione" → SW 2.2.0 attivo; Proprietario, **5 veicoli, 3 membri** (tu, alessandro, tiziana), francesco come "vecchio formato"; **0 violazioni CSP**, 0 errori |
| 5. Redirect v1 | ✅ | PR [lucsor/garageOS#1](https://github.com/lucsor/garageOS/pull/1) → merge `f395099` → online alle 13:09. Prova reale nel tuo browser: `lucsor.github.io/garageOS/` porta alla v2.2 già loggato; il vecchio SW v1 è stato rimosso, quello della v2 è intatto |

### 1.1 Anomalie viste (nessuna bloccante)
- **Errore "insufficient permissions" sul listener degli inviti** nel minuto successivo al deploy delle regole: era la propagazione. Dopo un ricaricamento alle 13:05 è sparito.
- **`users/<tuo uid>.updatedAt` cambiato.** L'ha riscritto la **v2.1** di produzione quando l'ho aperta per la diagnosi del login (12:47): la v2.1 riscrive quel campo a ogni apertura. È innocuo.
- **Il secondo export di oggi aveva sovrascritto quello del mattino** (stesso nome file). Il contenuto era equivalente, perché nel frattempo non c'erano state scritture. Ora gli export hanno data e ora nel nome e non sovrascrivono mai (commit `cff366c`).
- **Il problema di login era nella chiave API, non nel codice**, e riguardava già la v2.1: mancava `garageos-879bc.firebaseapp.com`. L'hai sistemato tu prima del deploy.

### 1.2 Server e schede
Server su `5173` spento, emulatori spenti, schede di test chiuse. Nessun processo locale in ascolto.

### 1.3 Testo da mandare agli amici (copia e incolla)
> Ciao! GarageOS ha un nuovo indirizzo: **https://lucsor.github.io/garageos-v2/**
> Accedi con lo stesso account Google di prima: trovi già i tuoi veicoli. Il vecchio link ti ci porta da solo.
> Se avevi l'app sulla schermata Home, aprila dal nuovo indirizzo e aggiungila di nuovo (Condividi → "Aggiungi a Home" su iPhone, menu ⋮ → "Installa app" su Android), poi elimina la vecchia icona.

**Per lucoli76:** i due inviti in sospeso (martyoli06 e manunap77) vanno rifatti dalla scheda **Famiglia** della v2.2. I vecchi link non funzionano più.

---

## 2. Lavoro in autonomia (solo branch locali ed emulatore)
Nessuna scrittura in produzione, nessun push, nessun deploy.

### 2.1 Branch
| Branch | Base | Commit | Contenuto |
|---|---|---|---|
| `fix/v2.3` | `main` (`e864c6f`) | 11 (9 di lavoro + 2 di questo `STATO.md`) | Fase 2 e 3 (documenti) + v2.3.0 pronta da rivedere |
| `refactor/modules` | `fix/v2.3` al commit `4c53db6` (i 9 di lavoro, senza `STATO.md`) | 11 (9 + 2 del prototipo) | prototipo moduli ES (v2.4.0-modules) |

Il repo locale ha `core.hooksPath = .githooks` (pre-commit hook attivo). La cartella di lavoro è su `fix/v2.3`. Conteggi verificabili con `git rev-list --count main..<branch>`; questa correzione è un amend del commit di `STATO.md`, quindi non cambia il totale.

### 2.2 Fatto
| # | Cosa | Dove | Test |
|---|---|---|---|
| Fase 2 | `docs/IDEE.md`: idee con valore, impegno, impatto Firestore e costi Spark/Blaze con alternative gratuite; modello dati v3 in Mermaid; roadmap MVP → v2.4 → v2.5 → v3 | `fix/v2.3` | — |
| Fase 3 | `docs/PIANO.md`: task ordinati (sicurezza → bug → DB → funzionalità → UX), stimati e con stato | `fix/v2.3` | — |
| B1 | SW: `activate` non cancella più `garageos-notif` né cache di altre app sulla stessa origine | `dc68841` | `pwa.e2e` ✔ |
| B2 | SW: niente reload alla prima installazione; reload una sola volta all'aggiornamento richiesto. **Il test ha trovato un difetto nella mia prima versione**: il reload non scattava se installazione e aggiornamento avvenivano nella stessa sessione. Corretto prima del commit | `dc68841` | `pwa.e2e` ✔ |
| D1 | **Offline:** SDK Firebase e font nella cache del SW + `persistentLocalCache` (multi-scheda) + indicatore "● Offline · dati locali" | `3406407` | `pwa.e2e` ✔ offline **vero**: server spento, rete e gstatic bloccati. L'app si apre, mostra i dati e accetta una modifica, che viene sincronizzata al ritorno online |
| B3 | **Costi multi-tipo:** costo solo sul primo tipo, gli altri "incluso"; i totali deduplicano i vecchi gruppi con lo stesso costo ripetuto | `d774112` | `costs.e2e` ✔ sui **dati reali**: totali invariati; gruppo legacy 3×100 € contato una volta; nuovo intervento 3 tipi da 250 € → +250 € e non +750 € |
| — | `reg.update()` offline non genera più un errore non gestito | `dc68841` | trovato da `pwa.e2e` |
| S3 | **Pre-commit hook:** hash CSP della versione **in staging** + bump di `VERSION` del SW | `056acff` | collaudato in un clone usa e getta su 4 scenari |
| D2 | **Migrazione km/importi/anno → number**, solo script | `7b9e97a` | **solo dry-run, sull'emulatore** con i dati del backup: **66 documenti, 159 campi, 0 ambigui**. Non eseguita da nessuna parte |
| U4 | Prototipo moduli ES | `refactor/modules` | vedi §4 |

**Regressione su `fix/v2.3`:** regole 92/92 · dati reali 17/17 · e2e CSP ✔ · e2e primo avvio ✔ (lucoli76 trova il suo garage) · e2e costi ✔ · e2e PWA/offline ✔.

**Dato utile sui costi:** nei dati reali ci sono 6 interventi multi-tipo (32 documenti), **tutti senza costo**. Il bug non ha mai gonfiato un totale: era latente.

### 2.3 Non fatto (di proposito)
- **Modello dati di km e importi:** non toccato, come chiesto. Il client scrive ancora stringhe. La migrazione va fatta **dopo** il task D3 (ordine in `PIANO.md`).
- **Timestamp lato server (D4):** solo pianificato.
- Nessun aggiornamento della v1 oltre al redirect; nessuna modifica alla chiave API né alle regole.

---

## 3. Decisioni che mi servono (in ordine di priorità)

1. **Pubblicare la v2.3?** Contiene solo client e service worker, nessuna modifica a regole o dati. Proposta: rivedi il diff `main..fix/v2.3`, poi push, PR, merge (la sequenza di `DEPLOY.md` si riduce ai passi 6-7).
2. **Costi multi-tipo, comportamento definitivo.** Oggi c'è la soluzione "costo sul primo tipo + incluso". Le alternative:
   - (a) **tenerla così**: zero migrazioni (la mia scelta per la v2.3);
   - (b) costo diviso tra i tipi;
   - (c) v3: **un solo documento con `types[]`**, che richiede una modifica alle regole e una migrazione che raggruppa per `createdAt`.

   Consiglio (a) ora e (c) nella v3.
3. **Moduli ES (`refactor/modules`):** adottarli come primo passo della v2.4? Vedi §4. La mia raccomandazione è sì.
4. **Java 21 per i test:** oggi uso un JDK portabile nella cartella temporanea della sessione, che può sparire. Vuoi che installi Temurin 21 in modo permanente (winget), o preferisci farlo tu? Senza Java i test delle regole non girano.
5. **CI su GitHub Actions** (gratuita): test delle regole + `csp-hash --check` a ogni PR. Mi autorizzi a prepararla, su un branch?
6. **App Check** (S2) e **pulizia dei `members[]` legacy** (S4): da pianificare nella v2.3.1?
7. **Fase 2:** le tre priorità che propongo per la v2.4 sono calendario e promemoria (.ics), più garage per utente, rifornimenti e spese annue. Confermi o cambi l'ordine?

---

## 4. Moduli ES senza build: valutazione del prototipo (`refactor/modules`)

**Cosa ho fatto.** Solo trasformazioni meccaniche, nessuna modifica alla logica:
- `index.html` è passato da **2.635 a 401 righe** (solo markup);
- CSS in **`css/app.css`** (530 righe), applicazione in **`js/app.js`** (1.597 righe);
- funzioni pure in **`js/utils.js`** (escape, `safeImg`, date, tipi di intervento), **`js/csv.js`** (export con protezione dalle formule) e **`js/costs.js`** (deduplicazione dei costi).

**Test:** tutti verdi.
- e2e CSP, primo avvio, costi e PWA/offline: i moduli vengono serviti dalla cache del SW quando si è offline.
- Regole e dati reali invariati.
- **10 nuovi test unitari in Node** sui moduli puri, compreso il calcolo dei costi **sui dati reali del backup**. Prima non erano possibili: le funzioni stavano dentro uno script inline.

**Pro**
- **Niente più hash CSP:** non ci sono script inline, quindi `script-src 'self'`. Sparisce il rischio "hash dimenticato = app bianca in produzione", che oggi è il punto più fragile del deploy.
- **Funzioni testabili in Node**, senza browser né emulatore: test rapidi sulla logica (costi, date, alert km, poi i consumi della v2.4).
- **Diff e revisioni più leggibili:** CSS, logica e markup cambiano in file diversi.
- **Nessun build step:** deploy invariato (Pages da `main`/root), nessun `npm` per chi modifica l'app.
- Il browser mette in cache i file separatamente: se cambia solo il CSS, non si riscarica il JS.

**Contro**
- **La lista di precache del SW va aggiornata a mano** per ogni nuovo file JS. Se se ne dimentica uno, l'offline si rompe. Mitigazione: un test o un controllo nell'hook che confronti `js/*.js` con `PRECACHE` (½ ora).
- **`app.js` resta un monolite da 1.600 righe** con stato condiviso (`data`, `garageId`, `isOwner`…). Per dividerlo davvero (render, azioni, auth, Firestore) serve un oggetto `state` esportato: è un refactor vero (~1 giorno) e non più meccanico.
- Qualche richiesta HTTP in più (5 JS + 1 CSS): irrilevante con HTTP/2 e il precache.
- I file importati non hanno SRI. Il rischio è uguale a oggi: sono same-origin e serviti da Pages.

**Vite in alternativa?** Avrebbe senso solo con dipendenze npm (grafici, Tesseract) o se il precache manuale diventasse un problema. Costerebbe un deploy via GitHub Actions e `npm` per chiunque contribuisca. Oggi non serve.

**Raccomandazione:** **adottare `refactor/modules` come prima cosa della v2.4**, dopo il merge della v2.3, perché è basato su di essa. Poi:
1. aggiungere il controllo automatico `js/*.js` ↔ `PRECACHE`;
2. estrarre lo stato in `js/state.js` e dividere `app.js` per aree (auth, Firestore, render, azioni), un'area per commit, con gli e2e come rete di sicurezza;
3. rimandare Vite finché non serve una dipendenza npm.

---

## 5. Come rilanciare i test
Prerequisiti: Java 21 nel `PATH`, `npm install` in `tests/rules`, `tests/e2e` e `tools/admin`. Per gli e2e servono anche gli emulatori e il server statico (vedi README).
```sh
cd tests/rules && npm test && npm run test:prod-data
node --test tests/unit/modules.test.mjs          # solo su refactor/modules
cd tests/e2e && npm run test:csp && node first-open.e2e.mjs && node costs.e2e.mjs && node pwa.e2e.mjs
```
