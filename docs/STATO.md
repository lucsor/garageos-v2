# Stato del lavoro — aggiornato 2026-11-08 (pomeriggio)

> **In produzione: v2.6.0** (`main`), regole `e08c501a` (= `firestore.rules` di `main`).
> **Cosa ti serve fare:**
> 1. **Pubblicare le regole di `payments`** (la PR #14 è pronta, CI verde, ma il deploy dalla mia sessione è stato bloccato dai permessi): comando in §3.1. Poi unisco la #14 e la verifico.
> 2. **Rivedere lo script delle date** (§3.2) e dirmi se eseguirlo.
> 3. Mandarmi l'esito delle prove dal telefono (ne è arrivato solo il segnaposto «[esito 1-7]»).

---

## 1. Cosa è stato fatto oggi (in ordine)

| # | Cosa | Versione | Merge | Verifica in produzione |
|---|---|---|---|---|
| 1 | **#7** correzione della CI di main | — | `0dc1d80` | CI di main tornata verde |
| 2 | **#11** STATO del 7/11 | — | `a18f463` | — |
| 3 | **#9** accessibilità + **quick win P1** (`fadeIn` da opacità 0.01: ora l'FCP si misura) | 2.5.2 | `e13fa72` | SW e cache 2.5.2, FCP ~190 ms, 0 errori, 0 violazioni CSP |
| 4 | **#12** avviso "vecchia icona" con l'app già installata (nuova, su tua richiesta) | 2.5.3 | `578691f` | `?from=v1`: avviso nel flusso della pagina, istruzioni ⋮ in evidenza, 0 errori |
| 5 | **Backup + regole** F2 + rifornimenti in **un solo deploy** | — | — | backup dati e Auth 07:34, regole precedenti salvate; poi ruleset `e08c501a` con sha256 `8f6e631a…` identico al file testato (120/120) |
| 6 | **#10** scadenze personalizzate (F2), `docs/f2-wip/` eliminata | 2.5.4 | `0414752` | SW 2.5.4, 0 errori |
| 7 | **#8** rifornimenti, consumi, spese annue, con le tue modifiche (sotto) | 2.6.0 | `bc31619` | SW 2.6.0, 0 errori |
| 8 | **garageOS#2** redirect della v1 con `?from=v1` | v1 | `12a85eb` | `lucsor.github.io/garageOS/` porta alla v2 con l'avviso e il parametro tolto |
| 9 | **Promemoria, passo 5** (dry-run in produzione) | — | — | 1 utente, 1 dispositivo, 1 notifica con 2 scadenze, 0 errori |
| 10 | **Promemoria, passo 6** (primo invio reale, solo a te) | — | — | `REMINDERS_ALLOW_LIVE=yes`; invio `live`: 1 notifica inviata, 0 errori |

Ogni PR: tolta dalla bozza → aggiornata su main → CI verde (3 controlli obbligatori) → merge → Pages → controllo della produzione.
Nessun rollback è stato necessario.

**#12, avviso "vecchia icona"**
- Con la v2 già installata ma aperta nel browser, Chrome non manda `beforeinstallprompt`.
- Ora `navigator.getInstalledRelatedApps()` lo rileva: il manifest ha `related_applications`, che punta a sé stesso. L'avviso dice «L'app è già installata: aprila dalla schermata Home e cancella la vecchia icona» e il pulsante Installa sparisce.
- Se l'app non risulta installata, o se non si può sapere: Installa mostra **in evidenza** le istruzioni del menu ⋮ (su iPhone, quelle di Condividi).
- L'avviso è nel flusso della pagina e spinge giù il contenuto. Dopo "Ho capito" il contenuto risale.
- Nuovi casi E2E: "già installata", "API presente ma non installata", "contenuto non coperto".
- Numerazione: F2 è passata a 2.5.4.

**#8, le tue modifiche**
- **"Pagato" = tutto ciò che ha un importo**, contato nell'anno della sua data:
  - interventi (i costi multi-tipo contati una volta);
  - rifornimenti;
  - bollo, revisione e assicurazione del veicolo alla loro data;
  - scadenze personalizzate alla data `due`, anche negli anni futuri.
  - Le scadenze di tutto il garage compaiono come "Garage (senza veicolo)".
  - **Unica regola contro il doppio conteggio:** una scadenza del veicolo non conta se nello stesso anno c'è già un intervento dello stesso tipo (es. "✅ Rinnovata").
  - **Limite:** il "✅ Fatto" di una scadenza personalizzata ricorrente sposta la data e non registra un pagamento, quindi l'importo passa all'anno successivo.
- **Spese** è la **quinta voce** in basso (dopo Famiglia), con Rifornimenti e Spese annue (grafico, tabella, CSV).
- **Km dal rifornimento:** il veicolo prende `km` e `kmDate` dal rifornimento solo se è il più recente per data **e** ha più km di quelli attuali.
- **Date vuote, per il futuro:** aprendo una finestra, solo la data di intervento, gomme e rifornimento parte da oggi. Bollo, revisione, assicurazione, "km al" e scadenze personalizzate restano vuote. C'è un test E2E.

## 2. Colori della #9: prima e dopo (390 px, emulatore)

| | Prima (v2.5.1) | Dopo (v2.5.2) |
|---|---|---|
| Dashboard | ![](screenshots/v2.5.2-prima-dashboard-light.png) | ![](screenshots/v2.5.2-dopo-dashboard-light.png) |
| Scadenze | ![](screenshots/v2.5.2-prima-scadenze-light.png) | ![](screenshots/v2.5.2-dopo-scadenze-light.png) |

**Tema scuro: l'app non ne ha uno.** Gli screenshot con `prefers-color-scheme: dark` sono identici byte per byte a quelli chiari, per questo non li ho aggiunti. Un vero tema scuro è un'idea a parte (impegno S).

Scheda Spese (v2.6.0, prima dello spostamento in quinta posizione):

![](screenshots/v2.6.0-spese-annue.png) ![](screenshots/v2.6.0-spese-rifornimenti.png)

## 3. In corso e decisioni

### 3.1 «✅ Fatto» registra il pagamento — PR #14 (v2.6.1), in attesa delle regole
- Finestra con **importo pagato** precompilato dal costo previsto (modificabile) e **data** del pagamento (oggi). Vuoto = nessun pagamento.
- Il pagamento va in `garages/{g}/payments` e conta nelle **Spese** (Scadenze) nell'anno del pagamento. Resta anche se la scadenza singola viene tolta; si cancella con il veicolo.
  - Scelta: una collezione nuova e non un intervento (`mechs`), perché le scadenze di "tutto il garage" non hanno un veicolo e gli interventi lo richiedono.
  - Oggi non c'è un'interfaccia per correggere un pagamento già registrato.
- Test: regole 125/125 (PY01–PY05), unit 58/58, e2e scadenze (precompilazione, "1.500,5" respinto, importo modificato salvato come numero, visibile in Spese, nessun pagamento con importo vuoto, cascata), CI verde.
- **Regole da pubblicare PRIMA del merge** (solo aggiunte; backup dati, Auth e regole già fatto alle 07:58). Dalla cartella del repo, sul branch `feat/fatto-pagamento`:
  ```sh
  git checkout feat/fatto-pagamento
  npx firebase-tools deploy --only firestore:rules --project garageos-879bc
  ```
  Oppure dimmi «ok deploy regole #14» e consenti il comando quando te lo chiede. Rollback: `firebase.rollback.json` (→ `pre-v2.6.rules`) o la versione precedente in Console.

### 3.2 Date del vecchio bug — script pronto, NON eseguito
- **Veicolo:** 1 solo, in un garage che non è il tuo (targa, proprietario e percorso nel file locale `date-vuote-20261108.txt`; il repo è pubblico). Bollo, revisione e assicurazione = 2026-04-12, il giorno in cui è stato creato.
- Script `tools/admin/clear-bug-dates.mjs` (nella PR #14):
  - è in dry-run di default; svuota solo bollo/revisione/assicurazione uguali al giorno di creazione (UTC o ora italiana);
  - scrive `""` come fa l'app;
  - in `--apply` usa una transazione che ricontrolla il valore, poi verifica il risultato;
  - rifiuta `production` con l'emulatore attivo.
- Collaudato sull'emulatore: dry-run, apply, secondo dry-run a 0.
- **Dry-run in produzione** (sola lettura, 07:58): `1 veicoli, 3 campi da svuotare`: solo quel veicolo.
- Per eseguirlo, dopo il tuo controllo:
  ```sh
  cd tools/admin && node clear-bug-dates.mjs --target production --only <percorso dal file locale> --apply
  ```
- Gli altri 4 veicoli con "km al" senza km non sono toccati: sono innocui.

### 3.3 Promemoria: solo a te per 3 mattine (deciso)
- Resta tutto com'è: `REMINDERS_ALLOW_LIVE=yes`, `REMINDERS_ONLY_UID` = il tuo uid.
- Le mattine da guardare sono il 9, il 10 e l'11/11, alle 06:17 UTC.
- Poi ti mostro i conteggi dei log (utenti, dispositivi, notifiche, già inviati, errori, token rimossi) e decidiamo il passo 7.
- **Nota:** stamattina il cron delle 06:17 non risulta partito (ci sono solo i due lanci manuali delle 07:43 e 07:44 UTC). Se manca anche domani, va controllato lo schedule di GitHub.
- Per leggere i conteggi:
  ```sh
  gh run list --workflow reminders.yml --limit 5
  gh run view <id> --log | grep -A12 "Promemoria 20"
  ```

## 4. Problemi incontrati (onestamente)
- **Niente prova con login in produzione.** L'estensione Claude in Chrome non era connessa: nessun browser collegato, e ti ho mandato una notifica.
  - Al posto della prova, dopo ogni merge ho controllato con un browser headless anonimo: SW e cache della versione giusta, schermata di login, 0 errori in console, pagina e rete, 0 violazioni CSP.
  - I dati li ho letti dal backup admin: il tuo garage ha **5 veicoli**.
  - "Login + 5 veicoli" visti nell'app li deve confermare il tuo telefono (§5).
- **Il commit di #8 `4bf6940` mescola** il merge di F2 e le modifiche richieste: l'ha fatto l'agente, ed è dichiarato nel messaggio di commit.
- **Un 404 durante il redirect della v1** (una sola volta, non riprodotto): era una risorsa della pagina di redirect della v1, caricata prima del salto. Non riguarda la v2.
- Il cron dei promemoria di stamattina non risultava eseguito: GitHub a volte ritarda o salta i cron. Il recupero delle soglie copre i giorni saltati.

## 5. Cosa provare dal telefono
1. **Aggiornamento:** apri l'app → banner "Nuova versione" → una sola ricarica → menu: versione 2.6.0. Login, **5 veicoli**.
2. **Notifica di prova:** dovrebbe essere arrivata stamattina verso le 08:40, con 2 scadenze.
3. **Vecchia icona:** toccala → la v2 si apre con l'avviso, senza coprire il contenuto → «L'app è già installata…» → "Ho capito".
4. **Scadenze → +:** "Permesso ZTL", "Ogni anno", importo "80,50" → compare in lista. Poi "✅ Fatto" → la data avanza di un anno.
5. **⛽ dalla scheda veicolo:** pieno "38,5" l e "62,40" €, con km più alti di quelli attuali → i km del veicolo si aggiornano. Poi un parziale e un altro pieno → km/l ed €/km.
6. **Spese** (quinta voce): grafico per anno, totali, i due CSV.
7. **Nuovo veicolo** senza date → nessun "in scadenza oggi".

## 6. Rollback (se serve)
Procedura in `docs/DEPLOY.md`.
- Regole: `firebase.rollback.json` ora punta a `docs/rules-backup/pre-v2.6.rules`, il ruleset `ead41147` pubblicato fino a stamattina.
- App: `git revert -m 1 <merge>` su main, nell'ordine inverso: `bc31619`, `0414752`, `578691f`, `e13fa72`.
- Dati: backup `firestore-20261108-0734.json` e `restore-firestore.mjs`.

## 7. Come rilanciare i test
Invariato rispetto al 7/11, più `tests/unit/fuel.test.mjs`, `deadlines`, `f2-integration`, `tests/e2e/fuel.e2e.mjs` e `deadlines.e2e.mjs`, tutti in CI.
```sh
node --test tests/unit/*.test.mjs
cd tests/rules && npm test
cd tests/e2e && for t in csp calendar push legacy-banner pwa deadlines fuel; do node $t.e2e.mjs || break; done && node reminders.emu.mjs && node upgrade.e2e.mjs origin/main
```
