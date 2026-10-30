/* pantallas-v2204.test.mjs — v2.20.4: Chat, Memoria, Biblioteca y Ajustes reordenados (docs/REVISION-UI-2.20.2.md).
 * Se mueve y se pliega: todos los ids que usa el JS siguen existiendo.
 * node --test tests/pantallas-v2204.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const WWW = path.join(process.cwd(), 'app/src/main/assets/www');
const html = readFileSync(path.join(WWW, 'index.html'), 'utf8');
const ui = readFileSync(path.join(WWW, 'js/app/app-ui.js'), 'utf8');
const css = readFileSync(path.join(WWW, 'css/app.css'), 'utf8');
const seccion = (id) => { const i = html.indexOf(`<section id="${id}"`); return html.slice(i, html.indexOf('</section>', i)); };

test('chat: bienvenida corta y sin la barra de acciones de una respuesta', () => {
  const m = ui.match(/bienvenida: true, text: '([^']+)'/);
  assert.ok(m, 'la bienvenida está marcada');
  assert.ok(m[1].length < 220, 'una bienvenida corta, no 3 párrafos: ' + m[1].length + ' caracteres');
  assert.match(ui, /isBot && !m\.bienvenida && !\/\^Hola, soy Kiu, tu agente personal/, 'ni la bienvenida nueva ni la vieja guardada llevan acciones');
});

test('memoria: sin tarjeta repetida ni contadores aparte; cada pestaña lleva su número', () => {
  const m = seccion('screen-memory');
  assert.equal(m.includes('class="mem-hero"'), false);
  assert.equal(m.includes('class="mem-stats"'), false);
  for (const id of ['st-rec', 'st-tar', 'st-not', 'st-ala', 'st-apr']) assert.ok(m.includes(`id="${id}"`), id + ' sigue existiendo (lo escribe refreshMem)');
  const tabs = m.slice(m.indexOf('id="mem-tabs"'), m.indexOf('</div>', m.indexOf('id="mem-tabs"')));
  for (const id of ['st-rec', 'st-tar', 'st-not', 'st-ala']) assert.ok(tabs.includes(`id="${id}"`), id + ' dentro de su pestaña');
  assert.match(m, /seg seg-scroll" id="mem-tabs"/, 'pestañas desplazables: «Gustos» ya no se corta');
  assert.match(css, /\.seg\.seg-scroll \{ overflow-x:auto/);
});

test('memoria: Documentos (RAG) va después de la lista, no partiendo la página', () => {
  const m = seccion('screen-memory');
  assert.ok(m.indexOf('id="rag-card"') > m.indexOf('id="mem-list"'));
  assert.ok(m.indexOf('id="rag-card"') > m.indexOf('id="mem-tabs"'));
});

test('biblioteca: «Cuentas» era de cálculos y «Conectar» abre una app: ya lo dicen', () => {
  const b = seccion('screen-biblio');
  assert.match(b, /data-f="cuentas">Cálculos</);
  assert.match(b, /Atajos a tus apps/);
  assert.match(ui, /font-weight:700">Abrir<\/span><\/button>/);
  assert.equal(/>Conectar<\/span><\/button>/.test(ui.slice(ui.indexOf('renderCx: function'), ui.indexOf('cx_contacts: function'))), false);
});

test('ajustes: diagnóstico y actualizaciones plegados; los dos interruptores a la vista', () => {
  const s = seccion('screen-settings');
  const d0 = s.indexOf('id="adv-mant"'), d1 = s.indexOf('</details>', d0);
  assert.ok(d0 > 0 && /<details class="adv-box" id="adv-mant"/.test(s) && !/id="adv-mant"[^>]*\sopen/.test(s), 'plegado por defecto');
  const dentro = s.slice(d0, d1);
  for (const id of ['btn-diag', 'btn-diag-voz', 'btn-asist-voz', 'diag-voz-box', 'btn-estado', 'btn-upd']) assert.ok(dentro.includes(`id="${id}"`), id + ' en el desplegable');
  for (const id of ['tg-upd', 'tg-barge']) { assert.ok(s.includes(`id="${id}"`), id); assert.equal(dentro.includes(`id="${id}"`), false, id + ' queda a la vista'); }
  assert.match(ui, /adv-mant'\); if \(mt\) mt\.open = true/, 'si el asistente manda al resultado de voz, el desplegable se abre');
});

test('asistente de voz: se abre solo una vez y solo sobre Inicio', () => {
  const a = ui.slice(ui.indexOf('asistenteAuto: function'), ui.indexOf('verNum: function'));
  assert.match(a, /this\.current !== 'home'\) return;/);
  assert.ok(a.indexOf("this.current !== 'home'") < a.indexOf("store('kiu_asist_voz', 1)"), 'si no está en Inicio NO se marca como hecho');
});
