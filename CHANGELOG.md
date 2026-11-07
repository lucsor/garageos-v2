# Changelog

## [2.6.0] — in preparazione
### Novità
- **Rifornimenti:** ⛽ sulla scheda di ogni veicolo (un tocco) o ＋ nella nuova scheda **Spese**. Data di oggi e "pieno" già impostati, tastierino numerico, virgola decimale ("38,5"); i valori ambigui come "1.500,5" vengono respinti con un messaggio chiaro, e se i km sono meno dell'ultimo rifornimento l'app chiede conferma. Elenco per veicolo con modifica ed eliminazione, export CSV.
- **Consumi:** km/l, l/100 km ed €/km calcolati solo tra due pieni, sommando i rifornimenti parziali in mezzo. Compaiono solo se calcolabili; i tratti con km mancanti o incoerenti vengono esclusi e segnalati.
- **Spese annue:** grafico per anno (interventi, bollo/revisione pagati, carburante), tabella, ripartizione per veicolo ed export CSV. I costi degli interventi multi-tipo sono contati una volta. L'assicurazione non è compresa, perché l'app non registra quando viene pagata.
- Eliminando un veicolo si eliminano anche i suoi rifornimenti.
### Sicurezza
- Regole `garages/{g}/refuels`: accesso solo ai membri; km intero, litri e importo solo numeri, entro limiti; chiavi ammesse chiuse; veicolo esistente; `addedBy` = chi scrive e immutabile; `createdAt`/`updatedAt` = ora del server. **Da pubblicare prima dell'app.**
### Sviluppo
- Modulo puro `js/fuel.js` con unit test (`tests/unit/fuel.test.mjs`), test delle regole RF01–RF10, e2e `tests/e2e/fuel.e2e.mjs` (in CI). Progetto e limiti: `docs/v2.6.md`.

## [2.5.1] — 2026-11-07
### Novità
- **Avviso "vecchia icona":** chi apre ancora l'icona della v1 arriva qui dal redirect con `?from=v1` e vede "Stai usando la vecchia icona. Installa la nuova app e cancella quella vecchia dalla schermata Home." con **Installa** (prompt di Chrome su Android; istruzioni "Condividi → Aggiungi alla schermata Home" su iPhone) e **Ho capito**. Il parametro viene tolto subito dall'URL. Non compare nell'app installata, dopo "Ho capito" o dopo l'installazione da qui.
- **Promemoria push delle scadenze** (menu → 🔔 Promemoria): attivazione per dispositivo solo al tocco, giorni di preavviso (default 30, 7, 1) e "con o senza dettagli" per utente. Una notifica al giorno, la mattina, con targa e tipo di scadenza (mai importi). Su iPhone: istruzioni per aggiungere l'app alla Home (iOS 16.4+).
- Invio da GitHub Actions (piano Spark, niente Cloud Functions) con Workload Identity Federation: nessuna chiave. Idempotente (registro `pushLog`), recupera i giorni saltati, rimuove i token non validi o inutilizzati da 60 giorni, keepalive contro la disattivazione dopo 60 giorni.
### Sicurezza
- Regole: `users/{uid}/pushTokens/{sha256(token)}` leggibili solo dal proprietario (anche contro query collectionGroup), preferenze validate, registro inaccessibile ai client.

## [2.4.1] — 2026-11-07
### Novità
- **Scadenze nel calendario:** nella scheda Scadenze, "📅 Calendario" scarica un file `.ics` con tutte le scadenze future (bollo, revisione, assicurazione) dei veicoli attivi, rispettando il filtro per veicolo; il 📅 su ogni scadenza scarica solo quella. Ogni evento è "tutto il giorno" con due promemoria (alle 9:00 di 7 giorni prima e del giorno prima). Si apre con l'app Calendario di iPhone, Android, Google o Outlook. Tutto generato sul dispositivo: nessun dato inviato a server.
- UID stabile per evento: reimportando il file, i calendari che lo supportano aggiornano l'evento invece di duplicarlo.

## [2.4.0] — 2026-11-07
### Sviluppo
- **Moduli ES senza build:** `index.html` (solo markup) + `css/app.css` + `js/app.js` e i moduli puri `js/utils.js`, `js/csv.js`, `js/costs.js`. Nessuna modifica alla logica. CSP senza script inline (`script-src 'self'`): niente più hash da aggiornare.
- `tools/check-precache.mjs` (pre-commit e CI): ogni file in `css/` e `js/` deve essere nel precache del service worker.
- Unit test in Node dei moduli puri, anche in CI. `tools/split-modules.py` rigenera la divisione da un `index.html` monolitico.

