# GarageOS — Piano (bozza)

> Il piano completo verrà scritto nella **Fase 3**, dopo l'approvazione di `docs/IDEE.md`.
> Qui sono registrati per ora gli elementi già decisi.

## Fatto nel hotfix `hotfix/security` (v2.2.0)
Punti 1, 2, 3 (parziale: chiusura delle letture globali nelle regole), 5 dell'audit; regole e test versionati.

## Rimandati alla Fase 4 (decisione del 2026-11-07)
| Rif. audit | Cosa | Note |
|---|---|---|
| H5 / punto 6 | Offline: precache dell'SDK Firebase nel SW + `persistentLocalCache` | `enableIndexedDbPersistence` è deprecato |
| M1 / punto 7 | Costo duplicato con più tipi di intervento | Serve decidere: costo solo sul primo tipo, diviso o un documento con `types[]` |
| M7 / punto 8 | SW: non cancellare `garageos-notif`; niente reload alla prima installazione | |
| M5 | **Tipi:** km, importi e anno da stringa a `number` | Script di migrazione con dry run; le regole accettano già entrambi i tipi |

## In attesa di decisione
- **Punto 4, migrazione v1→v2:** dipende dall'uso residuo della v1 (vedi la domanda aperta). Se serve: script Admin SDK con `--dry-run`
  che popola `memberInfo` (e, se approvato, `memberUids`) dalle voci `members[]` attive.
- **Dismissione della v1** (`lucsor/garageOS`): redirect alla v2 oppure disattivazione di Pages.

## Altri punti dell'audit ancora aperti (da pianificare in Fase 3)
M2 (inviti ora documenti separati: risolto per i nuovi; resta il `members[]` legacy), M4 (eliminazione del veicolo con `writeBatch`),
M6 (data "oggi" in UTC), M8 (errori dei listener: gestito `permission-denied`), M9 (login con redirect su Safari/iOS),
App Check, restrizione della API key, manifest e icone.
