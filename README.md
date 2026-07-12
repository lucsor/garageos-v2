# GarageOS v2

PWA per gestire il parco macchine in famiglia: veicoli, scadenze (bollo,
revisione, assicurazione), cambi gomme, interventi meccanici e garage
condiviso con inviti.

**Novità v2**
- Nuova interfaccia mobile-first (tema teal, gauge scadenze, bottom nav)
- Modello dati sicuro: niente più lettura globale dei garage (`users/{uid}` + `memberUids`)
- Escaping HTML di tutti i dati utente (fix XSS)
- Service worker con path relativi e cache più robusta

**Stack:** HTML/CSS/JS in un solo file · Firebase Auth (Google) · Firestore realtime · PWA

**Deploy:** GitHub Pages (Settings → Pages → Deploy from branch → main / root).
Ricorda di pubblicare le regole Firestore aggiornate nella console Firebase.
