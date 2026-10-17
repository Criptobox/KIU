/* v2.10.1 — comandos dictados por voz. El reconocedor entrega frases completas con
 * cortesias («ok kiu, ¿podés ponerme una alarma, por favor?») y los comandos
 * estaban anclados con ^ a la forma seca. node --test tests/*.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.join(here, '..', 'app', 'src', 'main', 'assets', 'www');
const brainSrc = readFileSync(path.join(WWW, 'js', 'brain.js'), 'utf8');

function load() {
  const calls = [];
  /* window === global, como en el WebView: el cerebro nombra KiuApp a secas */
  const win = {};
  win.window = win;
  win.crypto = globalThis.crypto;
  win.KiuApp = {
    bridgeCall(fn, args) { calls.push([fn, args]); return true; },
    contactSearch() { return []; },
    reminders() { return []; },
    getName() { return ''; },
    setName() { },
    addReminder() { return { id: 'x' }; },
    sysCache: { bat: 80 },
  };
  vm.createContext(win);
  vm.runInContext(brainSrc, win, { filename: 'brain.js' });
  return { b: win.KiuBrain, calls };
}

test('voz: las cortesías delante y detrás no rompen el comando', () => {
  const { b } = load();
  for (const f of [
    'ok kiu qué hora es',
    'por favor qué hora es',
    'kiu, ¿podés decirme qué hora es?',
    'qué hora es por favor',
  ]) {
    const r = b.reply(f);
    assert.ok(r.handled, `"${f}" debería resolverse en local`);
  }
});

test('voz: linterna con «pon», «ponme» y voseo', () => {
  for (const f of ['pon la linterna', 'ponme la linterna', 'poné la linterna', 'ok kiu prendé la linterna']) {
    const { b, calls } = load();
    const r = b.reply(f);
    assert.ok(r.handled, `"${f}" no se resolvió`);
    assert.ok(calls.some((c) => c[0] === 'torch' && c[1][0] === true), `"${f}" no encendió la linterna`);
  }
});

test('voz: alarma dicha de varias formas llega al mismo handler', () => {
  for (const f of [
    'ponme una alarma a las 7',
    'quiero una alarma para las 7 de la mañana',
    'despiértame a las 7',
    'crea una alarma a las 7',
    'kiu por favor pon una alarma a las 7',
  ]) {
    const { b, calls } = load();
    const r = b.reply(f);
    assert.ok(r.handled, `"${f}" no se resolvió`);
    assert.ok(calls.some((c) => c[0] === 'setAlarmDevice' || c[0] === 'setReminder'),
      `"${f}" no programó ninguna alarma`);
  }
});

test('voz: batería dicha de varias formas', () => {
  for (const f of ['cuál es la batería', 'batería', 'cuánta batería me queda', 'ok kiu cuál es la batería por favor']) {
    const { b } = load();
    const r = b.reply(f);
    assert.ok(r.handled && /80/.test(r.text), `"${f}" no devolvió la batería: ${r.text}`);
  }
});

test('voz: volumen y brillo abren el ajuste en vez de fingir', () => {
  for (const [f, key] of [['sube el volumen', 'volumen'], ['bajale el brillo', 'brillo'], ['súbele el volumen', 'volumen']]) {
    const { b, calls } = load();
    const r = b.reply(f);
    assert.ok(r.handled, `"${f}" no se resolvió`);
    assert.ok(calls.some((c) => c[0] === 'openSettings' && c[1][0] === key), `"${f}" no abrió ${key}`);
    assert.ok(/no puedo mover/i.test(r.text), 'debe ser honesto: no puede mover el volumen solo');
  }
});

test('voz: «Kiu» solo sigue contestando «acá estoy»', () => {
  const { b } = load();
  const r = b.reply('kiu');
  assert.ok(r.handled && /Acá estoy/.test(r.text));
});

/* ---- Java: se verifica la estructura de los arreglos (no hay SDK para compilar) ---- */
const javaDir = path.join(here, '..', 'app', 'src', 'main', 'java', 'com', 'kiu', 'agent');
const main = readFileSync(path.join(javaDir, 'MainActivity.java'), 'utf8');
const svc = readFileSync(path.join(javaDir, 'KiuService.java'), 'utf8');

test('java: speak() ya no descarta la frase si el TTS no está listo', () => {
  const m = main.match(/public void speak\(String str\) \{([\s\S]*?)\n        \}/);
  assert.ok(m, 'no se encontró Bridge.speak');
  assert.match(m[1], /queueSpeak\(str\)/);
  assert.doesNotMatch(m[1], /!MainActivity\.this\.ttsReady \|\| TextUtils\.isEmpty/);
  assert.match(main, /flushPendingSpeak\(\);/, 'al estar listo el TTS se dice lo pendiente');
});

