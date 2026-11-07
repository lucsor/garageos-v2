# Deploy e rollback — hotfix v2.2.0 + migrazione membri + dismissione v1

- **Progetto Firebase:** `garageos-879bc` (piano Spark: niente export gestito su bucket, il backup è il JSON)
- **App v2:** GitHub Pages da `lucsor/garageos-v2` `main` / root · branch `hotfix/security`
- **App v1:** `lucsor/garageOS` `main` · branch `redirect-to-v2`
- **Backup:** fuori dal progetto, in `%USERPROFILE%\Documents\garageos-backup\` (variabile `GARAGEOS_BACKUP_DIR`). Contiene dati personali: non copiarlo nel repo.
- **Script admin:** `tools/admin` (`npm install` la prima volta). Usano le credenziali di `firebase login` e girano **fuori dalle regole**.

> **Ordine:** backup → migrazione → regole → app v2 → redirect v1.
> - La migrazione funziona sia con le regole vecchie sia con le nuove: aggiunge solo `memberUids` e `users/{uid}`.
> - Le regole vanno prima dell'app. L'app v2.1, ancora in cache sui telefoni, funziona anche con le regole nuove; l'app v2.2 con le regole vecchie non gestisce gli inviti.
> - Il redirect della v1 va per ultimo, così porta su una v2.2 già funzionante.
>
> Ci si ferma a ogni passo per l'ok.

Regole pubblicate fino a oggi: `docs/rules-backup/pre-v2.2.rules` (ruleset `d071b7de-15f7-4e1e-9055-781c28720c67`).

---

## Prerequisito: restrizioni della chiave API (trovato il 2026-11-07)
La chiave API del browser è ristretta per referrer e oggi ammette **solo `lucsor.github.io`**. Lo si vede inviando un `Referer` diverso a `identitytoolkit`.
Manca **`garageos-879bc.firebaseapp.com`**, dove gira l'handler del login Google. Con la chiave così:
- l'handler non riesce a verificare il dominio ("Unable to verify that the app domain is authorized");
- **i nuovi login falliscono anche con la v2.1 in produzione**; funzionano solo le sessioni già salvate.

Google Cloud Console → API e servizi → Credenziali → chiave "Browser key (auto created by Firebase)" → Restrizioni delle applicazioni → Siti web:
- `https://lucsor.github.io/*` (già presente)
- **`https://garageos-879bc.firebaseapp.com/*`** (da aggiungere, obbligatorio per il login)
- `http://localhost:5173/*` (solo per il test locale; **da togliere** dopo)

La propagazione richiede fino a ~5 minuti. Per verificare (in sola lettura):
```sh
curl -s -H "Referer: https://garageos-879bc.firebaseapp.com/" "https://identitytoolkit.googleapis.com/v1/projects?key=<apiKey>" | head -c 200
```
Se la risposta non contiene `error`, il referrer è ammesso.

## Sequenza

