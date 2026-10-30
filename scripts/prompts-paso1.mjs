/* scripts/prompts-paso1.mjs — fija el PRIMER prompt de decisión de cada pedido de la Prueba del teléfono.
 *
 * Por qué existe: en 2.20.1 y 2.20.6 cambié prompts pensando en los pedidos compuestos y rompí, sin
 * darme cuenta, dos pedidos simples que acertaban (manage_task → list, log_expense → total). Solo se
 * vio días después, en el teléfono. Con esto, cualquier cambio en el prompt o la gramática del 1.er
 * paso de esos pedidos rompe el CI y hay que aceptarlo a propósito.
 *
 *   node scripts/prompts-paso1.mjs              → compara (lo mismo que hace el test)
 *   node scripts/prompts-paso1.mjs --actualizar → reescribe tests/fixtures/prompts-paso1.json
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const RAIZ = process.cwd();
const FIX = path.join(RAIZ, 'tests/fixtures/prompts-paso1.json');

export async function generar() {
  const { cargarAgente } = await import(pathToFileURL(path.join(RAIZ, 'tests/evals/harness.mjs')).href);
  const r = cargarAgente();
  r.ctx.S.kiu = { ok: true, name: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf' };
  const A = r.ctx.KiuAgente, U = r.ctx.KiuAutoprueba;
  const pedidos = U.CASOS.map((c) => c.pedido).concat(U.COMPUESTOS.map((c) => c.pedido));
  const out = {};
  /* lo que REALMENTE se le manda al modelo: se captura en el motor de mentira */
  let visto = null;
  r.ctx.Kiu = { ask(hist, maxT, cb, onTok, gbnf) { visto = { sys: hist[0].content, gbnf: gbnf || '' }; cb({ ok: true, text: '{"listo":true}' }); } };
  for (const p of pedidos) {
    visto = null;
    A.probarDecision(p, () => {});
    if (!visto) throw new Error('probarDecision no llamó al motor para «' + p + '»');
    out[p] = {
      herramientas: A.seleccionar(p).slice(0, 6).join(','),
      prompt: visto.sys,
      gramatica_sha1: crypto.createHash('sha1').update(visto.gbnf).digest('hex').slice(0, 12),
    };
  }
  return out;
}

export function leerFijado() { return JSON.parse(fs.readFileSync(FIX, 'utf8')); }

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const actual = await generar();
  if (process.argv.includes('--actualizar')) {
    fs.mkdirSync(path.dirname(FIX), { recursive: true });
    fs.writeFileSync(FIX, JSON.stringify(actual, null, 1) + '\n');
    console.log('Fijados', Object.keys(actual).length, 'prompts en', path.relative(RAIZ, FIX));
  } else {
    const fij = leerFijado();
    const dif = Object.keys(actual).filter((p) => JSON.stringify(actual[p]) !== JSON.stringify(fij[p]));
    console.log(dif.length ? 'Cambiaron:\n  ' + dif.join('\n  ') : 'Sin cambios.');
    process.exitCode = dif.length ? 1 : 0;
  }
}
