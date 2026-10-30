/* compuestos-v2200.test.mjs — v2.20.0: un pedido con dos partes ejecuta las dos en UN turno del agente.
 * El modelo es de mentira (guionizado); lo real es la selección, el bucle, la gramática y la validación.
 * node --test tests/compuestos-v2200.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarAgente } from './evals/harness.mjs';

const PEDIDO = 'agregá una tarea: comprar pan, y anotá que el dentista es el martes';

function correr(guion, pedido = PEDIDO) {
  const r = cargarAgente();
  r.ctx.S.kiu = { ok: true, name: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf' };
  const prompts = [];
  r.ctx.Kiu = { ask(hist, maxT, cb, onTok, gbnf) { prompts.push({ sys: hist[0].content, gbnf }); cb({ ok: true, text: guion[Math.min(prompts.length, guion.length) - 1] }); } };
  return new Promise((res) => {
    const resultados = [];
    r.ctx.KiuAgente.run({ pedido, habla: [pedido], componer: false, resultado: (n, ok) => resultados.push([n, ok]) }, (out) => res({ out, prompts, resultados, ctx: r.ctx }));
  });
}

test('las dos partes se ejecutan en un solo turno y el 2.º paso sabe que falta una', async () => {
  const j = (o) => JSON.stringify(o);
  const x = await correr([
    j({ tool: 'manage_task', args: { action: 'add', text: 'comprar pan' } }),
    j({ tool: 'remember', args: { text: 'el dentista es el martes' } }),
    j({ listo: true }),
  ]);
  assert.deepEqual(x.resultados.map((r) => r[0]), ['manage_task', 'remember']);
  assert.ok(x.resultados.every((r) => r[1]), 'las dos salieron bien: ' + JSON.stringify(x.out.obs));
  assert.equal(x.out.ok, true);
  assert.match(x.prompts[1].sys, /\[manage_task ok\]/, 'el 2.º paso ve lo que ya se hizo');
  assert.match(x.prompts[1].sys, /otra parte sin hacer/);
  assert.doesNotMatch(x.prompts[0].sys, /otra parte sin hacer/);
});

test('en el 1.er paso la gramática no admite "listo"; en el 2.º de un pedido simple sí; en el de un compuesto, no', async () => {
  const raiz = (g) => g.split('\n').find((l) => /^root ::=/.test(l));
  /* pedido de UNA intención: tras la herramienta se puede terminar */
  const simple = await correr([
    JSON.stringify({ tool: 'manage_task', args: { action: 'add', text: 'comprar pan' } }),
    JSON.stringify({ listo: true }),
  ], 'agregá una tarea: comprar pan');
  assert.doesNotMatch(raiz(simple.prompts[0].gbnf), /\bdone\b/);
  assert.match(raiz(simple.prompts[1].gbnf), /\bdone\b/);
  /* compuesto: falta «anotá…» → se ofrece solo remember y no se admite terminar (v2.20.7) */
  const comp = await correr([
    JSON.stringify({ tool: 'manage_task', args: { action: 'add', text: 'comprar pan' } }),
    JSON.stringify({ tool: 'remember', args: { text: 'el dentista es el martes' } }),
  ]);
  assert.doesNotMatch(raiz(comp.prompts[1].gbnf), /\bdone\b/);
  assert.match(raiz(comp.prompts[1].gbnf), /remember/);
  assert.doesNotMatch(raiz(comp.prompts[1].gbnf), /manage-task|web-search|set-alarm/, 'solo la que falta');
});

test('v2.20.1: en el 2.º paso el ejemplo del prompt NO es el de la herramienta que ya salió bien', async () => {
  const ej = (sys) => (sys.match(/EJEMPLOS:\n"(\w+)"/) || [])[1];
  /* como en el teléfono: la 1.ª decisión copia el ejemplo (remember) y la 2.ª lo repetía */
  const x = await correr([
    JSON.stringify({ tool: 'remember', args: { text: 'el dentista es el martes' } }),
    JSON.stringify({ tool: 'manage_task', args: { action: 'add', text: 'comprar pan' } }),
    JSON.stringify({ listo: true }),
  ]);
  const primera = ej(x.prompts[0].sys), segunda = ej(x.prompts[1].sys);
  assert.equal(primera, 'remember');
  assert.notEqual(segunda, primera, 'el 2.º paso mostraba el mismo ejemplo y el modelo lo copiaba');
  assert.equal(x.prompts[1].sys.includes('remember('), false, 'lo ya hecho ya no está en la lista del 2.º paso (v2.20.7): solo lo que falta');
});

test('v2.20.1/2.20.7: en un pedido SIMPLE la herramienta ya usada sigue disponible (se puede repetir, p. ej. dos alarmas)', async () => {
  const x = await correr([
    JSON.stringify({ tool: 'manage_task', args: { action: 'add', text: 'comprar pan' } }),
    JSON.stringify({ listo: true }),
  ], 'agregá una tarea: comprar pan');
  assert.match(x.prompts[1].sys, /manage_task/);
  assert.match(x.prompts[1].gbnf, /manage_task/);
});
