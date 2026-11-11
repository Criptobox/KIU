/* markdown-xss-v2230.test.mjs — v2.23.0: el renderizador de markdown (js/app/markdown.js) es la
 * frontera de seguridad del chat: lo que escribe el modelo o una web no puede inyectar HTML.
 * node --test tests/markdown-xss-v2230.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarAgente } from './evals/harness.mjs';

const md = (t) => cargarAgente().ctx.KiuMd.render(t);

test('<script> e <img onerror> salen escapados, nunca como etiquetas', () => {
  const h = md('hola <script>alert(1)</script> <img src=x onerror=alert(1)>');
  assert.doesNotMatch(h, /<script/i);
  assert.doesNotMatch(h, /<img/i);
  assert.match(h, /&lt;script&gt;/);
});

test('los enlaces solo aceptan http(s): javascript: y data: quedan como texto', () => {
  assert.doesNotMatch(md('[x](javascript:alert(1))'), /<a /);
  assert.doesNotMatch(md('[x](data:text/html;base64,AAAA)'), /<a /);
  assert.match(md('[web](https://ejemplo.com/a)'), /<a href="https:\/\/ejemplo\.com\/a" class="msg-link"/);
});

test('una comilla en la URL no rompe el atributo href', () => {
  const h = md('[x](https://a.com/"onmouseover="alert(1))');
  assert.doesNotMatch(h, /"onmouseover=/, 'la comilla queda escapada como &quot;');
});

test('un bloque de código no ejecuta ni interpreta su contenido', () => {
  const h = md('```\n<b onclick="x()">hola</b> **no negrita**\n```');
  assert.doesNotMatch(h, /<b onclick/);
  assert.match(h, /&lt;b onclick=&quot;x\(\)&quot;&gt;/);
  assert.doesNotMatch(h, /<b>no negrita/);
});

test('la tarjeta de error: el botón solo lleva una acción kiu:// y el texto va escapado', () => {
  const h = md('!! **Falló** <img src=x onerror=1>\n!! → [Reintentar](kiu://reintentar)');
  assert.match(h, /data-kiu-act="kiu:\/\/reintentar"/);
  assert.doesNotMatch(h, /<img/i);
});

test('lo básico sigue funcionando: negrita, lista, título y salto de línea', () => {
  const h = md('# Título\n**fuerte** y *suave*\n- uno\n- dos\n1. a\n2. b');
  assert.match(h, /<h4>Título<\/h4>/);
  assert.match(h, /<b>fuerte<\/b>/);
  assert.match(h, /<i>suave<\/i>/);
  assert.match(h, /<ul><li>uno<\/li><li>dos<\/li><\/ul>/);
  assert.match(h, /<ol><li>a<\/li><li>b<\/li><\/ol>/);
});
