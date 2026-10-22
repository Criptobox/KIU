import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const gradle = fs.readFileSync('app/build.gradle.kts', 'utf8');
const core = fs.readFileSync('app/src/main/assets/www/js/rag-worker.js', 'utf8');
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
test('versión Android sube a 2.12.2 / código 76', () => {
  assert.match(gradle, /val kiuVersionName = "2\.12\.2"/);
  assert.match(gradle, /val kiuVersionCode = 76/);
});
test('RAG divide por encabezados y conserva el tema en cada fragmento', () => {
  assert.match(core, /fragmentos semánticos/);
  assert.match(core, /line\.match/);
  assert.match(core, /heading/);
  assert.match(changelog, /## \[2\.12\.2\]/);
});
