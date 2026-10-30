/* velocidad-v2208.test.mjs — v2.20.8: «tok/s» contaba desde ANTES de leer el prompt, así que mezclaba leer con generar.
 * El motor mide aparte cuánto tarda en leer el pedido (pre_ms) y la velocidad de generación (gen_tps).
 * node --test tests/velocidad-v2208.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cargarAgente } from './evals/harness.mjs';

const cpp = fs.readFileSync('app/src/main/cpp/kiullama_jni.cpp', 'utf8');

test('el motor mide el prefill y la generación por separado y los publica en genStatus', () => {
  assert.match(cpp, /std::atomic<double> g_pre_ms\{0\.0\};/);
  assert.match(cpp, /std::atomic<double> g_gen_tps\{0\.0\};/);
  const iPre = cpp.indexOf('g_pre_ms = (double)(t_gen0 - t0) / 1000.0;');
  const iPrefill = cpp.indexOf('while (done < n_prompt)');
  const iLoop = cpp.indexOf('for (int i = 0; i < n_predict; i++)', iPrefill);
  assert.ok(iPrefill > 0 && iPre > iPrefill && iPre < iLoop, 'pre_ms se toma al TERMINAR el prefill y antes de generar');
  assert.match(cpp, /g_gen_tps = \(double\)\(i \+ 1\) \/ gsecs;/);
  assert.match(cpp, /\\"pre_ms\\":%\.0f,\\"gen_tps\\":%\.1f/, 'genStatus los incluye');
  assert.match(cpp, /g_pre_ms = 0\.0;\n\s*g_gen_tps = 0\.0;/, 'se reinician en cada generación');
  assert.match(cpp, /char buf\[240\];/, 'el buffer de genStatus alcanza para los campos nuevos');
});

test('probarDecision devuelve leer/generar si el motor los publica, y null si no', async () => {
  const r = cargarAgente();
  r.ctx.S.kiu = { ok: true, name: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf' };
  r.ctx.Kiu = { ask(h, m, cb) { cb({ ok: true, tps: 2.4, text: '{"tool":"now","args":{}}' }); } };
  r.ctx.rawBridge = (n) => (n === 'kiuGenStatus' ? '{"text":"","toks":9,"tps":2.4,"pre_ms":6100,"gen_tps":7.8,"done":true}' : null);
  const d = await new Promise((ok) => r.ctx.KiuAgente.probarDecision('qué hora es', ok));
  assert.equal(d.preMs, 6100);
  assert.equal(d.genTps, 7.8);
  r.ctx.rawBridge = () => '{"text":"","tps":2.4}';   /* motor viejo, sin los campos */
  const d2 = await new Promise((ok) => r.ctx.KiuAgente.probarDecision('qué hora es', ok));
  assert.equal(d2.preMs, null);
  assert.equal(d2.genTps, null);
});

test('la Prueba promedia leer/generar y la pantalla los muestra aparte', async () => {
  const r = cargarAgente();
  r.ctx.S.kiu = { ok: true, name: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf' };
  r.ctx.Kiu = { ask(h, m, cb) { cb({ ok: true, tps: 2.5, text: '{"tool":"now","args":{}}' }); } };
  let n = 0;
  const dados = [];
  r.ctx.rawBridge = (k) => { if (k !== 'kiuGenStatus') return null; const v = (++n % 2) ? 6000 : 8000; dados.push(v); return JSON.stringify({ pre_ms: v, gen_tps: 8 }); };
  const res = await new Promise((ok) => r.ctx.KiuAutoprueba.correr({ completa: false }, ok));
  assert.ok(dados.length >= 2);
  assert.equal(res.preMs, Math.round(dados.reduce((a, b) => a + b, 0) / dados.length), 'promedio de lo que tardó en leer el pedido');
  assert.equal(res.genTps, 8);
  const ui = fs.readFileSync('app/src/main/assets/www/js/app/app-ui.js', 'utf8');
  assert.match(ui, /Leer el pedido: ' \+ \(r\.preMs \/ 1000\)/);
});
