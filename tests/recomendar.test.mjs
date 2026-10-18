/* recomendar.test.mjs — v2.11.0: el recomendador según el teléfono (KiuReco.plan). */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { WWW } from './helpers.mjs';

const win = {};
const ctx = vm.createContext({ window: win, S: { dl: { done: {} } }, console });
vm.runInContext(readFileSync(path.join(WWW, 'js/app/catalog.js'), 'utf8'), ctx);
const { plan } = win.KiuReco;
const G = 1073741824;
const VIS = [
  { g: 'Visión', n: 'Qwen2.5-VL 3B', s: '2,3 GB', r: 4.0, u: 'u3' },
  { g: 'Visión', n: 'Qwen2.5-VL 7B', s: '5,5 GB', r: 7.6, u: 'u7' },
];
const dev = (ram, extra) => Object.assign({ ramTotal: ram * G, diskFree: 50 * G, cores: 8, model: 'T' }, extra || {});

test('sin RAM informada no inventa nada', () => {
  assert.equal(plan({}, {}).unknown, true);
});

test('3 GB: solo modelos chicos, nada pasa del criterio RAM-1', () => {
  const p = plan(dev(3), { vis: VIS });
  assert.equal(p.tier, 'baja');
  assert.ok(p.text.length >= 1);
  for (const t of p.text) assert.ok(t.c.r <= 2, t.c.n);
  assert.equal(p.vision.phone, null);
  assert.ok(p.notes.some((n) => /servidor|nube/.test(n)));
});

test('6 GB: la mejor calidad es la más grande que entra', () => {
  const p = plan(dev(6), { vis: VIS });
  assert.equal(p.tier, 'media');
  const q = p.text.find((t) => t.k === 'quality');
  assert.ok(q && q.c.r <= 5);
  for (const t of p.text) assert.ok(t.c.r <= q.c.r);
  assert.equal(p.vision.phone.n, 'Qwen2.5-VL 3B');
});

test('12 GB: sube a modelos de 8B y la visión de 7B entra en el teléfono', () => {
  const p = plan(dev(12), { vis: VIS });
  assert.equal(p.tier, 'alta');
  assert.ok(p.text.find((t) => t.k === 'quality').c.r >= 8);
  assert.equal(p.vision.phone.n, 'Qwen2.5-VL 7B');
  assert.ok(!p.text.some((t) => t.c.moe), 'el MoE de 18 GB no se recomienda');
});

test('pocos núcleos: no pasa de modelos chicos aunque sobre RAM', () => {
  const p = plan(dev(12, { cores: 4 }), { vis: VIS });
  for (const t of p.text) assert.ok(t.c.r <= 3.5, t.c.n);
  assert.ok(p.notes.some((n) => /núcleos/.test(n)));
});

test('poco espacio libre: excluye lo que no entra en disco y lo avisa', () => {
  const p = plan(dev(12, { diskFree: 1.2 * G }), { vis: VIS });
  for (const t of p.text) assert.ok(t.c.gb * 1.15 <= 1.2, t.c.n);
  const p2 = plan(dev(12, { diskFree: 0.3 * G }), { vis: VIS });
  assert.equal(p2.text.length, 0);
  assert.ok(p2.notes.some((n) => /espacio/.test(n)));
});

test('marca lo que ya está descargado y no repite modelos', () => {
  const base = plan(dev(6), { vis: VIS });
  const f = base.text[0].c.f;
  const p = plan(dev(6), { vis: VIS, done: { [f]: { b: 1 } } });
  assert.equal(p.text[0].done, true);
  const files = p.text.map((t) => t.c.f);
  assert.equal(new Set(files).size, files.length);
});

test('el botón y el método existen en la UI', () => {
  const html = readFileSync(path.join(WWW, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(WWW, 'js/app/app-ui.js'), 'utf8');
  assert.match(html, /id="dev-reco"/);
  assert.match(ui, /recomendar: function \(\)/);
  assert.match(ui, /getElementById\('dev-reco'\)/);
});
