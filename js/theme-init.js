// Tema chiaro / scuro (v2.7.1). Script CLASSICO e SINCRONO caricato in <head> prima del CSS: imposta data-theme
// su <html> prima del primo disegno, così non c'è il lampo del tema sbagliato. È un file esterno perché la CSP
// non ammette script inline (script-src 'self').
// Preferenza: localStorage 'garageos_theme' = 'light' | 'dark'; assente = 'auto' (segue il sistema).
// L'app (js/app.js) usa window.GarageTheme per il selettore Auto / Chiaro / Scuro nel menu utente.
(function () {
  var KEY = 'garageos_theme';
  // colore della barra di sistema (meta theme-color) = --grad-top del tema (verificato da tests/unit/theme.test.mjs)
  var THEME_COLOR = { light: '#0c333d', dark: '#071d23' };
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function get() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : 'auto';
    } catch (e) { return 'auto'; }
  }
  function effective(pref) {
    return pref === 'auto' ? (mq && mq.matches ? 'dark' : 'light') : pref;
  }
  function apply(pref) {
    var root = document.documentElement;
    if (pref === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', pref);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLOR[effective(pref)]);
  }
  function set(pref) {
    if (pref !== 'light' && pref !== 'dark') pref = 'auto';
    try {
      if (pref === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, pref);
    } catch (e) { /* modalità privata: vale solo per questa pagina */ }
    apply(pref);
    return effective(pref);
  }

  window.GarageTheme = { get: get, set: set, effective: function () { return effective(get()); }, THEME_COLOR: THEME_COLOR };
  apply(get());
  // "Auto": se il sistema cambia tema con l'app aperta, si aggiorna anche la barra di sistema
  if (mq) {
    var onChange = function () { if (get() === 'auto') apply('auto'); };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
  }
})();
