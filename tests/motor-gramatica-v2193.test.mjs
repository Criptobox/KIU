/* v2.19.3 — test de FORMA sobre kiullama_jni.cpp (no ejecuta el motor).
 * Orden exigido de la cadena: penalizaciones -> gramática -> selector, y try/catch en el muestreo. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const cpp = fs.readFileSync('app/src/main/cpp/kiullama_jni.cpp', 'utf8');
const pos = (re) => { const i = cpp.search(re); assert.ok(i >= 0, 'falta ' + re); return i; };

test('la gramática se agrega a la cadena antes que el selector', () => {
  const pen = pos(/kiu_penalties\(64/);
  const gram = pos(/llama_sampler_chain_add\(smpl, gs\)/);
  const greedy = pos(/llama_sampler_chain_add\(smpl, llama_sampler_init_greedy\(\)\)/);
  const dist = pos(/llama_sampler_chain_add\(smpl, llama_sampler_init_dist/);
  assert.ok(pen < gram, 'penalizaciones antes de la gramática');
  assert.ok(gram < greedy && gram < dist, 'la gramática debe ir antes del selector');
});

test('llama_sampler_sample está protegido con try/catch', () => {
  const m = cpp.match(/try\s*\{\s*id = llama_sampler_sample\(smpl, g_ctx, -1\);\s*\}\s*catch \(const std::exception&/);
  assert.ok(m, 'llama_sampler_sample debe ir dentro de try/catch');
  assert.match(cpp, /#include <exception>/);
});
