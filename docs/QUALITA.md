# Qualità — Lighthouse, accessibilità, PWA (v2.5.1 → v2.5.2)

Audit del 2026-11-07 su `origin/main` (v2.5.1, commit `9fdc75e`) e sul branch `fix/qualita-quick-wins` (v2.5.2).
Senza login si raggiunge solo la schermata di accesso: l'interfaccia "loggata" (schede, card, finestre) è stata analizzata
**staticamente** (index.html, template in `js/app.js`, `css/app.css`) e con **axe-core** sul markup reale delle finestre
e delle schede vuote (vedi §3). Nessuna scrittura in produzione: solo server locale.

## 1. Come è stato misurato

- **Lighthouse 12.8.2** (`npm install lighthouse@12` in una cartella di lavoro fuori dal repo), Chrome 156 headless (Windows 11).
- Server: `python -m http.server <porta> --bind 127.0.0.1` sulla copia dei file (porte 5191/5193/5194).
- Comandi esatti (3 esecuzioni per formato, si riporta la **mediana**):

```sh
export CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"
# mobile (predefinito: Moto G Power emulato, rete 4G lenta simulata, CPU 4×)
npx lighthouse http://127.0.0.1:5193/ --only-categories=performance,accessibility,best-practices \
  --output=json --output-path=mobile-N.json --chrome-flags="--headless=new" --quiet
# desktop
npx lighthouse http://127.0.0.1:5193/ --preset=desktop --only-categories=performance,accessibility,best-practices \
  --output=json --output-path=desktop-N.json --chrome-flags="--headless=new" --quiet
```

### ⚠️ Lighthouse non riesce a misurare la v2.5.1 così com'è (NO_FCP)

Sul codice di `main` **tutte** le esecuzioni falliscono con `NO_FCP` ("The page did not paint any content") e i tre punteggi
risultano nulli. La pagina in realtà si vede, ma Chrome **non registra mai il First Contentful Paint**: tutto il contenuto della
schermata di login sta dentro `#login-screen`, che parte con `animation: fadeIn` da `opacity: 0` (`css/app.css:432` e `:489`).
Verificato con Playwright: `performance.getEntriesByType('paint')` contiene solo `first-paint`; togliendo l'animazione, o facendola
partire da `opacity: 0.01`, compare `first-contentful-paint`.

Conseguenza pratica oltre a Lighthouse: anche FCP/LCP reali (Chrome UX Report, PageSpeed Insights sul sito pubblicato)
probabilmente non vengono registrati. Per poter misurare, le esecuzioni sono state fatte su una **copia di misura** identica
al codice tranne una riga aggiunta in fondo a `css/app.css` (non nel repo, applicata uguale a prima e dopo):

```css
@keyframes fadeIn { from { opacity: 0.01; } to { opacity: 1; } }
```

È visivamente indistinguibile: è la correzione proposta al punto P1 (§5), lasciata fuori da questo PR perché il mandato era solo
contrasto/etichette/aree di tocco.

### Limiti della misura (onestà)

- **Performance locale ≠ GitHub Pages.** `http.server` non comprime (gzip) e non manda header di cache: le voci
  "text compression" e "cache TTL" sono artefatti locali (Pages comprime e mette `max-age=600`). Il punteggio mobile è quindi
  pessimistico; il punteggio vero va preso da PageSpeed Insights sul sito pubblicato (dopo P1).
- Lighthouse vede **solo la schermata di login**. Accessibilità e best practice del resto dell'app sono coperte da analisi
  statica + axe-core (§3), non da Lighthouse.
- La categoria **PWA non esiste più in Lighthouse 12**: installabilità verificata a parte (§4).
- Non misurati: lettori di schermo reali (TalkBack/VoiceOver), Safari/iOS, prestazioni con dati veri e dopo il login
  (Firestore, molti veicoli), contrasto sul gradiente dietro testi bianchi in ogni punto (stimato agli estremi).

## 2. Punteggi Lighthouse

Mediana di 3 esecuzioni (tra parentesi le singole performance). Metriche di laboratorio: FCP, LCP, TBT, CLS, Speed Index.

