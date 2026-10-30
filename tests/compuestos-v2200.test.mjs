/* compuestos-v2200.test.mjs — v2.20.0: un pedido con dos partes ejecuta las dos en UN turno del agente.
 * El modelo es de mentira (guionizado); lo real es la selección, el bucle, la gramática y la validación.
 * node --test tests/compuestos-v2200.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarAgente } from './evals/harness.mjs';

const PEDIDO = 'agregá una tarea: comprar pan, y anotá que el dentista es el martes';

function correr(guion) {
  const r = cargarAgente();
  r.ctx.S.kiu = { ok: true, name: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf' };
  const prompts = [];
  r.ctx.Kiu = { ask(hist, maxT, cb, onTok, gbnf) { prompts.push({ sys: hist[0].content, gbnf }); cb({ ok: true, text: guion[Math.min(prompts.length, guion.length) - 1] }); } };
  return new Promise((res) => {
    const resultados = [];
    r.ctx.KiuAgente.run({ pedido: PEDIDO, habla: [PEDIDO], componer: false, resultado: (n, ok) => resultados.push([n, ok]) }, (out) => res({ out, prompts, resultados, ctx: r.ctx }));
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

test('en el 1.er paso la gramática no admite "listo"; en el 2.º sí', async () => {
  const raiz = (g) => g.split('\n').find((l) => /^root ::=/.test(l));
  const x = await correr([
    JSON.stringify({ tool: 'manage_task', args: { action: 'add', text: 'comprar pan' } }),
    JSON.stringify({ listo: true }),
  ]);
  assert.doesNotMatch(raiz(x.prompts[0].gbnf), /\bdone\b/);
  assert.match(raiz(x.prompts[1].gbnf), /\bdone\b/);
});
