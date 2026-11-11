/* java-wakededupe-v2230.test.mjs — v2.23.0: WakeDedupe (extraído de MainActivity) se EJECUTA en una JVM.
 * node --test tests/java-wakededupe-v2230.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '../app/src/main/java/com/kiu/agent/WakeDedupe.java');
const HARNESS = path.join(here, 'java/com/kiu/agent/WakeDedupeHarness.java');
const ok = spawnSync('javac', ['-version']).status === 0;

function correr(src) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kiu-wd-'));
  execFileSync('javac', ['-encoding', 'UTF-8', '-d', out, src]);
  execFileSync('javac', ['-encoding', 'UTF-8', '-cp', out, '-d', out, HARNESS]);
  const r = spawnSync('java', ['-cp', out, 'com.kiu.agent.WakeDedupeHarness'], { encoding: 'utf8' });
  return { r, txt: (r.stdout || '') + (r.stderr || '') };
}

test('WakeDedupe cumple su contrato en una JVM', { skip: ok ? false : 'sin JDK' }, () => {
  const { r, txt } = correr(SRC);
  assert.equal(r.status, 0, txt);
  assert.match(txt, /checks=9 fails=0/);
});

test('el arnés falla con un WakeDedupe roto (no pasa siempre)', { skip: ok ? false : 'sin JDK' }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kiu-wd-neg-'));
  const roto = path.join(d, 'WakeDedupe.java');
  fs.writeFileSync(roto, fs.readFileSync(SRC, 'utf8').replace('ahoraMs - ultimoEn < ventanaMs', 'true'));
  const { r, txt } = correr(roto);
  assert.notEqual(r.status, 0);
  assert.match(txt, /FAIL/);
});

test('MainActivity usa WakeDedupe y ya no guarda el estado a mano', () => {
  const j = fs.readFileSync(path.join(here, '../app/src/main/java/com/kiu/agent/MainActivity.java'), 'utf8');
  assert.match(j, /new WakeDedupe\(4000\)/);
  assert.doesNotMatch(j, /lastWakeCmd/);
});
