# Promemoria push: configurazione e messa in produzione

Architettura: [`PUSH.md`](PUSH.md). Qui ci sono i **passi operativi**, in ordine. Ogni passo che scrive in produzione (Google Cloud, Firebase, GitHub, `main`) si esegue **solo con l'ok esplicito del proprietario**.

Dati del progetto, verificati in sola lettura il 2026-11-07:
- progetto `garageos-879bc`, numero `388016073061`, **senza organizzazione** (nessun criterio che blocchi la federazione);
- API già attive: `fcm`, `fcmregistrations`, `firebaseinstallations`, `firestore`. Da attivare: `iam`, `iamcredentials`, `sts`;
- repo `lucsor/garageos-v2`: id `1298368157`, proprietario id `22025699`. Si usano gli **ID numerici** e non i nomi, così un repo omonimo creato dopo una rinomina non può impersonare il service account.

---

## 1. Google Cloud: service account + Workload Identity Federation (senza chiavi)

Prerequisito: `gcloud` installato e `gcloud auth login` con l'account proprietario del progetto.

```sh
P=garageos-879bc
PN=388016073061
SA=garageos-reminders@$P.iam.gserviceaccount.com
REPO_ID=1298368157
OWNER_ID=22025699

# 1.1 API necessarie alla federazione (gratuite)
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project=$P

# 1.2 service account dedicato
gcloud iam service-accounts create garageos-reminders --project=$P \
  --display-name="GarageOS promemoria (GitHub Actions)" \
  --description="Invio giornaliero dei promemoria delle scadenze. Usato solo via Workload Identity Federation dal workflow reminders.yml su main."

# 1.3 ruoli minimi: Firestore (lettura token/utenti/garage/veicoli, scrittura pushLog, pulizia token) + invio FCM
gcloud projects add-iam-policy-binding $P --member="serviceAccount:$SA" --role="roles/datastore.user" --condition=None
gcloud projects add-iam-policy-binding $P --member="serviceAccount:$SA" --role="roles/firebasecloudmessaging.admin" --condition=None

# 1.4 pool e provider OIDC di GitHub, accettati SOLO per questo repo, su main
gcloud iam workload-identity-pools create github --project=$P --location=global \
  --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc garageos-v2 --project=$P --location=global \
  --workload-identity-pool=github \
  --display-name="lucsor/garageos-v2 (main)" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository_id=='$REPO_ID' && assertion.repository_owner_id=='$OWNER_ID' && assertion.ref=='refs/heads/main'"

# 1.5 solo le identità di questo repo possono impersonare il service account
gcloud iam service-accounts add-iam-policy-binding $SA --project=$P \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PN/locations/global/workloadIdentityPools/github/attribute.repository_id/$REPO_ID"

# 1.6 verifica (sola lettura)
gcloud iam workload-identity-pools providers describe garageos-v2 --project=$P --location=global --workload-identity-pool=github --format="value(name,attributeCondition,state)"
gcloud projects get-iam-policy $P --flatten="bindings[].members" --filter="bindings.members:$SA" --format="table(bindings.role)"
```

Nome del provider, da usare in GitHub: `projects/388016073061/locations/global/workloadIdentityPools/github/providers/garageos-v2`.

**Rollback:**
```sh
gcloud iam workload-identity-pools delete github --project=$P --location=global
gcloud iam service-accounts delete $SA --project=$P
```
Il pool si può ripristinare entro 30 giorni.

## 2. Firebase Console: chiave VAPID (a mano, non esiste un comando)

1. Apri <https://console.firebase.google.com/> → progetto **garageos-879bc**.
2. Ingranaggio ⚙️ in alto a sinistra → **Impostazioni progetto** → scheda **Cloud Messaging**.
3. Verifica che **API Firebase Cloud Messaging (V1)** risulti **Abilitata**. Dal controllo in sola lettura risulta già attiva.
4. Scorri fino a **Configurazione web** → **Certificati push web** → **Genera coppia di chiavi**.
5. Copia la **chiave pubblica**: è una stringa lunga che inizia di solito con `B…`, ed è pubblica. Mandamela. Va in `VAPID_PUBLIC_KEY` in `js/push.js`.
   **Non** serve la chiave privata, che resta in Firebase.

