# GarageOS — Piano v2.7 / v2.8

> Base: `main` = v2.6.1 (`e75baa7`), regole `42869098`. Analisi fatta sul codice di `main`.

## 0. Fattibilità in breve

| # | Richiesta | Stato reale nel codice | Fattibilità | Impegno |
|---|---|---|---|---|
| 1a | Importo su "✅ Fatto" | **Già in produzione (v2.6.1)**: `confirmDeadlineDone()` scrive in `payments` con importo precompilato e data di pagamento, contato nell'anno del pagamento | — | — |
| 1b | Registro pagamenti (vedi / modifica / elimina) | `payments` viene già letto in `data.payments`, ma non ha un'interfaccia. La regola `update` oggi permette di cambiare **qualunque** campo (deadlineId, kind…) | Alta | S |
| 1c | Problema contabile residuo | Le spese annue mescolano **pagato** (interventi, rifornimenti, `payments`) e **previsto** (scadenze future alla data `due`, `deadlineExtras`). Il grafico "Spese" mostra quindi negli anni futuri importi non ancora pagati | Alta | S |
| 2 | Tema scuro | I token CSS in `:root` ci sono, ma ci sono **75 colori scritti a mano** in `css/app.css` e nessun blocco dark | Alta | S-M |
| 3 | Parti d'usura | Il veicolo ha `km`/`kmDate`, aggiornati dai rifornimenti (v2.6.0). Serve una nuova collezione, più regole, UI e promemoria | Media | M-L |
| 4 | Backup / ripristino JSON | **Export**: facile. **Import**: limitato dalle regole (`createdAt == request.time`, `addedBy == myEmail()`), quindi date di creazione e autori originali **non si possono ripristinare** dal client | Export alta, import media | M |

## 1. Piano a PR incrementali

| PR | Versione | Contenuto | Regole | Test |
|---|---|---|---|---|
| **A** | 2.7.0 | Registro pagamenti in Spese (lista, filtro per anno/veicolo, modifica importo/data/etichetta, eliminazione) + separazione **Pagato / Previsto** nelle spese annue | `payments`: update ristretto, delete solo autore o proprietario | rules +8, unit +6, e2e `payments.e2e.mjs` |
| **B** | 2.7.1 | Tema scuro: token per tutti i colori, blocco `prefers-color-scheme: dark`, selettore Auto / Chiaro / Scuro (preferenza in `localStorage`), `meta theme-color` dinamico, controllo contrasto AA | nessuna | e2e `theme.e2e.mjs` (emulazione dark + contrasto), screenshot in STATO.md |
| **C** | 2.8.0 | Parti d'usura: `garages/{g}/wear/{id}`, stato calcolato da km e tempo, "🔧 Sostituito" (azzera e crea l'intervento facoltativo), badge in scheda veicolo e avvisi | nuova `wearOk()` | rules +10, unit `wear.test.mjs`, e2e `wear.e2e.mjs` |
| **C2** | 2.8.1 | Promemoria push per le parti d'usura (lo script del cron calcola le soglie di km e giorni) | nessuna (Admin SDK) | `reminders.emu.mjs` esteso |
| **D** | 2.8.2 | Export JSON del garage (tutte le sottocollezioni, `schemaVersion`), import **solo del proprietario**, solo additivo (crea gli ID mancanti, non sovrascrive e non cancella), anteprima delle differenze prima di scrivere | nessuna nuova (passa dalle regole esistenti) | e2e `backup.e2e.mjs` (export → garage vuoto → import → conteggi uguali) |

Ordine consigliato: **A → B → C → C2 → D**. B è indipendente e può andare in parallelo ad A.

## 2. PR A — modifiche architetturali

1. **Previsto vs Pagato.** In `js/fuel.js` ogni riga extra riceve un flag `planned`:
   - `paymentExtras` → `planned: false`;
   - `deadlineExtras` → `planned: date > oggi` (le scadenze passate senza pagamento restano "dovute", contate come oggi).

   `totalsByYear` restituisce `total` (pagato) e `planned` (previsto) separati. Il grafico mostra il previsto con barra tratteggiata e la tabella ha una colonna "Previsto". Il CSV ottiene una colonna `previsto`.
2. **Registro pagamenti.** Modulo puro nuovo `js/payments.js` (testabile in Node), più UI nella sottosezione "Spese annue" → segmento nuovo "Pagamenti".
3. **Modifica.** Si riusa `paymentFromForm()`. Si toccano solo `amount`, `date`, `label`, più `editedBy` e `updatedAt`.
4. **Eliminazione.** Conferma esplicita. Il pagamento non tocca la scadenza (che è già avanzata), quindi lo si dice nel testo di conferma.

