# Changelog

## [2.2.0] — hotfix di sicurezza (branch `hotfix/security`, non ancora pubblicato)

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
