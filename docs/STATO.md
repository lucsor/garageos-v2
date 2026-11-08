# Stato del lavoro — aggiornato 2026-11-07, 20:30

> **Cosa ti serve fare, in ordine di priorità**
> 1. **Leggi prima la nota su #6 (§1):** la PR #6 era **già unita** (v2.5.1 in produzione) quando è arrivato "correggilo prima del merge della PR #6".
> 2. **Passo 4 dei promemoria: puoi farlo ora.** La v2.5.1 è online: sul telefono, menu → 🔔 Promemoria → "Attiva su questo dispositivo" (§5). Poi dimmi l'esito e preparo il dry-run in produzione (passo 5).
> 3. **Unisci #7 per prima** (correzione della CI di main). Con la protezione attiva, le altre PR dovranno essere aggiornate su main dopo ogni merge.
> 4. Rivedi e decidi le PR in bozza (§2) e le decisioni in §3.

---

## 1. Cosa ho fatto in questo blocco

Regole rispettate: nessuna scrittura in produzione (Firestore, Auth, regole, chiave API, Pages), nessun merge su main, nessun deploy, PR solo in bozza. L'unica eccezione autorizzata è la protezione di main.

**Nota su #6 (da leggere):** al tuo messaggio "ok passo 3, merge della PR #6" ho unito la #6 (merge `9fdc75e`, v2.5.1: promemoria + avviso "vecchia icona") e l'ho verificata in produzione:
- banner di aggiornamento → una sola ricarica, SW 2.5.1, cache 2.4.1 rimossa;
- Proprietario, 5 veicoli, menu Promemoria presente, 0 errori in console;
- `?from=v1` mostra l'avviso e il parametro sparisce dall'URL.

Il messaggio successivo ("correggi la ✗ prima del merge della #6") è arrivato **dopo** il merge. La ✗ non riguardava l'app (vedi punto 1), ma va detto: la #6 è entrata con il main ancora rosso per quel motivo.

| # | Punto | Esito |
|---|---|---|
| 1 | **CI rossa su main** | **Causa:** sui *push* su main lo step "Aggiornamento dalla versione in produzione" lanciava `upgrade.e2e.mjs origin/main`. Dopo il merge `origin/main` = HEAD, quindi la versione non cambia, il banner non compare e il test fallisce. Era sbagliato il test, non l'app: è successo su #4, #5 e #6; sulle PR era sempre verde. **Correzione** in **#7** (bozza, CI verde): base = `origin/<base>` nelle PR, `HEAD^1` (main prima del merge) nei push; provato in locale 2.4.1 → 2.5.1. Nella #7 c'è anche la correzione di un test instabile mio (`legacy-banner.e2e`: il ping `apis.google.com/js/gen_204` di Google, bloccato dalla CSP, a volte faceva fallire la CI) |
| — | **Protezione di main** | ✅ applicata (comando e output sotto) |
| 2 | **Avviso "vecchia icona"** | ✅ già in produzione con la v2.5.1 (e2e in CI). La parte della v1 (`?from=v1`) è nella PR in bozza **lucsor/garageOS#2**, verificata con il vecchio SW v1 in cache: v2 in ~2,4 s, avviso visibile, parametro tolto, SW e cache v1 rimossi, cache v2 intatta. Funziona anche **senza** la #2: la v2 si apre comunque, solo senza avviso |
| 3 | **F2 scadenze personalizzate** | ✅ **#10** (bozza, CI verde), v2.5.3. Dettagli in §2 |
| 4 | **Rifornimenti e spese annue** | ✅ **#8** (bozza, CI verde), v2.6.0, fatta da un agente in un clone separato; ho ricontrollato io CI e regole |
| 5 | **Qualità (Lighthouse)** | ✅ `docs/QUALITA.md` + quick win in **#9** (bozza, CI verde), v2.5.2, fatta da un agente; ho ricontrollato io la CI e il confronto visivo |
| 6 | **Migrazione km/importi (dry-run)** | ✅ su una **copia** del backup `firestore-20261107-1205.json` nell'emulatore: **66 documenti, 159 campi** (104 convertibili + 55 vuoti → null), **0 ambigui** |

