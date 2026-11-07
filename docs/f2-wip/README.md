# F2 — Scadenze personalizzate (IN PAUSA dal 2026-11-07)

Messo in pausa per dare priorità alle notifiche push. **Niente di questo è in produzione** e le regole non sono pubblicate.

## Fatto e testato
- **Regole** `garages/{g}/deadlines/{id}` in `firestore.rules`: solo i membri leggono e scrivono, validazione completa anche in update (collezione nuova, niente dati legacy), numeri veri (`cost` number ≥ 0, `repeatMonths` int 1-120), `createdAt`/`updatedAt` = timestamp del server, `addedBy` = email di chi crea e immutabile. Tipi ammessi in `deadlineKinds()`.
- **Test delle regole**: 10 nuovi (DL01-DL10) in `tests/rules/rules.test.mjs` → 102/102.
- **Modulo puro** `js/deadlines.js`: lista unica scadenze veicolo + personalizzate (`collectDeadlines`), ricorrenza con fine mese (`advanceDue`), modulo → documento (`deadlineFromForm`), tipi e ricorrenze. **Non ancora importato dall'app** (e quindi non nel precache).
- **Unit test** `tests/unit/deadlines.test.mjs` (5), compreso il controllo che i tipi del client coincidano con quelli delle regole.

## Bozze da completare (in questa cartella)
- `deadline-modal.html`: finestra di inserimento/modifica.
- `deadlines.e2e.mjs.draft`: e2e completo (creazione, ordine, contatore, Firestore, .ics, "Fatto", membro, eliminazione del veicolo).

## Da fare per chiudere F2
1. `js/app.js`: listener `deadlines`, `data.deadlines`, `+` nella scheda Scadenze, finestra, salvataggio con `written()` e `serverTimestamp()`, "✅ Fatto" (ricorrente → `advanceDue`, singola → elimina), ✏️ modifica/elimina.
2. Usare `collectDeadlines` in: lista Scadenze, hero "Prossima scadenza", contatore e chip, snapshot per le notifiche (`garageos-notif`), export `.ics` (`deadlineEvents`).
3. `removeVehicle`: eliminare anche le scadenze personalizzate del veicolo.
4. `sw.js`: `./js/deadlines.js` nel PRECACHE e VERSION; CI: unit test e e2e.
5. Deploy: **prima le regole** (con il mio ok), poi l'app.
6. Da coordinare con le notifiche push: lo script di invio dovrà leggere anche `deadlines`.
