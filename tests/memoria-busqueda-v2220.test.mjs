/* memoria-busqueda-v2220.test.mjs — v2.22.0: buscar en lo guardado como se pregunta hablando.
 * «qué anoté ayer», «qué guardé del médico», «qué dije el martes», «reuniones» → «reunión».
 * node --test tests/memoria-busqueda-v2220.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarAgente } from './evals/harness.mjs';

const AHORA = new Date(2026, 9, 29, 18, 0, 0);   // jueves 29/oct/2026 18:00
const DIA = 86400000;
function montar(items) {
  const r = cargarAgente();
  const M = r.ctx.KiuMem;
  for (const [tipo, texto, haceDias] of items) {
    M.add(tipo, texto);
    M.data[tipo][0].ts = AHORA.getTime() - haceDias * DIA - 3600000;   // una hora antes, ese día
  }
  M.save();
  return { M, A: r.ctx.KiuAgente };
}
const textos = (hits) => Array.from(hits, (h) => h.text);   /* los arreglos vienen de la VM (otro realm) */

test('«qué anoté del médico»: las palabras de la pregunta no cuentan', () => {
  const { M } = montar([['recuerdos', 'el médico dijo que tome menos sal', 3], ['recuerdos', 'comprar pan', 1]]);
  assert.deepEqual(textos(M.search('qué anoté del médico', null, AHORA)), ['el médico dijo que tome menos sal']);
  assert.equal(M.search('qué anoté del médico', null, AHORA).parcial, undefined, 'coincidencia completa, no «parecida»');
});

test('fechas: hoy, ayer, anteayer, esta semana, la semana pasada', () => {
  const { M } = montar([
    ['recuerdos', 'hoy fui al gimnasio', 0], ['recuerdos', 'ayer llamé a mamá', 1], ['notas', 'anteayer pagué la luz', 2],
    ['recuerdos', 'el lunes empecé el curso', 3], ['recuerdos', 'la semana pasada vi a Juan', 8],
  ]);
  assert.deepEqual(textos(M.search('qué anoté ayer', null, AHORA)), ['ayer llamé a mamá']);
  assert.equal(M.search('qué anoté ayer', null, AHORA).fecha, 'ayer');
  assert.deepEqual(textos(M.search('hoy', null, AHORA)), ['hoy fui al gimnasio']);
  assert.deepEqual(textos(M.search('anteayer', null, AHORA)), ['anteayer pagué la luz']);
  assert.equal(M.search('qué guardé esta semana', null, AHORA).length, 4, 'del lunes a hoy');
  assert.deepEqual(textos(M.search('la semana pasada', null, AHORA)), ['la semana pasada vi a Juan']);
});

test('un día de la semana es «el último» (hoy incluido)', () => {
  const { M } = montar([['recuerdos', 'empecé el curso de inglés', 3], ['recuerdos', 'otra cosa', 2]]);
  assert.deepEqual(textos(M.search('qué dije el lunes', null, AHORA)), ['empecé el curso de inglés']);
  assert.equal(M.search('qué dije el lunes', null, AHORA).fecha, 'el lunes');
});

test('«martes» como CONTENIDO: si con la fecha no hay nada, se busca como texto', () => {
  const { M } = montar([['recuerdos', 'el dentista es el martes', 0]]);   // guardado HOY (jueves)
  assert.deepEqual(textos(M.search('dentista martes', null, AHORA)), ['el dentista es el martes']);
  assert.equal(M.search('dentista martes', null, AHORA).fecha, undefined, 'no dice «guardado el martes»: se guardó hoy');
});

test('plurales: «reuniones» encuentra «reunión»', () => {
  const { M } = montar([['recuerdos', 'La reunión con Ana es el jueves', 1]]);
  assert.equal(M.search('reuniones', null, AHORA).length, 1);
});

test('sin coincidencia completa: lo más parecido, marcado como tal', () => {
  const { M } = montar([['recuerdos', 'la clave del wifi está en la heladera', 1], ['recuerdos', 'comprar pan', 1]]);
  const r = M.search('contraseña del wifi', null, AHORA);
  assert.equal(r.parcial, true);
  assert.deepEqual(textos(r), ['la clave del wifi está en la heladera']);
  assert.equal(M.search('hipoteca', null, AHORA).length, 0, 'nada en común: nada');
});

test('lo de antes sigue igual: vacío devuelve todo, se filtra por tipo, sin tildes', () => {
  const { M } = montar([['recuerdos', 'algo', 1], ['notas', 'algo', 1], ['tareas', 'Reunión con Ana', 0]]);
  assert.equal(M.search('', null, AHORA).length, 3);
  assert.equal(M.search('algo', ['notas'], AHORA).length, 1);
  assert.equal(M.search('reunion', null, AHORA).length, 1);
});

test('recall le dice al agente CUÁNDO se guardó cada cosa, y si es «parecido»', () => {
  const { A } = montar([['recuerdos', 'el médico dijo que tome menos sal', 1], ['recuerdos', 'la clave del wifi está en la heladera', 9]]);
  const t = A.get('recall');
  /* recall usa la fecha real del sistema: lo de hace 1 día puede ser «ayer» o una fecha; con que diga CUÁNDO alcanza */
  assert.match(t.run({ query: 'médico' }).text, /^Guardado:\n- \[recuerdo, [^\]]+\] el médico dijo/);
  assert.match(t.run({ query: 'contraseña wifi' }).text, /^No encontré exactamente eso; lo más parecido:\n- \[recuerdo, \d+\/\d+\] la clave del wifi/);
});