## 3. GitHub: environment e variabili (non sono segreti)

```sh
R=lucsor/garageos-v2
# environment "reminders" utilizzabile solo dal branch main
echo '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' | gh api -X PUT repos/$R/environments/reminders --input -
gh api -X POST repos/$R/environments/reminders/deployment-branch-policies -f name=main -f type=branch
# identità Google per la federazione
gh variable set GCP_WIF_PROVIDER --repo $R --body "projects/388016073061/locations/global/workloadIdentityPools/github/providers/garageos-v2"
gh variable set GCP_SA_EMAIL     --repo $R --body "garageos-reminders@garageos-879bc.iam.gserviceaccount.com"
# primo test: solo il tuo account (uid del proprietario del garage di famiglia)
gh variable set REMINDERS_ONLY_UID --repo $R --body "<il tuo uid>"
# REMINDERS_ALLOW_LIVE NON si imposta ora: finché manca, ogni esecuzione è un DRY RUN
```

## 4. Messa in produzione (ogni passo con l'ok del proprietario)

1. **Regole** (`firebase deploy --only firestore:rules`), dopo aver salvato quelle pubblicate in `docs/rules-backup/`. Sono compatibili con la v2.4.1: aggiungono soltanto `push`, `pushTokens`, `pushLog` e `pushStatus`.
2. **App v2.5.1** (promemoria + avviso "vecchia icona"): merge della PR. Prima va inserita `VAPID_PUBLIC_KEY`: senza, il pulsante dice "non ancora attivi".
3. **Il tuo telefono**: Promemoria → Attiva su questo dispositivo. Su iPhone, prima aggiungi l'app alla Home.
4. **Dry run in produzione**: Actions → "Promemoria scadenze" → Run workflow → `dry-run`. Si controllano i conteggi nel log e il job keepalive verde.
5. **Primo invio reale, solo sul tuo account**: `gh variable set REMINDERS_ALLOW_LIVE --body yes`, con `REMINDERS_ONLY_UID` = il tuo uid → Run workflow → `live`. Verifica la notifica sul telefono.
6. **Apertura a tutti**: `gh variable delete REMINDERS_ONLY_UID`. Da lì il cron giornaliero invia a tutti quelli che hanno attivato i promemoria.

**Spegnimento d'emergenza:**
- `gh variable delete REMINDERS_ALLOW_LIVE`: si torna al dry-run;
- oppure Actions → workflow → **Disable workflow**.

## 5. Keepalive: come funziona e come si verifica

- **Il problema:** GitHub disattiva i workflow **pianificati** di un repo pubblico dopo **60 giorni senza attività nel repo**. Un workflow disattivato **non gira più**, quindi non può riattivarsi da solo.
- **La soluzione:** il job `keepalive` gira a **ogni** esecuzione pianificata, cioè ogni giorno: 59 giorni di margine. Chiama l'API `PUT …/actions/workflows/reminders.yml/enable`, che azzera il conteggio, e poi verifica che lo stato sia `active`. Se non lo è, il job fallisce e GitHub manda un'email al proprietario.
- **Nota onesta:** che l'API `enable` azzeri il conteggio **non è scritto nella documentazione di GitHub**. È il comportamento osservato e usato dalle action di keepalive più diffuse. Se GitHub lo cambiasse, l'unica conseguenza sarebbe la disattivazione dopo 60 giorni senza commit. Le reti di sicurezza:
  1. l'app mostra al proprietario "l'invio non gira da N giorni" quando il heartbeat ha più di 3 giorni (finestra Promemoria);
  2. si riattiva con un clic (Actions → workflow → Enable), oppure basta un commit qualsiasi.
- **Verifiche automatiche:**
  - `tests/unit/workflows.test.mjs` (in CI) controlla che il cron sia giornaliero (margine < 60 giorni), che il keepalive non sia limitato al lancio manuale, che abbia `actions: write`, che chiami `enable` **su questo stesso file** e che fallisca se lo stato non è `active`;
  - il primo `workflow_dispatch` (passo 4.4) esegue davvero il keepalive e ne mostra lo stato nel log.
