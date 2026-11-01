/* seleccion-v2222.test.mjs — v2.22.2: la selección de herramientas con frases NATURALES (no las de la Prueba).
 * Reportado en el teléfono: «cualquier cosa que digas pregunta si pone la música». La causa no era el modelo: la selección
 * por palabras clave ofrecía la herramienta equivocada («siguiente», «tema» → música; «es el» → corregir recuerdo) y la
 * gramática OBLIGA a elegir entre las ofrecidas. Medido con estas 40 frases: ofrecida 37 → 40, primera 31 → 35.
 * node --test tests/seleccion-v2222.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarAgente } from './evals/harness.mjs';

const FRASES = [
  ['¿cuándo es el dentista?', 'recall'], ['cuándo era la reunión con Ana', 'recall'], ['qué anoté sobre el auto', 'recall'],
  ['despertame mañana a las 7', 'set_alarm'], ['despertame a las 6', 'set_alarm'], ['avisame en media hora', 'set_alarm'],
  ['recordame a las 5 sacar la ropa', 'set_alarm'], ['poneme una alarma para las 8', 'set_alarm'],
  ['agregá la siguiente tarea: pagar el gas', 'manage_task'], ['anotá el tema de la reunión como tarea', 'manage_task'],
  ['tengo que hacer todo el informe, agregalo a tareas', 'manage_task'], ['qué me queda pendiente', 'manage_task'],
  ['terminé la tarea del informe', 'manage_task'], ['sumá a mis tareas llamar a Pedro', 'manage_task'],
  ['pasá a la siguiente canción', 'media_control'], ['poné pausa a la música', 'media_control'], ['subí el volumen', 'media_control'],
  ['siguiente tema', 'media_control'], ['volvé al tema anterior', 'media_control'],
  ['qué tengo en la agenda el viernes', 'read_calendar'], ['tengo algo el lunes?', 'read_calendar'],
  ['la reunión no es el martes, es el jueves', 'update_memory'], ['corregí lo del dentista: es el viernes', 'update_memory'],
  ['el siguiente paso es llamar a Juan, anotalo', 'remember'], ['guardá que mi DNI es 30111222', 'remember'],
  ['qué clima va a hacer mañana', 'get_weather'], ['va a llover hoy', 'get_weather'],
  ['llamá a Pedro', 'call_contact'], ['mandale un mensaje a mamá que llego tarde', 'send_message'],
  ['prendé la linterna', 'device_action'], ['cuánta batería tengo', 'device_action'],
  ['qué notificaciones tengo', 'read_notifications'], ['me escribió el banco?', 'read_sms'],
  ['qué hora es en este momento', 'now'], ['gasté 300 en el super', 'log_expense'], ['cuánto gasté este mes', 'log_expense'],
  ['buscá cuánto sale el dólar', 'web_search'], ['qué alarmas tengo', 'manage_alarm'],
  ['olvidate de lo del dentista', 'forget'], ['pausá la rutina de la mañana', 'manage_routine'],
];


function medir(A, lista) {
  let ofrecida = 0, primera = 0; const faltan = [];
  for (const [p, t] of lista) {
    const sel = A.seleccionar(p);
    if (sel.includes(t)) ofrecida++; else faltan.push(t + ' ← ' + p + ' (ofrece: ' + sel.slice(0, 3).join(', ') + ')');
    if (sel[0] === t) primera++;
  }
  return { ofrecida, primera, faltan };
}

test('frases naturales: la herramienta correcta SIEMPRE se ofrece', () => {
  const m = medir(cargarAgente().ctx.KiuAgente, FRASES);
  assert.equal(m.ofrecida, FRASES.length, 'faltan:\n  ' + m.faltan.join('\n  '));
});

test('frases naturales: la correcta va primera (la que da el ejemplo) en al menos 35 de 40', () => {
  const m = medir(cargarAgente().ctx.KiuAgente, FRASES);
  assert.ok(m.primera >= 35, 'primera en ' + m.primera + ' de ' + FRASES.length + ' (antes del arreglo: 31)');
});

test('la Prueba del teléfono no empeora: la correcta va primera en todos sus pedidos simples', () => {
  const { ctx } = cargarAgente();
  const m = medir(ctx.KiuAgente, ctx.KiuAutoprueba.CASOS.map((c) => [c.pedido, c.tool]));
  assert.equal(m.primera, ctx.KiuAutoprueba.CASOS.length);
});

test('los casos del reporte: «siguiente», «tema» y «es el» ya no secuestran el pedido', () => {
  const A = cargarAgente().ctx.KiuAgente;
  assert.notEqual(A.seleccionar('el siguiente paso es llamar a Juan, anotalo')[0], 'media_control');
  assert.ok(!A.seleccionar('agregá la siguiente tarea: pagar el gas').includes('media_control'));
  assert.ok(!A.seleccionar('¿cuándo es el dentista?').every((t) => t === 'update_memory'), 'antes ofrecía SOLO corregir un recuerdo');
  assert.equal(A.seleccionar('pasá a la siguiente canción')[0], 'media_control', 'la música sigue yendo a la música');
  assert.equal(A.seleccionar('pausá la música')[0], 'media_control');
});

test('cada palabra clave cuenta UNA vez aunque esté con y sin acento', () => {
  const A = cargarAgente().ctx.KiuAgente;
  /* «mañana»/«manana» contaban doble y la agenda le ganaba a la alarma */
  assert.equal(A.seleccionar('despertame mañana a las 7')[0], 'set_alarm');
});