### 2.1 Regole aggiornate (`firestore.rules`)

```
    // ───────── pagamenti delle scadenze ─────────
    // limiti: devono coincidere con PAYMENT_LIMITS in js/fuel.js
    function paymentOk(d) {
      return d.keys().hasOnly(['deadlineId', 'kind', 'label', 'vehicleId', 'date', 'amount',
                               'addedBy', 'editedBy', 'createdAt', 'updatedAt'])
        && d.keys().hasAll(['deadlineId', 'kind', 'label', 'date', 'amount', 'addedBy', 'createdAt', 'updatedAt'])
        && validId(d.deadlineId)
        && d.kind in deadlineKinds()
        && reqStr(d, 'label', 60)
        && (!('vehicleId' in d) || d.vehicleId == null || validId(d.vehicleId))
        && d.date is string && d.date.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
        && d.amount is number && d.amount > 0 && d.amount <= 1000000
        && d.createdAt is timestamp && d.updatedAt is timestamp
        && str(d.addedBy, 254)
        && (!('editedBy' in d) || str(d.editedBy, 254));
    }
```

```
      match /payments/{id} {
        allow read: if isMember(gid);
        allow create: if isMember(gid) && validId(id)
          && paymentOk(request.resource.data)
          && !('editedBy' in request.resource.data)
          && request.resource.data.addedBy == myEmail()
          && request.resource.data.createdAt == request.time
          && request.resource.data.updatedAt == request.time;
        // registro: si correggono solo importo, data ed etichetta; collegamento e autore restano fissi
        allow update: if isMember(gid)
          && touched().hasOnly(['amount', 'date', 'label', 'editedBy', 'updatedAt'])
          && paymentOk(request.resource.data)
          && request.resource.data.editedBy == myEmail()
          && request.resource.data.updatedAt == request.time;
        // elimina chi l'ha registrato o il proprietario del garage
        allow delete: if isOwner(gid)
          || (isMember(gid) && resource.data.addedBy == myEmail());
      }
```

Nota: `touched()` esclude già le chiavi non modificate, quindi `deadlineId`, `kind`, `vehicleId`, `addedBy` e `createdAt` diventano immutabili senza bisogno di confronti espliciti.

**Attenzione per la cancellazione del veicolo:** oggi `deleteVehicle` elimina i pagamenti collegati. Con la nuova regola di delete, un membro non proprietario che elimina un veicolo non può cancellare i pagamenti registrati da altri, e il batch fallisce. Due opzioni: (a) eliminare un veicolo resta riservato al proprietario (verificare la regola attuale dei `vehicles`); (b) i pagamenti orfani restano e compaiono come "Veicolo rimosso" (`spendVehicleName` lo gestisce già). **Consigliata (b)**: lo storico delle spese non deve sparire.

### 2.2 Test delle regole da aggiungere (`tests/rules`)

| ID | Caso | Atteso |
|---|---|---|
| P01 | membro modifica `amount` + `editedBy` = sé + `updatedAt` = request.time | ✅ |
| P02 | membro modifica `date` in formato non valido | ❌ |
| P03 | modifica di `deadlineId` / `kind` / `vehicleId` | ❌ |
| P04 | modifica di `addedBy` o `createdAt` | ❌ |
| P05 | `editedBy` ≠ propria email | ❌ |
| P06 | create con `editedBy` presente | ❌ |
| P07 | delete dell'autore (membro) | ✅ |
| P08 | delete di un altro membro, non autore | ❌ |
| P09 | delete del proprietario su un pagamento altrui | ✅ |
| P10 | estraneo: read / update / delete | ❌ |

### 2.3 Modulo puro `js/payments.js`

