import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const rd = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const job = rd('app/src/main/java/com/kiu/agent/KiuGenJob.java');
const motor = rd('app/src/main/assets/www/js/app/motor.js');
const gradle = rd('app/build.gradle.kts');
const main = rd('app/src/main/java/com/kiu/agent/MainActivity.java');

test('el estado busy se publica entre WebView y worker', () => {
  assert.match(job, /public static volatile boolean busy;/);
});

test('la reserva de generación Java es atómica ante dos solicitudes simultáneas', () => {
  const a = main.indexOf('public boolean kiuGen(String str, int i, float f)');
  const b = main.indexOf('@JavascriptInterface', a + 1);
  const block = main.slice(a, b);
  assert.match(block, /synchronized \(KiuGenJob\.class\)/);
  assert.match(block, /if \(KiuGenJob\.busy\) return false/);
});

test('los reintentos no cortan ni resetean una generación activa a ciegas', () => {
  const a = motor.indexOf('v2.11.21: no interrumpir una generación real');
  const b = motor.indexOf('var afterGen = function ()', a);
  assert.ok(a >= 0 && b > a);
  const block = motor.slice(a, b);
  assert.match(block, /attempt <= 8/);
  assert.doesNotMatch(block, /kiuGenStop|kiuResetBusy/);
  assert.match(block, /no interrumpí la tarea anterior/);
});

test('la reparación incrementa versión Android name y code', () => {
  assert.match(gradle, /val kiuVersionName = "2\.12\.2"/);
  assert.match(gradle, /val kiuVersionCode = 76/);
});
