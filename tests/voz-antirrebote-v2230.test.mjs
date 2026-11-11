/* voz-antirrebote-v2230.test.mjs — v2.23.0: la misma frase, entregada por el servicio de la
 * palabra de activación Y por el micrófono de la app, se ejecuta UNA vez.
 * node --test tests/voz-antirrebote-v2230.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../app/src/main/assets/www/js/app/app-ui.js', import.meta.url), 'utf8');

function vozDup(reloj) {
  const m = src.match(/var _vozUlt = [\s\S]*?\n      };\n/);
  assert.ok(m, 'existe el antirrebote común de voz');
  const ctx = { App: {}, Date: { now: () => reloj.t } };
  vm.runInNewContext(m[0], ctx);
  return ctx.App.vozDup;
}

test('misma frase en menos de 4 s: la segunda se descarta (sin importar mayúsculas ni espacios)', () => {
  const r = { t: 1000 }, d = vozDup(r);
  assert.equal(d('poné una alarma a las 7'), false);
  r.t += 1500;
  assert.equal(d('  Poné una alarma a las 7 '), true);
});

test('pasados 4 s, la misma frase vuelve a valer; una frase distinta nunca se descarta', () => {
  const r = { t: 1000 }, d = vozDup(r);
  assert.equal(d('qué hora es'), false);
  assert.equal(d('qué día es'), false);
  r.t += 4001;
  assert.equal(d('qué día es'), false);
});

test('una frase vacía no bloquea la siguiente', () => {
  const r = { t: 1000 }, d = vozDup(r);
  assert.equal(d(''), false);
  assert.equal(d(''), false);
  assert.equal(d('hola'), false);
});

test('las dos entradas de voz de la UI pasan por el antirrebote', () => {
  assert.match(src, /window\.nexoOnVoice = function \(text\) \{ if \(App\.vozDup\(text\)\) return;/);
  assert.match(src, /window\.nexoWakeCmd = function \(text\) \{\s*\n\s*if \(App\.vozDup\(text\)\) return;/);
});