```js
// Registro pagamenti (v2.7.0) — funzioni pure, testate in tests/unit/payments.test.mjs
import { paymentFromForm } from './fuel.js';

// Righe del registro: più recenti prima, con filtro per anno e veicolo ('' = tutti, '-' = senza veicolo)
export function paymentLedger(payments = [], { year = null, vehicleId = '' } = {}) {
  return payments
    .filter((p) => typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date))
    .filter((p) => year == null || Number(p.date.slice(0, 4)) === year)
    .filter((p) => !vehicleId || (vehicleId === '-' ? !p.vehicleId : p.vehicleId === vehicleId))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id)));
}

// Totale del registro filtrato (in centesimi, per evitare errori di arrotondamento)
export function ledgerTotal(rows = []) {
  return rows.reduce((s, p) => s + Math.round(Number(p.amount) * 100), 0) / 100;
}

// Modulo di modifica → patch da scrivere (solo campi ammessi dalle regole) o errore
export function paymentPatch(form, original) {
  const label = String(form.label ?? '').trim();
  if (!label || label.length > 60) return { ok: false, error: "L'etichetta è obbligatoria (max 60 caratteri)" };
  const res = paymentFromForm({ amount: form.amount, date: form.date });
  if (!res.ok) return res;
  if (!res.amount) return { ok: false, error: 'Per togliere un pagamento usa «Elimina»' };
  const patch = {};
  if (res.amount !== Number(original.amount)) patch.amount = res.amount;
  if (res.date !== original.date) patch.date = res.date;
  if (label !== original.label) patch.label = label;
  return { ok: true, patch, changed: Object.keys(patch).length > 0 };
}

// Può eliminare: il proprietario del garage o chi l'ha registrato (stessa logica delle regole)
export function canDeletePayment(p, { isOwner, email }) {
  return !!isOwner || (!!email && String(p.addedBy || '').toLowerCase() === String(email).toLowerCase());
}
```

### 2.4 UI (nella scheda Spese, sottosezione nuova "Pagamenti")

`index.html`, accanto ai segmenti esistenti:

```html
<button class="seg" id="seg-pagamenti" data-click="spese-sub" data-sub="pagamenti">Pagamenti</button>
…
<div id="subsection-pagamenti" style="display:none">
  <div class="filter-row">
    <label class="sr-only" for="pay-filter-year">Anno</label>
    <select class="filter-select" id="pay-filter-year" data-change="pay-filter"></select>
    <label class="sr-only" for="pay-filter-vehicle">Veicolo</label>
    <select class="filter-select" id="pay-filter-vehicle" data-change="pay-filter"></select>
  </div>
  <p class="ledger-total" id="pay-total" aria-live="polite"></p>
  <ul class="ledger" id="pay-list"></ul>
  <p class="empty" id="pay-empty" hidden>Nessun pagamento registrato. Si registrano con «✅ Fatto» su una scadenza.</p>
</div>

<div class="modal" id="payment-edit-modal" role="dialog" aria-modal="true" aria-labelledby="pe-title">
  <h2 id="pe-title">Modifica pagamento</h2>
  <input type="hidden" id="pe-id">
  <label for="pe-label">Descrizione</label><input id="pe-label" maxlength="60">
  <label for="pe-amount">Importo (€)</label><input id="pe-amount" inputmode="decimal">
  <label for="pe-date">Data del pagamento</label><input id="pe-date" type="date">
  <p class="form-error" id="pe-error" role="alert" hidden></p>
  <div class="modal-actions">
    <button class="btn-danger" data-click="pay-delete">Elimina</button>
    <button class="btn-ghost" data-click="modal-close" data-modal="payment-edit-modal">Annulla</button>
    <button class="btn-primary" data-click="pay-save">Salva</button>
  </div>
</div>
```

