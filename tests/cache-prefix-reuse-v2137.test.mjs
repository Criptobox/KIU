import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const cpp = fs.readFileSync('app/src/main/cpp/kiullama_jni.cpp', 'utf8');
const gradle = fs.readFileSync('app/build.gradle.kts', 'utf8');
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');

test('KV prefix reuse: only reuses a matching common token prefix', () => {
  assert.match(cpp, /g_cached_prompt_tokens/);
  assert.match(cpp, /g_cached_prompt_tokens\[\(size_t\)reuse_tokens\] == toks\[\(size_t\)reuse_tokens\]/);
  assert.match(cpp, /llama_memory_seq_rm\(prompt_mem, 0, reuse_tokens, -1\)/);
});

test('KV prefix reuse: reevaluates at least the final prompt token', () => {
  assert.match(cpp, /if \(reuse_tokens >= n_prompt\) reuse_tokens = n_prompt - 1/);
  assert.match(cpp, /int done = reuse_tokens/);
  assert.match(cpp, /n_pos = reuse_tokens/);
});

test('KV prefix reuse: invalidates on memory clearing and context shift', () => {
  assert.ok((cpp.match(/g_prompt_cache_valid = false/g) || []).length >= 4);
  assert.match(cpp, /context_shifted = true/);
  assert.match(cpp, /if \(ok && !context_shifted && done == n_prompt\)/);
});

test('Version is bumped consistently for the KV prefix implementation', () => {
  assert.match(gradle, /val kiuVersionName = "2\.14\.0"/);
  assert.match(gradle, /val kiuVersionCode = 91/);
  assert.match(changelog, /^## \[2\.14\.0\]/);
});