| # | Azione | Comando | Verifica |
|---|---|---|---|
| 0 | Test in locale | `cd tests/rules && npm test` (92)<br>`npm run test:prod-data` (17, dati reali)<br>`node tools/csp-hash.mjs --check`<br>con emulatori e server attivi: `cd tests/e2e && npm run test:csp && node first-open.e2e.mjs` | tutto verde |
| 1 | OK al **push** di `hotfix/security` (v2) e di `redirect-to-v2` (v1), poi apertura delle PR | — | PR con il diff |
| 2 | **Backup fresco** dei dati e delle regole, appena prima di scrivere | `cd tools/admin`<br>`node export-firestore.mjs`<br>`node export-auth-users.mjs`<br>`cd ../.. && node tools/backup-rules.mjs` | nuovi file datati; regole uguali a `pre-v2.2.rules`, altrimenti **fermarsi** |
| 3 | **Migrazione, dry run** | `cd tools/admin`<br>`node migrate-members.mjs --garage <gid> --uid <alessandro> --uid <tiziana>`<br>(uid in `migration-plan.json`) | il diff è identico a quello approvato: solo `memberUids` più 2 `users/{uid}` CREATE |
| 4 | **Migrazione, apply** | stesso comando + `--apply` | `✔ Applicato` e `✔ Verifica post-scrittura`; rilanciandolo dice "Già migrato" |
| 5 | **Regole e indici** | `npx firebase-tools deploy --only firestore:rules,firestore:indexes --project garageos-879bc` | `✔ Deploy complete!`; in Console → Regole c'è la nuova versione |
| 6 | **Merge** della PR v2 su `main`, entro pochi minuti dal passo 5 | — | build Pages verde; `curl -s https://lucsor.github.io/garageos-v2/sw.js \| grep VERSION` → `2.2.0` |
| 7 | **Prova in produzione** | tu: login, nessun `Refused to…` in console, Famiglia mostra alessandro e tiziana; un invito di prova verso un secondo account va accettato e poi rimosso | tutto ok |
| 8 | **Merge** della PR v1 (`redirect-to-v2`) su `main` di `lucsor/garageOS` | — | `https://lucsor.github.io/garageOS/` porta alla v2 |
| 9 | Comunicazione | ad amici e famiglia: nuovo link `https://lucsor.github.io/garageos-v2/`, stesso account Google, reinstallare l'icona; a francesco: invito v2.2 dalla scheda Famiglia | — |

---

## Rollback (in ordine inverso, fermandosi a ogni passo)

### A. v1: annullare il redirect
`git revert <sha-merge-redirect>` su `lucsor/garageOS` `main` e push.
La v1 resta comunque inutilizzabile con qualsiasi regola che vieti di elencare tutti i garage, perché la usa all'avvio. Il revert serve solo a ripristinare la pagina.

### B. App v2
```sh
git checkout main && git pull
git revert -m 1 <sha-merge-v2.2> && git push origin main      # Pages ripubblica la v2.1
```

### C. Regole
```sh
npx firebase-tools deploy --only firestore:rules --config firebase.rollback.json --project garageos-879bc
```
In alternativa: Console → Firestore → Regole → cronologia → versione precedente → Pubblica.

### D. Dati: ripristino dal backup JSON
`tools/admin/restore-firestore.mjs` riscrive i documenti **esattamente com'erano nel backup**.
- Fa sempre prima un dry run, che mostra i documenti identici, diversi e mancanti.
- Riscrive solo quelli diversi o mancanti.
- **Non cancella** i documenti creati dopo il backup (`invites/*`, nuovi `users/*`): li elenca soltanto.
- Rifiuta `--target production` se è impostato `FIRESTORE_EMULATOR_HOST`, e viceversa.

```sh
cd tools/admin
# 1) cosa cambierebbe (dry run). --file per scegliere un backup preciso, --only per limitarlo
node restore-firestore.mjs --target production --file "%USERPROFILE%\Documents\garageos-backup\firestore-YYYYMMDD.json"
# 2a) annullare SOLO la migrazione: riporta il garage com'era (memberUids compreso)
node restore-firestore.mjs --target production --only garages/<gid> --apply
# 2b) ripristino completo di tutti i documenti del backup
node restore-firestore.mjs --target production --apply
```

Note:
- **2a** riporta l'intero documento garage allo stato del backup: si perdono anche le modifiche successive, come la rinomina o i membri entrati dopo con un invito v2.2.
  I `users/{uid}` creati dalla migrazione restano. Sono innocui: senza `memberUids` l'app riceve `permission-denied` e riporta il puntatore al garage personale.
  Se vuoi eliminarli: Console → Firestore → `users/<uid>` → Elimina documento.
- Per i veicoli o gli interventi di un garage: `--only garages/<gid>/vehicles/<id>` (o `.../mechs/<id>`).
- Collaudato sull'emulatore: dry run, poi apply, poi di nuovo dry run con 73 su 73 documenti identici.