`js/app.js` (rendering con `esc()` come nel resto dell'app, niente `onclick` inline: gli handler passano dalla delegation `data-click` esistente):

```js
import { paymentLedger, ledgerTotal, paymentPatch, canDeletePayment } from './payments.js';

function renderPagamenti() {
  const year = Number(document.getElementById('pay-filter-year').value) || null;
  const vehicleId = document.getElementById('pay-filter-vehicle').value;
  const rows = paymentLedger(data.payments, { year, vehicleId });
  document.getElementById('pay-total').textContent = rows.length ? `Totale: ${fmtEuro(ledgerTotal(rows))}` : '';
  document.getElementById('pay-empty').hidden = rows.length > 0;
  document.getElementById('pay-list').innerHTML = rows.map((p) => `
    <li class="ledger-row">
      <button class="ledger-btn" data-click="pay-edit" data-id="${esc(p.id)}">
        <span class="ledger-main">${esc(KIND_ICONS[p.kind] || '📌')} ${esc(p.label)}</span>
        <span class="ledger-sub">${esc(formatDate(p.date))} · ${esc(spendVehicleName(p.vehicleId))}${p.editedBy ? ' · modificato' : ''}</span>
        <span class="ledger-amt">${esc(fmtEuro(p.amount))}</span>
      </button>
    </li>`).join('');
}

function openPaymentEdit(id) {
  const p = data.payments.find((x) => x.id === id);
  if (!p) return;
  document.getElementById('pe-id').value = id;
  document.getElementById('pe-label').value = p.label;
  document.getElementById('pe-amount').value = String(p.amount).replace('.', ',');
  document.getElementById('pe-date').value = p.date;
  const del = document.querySelector('#payment-edit-modal [data-click="pay-delete"]');
  del.hidden = !canDeletePayment(p, { isOwner: isOwnerOfGarage(), email: currentUser?.email });
  showPeError('');
  openModal('payment-edit-modal');
}

async function savePaymentEdit() {
  const id = document.getElementById('pe-id').value;
  const p = data.payments.find((x) => x.id === id);
  if (!p) return closeModal('payment-edit-modal');
  const res = paymentPatch({
    label: document.getElementById('pe-label').value,
    amount: document.getElementById('pe-amount').value,
    date: document.getElementById('pe-date').value,
  }, p);
  if (!res.ok) return showPeError(res.error);
  closeModal('payment-edit-modal');
  if (!res.changed) return;
  try {
    await written(setDoc(vDoc('payments', id), {
      ...res.patch, editedBy: (currentUser?.email || '').toLowerCase(), updatedAt: serverTimestamp(),
    }, { merge: true }));
    _showToast('Pagamento aggiornato');
  } catch (e) { _showToast('Errore: ' + (e.code || e.message), 'red'); }
}

async function deletePayment() {
  const id = document.getElementById('pe-id').value;
  if (!confirm('Eliminare questo pagamento? La scadenza non torna indietro.')) return; // sostituire con il modale di conferma dell'app
  closeModal('payment-edit-modal');
  try { await written(deleteDoc(vDoc('payments', id))); _showToast('Pagamento eliminato'); }
  catch (e) { _showToast('Errore: ' + (e.code || e.message), 'red'); }
}
```

Da collegare: `'pay-edit'`, `'pay-save'`, `'pay-delete'`, `'pay-filter'` nella mappa `data-click` / `data-change`; `switchSpeseSub` esteso a tre segmenti; `renderPagamenti()` chiamato da `renderSpese()`; `isOwnerOfGarage()` = l'helper già usato per la scheda Famiglia.

### 2.5 Test

- **Unit (`tests/unit/payments.test.mjs`)**: ordinamento e filtri (anno, veicolo, "senza veicolo"); totale in centesimi (0,1 + 0,2); `paymentPatch` (solo i campi cambiati, etichetta vuota, importo vuoto → errore, virgola, migliaia ambigue); `canDeletePayment`; `deadlineExtras` con il flag `planned`.
- **E2E (`tests/e2e/payments.e2e.mjs`)**: "✅ Fatto" con 80,50 → compare nel registro; modifica a 75 → totale e grafico aggiornati, badge "modificato"; un membro non autore non vede "Elimina"; il proprietario elimina → sparisce dal registro e dalle spese; colonna "Previsto" per una scadenza futura.

## 3. Note sulle PR successive (da dettagliare quando si arriva lì)

- **B, tema scuro.** Prima si estraggono i 75 colori scritti a mano in token, poi il blocco dark. Va previsto anche il gradiente `--grad`, i grafici delle spese (colori delle serie) e `meta name="theme-color"`. Il selettore va in Impostazioni, con default Auto.
- **C, parti d'usura.** Documento `{vehicleId, kind: olio|filtro-aria|filtro-abitacolo|pastiglie|dischi|distribuzione|candele|batteria|liquido-freni|altro, label, lastKm, lastDate, intervalKm, intervalMonths, warnKm (default 1000), warnDays (default 30), note}`. Stato = il peggiore tra km residui (`lastKm + intervalKm − vehicle.km`) e giorni residui. Per stimare la data dai km si usa la media km/giorno dei rifornimenti, se ce ne sono almeno 2. Limite onesto: i km sono affidabili solo quanto i rifornimenti registrati.
- **D, backup.** Export: tutte le sottocollezioni del garage, in un JSON con `schemaVersion`, `exportedAt` e `garageId`, senza token push né dati di altri utenti, con l'avviso che il file contiene targhe. Import: solo il proprietario, nel proprio garage, solo additivo, con anteprima "crea N, salta M", a batch di massimo 500. `createdAt` e `addedBy` diventano quelli dell'import (vincolo delle regole, da scrivere nell'anteprima). Per un ripristino completo resta lo script admin `restore-firestore.mjs`.
