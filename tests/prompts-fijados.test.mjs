/* prompts-fijados.test.mjs — v2.20.8: el 1.er prompt de cada pedido de la Prueba del teléfono no cambia sin querer.
 * Dos veces arreglé un pedido compuesto y rompí uno simple que acertaba; solo se vio en el teléfono, días después.
 * Si este test falla y el cambio ES a propósito: node scripts/prompts-paso1.mjs --actualizar (y medir en el teléfono).
 * node --test tests/prompts-fijados.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generar, leerFijado } from '../scripts/prompts-paso1.mjs';

test('el 1.er prompt y la gramática de los 24 pedidos de la Prueba siguen siendo los fijados', async () => {
  const actual = await generar(), fijado = leerFijado();
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(fijado).sort(), 'cambió la lista de pedidos de la Prueba');
  const cambiaron = [];
  for (const p of Object.keys(fijado)) {
    for (const k of ['herramientas', 'prompt', 'gramatica_sha1']) {
      if (actual[p][k] !== fijado[p][k]) cambiaron.push('«' + p + '» · ' + k);
    }
  }
  assert.equal(cambiaron.length, 0,
    'Cambió lo que el modelo ve en el 1.er paso de:\n  ' + cambiaron.join('\n  ') +
    '\nSi es a propósito: node scripts/prompts-paso1.mjs --actualizar, y repetir la Prueba completa en el teléfono.');
});
