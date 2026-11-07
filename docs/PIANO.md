# GarageOS — Piano (Fase 3, bozza del 2026-11-07)

**Ordine:** falle di regole e sicurezza → bug → DB e indici → funzionalità → UX. Le stime sono in ore di lavoro, test compresi.
**Stato:** ✅ fatto · 🔧 pronto su branch (da rivedere) · ⏳ da fare · ❓ serve una tua decisione

## 0. Già fatto (v2.2.0, in produzione dal 2026-11-07)
- ✅ Regole versionate e testate (92 test più 17 sui dati reali), inviti `invites/{token}`, membri coerenti, validazione tollerante ai dati legacy
- ✅ XSS (niente handler inline), CSP con hash, ID generati solo da Firestore
- ✅ Errore di rete all'avvio che scollegava il membro dal garage condiviso
- ✅ Login: niente blocco su "Accesso in corso…", messaggi chiari
- ✅ Migrazione di alessandro e tiziana; dismissione della v1 con redirect e kill switch del service worker
- ✅ Chiave API: aggiunto `garageos-879bc.firebaseapp.com`, quindi i nuovi login funzionano di nuovo

---

## 1. Sicurezza e regole

| # | Task | Stima | Stato | Note |
|---|---|---|---|---|
| S1 | **Togliere `localhost:*` e `localhost:5173/*` dalla chiave API** | 5 min | ⏳ **tu** | Restano solo `lucsor.github.io/*` e `garageos-879bc.firebaseapp.com/*` |
| S2 | App Check (reCAPTCHA Enterprise): registrazione, SDK, **monitor** per 2 settimane, poi enforce su Firestore | 3 h | ⏳ | gratuito fino a 10.000 verifiche al mese; da aggiungere alla CSP: `https://www.google.com/recaptcha/`, `https://www.gstatic.com/recaptcha/` |
| S3 | Pre-commit hook: `csp-hash --check` + controllo del bump di `VERSION` in `sw.js` | 1 h | 🔧 `fix/v2.3` | `git config core.hooksPath .githooks` |
| S4 | TTL sugli `invites` (`expiresAt`) e pulizia dei `members[]` legacy dalla UI | 1 h | ⏳ | policy TTL dalla Console; nessun costo |
| S5 | CI su GitHub Actions: test delle regole + `csp-hash --check` a ogni PR | 2 h | ⏳ | gratuito (repo pubblico) |
| S6 | Togliere `127.0.0.1:8080/9099` dalla CSP di produzione (servono solo all'emulatore) | 1 h | ⏳ | con un build step o con un flag `?emulator` che non dipenda dalla CSP; vedi `refactor/modules` |

## 2. Bug

| # | Task | Stima | Stato | Note |
|---|---|---|---|---|
| B1 | **Service worker:** `activate` cancella anche la cache `garageos-notif` (e quelle di altre app sulla stessa origine) | 0,5 h | 🔧 `fix/v2.3` | ora cancella solo `garageos-v*` diverse dalla corrente |
| B2 | **Service worker:** reload della pagina alla *prima* installazione (`clients.claim` → `controllerchange`) | 0,5 h | 🔧 `fix/v2.3` | reload solo se c'era già un controller e una sola volta |
| B3 | **Costi duplicati** negli interventi multi-tipo | 2 h | 🔧 `fix/v2.3` ❓ | Il costo va sul primo tipo; gli altri risultano "incluso"; i totali deduplicano i gruppi legacy (stesso `createdAt`). **Sui dati reali l'impatto oggi è nullo:** 6 gruppi multi-tipo (32 documenti), tutti senza costo. Decisione v3: un solo documento con `types[]` |
| B4 | Modifica di un intervento multi-tipo: si salva solo il primo tipo selezionato | 1 h | ⏳ | si risolve con `types[]` (v3) |
| B5 | "Oggi" calcolato in UTC (data sbagliata tra mezzanotte e l'1-2) | 0,5 h | ⏳ | usare la data locale |
| B6 | `removeVehicle` non atomico (figli orfani se si interrompe) | 1 h | ⏳ | `writeBatch` (max 500 operazioni) |
| B7 | `addYears` sul 29/02 | 0,25 h | ⏳ | |

## 3. Database, indici, offline

| # | Task | Stima | Stato | Note |
|---|---|---|---|---|
| D1 | **Offline:** SDK Firebase e font in cache nel service worker + `persistentLocalCache` (multi-tab) | 3 h | 🔧 `fix/v2.3` | test Playwright in modalità offline |
| D2 | **km, importi e anno da stringa a numero:** script di migrazione con dry-run | 2 h | 🔧 `fix/v2.3` (**solo dry-run sull'emulatore, mai eseguito in produzione**) | le regole accettano già entrambi i tipi |
| D3 | km e importi come numero **anche nel client** (salvataggio e lettura), poi la migrazione in produzione | 3 h | ⏳ ❓ | ordine: client che legge entrambi → deploy → migrazione → client che scrive numeri → regole che accettano solo numeri |
| D4 | **Timestamp del server** per `createdAt`/`updatedAt`/`frozenAt` (oggi stringhe ISO dell'orologio del client) | 2 h | ⏳ | `serverTimestamp()`; il client legge sia stringhe sia Timestamp; le regole lo accettano già (`optTs`) |
| D5 | Indici: nessuno necessario oggi. Da aggiungere con `fuel` e `deadlines` (v2.4) | — | — | `firestore.indexes.json` |
| D6 | Limitare il listener `mechs` agli ultimi N anni (con "carica tutto") | 2 h | ⏳ | solo quando lo storico crescerà (oggi 52 documenti in tutto) |

## 4. Funzionalità (dettagli in `docs/IDEE.md`)

| # | Task | Stima | Rilascio |
|---|---|---|---|
| F1 | Export .ics e "Aggiungi al calendario" | 4 h | v2.4 |
| F2 | Scadenze personalizzate (`deadlines`) + regole + test | 1,5 giorni | v2.4 |
| F3 | Rifornimenti e consumi (`fuel`) + regole + test | 2 giorni | v2.4 |
| F4 | Spese annue, costo di possesso, grafici | 1,5 giorni | v2.4 |
| F5 | Più garage per utente (`garageIds`, selettore) — **ultimo**: oggi non serve a nessuno | 2 giorni | v2.5 |
| F6 | Ruoli editor/lettore (regole + inviti con ruolo) | 2 giorni | v2.5 |
| F7 | Log attività (batch + regole append-only + TTL) | 1,5 giorni | v2.5 |
| F8 | Promemoria email e push via GitHub Actions | 3 giorni | v3 |

## 5. UX

| # | Task | Stima |
|---|---|---|
| U1 | Accessibilità: `aria-label` sui pulsanti a icona, focus trap ed Esc nelle modali, contrasti | 1 giorno |
| U2 | Dark mode | 0,5 giorni |
| U3 | Manifest: icone `any`/`maskable` separate, `id`, `screenshots`, apple-touch-icon 180, icona 512 compressa | 2 h |
| U4 | Divisione in moduli ES senza build (prototipo in `refactor/modules`) | 1 giorno | vedi `STATO.md` |

---

## Decisioni del 2026-11-07
- **v2.3.0:** pubblicata dopo la review indipendente (vedi `STATO.md` §3.1).
- **v2.3.1:** App Check **solo monitoraggio** (S2); pulizia `members[]` (S4) solo quando `tools/admin/check-v2-logins.mjs` dà ✔ per i 3 amici.
- **Ordine della v2.4:** 1) U4 moduli ES (`refactor/modules` ribasato su `main`) → 2) F1 calendario/.ics + F2 scadenze → 3) F3 rifornimenti + F4 spese annue. F5 (più garage) resta per ultimo, in v2.5.
- **Costi multi-tipo:** "costo sul primo tipo + incluso" fino alla v3, poi un documento con `types[]`.

## Sequenza consigliata per la v2.3
1. Revisione di `fix/v2.3`: B1, B2, B3, D1, D2 (dry-run), S3.
2. Merge e deploy, solo client: nessuna modifica alle regole.
3. D4 (timestamp) + D3 (lettura doppia dei numeri) in una v2.3.1.
4. Migrazione dei numeri in produzione **solo dopo** che tutti i client leggono i numeri.
