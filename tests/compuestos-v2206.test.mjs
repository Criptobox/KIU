/* compuestos-v2206.test.mjs — v2.20.6: medido en el teléfono (Llama 3.2 1B, 21/24), los tres compuestos fallaron por:
 *   · el ejemplo del prompt del 2.º paso era de OTRA herramienta (web_search, manage_task list) y el modelo lo copiaba,
 *   · «listo» con una parte sin hacer.
 * node --test tests/compuestos-v2206.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarAgente } from './evals/harness.mjs';

const ALARMA_CLIMA = 'poné una alarma a las 7 y decime qué tiempo hace en Córdoba';
const TAREA_ANOTAR = 'agregá una tarea: comprar pan, y anotá que el dentista es el martes';
const LINTERNA_MUSICA = 'encendé la linterna y pausá la música';
const j = (o) => JSON.stringify(o);

function agente() { const r = cargarAgente(); r.ctx.S.kiu = { ok: true, name: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf' }; return r; }
function correr(pedido, guion) {
  const r = agente();
  const prompts = [];
  r.ctx.Kiu = { ask(hist, maxT, cb, onTok, gbnf) { prompts.push({ sys: hist[0].content, gbnf }); cb({ ok: true, text: guion[Math.min(prompts.length, guion.length) - 1] }); } };
  return new Promise((res) => {
    const resultados = [];
    r.ctx.KiuAgente.run({ pedido, habla: [pedido], componer: false, resultado: (n, ok) => resultados.push([n, ok]) }, (out) => res({ out, prompts, resultados }));
  });
}
const ejemplo = (sys) => (sys.match(/EJEMPLOS:\n"(\w+)" → (\{.*\})/) || []);

test('faltaParte: detecta la mitad sin hacer, en cualquier orden, y no inventa pendientes', () => {
  const A = agente().ctx.KiuAgente;
  const casos = [
    [LINTERNA_MUSICA, ['media_control'], 'device_action'],
    [LINTERNA_MUSICA, ['device_action'], 'media_control'],
    [ALARMA_CLIMA, ['set_alarm'], 'get_weather'],
    [ALARMA_CLIMA, ['get_weather'], 'set_alarm'],
    [TAREA_ANOTAR, ['remember'], 'manage_task'],
    [TAREA_ANOTAR, ['manage_task'], 'remember'],
    /* una sola intención con «y»: nada pendiente */
    ['anotá que compré pan y leche', ['remember'], null],
    ['agregá una tarea: comprar pan y leche', ['manage_task'], null],
    ['poné una alarma a las 7 y media', ['set_alarm'], null],
    ['qué tiempo hace en Córdoba y si va a llover', ['get_weather'], null],
    /* sin conjunción */
    ['agregá una tarea: comprar pan', ['manage_task'], null],
    ['encendé la linterna', ['device_action'], null],
  ];
  for (const [p, usadas, esperado] of casos) assert.equal(A.faltaParte(p, usadas), esperado, usadas + ' · ' + p);
  assert.equal(A.faltaParte(LINTERNA_MUSICA, []), null, 'sin nada hecho no hay «falta»');
});

test('el ejemplo del 2.º paso es de la herramienta que FALTA, no de la ya usada ni de una alternativa', () => {
  const A = agente().ctx.KiuAgente;
  const sys = (p, obs) => A.systemPrompt(p, A.seleccionar(p), obs, 1, false, false, true);
  assert.equal(ejemplo(sys(ALARMA_CLIMA, ['[set_alarm ok] Listo.']))[1], 'get_weather', 'antes copiaba web_search / manage_alarm');
  assert.equal(ejemplo(sys(LINTERNA_MUSICA, ['[media_control ok] Listo.']))[1], 'device_action');
  assert.equal(ejemplo(sys(TAREA_ANOTAR, ['[remember ok] Listo.']))[1], 'manage_task');
});

test('manage_task / manage_routine: el ejemplo es de CREAR salvo que el pedido sea una consulta', () => {
  const A = agente().ctx.KiuAgente;
  const args = (p) => JSON.parse(ejemplo(A.systemPrompt(p, A.seleccionar(p), [], 1, false, false, true))[2]).args;
  assert.equal(args('agregá una tarea: comprar pan').action, 'add', 'antes mostraba list y el modelo lo copiaba al crear');
  assert.equal(args('qué tareas tengo pendientes').action, 'list');
  assert.equal(args('todos los días a las 8 dame el resumen').action, 'add');
  assert.equal(args('qué rutinas tengo').action, 'list');
});

test('toda herramienta con ejemplo muestra argumentos VÁLIDOS para su esquema', () => {
  const A = agente().ctx.KiuAgente;
  for (const n of A.toolNames()) {
    for (const p of ['qué tareas tengo pendientes', 'agregá algo']) {
      const sys = A.systemPrompt(p, [n], [], 1, false, false, true);
      const e = ejemplo(sys);
      if (!e[1]) continue;
      assert.equal(e[1], n);
      const v = A.validate(n, JSON.parse(e[2]).args);
      assert.ok(v.ok, n + ': ejemplo inválido → ' + v.err);
    }
  }
});

