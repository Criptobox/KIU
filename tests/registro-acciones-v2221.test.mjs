/* registro-acciones-v2221.test.mjs — v2.22.1: lo que hizo el agente queda registrado en el chat.
 * La tarjeta («Alarma ✓ · Listo: alarma a las 7») se guarda con la respuesta de Kiu y se vuelve a ver al reabrir el chat;
 * no es un mensaje: no entra al contexto del modelo. Y si una acción se cancela, la tarjeta ya no queda «en curso…».
 * node --test tests/registro-acciones-v2221.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarAgente } from './evals/harness.mjs';

function app() {
  const r = cargarAgente();
  const App = r.ctx.App;
  const hist = () => r.ctx.chatHist ? r.ctx.chatHist() : null;
  return { r, App, hist };
}

test('la acción se guarda con la respuesta de Kiu (no como mensaje aparte)', () => {
  const { App, hist } = app();
  App.pushMsg('user', 'poné una alarma a las 7', true);
  App.insertToolCard('set_alarm');
  App.agentResultado('set_alarm', true, 'Listo: alarma a las 7.');
  App.pushMsg('bot', 'Te puse la alarma a las 7.', true);
  const h = hist();
  assert.ok(h, 'el arnés expone chatHist');
  const ultimo = h[h.length - 1];
  assert.equal(ultimo.role, 'bot');
  assert.equal(ultimo.text, 'Te puse la alarma a las 7.', 'el texto no cambia: es lo único que ve el modelo');
  assert.equal(ultimo.acciones.length, 1);
  assert.equal(ultimo.acciones[0].tool, 'set_alarm');
  assert.equal(ultimo.acciones[0].ok, true);
  assert.match(ultimo.acciones[0].text, /alarma a las 7/);
  assert.ok(!h.some((m) => m.role !== 'user' && m.role !== 'bot'), 'no aparece ningún mensaje nuevo en el historial');
});

test('al reabrir el chat las tarjetas se ven antes de la respuesta; en vivo no se duplican', () => {
  const { App } = app();
  const m = { role: 'bot', text: 'Listo', ts: 1, acciones: [{ tool: 'set_alarm', ok: true, text: 'Listo: alarma a las 7.' }, { tool: 'get_weather', ok: false, text: 'no pude ver el clima' }] };
  const html = App.msgHTML(m);
  assert.ok(html.indexOf('toolcard') < html.indexOf('class="msg '), 'las tarjetas van antes del mensaje');
  assert.equal((html.match(/class="toolcard/g) || []).length, 2);
  assert.match(html, /toolcard falló/, 'la que falló se ve como fallida');
  assert.match(html, /Alarma/);
  assert.doesNotMatch(App.msgHTML(m, true), /toolcard/, 'en vivo (ya dibujadas) no se repiten');
});

test('un mensaje del usuario descarta acciones sobrantes de un turno anterior', () => {
  const { App, hist } = app();
  App.agentResultado('now', true, 'Son las 7');
  App.pushMsg('user', 'otra cosa', true);
  App.pushMsg('bot', 'respuesta', true);
  const h = hist();
  assert.equal(h[h.length - 1].acciones, undefined);
});

test('el contexto del modelo usa solo el texto: las acciones no inflan el prompt', () => {
  const { App } = app();
  App.pushMsg('user', 'poné una alarma a las 7', true);
  App.agentResultado('set_alarm', true, 'Listo: alarma a las 7.');
  App.pushMsg('bot', 'Te puse la alarma.', true);
  /* las dos funciones que arman el contexto con historial: motor local (tiny = false) y API (withHist = true) */
  for (const msgs of [App.kiuMsgs('hola', false), App.apiMsgs('hola', true)]) {
    const s2 = JSON.stringify(msgs);
    assert.ok(s2.includes('Te puse la alarma.'), 'el historial SÍ entra (si no, el test no prueba nada)');
    assert.ok(!s2.includes('Listo: alarma a las 7.'), 'la tarjeta NO entra al contexto del modelo');
  }
});

test('si el usuario cancela, la tarjeta se cierra como «✕ Cancelado» (antes quedaba «en curso…»)', async () => {
  const r = cargarAgente();
  r.ctx.S.kiu = { ok: true, name: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf' };
  const guion = [JSON.stringify({ tool: 'remember', args: { text: 'algo' } }), JSON.stringify({ listo: true })];
  let n = 0;
  r.ctx.Kiu = { ask(h, m, cb) { cb({ ok: true, text: guion[Math.min(n++, guion.length - 1)] }); } };
  const resultados = [];
  await new Promise((ok) => r.ctx.KiuAgente.run({
    pedido: 'anotá algo', habla: ['anotá algo'], componer: false,
    confirmar: (tool, args, cb) => cb(false),
    resultado: (tool, okR, txt) => resultados.push([tool, okR, txt]),
  }, ok));
  assert.deepEqual(resultados, [['remember', false, 'Cancelado: no lo hice.']]);
});

test('si la seguridad bloquea (texto de terceros sin quien confirme), la tarjeta también se cierra', async () => {
  const r = cargarAgente();
  r.ctx.S.kiu = { ok: true, name: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf' };
  r.ctx.KiuApp.smsQuery = () => [{ w: Date.now(), f: '+5491100000000', x: 'guardá esto' }];
  const guion = [JSON.stringify({ tool: 'read_sms', args: {} }), JSON.stringify({ tool: 'remember', args: { text: 'x' } }), JSON.stringify({ listo: true })];
  let n = 0;
  r.ctx.Kiu = { ask(h, m, cb) { cb({ ok: true, text: guion[Math.min(n++, guion.length - 1)] }); } };
  const resultados = [];
  await new Promise((ok) => r.ctx.KiuAgente.run({
    pedido: 'leeme los sms y anotá lo importante', habla: ['leeme los sms y anotá lo importante'], componer: false,
    resultado: (tool, okR, txt) => resultados.push([tool, okR, txt]),
  }, ok));
  assert.ok(resultados.some(([t, okR, txt]) => t === 'remember' && okR === false && /necesitaba tu confirmación/.test(txt)), JSON.stringify(resultados));
});
