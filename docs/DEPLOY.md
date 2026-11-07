# Deploy e rollback — hotfix v2.2.0

Progetto Firebase: `garageos-879bc` · App: GitHub Pages da `main` / root · Branch: `hotfix/security`

> **Regola d'oro:** prima le regole, poi l'app, a pochi minuti di distanza.
> - L'app v2.2 con le regole vecchie **non può creare né accettare inviti**: la collezione `invites` non è prevista.
> - L'app v2.1, ancora in cache sui telefoni, con le regole nuove **continua a funzionare**: garage, veicoli, gomme, interventi, rinomina e rimozione membri.
>   Si rompe solo il vecchio link `?join=`, che è proprio la falla da chiudere.

Le regole pubblicate fino a oggi sono salvate in `docs/rules-backup/pre-v2.2.rules` (ruleset `d071b7de-15f7-4e1e-9055-781c28720c67`, scaricato il 2026-11-07).

---

## Sequenza

| # | Chi | Comando / azione | Verifica |
|---|---|---|---|
| 0 | Claude/tu | Ultimi controlli in locale:<br>`cd tests/rules && npm test`<br>`node tools/csp-hash.mjs --check`<br>`cd tests/e2e && npm run test:csp` (con emulatori e server attivi, vedi README) | 92/92 · `CSP OK` · `✔ Nessuna violazione CSP` |
| 1 | tu | **OK al push** di `hotfix/security` e apertura della PR verso `main` | La PR mostra il diff |
| 2 | Claude/tu | Backup delle regole attuali, appena prima del deploy, nel caso siano cambiate da oggi:<br>`node tools/backup-rules.mjs` | Nuovo file in `docs/rules-backup/`. Se è diverso da `pre-v2.2.rules`, **fermarsi e confrontare** |
| 3 | tu (o Claude con il tuo ok) | **Regole e indici:**<br>`npx firebase-tools deploy --only firestore:rules,firestore:indexes --project garageos-879bc`<br>(dalla root del repo; in alternativa Console → Firestore → Regole → incolla `firestore.rules` → Pubblica) | Output `✔ Deploy complete!`; in Console → Regole compare la nuova versione con data e ora |
| 4 | tu | **Merge della PR su `main`**, entro pochi minuti dal punto 3 | GitHub → Actions/Pages: build "pages build and deployment" verde (1-2 min) |
| 5 | Claude/tu | `curl -s https://lucsor.github.io/garageos-v2/sw.js \| grep VERSION` | `const VERSION = '2.2.0';` |
| 6 | tu | Apri l'app → banner "Nuova versione" → tocca. Login, controlla la console (nessun `Refused to…`), vai su Famiglia → crea un invito di prova verso un tuo secondo account → accettalo da quel dispositivo o account → rimuovilo | Ingresso e rimozione funzionano; il link riusato dà "già stato usato" |
| 7 | tu | Avvisa la famiglia: aprire l'app e toccare "Nuova versione". Chi era stato invitato con un vecchio link `?join=` va **reinvitato** (in Famiglia compare come "Vecchio formato") | — |

**Finestra di rischio tra 3 e 4:** chi usa la v2.1 durante quei minuti non può più usare i link `?join=`. È voluto.

---

## Rollback

Va fatto **in ordine inverso**: prima l'app, poi le regole. Con l'app v2.2 online e le regole vecchie, gli inviti smetterebbero di funzionare.

### A. Rollback dell'app (Pages)
```sh
git checkout main && git pull
git revert -m 1 <sha-del-merge-v2.2>     # crea un commit che annulla il merge
git push origin main                      # Pages ripubblica la v2.1 in 1-2 minuti
```
Il byte di `sw.js` cambia, quindi i client vedranno il banner di aggiornamento verso la v2.1.

### B. Rollback delle regole
Opzione 1, CLI (un solo comando, usa `firebase.rollback.json` che punta al backup):
```sh
npx firebase-tools deploy --only firestore:rules --config firebase.rollback.json --project garageos-879bc
```
Opzione 2, Console: Firestore → Regole → icona cronologia → seleziona la versione precedente al deploy → **Pubblica**.

### Dati creati dalla v2.2 dopo un rollback
- I documenti `invites/*` e i campi `memberInfo` restano. La v2.1 li ignora, quindi sono innocui.
  Non vanno cancellati: servono se si ripubblica la v2.2.
- I membri entrati con un invito v2.2 sono in `memberUids`, quindi mantengono l'accesso anche con la v2.1.

---

## Cosa NON fa questo deploy
- Non migra né modifica dati esistenti: nessuna scrittura batch su produzione.
- Non tocca la v1 (`lucsor/garageOS`): è già inutilizzabile con le regole attuali (vedi la risposta sul punto 3).
- Niente App Check né restrizione della API key: sono nel piano.