### Protezione di main: comando ed esito
```sh
gh api -X PUT repos/lucsor/garageos-v2/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": [
    "CSP e versione del service worker",
    "Regole Firestore (emulatore)",
    "E2E (CSP, PWA/offline) su emulatori" ] },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```
Esito (exit 0, estratto della risposta):
```
required_status_checks: strict=true, contexts=["CSP e versione del service worker","Regole Firestore (emulatore)","E2E (CSP, PWA/offline) su emulatori"]
enforce_admins.enabled=true · allow_force_pushes.enabled=false · allow_deletions.enabled=false
required_pull_request_reviews: (assente) · restrictions: (assente)
```

Cosa comporta:
- **CI verde obbligatoria anche per te** (`enforce_admins`), e il branch deve essere aggiornato con main (`strict`).
- Niente force push né cancellazione di main.
- Nessuna review obbligatoria: su un repo personale non potresti approvare le tue PR.
- **"Solo tu fai merge":** il repo è personale e l'unico collaboratore è `lucsor` (admin), senza inviti in sospeso. Le restrizioni "chi può fare push" esistono solo per i repo di organizzazione.
- In emergenza: Settings → Branches → modifica la regola.
- Il primo tentativo era stato bloccato dai permessi di Claude Code; è riuscito dopo la tua autorizzazione esplicita.

### Migrazione: dettaglio del dry-run
| campo | convertibile | vuoto→null | ambiguo |
|---|---|---|---|
| mechs.cost | 14 | 38 | 0 |
| mechs.km | 45 | 7 | 0 |
| tires.km | 4 | 0 | 0 |
| tires.kmNext | 4 | 0 | 0 |
| vehicles.assicurazioneCost | 8 | 1 | 0 |
| vehicles.bolloCost | 7 | 2 | 0 |
| vehicles.km | 6 | 4 | 0 |
| vehicles.revisioneCost | 7 | 2 | 0 |
| vehicles.year | 9 | 1 | 0 |

- Il backup originale è intatto: ho lavorato su una copia con lo stesso sha256.
- Per provare l'idempotenza ho applicato la migrazione **solo all'emulatore**: un secondo dry-run dà 0 documenti. Poi ho svuotato l'emulatore.
- **Limite:** il backup è di stamattina (12:05). Prima di eseguirla in produzione servono un nuovo export e un nuovo dry-run.
- **Prerequisito invariato:** prima il client deve leggere e scrivere numeri (task D3 di `PIANO.md`).

---

## 2. PR in bozza da rivedere

| PR | Contenuto | Versione | CI | Note per la revisione |
|---|---|---|---|---|
| **#7** `fix/ci-upgrade-base` | correzione della CI di main + test instabile | — (solo test/CI) | ✅ | **da unire per prima** |
| **#9** `fix/qualita-quick-wins` | accessibilità: contrasti AA, etichette, aree di tocco 44 px; `docs/QUALITA.md` | 2.5.2 | ✅ | **Cambia l'aspetto**: verde di pulsanti, importi e FAB più scuro, grigi un tono più scuri (confronto in `docs/QUALITA.md`). Lighthouse accessibilità 90 → 100 (mobile), 89 → 100 (desktop) |
| **#10** `feat/f2-custom-deadlines` | scadenze personalizzate in lista, hero, avvisi, notifiche locali, .ics e promemoria push | 2.5.3 | ✅ | **Regole da pubblicare PRIMA.** Provato con le regole attuali: l'app funziona, il salvataggio dice "regole non aggiornate". ⚠️ Per un mio errore con `--amend`, il commit `713faff` "Merge main" contiene anche il codice; non ho riscritto la storia (il force push è stato bloccato): rivedi il diff della PR |
| **#8** `feat/v2.6-rifornimenti` | rifornimenti (⛽ dalla scheda veicolo), consumi solo tra pieni, scheda "Spese" con grafico per anno e veicolo, 2 CSV | 2.6.0 | ✅ | **Regole da pubblicare PRIMA.** Progetto in `docs/v2.6.md` |
| **garageOS#2** `feat/from-v1-param` | redirect della v1 con `?from=v1` | v1 | — | da unire quando vuoi: la v2.5.1 è già pronta |

