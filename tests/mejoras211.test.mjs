/* mejoras211.test.mjs — v2.11.0: asistente de voz, actualizaciones, nivel de voz y firma. */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { WWW } from './helpers.mjs';

const ROOT = path.resolve(WWW, '../../../../..');
const ui = readFileSync(path.join(WWW, 'js/app/app-ui.js'), 'utf8');
const html = readFileSync(path.join(WWW, 'index.html'), 'utf8');
const css = readFileSync(path.join(WWW, 'css/app.css'), 'utf8');
const java = readFileSync(path.join(ROOT, 'app/src/main/java/com/kiu/agent/MainActivity.java'), 'utf8');
const yml = readFileSync(path.join(ROOT, '.github/workflows/build.yml'), 'utf8');
const gradle = readFileSync(path.join(ROOT, 'app/build.gradle.kts'), 'utf8');

test('asistente de voz: pasos, botones y apertura única la primera vez', () => {
  assert.match(html, /id="btn-asist-voz"/);
  for (const id of ['mic', 'rec', 'model', 'tts', 'bat', 'vol']) assert.match(ui, new RegExp("id: '" + id + "'"));
  assert.match(ui, /asistenteAuto: function/);
  assert.match(ui, /store\('kiu_asist_voz'\)/);
  assert.match(ui, /store\('kiu_asist_voz', 1\)/);
});

test('el puente Java tiene kiuAsist y los ajustes de batería de la app', () => {
  assert.match(java, /public String kiuAsist\(\)/);
  assert.match(java, /isIgnoringBatteryOptimizations\(MainActivity\.this\.getPackageName\(\)\)/);
  assert.match(java, /"bateriaapp"\.equals\(str\)/);
  assert.match(java, /IGNORE_BATTERY_OPTIMIZATION_SETTINGS/);
});

test('nivel de voz: Java limita el ritmo y la UI lo traduce a barras', () => {
  assert.match(java, /private long lastRmsMs/);
  assert.match(java, /now - MainActivity\.this\.lastRmsMs < 90/);
  assert.match(java, /nexoVoiceLevel\(" \+ f \+ "\)/);
  assert.match(ui, /window\.nexoVoiceLevel = function/);
  assert.match(ui, /vpLevel: function/);
  assert.match(css, /\.voice-pulse\.live\[data-st="listen"\] \.vp-bars i/);
});

test('el nivel de voz se apaga si dejan de llegar avisos o se sale de escucha', () => {
  assert.match(ui, /Date\.now\(\) - \(self\._vpLvlT \|\| 0\) > 1200/);
  assert.match(ui, /if \(m !== 'listen'\) this\.vpLive\(false\)/);
});

test('actualizaciones: apagadas por defecto, una vez al día, solo abre la descarga', () => {
  assert.match(html, /id="btn-upd"/);
  assert.match(html, /id="tg-upd"/);
  assert.match(ui, /releases\/latest/);
  assert.match(ui, /if \(!u\.auto \|\| Date\.now\(\) - \(u\.last \|\| 0\) < 86400000\) return;/);
  assert.match(ui, /openUrl\(apk\.browser_download_url\)/);
  assert.doesNotMatch(ui, /REQUEST_INSTALL_PACKAGES/);
});

test('comparación de versiones', () => {
  const m = ui.match(/verNum: function \(v\) \{[\s\S]*?\n    \},/);
  assert.ok(m);
  const verNum = new Function('return {' + m[0].replace(/,\s*$/, '') + '}')().verNum;
  assert.deepEqual(verNum('v2.11.0'), [2, 11, 0]);
  assert.deepEqual(verNum('2.9'), [2, 9, 0]);
  assert.equal(verNum('?'), null);
  const cmp = (a, b) => { const x = verNum(a), y = verNum(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
  assert.ok(cmp('v2.11.0', '2.10.1') > 0);
  assert.ok(cmp('2.10.1', '2.10.1') === 0);
  assert.ok(cmp('v2.9.7', '2.10.0') < 0);
});

test('build: verifica la firma con mensajes claros y deja la huella en el resumen', () => {
  assert.match(yml, /name: Verificar firma/);
  assert.match(yml, /if: env\.KIU_PASS != ''/);
  assert.match(yml, /KIU_KEYSTORE_PASSWORD no abre el keystore/);
  assert.match(yml, /no tiene el alias/);
  assert.match(yml, /GITHUB_STEP_SUMMARY/);
  assert.ok(yml.indexOf('name: Verificar firma') < yml.indexOf('name: Compilar'));
  assert.ok(existsSync(path.join(ROOT, 'docs/FIRMA.md')));
});

test('el keystore se busca igual para comprobar que existe y para firmar', () => {
  assert.match(gradle, /val ksFile = rootProject\.file\(ksPath\)/);
  assert.match(gradle, /ksFile\.exists\(\)/);
  assert.match(gradle, /storeFile = ksFile/);
  assert.match(gradle, /val kiuVersionName = "2\.11\.0"/);
  assert.match(gradle, /val kiuVersionCode = 50/);
});
