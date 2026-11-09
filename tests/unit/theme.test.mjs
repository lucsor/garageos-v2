// Tema chiaro / scuro (v2.7.1): token, blocchi del tema scuro, theme-color e contrasto WCAG AA calcolato sui token.
// Uso: node --test tests/unit/theme.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const css = read('css/app.css');
const html = read('index.html');
const initJs = read('js/theme-init.js');
const appJs = read('js/app.js');

// ── parsing dei token ──
const rootBlock = css.match(/\n:root \{([\s\S]*?)\n\}/)[1];
const darkBlocks = [...css.matchAll(/\/\*DARK-START\*\/([\s\S]*?)\/\*DARK-END\*\//g)].map((m) => m[1].replace(/^\s+/gm, '').trim());
const decls = (block) => Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const LIGHT = decls(rootBlock);
const DARK = { ...LIGHT, ...decls(darkBlocks[0] || '') };
const resolve = (T, v, depth = 0) => {
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  return m && depth < 5 ? resolve(T, T[m[1]], depth + 1) : v;
};

// ── colori e contrasto (WCAG 2.x) ──
function parse(c) {
  c = c.trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  m = /^rgba?\(([^)]+)\)$/.exec(c);
  if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
  throw new Error('colore non riconosciuto: ' + c);
}
const over = (fg, bg) => { const a = fg[3]; return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1); };
const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// colore di un token, con i fondi semitrasparenti composti sopra `base`
const col = (T, name, base) => {
  const c = parse(resolve(T, T[name]));
  return c[3] < 1 ? over(c, base ? col(T, base) : [255, 255, 255, 1]) : c;
};

test('i due blocchi del tema scuro sono identici e completi', () => {
  assert.equal(darkBlocks.length, 2, 'servono il blocco "Auto" (prefers-color-scheme) e quello esplicito [data-theme="dark"]');
  assert.equal(darkBlocks[0], darkBlocks[1]);
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{/);
  assert.match(css, /:root\[data-theme="dark"\] \{/);
  for (const k of Object.keys(decls(darkBlocks[0]))) assert.ok(k in LIGHT, `${k} del tema scuro non esiste nel tema chiaro`);
  assert.match(rootBlock, /color-scheme: light;/);
  assert.match(darkBlocks[0], /color-scheme: dark;/);
});

test('nessun colore scritto a mano fuori dai token (CSS, stili inline di index.html e app.js)', () => {
  const rest = css.replace(/\n:root \{[\s\S]*?\n\}/, '')
    .replace(/@media \(prefers-color-scheme: dark\) \{[\s\S]*?\n\}\n/, '')
    .replace(/:root\[data-theme="dark"\] \{[\s\S]*?\n\}/, '')
    .replace(/@layer fonts[^\n]*/, '');
  const bad = rest.split('\n').filter((l) => /:\s*[^;{]*(#[0-9a-fA-F]{3,8}\b|rgba?\()/.test(l));
  assert.deepEqual(bad, []);
  const inline = [...html.matchAll(/style="([^"]*)"/g), ...appJs.matchAll(/style="([^"]*)"/g)].map((m) => m[1])
    .filter((s) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(s));
  assert.deepEqual(inline, []);
  assert.doesNotMatch(appJs, /style\.(color|background)\s*=.*'#[0-9a-f]/i);
});

test('ogni var(--x) usata è definita', () => {
  const used = new Set([...(css + html + appJs).matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((v) => !(v in LIGHT));
  assert.deepEqual(missing, []);
});

test('theme-color: meta di index.html e js/theme-init.js = --grad-top dei due temi', () => {
  const tc = JSON.parse(initJs.match(/THEME_COLOR = (\{[^}]+\})/)[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"'));
  assert.equal(tc.light, LIGHT['--grad-top']);
  assert.equal(tc.dark, DARK['--grad-top']);
  assert.match(html, new RegExp(`<meta name="theme-color" content="${LIGHT['--grad-top']}">`));
  // theme-init.js caricato in <head>, prima del CSS, come script classico (non modulo, non defer)
  const head = html.slice(0, html.indexOf('</head>'));
  const iScript = head.indexOf('<script src="js/theme-init.js"></script>');
  assert.ok(iScript > 0 && iScript < head.indexOf('css/app.css'), 'theme-init.js prima del CSS');
  assert.ok(iScript > head.indexOf('name="theme-color"'), 'theme-init.js dopo il meta theme-color');
});

// coppie testo / fondo realmente usate nell'interfaccia: [testo, fondo, base del fondo se semitrasparente, soglia]
const PAIRS = [
  ['--ink', '--card'], ['--ink', '--page'], ['--ink', '--field'], ['--ink', '--surface-1'],
  ['--ink-2', '--card'], ['--ink-2', '--page'], ['--ink-2', '--field'], ['--ink-2', '--seg-bg'],
  ['--green-ink', '--card'], ['--green-ink', '--page'], ['--green-ink', '--green-soft', '--card'],
  ['--yellow-ink', '--card'], ['--yellow-ink', '--yellow-soft', '--card'], ['--yellow-ink', '--yellow-soft', '--page'],
  ['--red', '--card'], ['--red', '--page'], ['--red', '--red-soft', '--card'],
  ['--blue', '--card'], ['--blue', '--blue-soft', '--card'], ['--blue', '--blue-soft', '--page'],
  ['--on-accent', '--green-strong'], ['--on-accent', '--green-hover'], ['--on-accent', '--red-strong'],
  ['--on-accent', '--plate-bg'], ['--on-accent', '--navy'], ['--on-yellow', '--yellow'],
  ['--nav-ink', '--navy'], ['--mint', '--navy'], ['--mint-yellow', '--navy'], ['--mint-red', '--navy'],
  ['--on-grad', '--grad-top'], ['--on-grad-2', '--grad-top'], ['--on-grad-3', '--grad-top'], ['--mint', '--grad-top'],
  ['--chip-red-ink', '--chip-red-bg', '--grad-top'], ['--chip-yellow-ink', '--chip-yellow-bg', '--grad-top'],
];
for (const [theme, T] of [['chiaro', LIGHT], ['scuro', DARK]]) {
  test(`contrasto AA (≥ 4.5:1) delle coppie di token — tema ${theme}`, () => {
    const fails = [];
    for (const [fg, bg, base, min = 4.5] of PAIRS) {
      const b = col(T, bg, base);
      const r = ratio(col(T, fg, bg), b);
      if (r < min) fails.push(`${fg} su ${bg}${base ? ` (sopra ${base})` : ''}: ${r.toFixed(2)}:1`);
    }
    assert.deepEqual(fails, []);
  });
}
