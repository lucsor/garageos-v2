# GarageOS v2

PWA per gestire il parco macchine in famiglia: veicoli, scadenze (bollo,
revisione, assicurazione), cambi gomme, interventi meccanici e garage
condiviso con inviti.

**Stack:** HTML/CSS/JS in un solo file · Firebase Auth (Google) · Firestore realtime · PWA
**Versione:** 2.2.0 — vedi [CHANGELOG](CHANGELOG.md)

## Sicurezza (v2.2)
- **Inviti** in `invites/{token}`: token casuale di 256 bit, valido 7 giorni, utilizzabile una sola volta,
  solo dall'account Google con l'email invitata. Ingresso e consumo dell'invito avvengono nello stesso batch,
  verificato dalle regole con `get()`/`getAfter()`.
- **Membri:** `memberUids` è l'unica fonte di verità per l'accesso; solo il proprietario rimuove gli altri,
  ognuno può togliere solo sé stesso ("Esci").
- **Nessun handler inline** (`onclick=`): event delegation con `data-action`, quindi una **CSP** senza `'unsafe-inline'` per gli script.
- Gli **ID dei documenti** sono generati solo da Firestore e validati dalle regole.
- Regole Firestore versionate in [`firestore.rules`](firestore.rules) e coperte da test sull'emulatore.

## ⚠️ Dopo OGNI modifica allo script in `index.html`
L'unico script inline è autorizzato nella CSP tramite hash SHA-256. Se l'hash non corrisponde, **l'app resta bianca**.
```sh
node tools/csp-hash.mjs          # aggiorna l'hash nel meta CSP
node tools/csp-hash.mjs --check  # verifica (prima di ogni commit)
```
Poi incrementa `VERSION` in `sw.js`.

## Test delle regole (Firebase Emulator)
Richiede Node 20+ e **Java 21** nel `PATH`.
```sh
cd tests/rules && npm install
npm test               # firestore.rules (suite completa)
npm run test:audit     # suite dell'audit sul vecchio flusso (es. RULES=baseline/published.rules)
```

## Sviluppo locale con emulatori
```sh
firebase emulators:start --only auth,firestore --project garageos-879bc
python -m http.server 5173 --bind 127.0.0.1
# apri http://127.0.0.1:5173/?emulator&as=alice   (as = utente finto dell'emulatore)
```
Il collegamento agli emulatori è attivo **solo** su `localhost`/`127.0.0.1` con `?emulator`.

## Deploy
- **App:** GitHub Pages (Settings → Pages → Deploy from branch → `main` / root).
- **Regole e indici:** `firebase deploy --only firestore` (progetto `garageos-879bc`, vedi `.firebaserc`),
  oppure copia `firestore.rules` in Console → Firestore → Regole.
  Pubblica le regole **insieme** al merge su `main`: la v2.2 ha bisogno delle nuove regole (collezione `invites`),
  e le nuove regole chiudono la lettura globale usata dalla v1.
