#!/usr/bin/env python3
# bridge_audit.py — cruza los métodos @JavascriptInterface de MainActivity.java
# contra los nombres que invoca el JS (todas las rutas: BR.x, bridge('x'),
# rawBridge('x'), B.x, KiuBridge.x) y los eventos Java→JS (evaluateJavascript).
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
JAVA = ROOT / 'app/src/main/java/com/kiu/agent/MainActivity.java'
WWW = ROOT / 'app/src/main/assets/www/js'
JS_FILES = ['brain.js', 'react.js', 'skills.js', 'tools.js', 'kiu-secure.js',
            'kiu-migrate.js', 'kiu-avatar-boot.js', 'rag.js', 'i18n.js',
            'app/env.js', 'app/state.js', 'app/models.js', 'app/motor.js', 'app/app-ui.js']

java = JAVA.read_text(encoding='utf-8')
# métodos del Bridge: "@JavascriptInterface\n public TIPO nombre("
jmethods = set(re.findall(r'@JavascriptInterface\s+public\s+[\w\[\]<>.]+\s+(\w+)\s*\(', java))

called = set()
for f in JS_FILES:
    src = (WWW / f).read_text(encoding='utf-8')
    called |= set(re.findall(r'\bBR\.(\w+)\s*\(', src))
    called |= set(re.findall(r"\bbridge\('(\w+)'", src))
    called |= set(re.findall(r"\brawBridge\('(\w+)'", src))
    called |= set(re.findall(r'\bKiuBridge\.(\w+)\s*\(', src))
    called |= set(re.findall(r'\bB\.(\w+)\s*\(', src))

missing = sorted(called - jmethods)
print(f'Java @JavascriptInterface: {len(jmethods)} métodos')
print(f'JS invoca (aprox): {len(called)} nombres distintos')
print('\n== JS llama y NO existe en Java ==')
for m in missing: print('  -', m)
if not missing: print('  (ninguno: contrato OK)')

# eventos Java → JS (evaluateJavascript / KiuJsPost)
# Ojo: hasta v2.8.0 el patrón solo miraba `window.nexoX(` (KiuJsPost) y
# `window.X(', `, así que los eventos que MainActivity manda con `js("nexoX(...)")`
# —que son la mayoría— no se auditaban nunca. Con un hook nuevo (nexoWakeError)
# eso ya es un agujero: un Java→JS sin handler pasa desapercibido.
print('\n== Eventos Java → JS (window.*) ==')
evs = (set(re.findall(r"window\.(\w+)\s*\(', ", java))
       | set(re.findall(r"window\.(\w+)\(", java))
       | set(re.findall(r'js\(\s*"(nexo\w+|kiu\w+)\(', java))
       | set(re.findall(r'js\("([^"]*?)\(", ', java)))
evs = sorted(e for e in evs if re.match(r'^[A-Za-z_]\w*$', e))
for e in evs: print('  -', e)

# eventos que el JS escucha
print('\n== Handlers JS (window.<nombre> =) ==')
handled = set()
for f in JS_FILES:
    src = (WWW / f).read_text(encoding='utf-8')
    handled |= set(re.findall(r'window\.(\w+)\s*=\s*function', src))
    handled |= set(re.findall(r'window\.(\w+)\s*=\s*\(', src))
print(' ', ', '.join(sorted(handled)))

# un evento que Java manda y el JS no escucha = la app se queda muda
print('\n== Java manda un evento y el JS NO lo escucha ==')
sin = sorted(e for e in evs if e not in handled)
for m in sin: print('  !', m)
if not sin: print('  (ninguno: todo evento Java→JS tiene handler)')

# no-JavascriptInterface públicos en Java que el JS invocaría por error
print('\n== Nombres JS parecidos a métodos Java pero SIN anotación ==')
allpub = set(re.findall(r'public\s+[\w\[\]<>.]+\s+(\w+)\s*\(', java))
suspect = sorted((called & allpub) - jmethods)
for m in suspect: print('  !', m)
if not suspect: print('  (ninguno)')