## [2.3.0] — 2026-11-07
### Correzioni
- **Service worker:** all'aggiornamento non cancella più la cache delle notifiche (`garageos-notif`) né le cache di altre app sulla stessa origine. Alla prima installazione la pagina non si ricarica più da sola (prima poteva interrompere il login); il reload avviene solo per un aggiornamento richiesto.
- **Costi multi-tipo:** un intervento con N tipi non moltiplica più il costo per N. Il costo va sul primo tipo; gli altri mostrano un badge **"incluso"** e la riga "🔗 Costo già conteggiato in «tipo»". I totali deduplicano i vecchi gruppi con il costo ripetuto.
- Un `reg.update()` fallito offline non genera più un errore non gestito.
- **Salvataggi offline:** la finestra si chiude subito con l'avviso "Salvato sul dispositivo" invece di restare in caricamento in attesa del server. Rinnovo scadenza e cancellazione di un veicolo non si bloccano più a metà offline.
- **Logout su dispositivo condiviso:** l'uscita svuota la cache locale Firestore e `garageos-notif`; se ci sono modifiche non ancora sincronizzate chiede conferma prima di perderle.
- Service worker: le risposte parziali (206) non vengono messe in cache.
### Novità
- **Offline:** SDK Firebase e font nella cache del service worker, cache Firestore persistente (IndexedDB, multi-scheda), indicatore "● Offline · dati locali". Le modifiche fatte offline vengono sincronizzate al ritorno della rete.
### Sviluppo
- Pre-commit hook (`.githooks/pre-commit`): hash CSP in staging e bump di `VERSION` in `sw.js`.
- `tools/admin/migrate-numbers.mjs`: migrazione da stringa a numero (solo dry-run; da eseguire dopo il task D3). I valori con separatore delle migliaia ("1.500", "50.000") non vengono mai convertiti: finiscono nella lista "da sistemare a mano".
- `tools/admin/check-v2-logins.mjs`: controllo in sola lettura degli accessi alla v2 (prerequisito della pulizia di `members[]`).
- Test e2e `costs.e2e.mjs` (dati reali) e `pwa.e2e.mjs` (service worker e offline).

## [2.2.0] — 2026-11-07 — hotfix di sicurezza

### Sicurezza
- **Inviti riprogettati** (`invites/{token}`): token `crypto.getRandomValues` da 256 bit, scadenza ≤ 7 giorni,
  uso singolo (`usedAt`/`usedBy`), vincolato all'email verificata dell'invitato. Il link è `?invite=<token>`
  e non contiene più né l'uid del proprietario né l'email.
  I vecchi link `?join=<uid>&email=` non sono più accettati.
- **Ingresso atomico:** consumo dell'invito + aggiunta a `memberUids`/`memberInfo` + aggiornamento di `users/{uid}`
  in un unico `writeBatch`, verificato dalle regole con `get()`/`getAfter()`.
- **XSS:** rimossi tutti gli handler inline (46 `onclick`/`onchange`) e le 27 funzioni esposte su `window`;
  event delegation con `data-action`/`data-change`; ogni valore negli attributi passa da `esc()`;
  foto profilo accettate solo `https://`.
- **CSP** via meta tag: `script-src` con hash SHA-256 (nessun `'unsafe-inline'` per gli script),
  `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`. Strumento: `tools/csp-hash.mjs`.
- **ID dei documenti** generati solo da Firestore (`doc(collection()).id`), mai dall'utente; validati dalle regole.
- **Regole Firestore versionate** (`firestore.rules`) con validazione di tipi, dimensioni e campi ammessi;
  niente più `list` sui garage; sottocollezioni ammesse solo `vehicles`, `tires`, `mechs`.

### Correzioni
- **Login:** si passa al redirect solo se il popup non può aprirsi (`popup-blocked`, ambiente non supportato). Per gli altri errori compare un messaggio chiaro, ad esempio per la restrizione della chiave API o il dominio non autorizzato, e il pulsante resta. La schermata non resta più bloccata su "Accesso in corso…" se il redirect non porta un utente, e c'è un pulsante "Annulla".
- **Membri coerenti:** `memberUids` (accesso) e `memberInfo` (profilo) si aggiornano insieme; solo il proprietario
  rimuove gli altri (in transazione), ognuno può uscire da solo ("Esci"). Se si perde l'accesso mentre l'app è aperta,
  si torna in automatico al garage personale.
- **Errore di rete all'avvio:** non scollega più il membro dal garage condiviso. Gli errori transitori ritentano
  con backoff; si torna al garage personale solo dopo una risposta certa del server (`permission-denied`/`not-found`).

### Compatibilità con i dati esistenti (nessuna modifica distruttiva)
- `members[]` legacy resta in sola lettura per i membri; il proprietario può eliminarne le voci non valide dalla UI.
- I numeri salvati come stringa e gli ID legacy (`uid()` della v2.1) restano validi.

### Sviluppo
- `firebase.json`, `.firebaserc`, `firestore.indexes.json`; suite di test delle regole (`tests/rules`, 61 casi);
  emulatori locali attivabili con `?emulator` solo su localhost.

## [2.1.0] — 2026-07-13
- Veicoli congelati, rinnovo scadenze, notifiche locali. (Vedi la cronologia git.)
