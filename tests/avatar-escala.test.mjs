// Regresión v2.7.5: los movimientos del cuerpo del bot deben escalar con su tamaño (--u = tamaño/190).
// Antes eran px fijos pensados para el bot de 190 px: en el mini de 36 px "iba de un lado a otro".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync('app/src/main/assets/www/js/kiu-avatar.js', 'utf8');
const css = eval(src.match(/var CSS=(".*?");\nvar SVG/s)[1]);

test('keyframes del cuerpo escalan con --u (sin px sueltos)', () => {
  for (const n of ['fl', 'nd', 'sw', 'sd', 'bn', 'tr', 'sh', 'sk', 'hp', 'ds', 'jt', 'zg', 'ld', 'vb', 'tb', 'jp']) {
    const m = css.match(new RegExp('@keyframes ' + n + '\\{.*'));
    const body = m[0].split('@keyframes')[1];
    const sinCalc = body.replace(/calc\(var\(--u,1\)\*-?[\d.]+px\)/g, '');
    assert.doesNotMatch(sinCalc.split('}}')[0], /\d+px/, 'keyframes ' + n + ' con px fijos');
  }
});

test('el montaje y el resize fijan --u', () => {
  assert.equal((src.match(/setProperty\('--u'/g) || []).length, 2);
});
