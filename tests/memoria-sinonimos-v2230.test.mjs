/* memoria-sinonimos-v2230.test.mjs — v2.23.0: «doctor» encuentra «médico».
 * node --test tests/memoria-sinonimos-v2230.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarAgente } from './evals/harness.mjs';

function montar(items) {
  const M = cargarAgente().ctx.KiuMem;
  for (const [tipo, texto] of items) M.add(tipo, texto);
  return M;
}
const textos = (hits) => Array.from(hits, (h) => h.text);

test('«doctor» encuentra «médico» y al revés, como coincidencia completa', () => {
  const M = montar([['recuerdos', 'el médico dijo que tome menos sal'], ['recuerdos', 'comprar pan']]);
  const r = M.search('qué anoté del doctor');
  assert.deepEqual(textos(r), ['el médico dijo que tome menos sal']);
  assert.equal(r.parcial, undefined);
  const M2 = montar([['notas', 'turno con la doctora el martes']]);
  assert.equal(M2.search('médico').length, 1);
});

test('plural + sinónimo: «reuniones» encuentra «junta», «coches» encuentra «auto»', () => {
  const M = montar([['notas', 'junta con el equipo'], ['notas', 'llevar el auto al taller']]);
  assert.deepEqual(textos(M.search('reuniones')), ['junta con el equipo']);
  assert.deepEqual(textos(M.search('coches')), ['llevar el auto al taller']);
});

test('sin relación no inventa: «doctor» no encuentra «comprar pan»', () => {
  const M = montar([['recuerdos', 'comprar pan']]);
  assert.equal(M.search('doctor').length, 0);
});

test('todas las palabras de la consulta siguen siendo obligatorias', () => {
  const M = montar([['recuerdos', 'el médico me recetó pastillas'], ['recuerdos', 'el dentista es el jueves']]);
  assert.deepEqual(textos(M.search('doctor remedio')), ['el médico me recetó pastillas']);
});