test('java: si el TTS se rinde, la conversación igual se rearma', () => {
  assert.match(main, /ttsGaveUp = true/);
  assert.match(main, /private void queueSpeak[\s\S]*ttsGaveUp[\s\S]*postDelayed\(this\.convOpen, 700L\)/);
});

test('java: el reconocedor del comando tiene perro guardián', () => {
  assert.match(main, /armMicWatch\(createSpeechRecognizer\)/);
  assert.match(main, /MIC_WATCHDOG_MS/);
  assert.match(main, /public void stopSpeech\(\) \{\s*if \(this\.micWatch != null\)/);
});

test('java: openConvMic pide permiso de micrófono en vez de reintentar a ciegas', () => {
  const m = main.match(/public void openConvMic\(\) \{([\s\S]*?)\n    \}/);
  assert.ok(m);
  assert.match(m[1], /RECORD_AUDIO/);
  assert.match(m[1], /micAskedOnce/);
});

test('java: la palabra de activación acepta las variantes que dicta Google', () => {
  const m = svc.match(/Pattern WAKE = Pattern\.compile\("(.*)"\);/);
  assert.ok(m);
  const re = new RegExp(m[1].replace(/\\\\/g, '\\'));
  for (const w of ['kiu', 'kyu', 'kio', 'quiu', 'qiu', 'chiu', 'kiwi']) {
    assert.ok(re.test(w), `"${w}" debería despertar a Kiu`);
  }
  assert.ok(!re.test('kilo'), '"kilo" no debe despertar a Kiu');
});

test('voz: «pon música» abre el reproductor', () => {
  const { b, calls } = load();
  const r = b.reply('pon música');
  assert.ok(r.handled);
  assert.ok(calls.some((c) => c[0] === 'openApp' && c[1][0] === 'musica'));
});

test('java: listen() refresca el latido de conversación', () => {
  const m = main.match(/public void listen\(\) \{([\s\S]*?)\n        \}/);
  assert.ok(m);
  assert.match(m[1], /lastConvBeat = SystemClock\.elapsedRealtime\(\)/);
});

/* ---- v2.10.1: Modelos con pestañas (Teléfono / Nube / Mi red) ---- */
const html = readFileSync(path.join(WWW, 'index.html'), 'utf8');
const ui = readFileSync(path.join(WWW, 'js', 'app', 'app-ui.js'), 'utf8');

function seccion(id) {
  const i = html.indexOf(`<section id="${id}"`);
  return html.slice(i, html.indexOf('</section>', i));
}

test('modelos: tres pestañas y cada pieza en su panel', () => {
  const m = seccion('screen-models');
  for (const t of ['tel', 'nube', 'red']) {
    assert.match(m, new RegExp(`data-mt="${t}"`));
    assert.match(m, new RegExp(`id="mpane-${t}"`));
  }
  const pane = (t) => { const i = m.indexOf(`id="mpane-${t}"`); return m.slice(i); };
  assert.ok(pane('tel').indexOf('id="mdl-list"') < pane('tel').indexOf('id="mpane-nube"'), 'descargas en Teléfono');
  assert.ok(pane('nube').indexOf('id="prov-list"') < pane('nube').indexOf('id="mpane-red"'), 'proveedores en Nube');
  assert.ok(pane('red').indexOf('id="local-block"') > 0, 'servidor en Mi red');
});

test('modelos: el modo y el orquestador quedan arriba de las pestañas', () => {
  const m = seccion('screen-models');
  assert.ok(m.indexOf('id="mode-seg"') < m.indexOf('id="mtabs"'));
  assert.ok(m.indexOf('id="orch-rows"') < m.indexOf('id="mtabs"'));
});

test('proveedores ya no es pantalla: go("api") cae en la pestaña Nube', () => {
  assert.equal(html.includes('id="screen-api"'), false);
  assert.match(ui, /if \(name === 'api'\) \{ name = 'models'; this\._mtab = 'nube'; \}/);
});

test('ajustes: Respuestas y Diagnóstico viven en Ajustes, no en Modelos', () => {
  const s = seccion('screen-settings');
  for (const id of ['gen-temp', 'gen-len', 'btn-diag', 'btn-diag-voz', 'diag-voz-box']) {
    assert.ok(s.includes(`id="${id}"`), `${id} debe estar en Ajustes`);
  }
});

test('no hay IDs duplicados en index.html', () => {
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((x) => x[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  assert.deepEqual(dup, []);
});
