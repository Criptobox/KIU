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

test('v2.21.1: todos los prompts empiezan con el MISMO bloque fijo (lo que la caché del motor reutiliza)', async () => {
  const actual = await generar();
  const ps = Object.values(actual).map((v) => v.prompt);
  const fijo = ps[0].slice(0, ps[0].indexOf('\n\n') + 2);
  assert.match(fijo, /^Sos Kiu, un asistente que usa herramientas para responder\.\nRespondé SOLO con un objeto JSON/);
  assert.match(fijo, /Usá una herramienta por vez\. Elegí la más específica que sirva\.\n\n$/);
  for (const p of ps) {
    assert.ok(p.startsWith(fijo), 'empieza con el bloque fijo: ' + p.slice(0, 80));
    assert.ok(p.indexOf('HERRAMIENTAS:') > fijo.length, 'la lista de herramientas (cambia en cada pedido) va DESPUÉS de lo fijo');
  }
  /* lo que decide el paso sigue siendo lo último que lee el modelo */
  for (const p of ps) assert.match(p, /Todavía no hiciste nada\.$/);
  /* medida: cuánto del prompt se reutiliza del pedido anterior, en el orden de la Prueba */
  let comun = 0, total = 0;
  for (let i = 0; i < ps.length; i++) {
    total += ps[i].length;
    if (!i) continue;
    let k = 0; while (k < ps[i].length && ps[i][k] === ps[i - 1][k]) k++;
    comun += k;
  }
  assert.ok(comun / total >= 0.4, 'al menos 40 % reutilizable entre pedidos seguidos (antes del reordenamiento: 19 %): ' + Math.round(comun / total * 100) + ' %');
});
