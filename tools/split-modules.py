"""v2.4: index.html (script inline + style) → css/app.css + js/app.js + moduli puri. Uso: python tools/split-modules.py <repo>
Da rieseguire su un index.html monolitico aggiornato (es. dopo il merge della v2.3.1), invece di risolvere conflitti a mano."""
import sys, re, os
repo = sys.argv[1]
p = os.path.join(repo, 'index.html')
html = open(p, encoding='utf8').read()

# ── 1) CSS
m = re.search(r'<style>\n(.*?)</style>\n', html, re.S)
css = m.group(1)
css = '\n'.join(l[2:] if l.startswith('  ') else l for l in css.split('\n'))   # de-indenta
html = html.replace(m.group(0), '<link rel="stylesheet" href="css/app.css">\n')

# ── 2) script inline → js/app.js
m = re.search(r'<script type="module">\n(.*?)</script>\n', html, re.S)
js = m.group(1)
html = html.replace(m.group(0), '<script type="module" src="js/app.js"></script>\n')

def cut(src, start, end_marker, include_end=True):
    a = src.index(start)
    b = src.index(end_marker, a) + (len(end_marker) if include_end else 0)
    return src[:a] + src[b:], src[a:b]

# ── 3) moduli puri
js, esc_src = cut(js, "const esc = s => String(s ?? '')", "}[c]));\n")
js, utils_src = cut(js, "function daysUntil(dateStr) {", "  return d.toISOString().split('T')[0];\n}\n")
js, csv_src = cut(js, "// Excel/LibreOffice interpretano", "  URL.revokeObjectURL(a.href);\n}\n")
js, cost_src = cut(js, "// ===== COSTI DEGLI INTERVENTI MULTI-TIPO =====", "  return info;\n}\n")
js, safe_src = cut(js, "// Solo immagini https (foto profilo Google)", "? url : ''; }\n")

def export_all(src):
    src = re.sub(r'^function ', 'export function ', src, flags=re.M)
    src = re.sub(r'^const ', 'export const ', src, flags=re.M)
    return src

os.makedirs(os.path.join(repo, 'js'), exist_ok=True)
os.makedirs(os.path.join(repo, 'css'), exist_ok=True)
open(os.path.join(repo, 'js', 'utils.js'), 'w', encoding='utf8', newline='\n').write(
    "// Funzioni pure di formattazione e sicurezza (nessuna dipendenza da DOM o Firebase): testabili in Node.\n\n"
    "// ===== SECURITY: HTML ESCAPING =====\n" + export_all(esc_src) + "\n" + export_all(safe_src) + "\n" + export_all(utils_src))
open(os.path.join(repo, 'js', 'csv.js'), 'w', encoding='utf8', newline='\n').write(
    "// Export CSV (con protezione dalla formula injection).\n\n" + export_all(csv_src))
open(os.path.join(repo, 'js', 'costs.js'), 'w', encoding='utf8', newline='\n').write(
    export_all(cost_src))
open(os.path.join(repo, 'css', 'app.css'), 'w', encoding='utf8', newline='\n').write(css)

imports = ("import { esc, safeImg, daysUntil, badgeClass, TYPE_EMOJI, MECH_TYPES, getMechType, formatDate, formatCurrency, addYears } from './utils.js';\n"
           "import { csvSafe, downloadCSV } from './csv.js';\n"
           "import { mechCostInfo } from './costs.js';\n")
# gli import firebase restano in cima; i nostri subito dopo
first_nonimport = js.index('\n// ===== FIREBASE CONFIG =====')
js = js[:first_nonimport] + '\n' + imports + js[first_nonimport:]
js = "// GarageOS — applicazione (modulo ES caricato da index.html, nessun build step)\n" + js
open(os.path.join(repo, 'js', 'app.js'), 'w', encoding='utf8', newline='\n').write(js)

# ── 4) CSP: niente script inline → niente hash, script-src 'self'
html = re.sub(r"<!-- CSP: niente 'unsafe-inline' per gli script\..*?-->\n",
              "<!-- CSP: nessuno script inline (tutto in js/*.js): script-src 'self', niente hash da mantenere. -->\n", html, flags=re.S)
html = re.sub(r"script-src 'sha256-[^']+' ", "script-src 'self' ", html)
open(p, 'w', encoding='utf8', newline='\n').write(html)
print('index.html', len(html.splitlines()), 'righe · app.js', len(js.splitlines()), '· app.css', len(css.splitlines()))
