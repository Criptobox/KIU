/* java-proxypolicy-v2232.test.mjs — v2.23.0: ProxyPolicy (extraído de MainActivity) se EJECUTA en una JVM.
 * node --test tests/java-proxypolicy-v2232.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '../app/src/main/java/com/kiu/agent/ProxyPolicy.java');
const HARNESS = path.join(here, 'java/com/kiu/agent/ProxyPolicyHarness.java');
const ok = spawnSync('javac', ['-version']).status === 0;

function correr(src) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kiu-pp-'));
  execFileSync('javac', ['-encoding', 'UTF-8', '-d', out, src]);
  execFileSync('javac', ['-encoding', 'UTF-8', '-cp', out, '-d', out, HARNESS]);
  const r = spawnSync('java', ['-cp', out, 'com.kiu.agent.ProxyPolicyHarness'], { encoding: 'utf8' });
  return { r, txt: (r.stdout || '') + (r.stderr || '') };
}

test('ProxyPolicy cumple su contrato en una JVM', { skip: ok ? false : 'sin JDK' }, () => {
  const { r, txt } = correr(SRC);
  assert.equal(r.status, 0, txt);
  assert.match(txt, /checks=\d+ fails=0/);
  assert.ok(Number(txt.match(/checks=(\d+)/)[1]) >= 30, 'corrió de verdad');
});

test('el arnés falla con un ProxyPolicy roto (no pasa siempre)', { skip: ok ? false : 'sin JDK' }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kiu-pp-neg-'));
  const roto = path.join(d, 'ProxyPolicy.java');
  fs.writeFileSync(roto, fs.readFileSync(SRC, 'utf8').replace('if (!m.matches()) return false;', ''));
  const { r, txt } = correr(roto);
  assert.notEqual(r.status, 0);
  assert.match(txt, /FAIL/);
});

test('KiuApiProxy delega en ProxyPolicy y ya no duplica la política', () => {
  const j = fs.readFileSync(path.join(here, '../app/src/main/java/com/kiu/agent/KiuApiProxy.java'), 'utf8');
  assert.match(j, /ProxyPolicy\.mayInject/);
  assert.match(j, /ProxyPolicy\.allowed/);
  assert.doesNotMatch(j, /PROVIDER_HOSTS|hostMatches/);
});