test('«listo» con una parte sin hacer se rechaza UNA vez y el agente hace la otra', async () => {
  const x = await correr(TAREA_ANOTAR, [
    j({ tool: 'remember', args: { text: 'el dentista es el martes' } }),
    j({ listo: true }),
    j({ tool: 'manage_task', args: { action: 'add', text: 'comprar pan' } }),
  ]);
  assert.deepEqual(x.resultados.map((r) => r[0]), ['remember', 'manage_task']);
  assert.ok(x.resultados.every((r) => r[1]), JSON.stringify(x.out.obs));
  assert.ok(x.out.obs.some((o) => /Falta otra parte del pedido: usá manage_task/.test(o)), 'se le avisó cuál faltaba');
  assert.match(x.prompts[2].sys, /Falta otra parte del pedido/);
});

test('si vuelve a decir «listo» se acepta: no hay bucle', async () => {
  const x = await correr(TAREA_ANOTAR, [
    j({ tool: 'manage_task', args: { action: 'add', text: 'comprar pan' } }),
    j({ listo: true }),
    j({ listo: true }),
    j({ listo: true }),
  ]);
  assert.deepEqual(x.resultados.map((r) => r[0]), ['manage_task']);
  assert.equal(x.prompts.length, 3, 'una vez rechazado y listo: ni una pregunta más');
});

test('un pedido de una sola intención NO se veta: «listo» termina', async () => {
  const x = await correr('agregá una tarea: comprar pan y leche', [
    j({ tool: 'manage_task', args: { action: 'add', text: 'comprar pan y leche' } }),
    j({ listo: true }),
    j({ tool: 'remember', args: { text: 'no debería pasar' } }),
  ]);
  assert.deepEqual(x.resultados.map((r) => r[0]), ['manage_task']);
  assert.equal(x.prompts.length, 2);
});

test('la Prueba completa mide también la red de seguridad: rechazado una vez, acierta a la 2.ª', async () => {
  const r = agente();
  const U = r.ctx.KiuAutoprueba;
  let paso = 0;
  r.ctx.Kiu = {
    ask(hist, maxT, cb) {
      const sys = hist[0].content, p = hist[hist.length - 1].content;
      const c = U.COMPUESTOS.find((x) => x.pedido === p);
      if (!c) { cb({ ok: true, tps: 5, text: j({ tool: 'now', args: {} }) }); return; }
      const nuevo = !/YA INTENTASTE/.test(sys);
      const vetado = /Falta otra parte/.test(sys);
      const t = c.partes[nuevo ? 0 : 1].tool;
      const args = { set_alarm: { when: 'a las 7' }, get_weather: { place: 'Córdoba' }, manage_task: { action: 'add', text: 'comprar pan' }, remember: { text: 'el dentista es el martes' }, device_action: { what: 'linterna' }, media_control: { action: 'pause' } }[t];
      if (!nuevo && !vetado) { cb({ ok: true, tps: 5, text: j({ listo: true }) }); return; }   /* 1.er intento del 2.º paso: «listo» */
      cb({ ok: true, tps: 5, text: j({ tool: t, args }) });
    },
  };
  const res = await new Promise((ok) => U.correr({ completa: true }, ok));
  const fallosCompuestos = res.fallos.filter((f) => U.COMPUESTOS.some((c) => c.pedido === f.pedido));
  assert.equal(fallosCompuestos.length, 0, 'con el aviso, los tres compuestos salen bien: ' + JSON.stringify(fallosCompuestos));
  assert.ok(res.total >= U.COMPUESTOS.length, 'corrió los compuestos');
});

test('v2.20.7: si se sabe qué parte falta, el 2.º paso ofrece SOLO esa herramienta y sin «listo»', async () => {
  const raiz = (g) => g.split('\n').find((l) => /^root ::=/.test(l));
  for (const [pedido, primera, falta, otras] of [
    [ALARMA_CLIMA, { tool: 'set_alarm', args: { when: 'a las 7' } }, 'get-weather', /web-search|set-alarm/],
    [LINTERNA_MUSICA, { tool: 'media_control', args: { action: 'pause' } }, 'device-action', /media-control/],
  ]) {
    const r = agente();
    const prompts = [];
    r.ctx.Kiu = { ask(hist, m, cb, t, gbnf) { prompts.push(gbnf); cb({ ok: true, text: prompts.length === 1 ? j(primera) : j({ listo: true }) }); } };
    /* las herramientas de la 1.ª parte no se ejecutan de verdad: el puente de pruebas las deja pasar o no, da igual */
    await new Promise((res) => r.ctx.KiuAgente.run({ pedido, habla: [pedido], componer: false }, res));
    assert.ok(prompts.length >= 2, pedido);
    const g = raiz(prompts[1]);
    assert.match(g, new RegExp(falta), pedido + ' → ' + g);
    assert.doesNotMatch(g, /\bdone\b/, 'sin «listo»: ' + g);
    assert.doesNotMatch(g, otras, 'sin las alternativas ni lo ya hecho: ' + g);
  }
});

test('v2.20.7: log_expense NO tiene ejemplo (con uno, «gasté 12 en almuerzo» pasó de acertar a elegir total)', () => {
  const A = agente().ctx.KiuAgente;
  const p = 'gasté 12 en almuerzo';
  const sys = A.systemPrompt(p, A.seleccionar(p), [], 1, false, false, true);
  assert.doesNotMatch(sys, /EJEMPLOS:/);
});