**Ordine di merge consigliato:** #7 → #9 → (regole F2 + rifornimenti in **un solo deploy**) → #10 → #8 → garageOS#2.
- #8 e #10 andranno in conflitto su `firestore.rules`, `rules.test.mjs`, `sw.js` (VERSION), `CHANGELOG.md`, `ci.yml` e `app.js`. I conflitti sono semplici (si tengono entrambi i blocchi). Li risolvo io su un branch, dopo il tuo ok, con la regressione completa.
- I numeri di versione si riallineano al merge.

---

## 3. Decisioni che mi servono (in ordine di priorità)

1. **Ordine di merge** come in §2? E l'ok a un **deploy unico delle regole** (`deadlines` + `refuels`) prima di #10 e #8, con backup e procedura della v2.5?
2. **#9, nuovi colori:** ok al verde più scuro e ai grigi più scuri (contrasto AA)? Alternativa: tenere `#21b57e` per i pulsanti grandi e scurire solo i testi piccoli.
3. **Spese annue (#8), cosa conta come "pagato":** oggi solo gli interventi bollo/revisione (creati da "✅ Rinnovata" o a mano). I costi previsti del veicolo non si sommano.
   - (a) Aggiungere "✅ Pagata" all'assicurazione?
   - (b) Il "✅ Fatto" delle scadenze personalizzate deve registrare un pagamento?
4. **Scheda "Spese"** come quinta voce in basso (#8), oppure rifornimenti dentro Officina?
5. **Km del veicolo dai rifornimenti:** l'ultimo rifornimento deve aggiornare da solo i "km attuali"? Oggi no.
6. **Bug preesistente:** `openModal` mette la data di oggi in ogni campo data vuoto. Un veicolo nuovo senza revisione o assicurazione riceve quindi la data di oggi e risulta "in scadenza oggi". Lo correggo (le date restano vuote)? Nella finestra di F2 l'ho già evitato.
7. **Quick win P1 di `QUALITA.md`:** `@keyframes fadeIn` parte da `opacity: 0`, quindi Lighthouse non registra il primo disegno (NO_FCP). Una riga, invisibile: ok?
8. `docs/f2-wip/` (bozze ormai integrate): posso eliminarla?

---

## 4. Problemi incontrati (onestamente)
- **#6 unita prima del tuo "correggilo prima del merge"** (vedi §1).
- **Commit di F2 mal suddiviso** (`713faff`): il contenuto è giusto, la storia no. Riscriverla richiederebbe un force push sul branch di lavoro, che i permessi di Claude Code hanno bloccato e che non ho aggirato.
- **Agenti in worktree non disponibili** (la cartella del repo appartiene ad Administrators): gli agenti hanno lavorato in cloni separati nella scratchpad. Due worktree vuoti creati dal tentativo fallito li ho rimossi.
- **La CI di main resta rossa** sui merge finché non entra la #7. L'ultimo run rosso è quello di `9fdc75e`, per la stessa causa.
- **Il backup per la migrazione è di stamattina:** serve un export fresco prima di qualsiasi esecuzione reale.

---

## 5. Cosa provare dal telefono

**Subito (v2.5.1 già online):**
1. **Promemoria, passo 4:** menu → 🔔 Promemoria → "Attiva su questo dispositivo" → accetta il permesso; lascia i giorni 30/7/1 e "con dettagli". Su iPhone serve prima l'app sulla Home (iOS 16.4+). Dimmi se compare "attivo su questo dispositivo".
   - Il cron di domattina (06:17 UTC) girerà in **dry-run**: manca `REMINDERS_ALLOW_LIVE`, quindi nessuna notifica partirà.
2. **Avviso "vecchia icona"** (prima del merge di garageOS#2): apri in Chrome `https://lucsor.github.io/garageos-v2/?from=v1`.
   - L'avviso compare e il parametro sparisce dall'indirizzo.
   - "Installa" apre il prompt o mostra le istruzioni.
   - "Ho capito" lo chiude per sempre su quel telefono.
   - Nell'app installata dalla Home non deve comparire.
3. **Vecchia icona v1** (dopo il merge di garageOS#2): toccala online → la v2 si apre con l'avviso.

**Dopo i merge (per ogni PR):**
- **#9:** colori leggibili alla luce del sole, pulsanti ✏️ 🗑️ facili da toccare; con TalkBack o VoiceOver i pulsanti a icona vengono letti ("Elimina AB123CD").
- **#10 (dopo le regole):**
  - Scadenze → **+** → "Permesso ZTL", veicolo, "Ogni anno", importo "80,50" → compare in lista e nel contatore.
  - 📅 → Google Calendar o file .ics.
  - "✅ Fatto" → la data avanza di un anno.
  - Una scadenza di "Tutto il garage".
  - Un membro della famiglia la vede.
- **#8 (dopo le regole):**
  - ⛽ dalla scheda veicolo: "38,5" litri e "62,40" €, Pieno.
  - Poi un parziale e un altro pieno: compaiono km/l ed €/km.
  - "1.500,5" va respinto.
  - Km in calo → chiede conferma.
  - Scheda Spese: grafico, anno, filtro, i due CSV aperti in Excel o Numbers come numeri.
  - Offline → "Salvato sul dispositivo".

---

## 6. Le prossime 3 idee (miglior rapporto valore/impegno, da `IDEE.md`)
Già fatti o in PR: .ics, promemoria push, scadenze personalizzate, rifornimenti e spese annue, accessibilità di base.

| # | Idea | Valore | Impegno | Perché adesso |
|---|---|---|---|---|
| 1 | **"Chi se ne occupa"**: scadenza assegnata a un membro, promemoria push solo a lui | ★★ | **S** | Si appoggia a F2 e ai promemoria appena fatti: un campo `assignee` (uid ∈ `memberUids`, validato nelle regole) e un filtro nello script di invio. Toglie le notifiche "di tutti a tutti" in famiglia |
| 2 | **Backup automatico settimanale** con GitHub Actions | ★★ | **S** | Su Spark non c'è l'export gestito e oggi i backup sono manuali. Si riusa la federazione senza chiavi dei promemoria (sola lettura) e si cifra l'output (age) come artifact privato. Serve una chiave di cifratura che tieni tu |
| 3 | **Più garage per utente** (il proprio più quelli condivisi, con selettore) | ★★★ | M | Risolve un limite reale: chi accetta un invito perde la vista sul proprio garage. Era già la tua scelta per la v2.5 "per ultimo"; ora che le funzioni base ci sono, è il prossimo passo di valore |

Alternative a basso impegno, se preferisci: dark mode (S) ed export JSON del garage (S).

---

## 7. Come rilanciare i test
Prerequisiti: Java 21, `npm ci` in `tests/rules`, `tests/e2e`, `tools/admin`; emulatori `auth,firestore --project garageos-879bc`; app su `http://127.0.0.1:5173` (`python -m http.server 5173 --bind 127.0.0.1`).
```sh
node --test tests/unit/*.test.mjs
cd tests/rules && npm test                    # oppure, con emulatori già avviati: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node --test rules.test.mjs
cd tests/e2e && node csp.e2e.mjs && node calendar.e2e.mjs && node legacy-banner.e2e.mjs && node push.e2e.mjs \
  && node pwa.e2e.mjs && node reminders.emu.mjs && node upgrade.e2e.mjs origin/main
node tests/e2e/v1-redirect.e2e.mjs <clone di lucsor/garageOS> [ref della v1] [no-param]   # manuale
```
