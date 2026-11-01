/* fuera-de-lista-v2222.test.mjs — v2.22.2: el agente solo acepta herramientas OFRECIDAS en el turno.
 * La gramática ya lo impone, pero si el motor no la aplica el modelo podía elegir cualquiera de las 24.
 * node --test tests/fuera-de-lista-v2222.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarAgente } from './evals/harness.mjs';
const j = (o) => JSON.stringify(o);

function correr(pedido, guion) {
  const r = cargarAgente();
  r.ctx.S.kiu = { ok: true, name: 'x' };
  const prompts = [], resultados = [];
  let n = 0;
  r.ctx.Kiu = { ask(h, m, cb) { prompts.push(h[0].content); cb({ ok: true, text: guion[Math.min(n++, guion.length - 1)] }); } };
  return new Promise((res) => r.ctx.KiuAgente.run({ pedido, habla: [pedido], componer: false, resultado: (t, ok) => resultados.push([t, ok]) },
    (out) => res({ out, prompts, resultados, A: r.ctx.KiuAgente })));
}

test('una herramienta que no estaba ofrecida se rechaza y se vuelve a preguntar', async () => {
  const x = await correr('agregá una tarea: comprar pan', [
    j({ tool: 'media_control', args: { action: 'play' } }),
    j({ tool: 'manage_task', args: { action: 'add', text: 'comprar pan' } }),
    j({ listo: true }),
  ]);
  assert.deepEqual(x.resultados.map((r) => r[0]), ['manage_task'], 'la música NO se tocó');
  assert.match(x.prompts[1], /«media_control» no sirve para este pedido\. Usá solo una de estas: manage_task/);
  const d = x.A.diag();
  assert.equal(d.fueraDeLista, 1);
  assert.equal(d.ultimoFuera, 'media_control');
});

test('si insiste hasta agotar los pasos, no hace nada (y sigue la respuesta normal)', async () => {
  const x = await correr('agregá una tarea: comprar pan', [j({ tool: 'media_control', args: { action: 'play' } })]);
  assert.equal(x.resultados.length, 0, 'ninguna acción');
  assert.equal(x.out.ok, false, 'el agente no "contesta": la app sigue con la respuesta normal');
});

test('cuando no coincide nada se ofrecen todas: ahí cualquier herramienta vale', async () => {
  const x = await correr('zzz qqq', [j({ tool: 'now', args: {} }), j({ listo: true })]);
  assert.deepEqual(x.resultados.map((r) => r[0]), ['now']);
});

test('diag() expone gramática aplicada/no aplicada y el registro, para «Estado y diagnóstico»', () => {
  const A = cargarAgente().ctx.KiuAgente;
  const d = A.diag();
  for (const k of ['conGramatica', 'sinGramatica', 'fueraDeLista', 'ultimoFuera', 'log']) assert.ok(k in d, k);
});

test('la app muestra el diagnóstico: aviso en la Prueba y sección AGENTE en «Estado y diagnóstico»', async () => {
  const fs = await import('node:fs');
  const ui = fs.readFileSync('app/src/main/assets/www/js/app/app-ui.js', 'utf8');
  assert.match(ui, /⚠ El motor NO aplicó la gramática en ' \+ r\.gramaticaNoAplicada/);
  assert.match(ui, /L\.push\('— AGENTE —'\)/);
  assert.match(ui, /Eligió herramientas que no se le ofrecían/);
  const ap = fs.readFileSync('app/src/main/assets/www/js/kiu-autoprueba.js', 'utf8');
  assert.match(ap, /que no estaba entre las ofrecidas' \+ \(dec\.gramatica === false \? ' \(el motor NO aplicó la gramática\)' : ''\)/);
});
