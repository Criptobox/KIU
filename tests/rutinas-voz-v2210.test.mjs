/* rutinas-voz-v2210.test.mjs — v2.21.0: pausar, reanudar y cambiar rutinas por voz.
 * node --test tests/rutinas-voz-v2210.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarAgente } from './evals/harness.mjs';

function montar() {
  const r = cargarAgente();
  const R = r.ctx.KiuRutinas;
  const alarmas = [];
  r.ctx.KiuApp.addReminder = (t, d) => { alarmas.push({ id: 'a' + alarmas.length + '_' + d.getTime(), title: t, time: d.getTime() }); return true; };
  r.ctx.KiuApp.reminders = () => alarmas;
  r.ctx.KiuApp.removeReminder = (id) => { const i = alarmas.findIndex((a) => a.id === id); if (i >= 0) alarmas.splice(i, 1); };
  return { ...r, R, A: r.ctx.KiuAgente, alarmas };
}
const J = (x) => JSON.parse(JSON.stringify(x));
const lunes7 = new Date(2026, 9, 26, 7, 0, 0);   // lunes 26/oct/2026 07:00

test('edit: cambia solo lo que viene y valida', () => {
  const { R } = montar();
  R.add({ name: 'resumen', at: '8', what: 'resumen' }, lunes7);
  const e = R.edit('resumen', { at: '9:30' }, lunes7);
  assert.equal(e.ok, true);
  assert.equal(e.routine.at, '09:30');
  assert.equal(e.routine.what, 'resumen', 'lo que no vino queda igual');
  assert.deepEqual(J(R.edit('resumen', { days: 'lunes y jueves' }, lunes7).routine.days), [1, 4]);
  assert.equal(R.edit('resumen', { what: 'clima' }, lunes7).routine.what, 'clima');
  assert.match(R.edit('resumen', {}, lunes7).err, /qué cambiar/);
  assert.match(R.edit('resumen', { at: 'nunca' }, lunes7).err, /hora nueva/);
  assert.match(R.edit('no existe', { at: '9' }, lunes7).err, /no encontré/);
  assert.equal(R.all().length, 1, 'editar no duplica');
});

test('edit: si la hora nueva de hoy ya pasó, hoy no corre; si no pasó, sí', () => {
  const { R } = montar();
  const once = new Date(2026, 9, 26, 11, 0, 0);
  R.add({ name: 'a', at: '12' }, once);
  R.edit('a', { at: '10' }, once);   /* las 10 ya pasaron */
  assert.equal(J(R.due(new Date(2026, 9, 26, 11, 1, 0))).length, 0, 'no corre enseguida por haberla movido a una hora pasada');
  R.add({ name: 'b', at: '9' }, once);   /* ya pasó: hoy no corre */
  R.edit('b', { at: '13' }, once);
  /* last quedó en hoy desde el alta (9 ya había pasado): mover a una hora futura no la hace correr dos veces el mismo día */
  assert.equal(J(R.due(new Date(2026, 9, 26, 13, 1, 0))).filter((x) => x.name === 'b').length, 0);
});

test('manage_routine: pausar y reanudar por voz; la pausada no programa alarma y la lista lo dice', () => {
  const { A, R, alarmas } = montar();
  const t = A.get('manage_routine');
  t.run({ action: 'add', name: 'resumen', at: '8', what: 'resumen' });
  assert.ok(alarmas.length >= 1, 'al crear programa la alarma');
  const p = t.run({ action: 'pause', name: 'resumen' });
  assert.equal(p.ok, true);
  assert.match(p.text, /Pausé la rutina "resumen"/);
  assert.equal(alarmas.length, 0, 'pausar quita la alarma');
  assert.match(t.run({ action: 'list' }).text, /\[pausada\]/);
  assert.equal(R.programarDespertadores(), 0, 'una rutina pausada no se reprograma');
  const r = t.run({ action: 'resume', name: 'resumen' });
  assert.match(r.text, /Reanudé la rutina "resumen"/);
  assert.equal(alarmas.length, 1, 'reanudar vuelve a programar su alarma');
  assert.doesNotMatch(t.run({ action: 'list' }).text, /\[pausada\]/);
});

test('manage_routine: cambiar por voz reprograma la alarma a la hora nueva', () => {
  const { A, alarmas } = montar();
  const t = A.get('manage_routine');
  t.run({ action: 'add', name: 'resumen', at: '8', what: 'resumen' });
  const antes = alarmas.map((a) => a.time);
  const e = t.run({ action: 'edit', name: 'resumen', at: '9' });
  assert.equal(e.ok, true, e.err);
  assert.match(e.text, /Rutina cambiada — resumen: todos los días a las 09:00/);
  assert.equal(alarmas.length, 1, 'no deja la alarma vieja');
  assert.notDeepEqual(alarmas.map((a) => a.time), antes, 'la alarma está a la hora nueva');
  assert.equal(new Date(alarmas[0].time).getHours(), 9);
});

test('sin nombre: con UNA rutina es esa; con varias pregunta cuál', () => {
  const { A } = montar();
  const t = A.get('manage_routine');
  assert.match(t.run({ action: 'pause' }).err, /no tenés rutinas/);
  t.run({ action: 'add', name: 'resumen', at: '8' });
  assert.match(t.run({ action: 'pause' }).text, /Pausé la rutina "resumen"/);
  t.run({ action: 'add', name: 'clima', at: '7' });
  assert.match(t.run({ action: 'resume' }).err, /decime cuál rutina \(tenés 2\)/);
});

test('pausar, reanudar y cambiar piden confirmación (escriben); listar no', () => {
  const { A } = montar();
  const t = A.get('manage_routine');
  for (const a of ['pause', 'resume', 'edit', 'add', 'remove']) assert.equal(t.riskFor({ action: a }), 'write', a);
  assert.equal(t.riskFor({ action: 'list' }), 'read');
  assert.ok(A.validate('manage_routine', { action: 'pause', name: 'resumen' }).ok);
  assert.ok(A.validate('manage_routine', { action: 'edit', name: 'resumen', at: '9' }).ok);
  assert.equal(A.validate('manage_routine', { action: 'pausar' }).ok, false, 'los valores del enum son ASCII y en inglés, como el resto');
});

test('la selección manda «pausá/cambiá la rutina» a las rutinas, no a la música ni a la memoria', () => {
  const { A } = montar();
  assert.equal(A.seleccionar('pausá la rutina del resumen')[0], 'manage_routine');
  assert.equal(A.seleccionar('reanudá la rutina del resumen')[0], 'manage_routine');
  assert.equal(A.seleccionar('cambiá la rutina del resumen a las 9')[0], 'manage_routine');
  assert.equal(A.seleccionar('pausá la música')[0], 'media_control', 'la música sigue yendo a la música');
  assert.equal(A.seleccionar('cambiá el dentista al jueves')[0], 'update_memory', 'corregir un recuerdo sigue yendo a la memoria');
});
