/* java-jsescape-v2232.test.mjs — v2.23.2: JsEscape (Java) escapa texto del modelo/errores para meterlo en
 * strings que se evalúan en el WebView. Prueba cruzada: Java escapa, JS EVALÚA el resultado y tiene que
 * devolver el texto original EXACTO (ni se cierra el string ni se ejecuta nada).
 * node --test tests/java-jsescape-v2232.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '../app/src/main/java/com/kiu/agent/JsEscape.java');
const HARNESS = path.join(here, 'java/com/kiu/agent/JsEscapeHarness.java');
const ok = spawnSync('javac', ['-version']).status === 0;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const deb64 = (s) => Buffer.from(s, 'base64').toString('utf8');

const CASOS = [
  'hola mundo',
  'comillas "dobles" y \'simples\'',
  'barra \\ y barra-n literal \\n',
  'salto\nde\r\nlínea\ry tab\tadentro',
  '"; window.KiuBridge.sendSms("1","x"); "',
  '\\"; alert(1); //',
  '"}); alert(document.domain); ({"x":"',
  '</script><img src=x onerror=alert(1)>',
  'sep de línea \u2028 y de párrafo \u2029',
  'control \u0000 \u0001 \u0008 \u000c \u001f \u007f',
  'emoji ' + String.fromCodePoint(0x1f600) + ' ñandú áéíóú ' + String.fromCodePoint(0x65e5, 0x672c),
  '',
  '`${alert(1)}`',
];

function escapar(src, casos) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kiu-je-'));
  execFileSync('javac', ['-encoding', 'UTF-8', '-d', out, src]);
  execFileSync('javac', ['-encoding', 'UTF-8', '-cp', out, '-d', out, HARNESS]);
  const r = spawnSync('java', ['-cp', out, 'com.kiu.agent.JsEscapeHarness'],
    { input: casos.map(b64).join('\n') + '\n', encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split('\n').map(deb64);
}

test('evaluado en JS, el escape devuelve el texto exacto (literal JS y JSON)', { skip: ok ? false : 'sin JDK' }, () => {
  const esc = escapar(SRC, CASOS);
  assert.equal(esc.length, CASOS.length);
  CASOS.forEach((txt, i) => {
    assert.ok(!new RegExp('[\\n\\r' + String.fromCharCode(0x2028, 0x2029) + ']').test(esc[i]), 'una sola línea: ' + JSON.stringify(txt));
    const ctx = { hit: false, alert() { ctx.hit = true; }, window: { KiuBridge: { sendSms() { ctx.hit = true; } } } };
    const comoJs = vm.runInNewContext('("' + esc[i] + '")', ctx);
    assert.equal(comoJs, txt, 'literal JS: ' + JSON.stringify(txt));
    assert.equal(JSON.parse('"' + esc[i] + '"'), txt, 'JSON: ' + JSON.stringify(txt));
    const comoObjeto = vm.runInNewContext('({"text":"' + esc[i] + '","ok":true})', ctx);
    assert.equal(comoObjeto.text, txt);
    assert.equal(comoObjeto.ok, true, 'el objeto no se corrompe');
    assert.equal(ctx.hit, false, 'no se ejecutó código inyectado: ' + JSON.stringify(txt));
  });
});

test('el arnés falla con un escape roto (sin escapar comillas)', { skip: ok ? false : 'sin JDK' }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kiu-je-neg-'));
  const roto = path.join(d, 'JsEscape.java');
  fs.writeFileSync(roto, fs.readFileSync(SRC, 'utf8').replace("case '\"': b.append(\"\\\\\\\"\"); break;", ''));
  const esc = escapar(roto, ['"; alert(1); "']);
  assert.throws(() => assert.equal(vm.runInNewContext('("' + esc[0] + '")', { alert() { throw new Error('inyectado'); } }), '"; alert(1); "'));
});

test('todos los escapadores del Java delegan en JsEscape', () => {
  const dir = path.join(here, '../app/src/main/java/com/kiu/agent');
  for (const f of ['KiuGenJob', 'KiuStream', 'KiuDownload', 'KiuVoskInstall']) {
    const j = fs.readFileSync(path.join(dir, f + '.java'), 'utf8');
    assert.match(j, /JsEscape\.esc\(/, f);
    assert.doesNotMatch(j, /\.replace\("\\\\", "\\\\\\\\"\)/, f + ' no arma su propio escape');
  }
});