| versione | formato | n | Performance | Accessibilità | Best practice | FCP | LCP | TBT | CLS | SI |
|---|---|---|---|---|---|---|---|---|---|---|
| v2.5.1 | mobile | 3 | 82 (82/82/82) | 90 | 96 | 3.0 s | 3.9 s | 10 ms | 0.000 | 3.0 s |
| v2.5.1 | desktop | 3 | 98 (98/98/99) | 89 | 100 | 0.8 s | 1.0 s | 0 ms | 0.000 | 0.8 s |
| v2.5.2 | mobile | 3 | 83 (83/79/95) | 100 | 96 | 3.0 s | 3.9 s | 17 ms | 0.000 | 3.0 s |
| v2.5.2 | desktop | 3 | 98 (98/98/97) | 100 | 100 | 0.8 s | 1.0 s | 0 ms | 0.000 | 0.8 s |

Sul codice non modificato (senza la riga di misura) le 6 esecuzioni su v2.5.1: **errore NO_FCP, nessun punteggio** (lo stesso vale per v2.5.2, che non tocca l'animazione).
La performance non cambia con questo PR (solo colori e attributi): la differenza 82→83 e l'esecuzione isolata a 95 sono rumore di misura.

Cosa abbassa i punteggi **prima**:
- *Accessibilità* (90 mobile / 89 desktop): `color-contrast` su `.login-logo span` (2.63:1, serve 3:1), `.login-owner`,
  `.login-sub`, `.login-note` (4.19:1, serve 4.5:1). **Dopo: 100.**
- *Best practice* mobile (96): `font-size` — solo il 46% del testo è ≥ 12 px (`.login-note` 11 px, `css/app.css:510`). Desktop 100.
  Non corretto qui (fuori mandato): vedi P6.
- *Performance* mobile (~82): FCP/LCP ~3–4 s per la catena bloccante HTML → `css/app.css` → `@import` Google Fonts
  (`render-blocking-resources`, stima −750 ms) più i moduli Firebase (`unused-javascript` ~155 KiB da `firebase-firestore.js`,
  inevitabile senza bundler). Vedi P2.

## 3. Accessibilità dell'interfaccia dopo il login (analisi statica + axe-core)

**Metodo axe-core** (4.14.0, la versione inclusa in Lighthouse 12.8.2; Playwright 1.65 con Chrome): `index.html` reale servito in locale, Firebase bloccato, `#login-screen`
nascosto e `#app` mostrato via script; poi una scena per ogni scheda (Garage, Scadenze, Officina, Famiglia) e per ogni finestra
aperta (veicolo, gomme, intervento, nome garage, promemoria, conferma). Regole WCAG 2.0/2.1/2.2 A+AA + best practice.
Le card generate dai template (veicoli, scadenze, interventi, gomme, famiglia) **non** sono coperte da axe (servono dati):
per quelle vale l'analisi statica qui sotto.

| | nodi in violazione | regole critiche/serie |
|---|---|---|
| v2.5.1 | **83** | `label` ×6, `select-name` ×8, `color-contrast` ×43 (+ 26 moderate di struttura) |
| v2.5.2 | **26** | nessuna: restano solo le 26 moderate `region`, `landmark-one-main`, `page-has-heading-one` (vedi P4) |

### 3.1 Contrasto (WCAG 1.4.3 / 1.4.11) — coppie realmente usate

Calcolo con la formula WCAG 2.x (luminanza relativa), colori semitrasparenti composti sul fondo reale.
Soglia 4.5:1 per testo normale, 3:1 per testo grande (≥ 24 px, o ≥ 18.67 px in grassetto) e per elementi non testuali.

| coppia (dove) | soglia | v2.5.1 | v2.5.2 |
|---|---|---|---|
| `--ink-2` su `--card` (label, testi secondari, login) | 4.5:1 | 4.20:1 ❌ | 5.48:1 ✅ |
| `--ink-2` su `--page` (.section-divider, .empty-state, .mech-summary) | 4.5:1 | 3.72:1 ❌ | 4.86:1 ✅ |
| `--ink-2` su `--field` (.year-count, .mech-type-btn, .mech-note) | 4.5:1 | 3.80:1 ❌ | 4.96:1 ✅ |
| `--ink-2` su #e5eaeb (.seg-btn inattivo) | 4.5:1 | 3.46:1 ❌ | 4.51:1 ✅ |
| bianco su verde (.btn-primary, #fab, #update-banner, toast) | 4.5:1 | 2.63:1 ❌ | 4.79:1 ✅ |
| verde su bianco (.stat-value.accent 30px, .login-logo span 32px) | 3:1 | 2.63:1 ❌ | 5.76:1 ✅ |
| verde su bianco (.year-cost, costi, "in corso", "(tu)") | 4.5:1 | 2.63:1 ❌ | 5.76:1 ✅ |
| verde su green-soft/field (.mech-type-btn.selected) | 4.5:1 | 2.15:1 ❌ | 4.69:1 ✅ |
| verde scuro su green-soft (.badge.green, .family-role.member, tag) | 4.5:1 | 3.89:1 ❌ | 5.14:1 ✅ |
| ambra su yellow-soft (.badge.yellow, .tire-season.estivo, owner) | 4.5:1 | 3.43:1 ❌ | 4.94:1 ✅ |
| rosso su red-soft (.badge.red, .btn-danger, #confirm-yes) | 4.5:1 | 3.40:1 ❌ | 4.60:1 ✅ |
| rosso su bianco (.user-menu-item.danger, errori) | 4.5:1 | 3.91:1 ❌ | 5.30:1 ✅ |
| bianco su rosso (.nav-badge 10.5px, toast rosso) | 4.5:1 | 3.91:1 ❌ | 5.30:1 ✅ |
| blu su blue-soft (.badge.frozen/.incl, invernale, "In attesa") | 4.5:1 | 3.32:1 ❌ | 5.21:1 ✅ |
| blu su blue-soft su page (.push-ios-hint) | 4.5:1 | 2.97:1 ❌ | 4.66:1 ✅ |
| giorni alla scadenza gialli (.sc-days 20px 800) | 3:1 | 2.15:1 ❌ | 5.44:1 ✅ |
| giorni alla scadenza verdi (.sc-days) | 3:1 | 2.63:1 ❌ | 5.76:1 ✅ |
| toast giallo: testo su #eda21c | 4.5:1 | 2.15:1 ❌ | 6.24:1 ✅ |
| #invite-feedback | 4.5:1 | 4.35:1 ❌ | 5.76:1 ✅ |
| bordo focus campi su --field (non-testo, min 3:1) | 3:1 | 2.38:1 ❌ | 4.33:1 ✅ |

Già conformi e non toccati: `--ink` su card (13.4:1), bianco su `--navy` (`.vc-plate`, `.btn-google`, `.copy-btn`: 15:1),
`#4fe3b0` su navy/teal (nav attiva, `.hero-pill`, `.app-role`: 8.3–9.3:1), voci nav inattive (bianco 55% su navy: 5.5:1),
`#db-status` / `.page-sub` (bianco 75% sul gradiente: ≥ 5.5:1 nel punto peggiore stimato), chip avvisi (7.5–8.2:1).
Bianco direttamente su `--teal-lite` (#1b9c8f) sarebbe 3.4:1, ma nessun testo cade sul fondo chiaro del gradiente
(header e hero stanno sulla parte scura in alto): rischio solo teorico, non misurato pixel per pixel.

### 3.2 Problemi trovati

Gravità: Numeri di riga riferiti a **v2.5.1** (`origin/main`). **Alta** = blocca o confonde chi usa tastiera/screen reader o non legge il testo; **media** = peggiora l'uso;
**bassa** = rifinitura. "Quick win sicuro" = correzione locale, senza cambi di comportamento né di layout.

| # | Problema | Gravità | Evidenza | Correzione | Quick win sicuro | Stato |
|---|---|---|---|---|---|---|
| A1 | Contrasto insufficiente di testi secondari, badge, pulsanti verdi/rossi, giorni alla scadenza (tabella 3.1) | alta | `css/app.css:4-32` (token), `.badge.*` `:196-199`, `.btn-primary` `:224`, `js/app.js:1261,1276` | ritocco dei token (stessa tinta, più scura) + token di testo separati | sì | ✅ corretto |
| A2 | `<label>` delle finestre non collegate ai campi: date, select e numeri senza nome accessibile | alta | `index.html` tutte le `.form-label` (es. "Scadenza Bollo" → `#v-bollo`) | `for="id"` | sì | ✅ corretto (31 label) |
| A3 | Filtri senza etichetta (`select-name`) | alta | `#scad-filter-vehicle`, `#mech-filter-vehicle`, `#mech-filter-type`, `#tire-filter-vehicle` | `aria-label` | sì | ✅ corretto |
| A4 | Campo email dell'invito solo con placeholder | media | `#invite-email` | `aria-label` | sì | ✅ corretto |
| A5 | ✏️/🗑️ letti come "matita"/"cestino" (il nome viene dall'emoji, non dal `title`), indistinguibili tra card | alta | `js/app.js:1226-1227, 1425-1426, 1457-1458` | `aria-label="Modifica AB123CD"`, "Elimina cambio gomme 12/03/2025", "Elimina Tagliando 01/02/2026" | sì | ✅ corretto |
| A6 | × dei tipi selezionati: nome "×" | media | `js/app.js:809` | `aria-label="Rimuovi <tipo>"` | sì | ✅ corretto |
| A7 | Finestre veicolo/gomme/intervento/nome garage/conferma senza ruolo e titolo accessibile | media | `index.html` `.modal` | `role="dialog"`/`alertdialog`, `aria-modal`, `aria-labelledby` (come già `cal-modal`, `push-modal`) | sì | ✅ corretto |
| A8 | Gruppi "Tipi di intervento" e "Avvisami" senza nome | bassa | `#mech-type-grid`, `#push-days` | `role="group"` + `aria-labelledby` | sì | ✅ corretto |
| A9 | Aree di tocco < 44 px: `.icon-btn` 34×34, `.btn-sm` 33–35 px di altezza (✅ Rinnovata 28), `.seg-btn` 39, `.copy-btn` 30, × dei tipi 10×14 (misurati in Chrome a 412 px) | media | `css/app.css:207-210, 230, 152-155, 387-389, 481`; `js/app.js:1279` | pseudo-elemento invisibile 44 px centrato (32 px per la ×): aspetto identico | sì | ✅ corretto |
| A10 | Filtri con `outline: none` e nessun indicatore di focus; bordo focus dei campi verde chiaro 2.4:1 | media | `css/app.css:344, 455, 381` | `:focus-visible` con bordo+anello `--green-strong`; bordo focus 4.3:1 | sì | ✅ corretto |
| A11 | SVG decorativi (nav, logo Google) esposti | bassa | `index.html` `.nav-item svg`, `.btn-google svg` | `aria-hidden="true"` | sì | ✅ corretto |
| A12 | **Elementi cliccabili non raggiungibili da tastiera** (div/span/img con `data-action`, nessun `tabindex`/ruolo, solo evento `click`): avatar → menu utente, voci del menu (Gestione Famiglia, Promemoria, **Esci**), nome del garage, card "Aggiungi veicolo", intestazioni anno in Officina, chip avvisi, banner "Nuova versione", suggerimento iPhone | **alta** | `index.html:22, 54, 59, 65-67, 106`; `js/app.js:1204, 1240, 1522, 1640` | trasformarli in `<button type="button">` (reset CSS: `background:none;border:0;font:inherit;color:inherit;text-align:inherit`), `alt` dell'avatar → "Menu utente", `aria-expanded` su avatar e intestazioni anno | no (tocca markup+CSS di molti punti, va provato a mano) | da fare (P3) |
| A13 | Nessun `<h1>`–`<h6>` né landmark (`main`, `nav`): niente navigazione per titoli/regioni | media | tutto `index.html` | `.login-logo`/`.app-title` → `h1`, `.modal-title` → `h2`, `.sheet` → `<main>`, `.bottom-nav` → `<nav aria-label="Sezioni">` (le classi hanno già font-size/weight e `*{margin:0}`, quindi aspetto invariato) | quasi (verificare a vista) | da fare (P4) |
| A14 | Finestre: il focus non entra nella finestra all'apertura, non resta intrappolato e non torna al pulsante alla chiusura | media | `openModal`/`closeModal` in `js/app.js` | `focus()` sul primo campo, trap con Tab, ripristino del focus | no (comportamento) | da fare (P5) |
| A15 | Stato non esposto: scheda attiva della nav (`aria-current="page"`), segmenti Meccanica/Pneumatici e tipi di intervento (`aria-pressed`), menu utente aperto (`aria-expanded`) | media | `switchTab`, `switchSubTab`, `toggleMechType`, `toggleUserMenu` in `js/app.js` | impostare gli attributi dove già si cambia la classe `active`/`selected`/`open` | sì (2-3 righe per funzione), ma tocca JS | da fare (P5) |
| A16 | Testo a basso contrasto per opacità: card veicolo congelato `opacity: .75` (anche i pulsanti), "al gg/mm/aaaa" `opacity:.65`, × dei tipi `opacity:.7` | bassa | `css/app.css:204, 481`; `js/app.js:1231` | usare `--ink-2` invece dell'opacità; per i congelati attenuare solo lo sfondo | sì | da fare (P6) |
| A17 | Testo 11 px: `.login-note`, `.nav-item` 11.5, `.form-label` 11.5 maiuscolo, `.family-role` 11, `.cc-val` 11 | bassa | `css/app.css:510, 407, 442, 368, 336` | minimo 12 px (fa salire Best practice mobile a 100) | sì (lievi cambi di layout) | da fare (P6) |
| A18 | Nessun `prefers-reduced-motion`: animazioni fadeUp/modalUp/scroll smooth sempre attive | bassa | `css/app.css:38, 145, 439` | `@media (prefers-reduced-motion: reduce) { *{animation:none!important;transition:none!important} html{scroll-behavior:auto} }` | sì | da fare (P6) |
| A19 | Aree di tocco ancora < 44 px: avatar 36×36 (è un `<img>`, niente pseudo-elementi), filtri 40 px, voci menu utente 41 px, chip avvisi 30 px, checkbox dei promemoria 18 px (la label intera è cliccabile, ~20 px) | bassa | `css/app.css:74-78, 341-348, 90-95, 122-128, 545` | con A12 (diventano `<button>` → pseudo-elemento); `min-height:44px` sui filtri | in parte | da fare (P3/P6) |
| A20 | Toast non annunciato agli screen reader | bassa | `_showToast` in `js/app.js:93` | `role="status"` + `aria-live="polite"` sul `#_toast` | sì | da fare (P6) |

Verificati e già a posto: `<html lang="it">`; `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">`
(zoom non bloccato); FAB con `aria-label="Aggiungi"`; 📅 delle scadenze con `aria-label` completo; ✕ del suggerimento iPhone
con `aria-label`; avatar dei membri con `alt=""` (decorativi, il nome è accanto); `#legacy-banner` con `role="region"` e
`aria-live`; checkbox dei promemoria dentro `<label>`; pulsanti nativi (`<button>`) con l'anello di focus del browser
(nessun `outline:none` sui pulsanti).

## 4. PWA (Lighthouse 12 non ha più la categoria)

Verificato con Chrome 156 via **Chrome DevTools Protocol** da Playwright (`playwright-core`, profilo persistente, non
incognito): `Page.getAppManifest`, `Page.getInstallabilityErrors`, `navigator.serviceWorker.ready`, Cache Storage, poi
`context.setOffline(true)` e ricarica.

| controllo | esito |
|---|---|
| Manifest (`manifest.json`) | letto senza errori: `name`, `short_name`, `start_url ./`, `scope ./`, `display standalone`, colori, `lang it`, icone 192/512 PNG |
| Installabilità (`getInstallabilityErrors`) | **nessun errore** (installabile) |
| Service worker | registrato, scope `/`, la pagina è controllata dopo il primo ricaricamento |
| Precache | `garageos-v2.5.1`: 17 risorse |
| Offline | la pagina si riapre offline (schermata di login dalla cache); l'offline con dati è coperto da `tests/e2e/pwa.e2e.mjs` in CI |
| `theme-color`, `apple-touch-icon` | presenti |

Osservazioni minori (non corrette): icone con `"purpose": "any maskable"` insieme — meglio due voci separate, perché la stessa
immagine non può avere il margine di sicurezza per `maskable` ed essere piena per `any`; `apple-mobile-web-app-capable` è
deprecato in Chrome a favore di `mobile-web-app-capable` (tenere entrambi).

## 5. Problemi rimanenti, in ordine di priorità

| P | Cosa | Perché | Correzione proposta | Quick win sicuro |
|---|---|---|---|---|
| P1 | **FCP mai registrato** (NO_FCP) | Lighthouse/PageSpeed non misurano nulla; probabilmente anche le metriche reali di Chrome | `@keyframes fadeIn { from { opacity: 0.01; } … }` in `css/app.css:432` (visivamente identico; verificato che fa comparire l'FCP) | ✅ **applicata** in v2.5.2 (2026-11-08) |
| P2 | **Google Fonts caricato ma mai usato**, e bloccante | `--font` con DM Sans è dichiarato in `@layer fonts`, e un livello `@layer` perde sempre contro gli stili fuori livello: vince il `--font` di sistema di `:root` (`css/app.css:2` vs `:26`). Il CSS dei font viene comunque scaricato (catena bloccante HTML → app.css → fonts.googleapis, stima −750 ms su mobile), i file `.woff2` mai. | Decidere: **togliere l'`@import`** (aspetto invariato, è quello di oggi) oppure usare davvero DM Sans con `<link rel="preconnect">` + `<link rel="stylesheet">` in `index.html` | sì se si toglie (nessun cambio visivo) |
| P3 | Elementi cliccabili non usabili da tastiera (A12, A19) | il menu utente con **Esci** e "Gestione Famiglia" è irraggiungibile senza mouse/touch | convertire in `<button>` con reset CSS; `aria-expanded` | no: va provato a mano su mobile e desktop |
| P4 | Titoli e landmark (A13) | navigazione per titoli/regioni con screen reader | `h1`/`h2`, `<main>`, `<nav>` | quasi: aspetto invariato per costruzione, ma verificare a vista |
| P5 | Focus nelle finestre e stati ARIA (A14, A15) | chi usa tastiera/screen reader perde il contesto all'apertura/chiusura | gestione focus in `openModal`/`closeModal`; `aria-current`, `aria-pressed`, `aria-expanded` | `aria-*` sì; focus trap no |
| P6 | Rifiniture (A16–A18, A20) | leggibilità, movimento ridotto, annunci | vedi tabella §3.2 | sì |
| P7 | Performance di caricamento oltre P1/P2 | `firebase-firestore.js` ~155 KiB inutilizzati al primo avvio, nessuna minificazione | `<link rel="preconnect" href="https://www.gstatic.com">`; minificazione solo se si introduce un build (oggi scelta esplicita: niente build) | preconnect sì |

## 6. Cosa cambia nella v2.5.2 (questo PR)

Solo correzioni "quick win sicure" di contrasto, etichette e aree di tocco; nessun cambio di comportamento o di layout.

- **Token colore** (`css/app.css`): `--ink-2` #6b7f86 → #5b6c72; nuovi `--green-ink` #157451 (testo verde),
  `--green-strong` #18825b (fondo dei pulsanti verdi con testo bianco: `.btn-primary`, FAB, banner aggiornamento, toast),
  `--yellow-ink` #925f06 (testo ambra); `--red` #e5484d → #c03c41; `--blue` #2f86d6 → #2166a5. `--green` #21b57e resta per
  barre del grafico, barre di avanzamento, bordi e ombre; le tinte `*-soft` restano quelle originali. Tutti i nuovi valori
  sono la stessa tinta, più scura del minimo necessario.
- **Template** (`js/app.js`): testo dei giorni alla scadenza e degli importi con le varianti leggibili (le barre restano
  nei colori originali); toast giallo con testo `--ink`; `aria-label` su ✏️/🗑️ e sulla × dei tipi.
- **Markup** (`index.html`): `for=` su 31 label, `aria-label` su 4 filtri, email invito e 2 pulsanti CSV, ruoli `dialog`
  sulle finestre, `role="group"` sui gruppi, SVG decorativi `aria-hidden`.
- **Aree di tocco**: `::after` invisibile di 44 px (32 px per la ×) su `.icon-btn`, `.btn-sm`, `.seg-btn`, `.copy-btn`.
  I pulsanti adiacenti (gap 6–7 px) si sovrappongono di 3–4 px ai bordi: il tocco va a quello più vicino.
- **Focus**: `:focus-visible` sui filtri, bordo di focus dei campi con `--green-strong` (4.3:1 su `--field`).
- `sw.js` VERSION `2.5.2`.

Verifiche locali: `node --test tests/unit/*.test.mjs` (31/31), `node tools/check-precache.mjs`, `node tools/csp-hash.mjs --check`;
e2e in CI sul PR. I test e2e usano solo `data-action`/id, non testi o colori modificati: nessun test da aggiornare.
Confronto visivo prima/dopo (screenshot 412 px dell'interfaccia con dati finti): stessa identità, verde dei pulsanti e degli
importi più profondo, grigi un tono più scuri.
