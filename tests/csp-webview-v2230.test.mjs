/* csp-webview-v2230.test.mjs — v2.23.0: segunda barrera contra XSS en el WebView.
 * node --test tests/csp-webview-v2230.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const R = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = R('app/src/main/assets/www/index.html');
const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
const dir = (n) => (csp.split(';').map((x) => x.trim()).find((x) => x.startsWith(n + ' ')) || '');

test('index.html declara una CSP que no permite scripts inline ni eval', () => {
  assert.ok(csp, 'hay <meta Content-Security-Policy>');
  assert.match(dir('default-src'), /'none'/);
  assert.equal(dir('script-src'), "script-src 'self'");
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.doesNotMatch(dir('script-src'), /unsafe-inline/);
  for (const d of ['object-src', 'base-uri', 'form-action', 'frame-src']) assert.match(dir(d), /'none'/, d);
  assert.doesNotMatch(dir('connect-src'), /\bhttp:/, 'lo http:// va por el proxy Java');
});

test('el HTML no tiene <script> inline ni manejadores on*= (la CSP los rompería)', () => {
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)];
  assert.equal(inline.length, 0, 'todo <script> lleva src');
  assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i);
  assert.match(html, /<script src="js\/kiu-safeboot\.js"><\/script>\s*<\/head>/, 'SafeBoot sigue siendo lo primero en cargar');
});

test('el JS no arma manejadores inline ni javascript: en cadenas HTML', () => {
  const files = execSync("ls app/src/main/assets/www/js/*.js app/src/main/assets/www/js/app/*.js", { cwd: new URL('..', import.meta.url) })
    .toString().trim().split('\n');
  for (const f of files) {
    const t = R(f);
    assert.doesNotMatch(t, /['"][^'"\n]*\son(click|change|input|error|load)=\\?["']/, f + ': onXXX= dentro de HTML');
    assert.doesNotMatch(t, /href=\\?["']javascript:/, f + ': href javascript:');
    assert.doesNotMatch(t, /\beval\(|new Function\(/, f + ': eval');
  }
});

test('el WebView no lee file:// ni content:// y nunca mezcla contenido', () => {
  const j = R('app/src/main/java/com/kiu/agent/MainActivity.java');
  assert.match(j, /setAllowFileAccess\(false\)/);
  assert.match(j, /setAllowContentAccess\(false\)/);
  assert.match(j, /setMixedContentMode\(WebSettings\.MIXED_CONTENT_NEVER_ALLOW\)/);
  assert.match(j, /setAllowUniversalAccessFromFileURLs\(false\)/);
});
