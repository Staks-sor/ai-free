import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveModelMediaCapabilities } from '../src/providers/model-catalog.mjs';

test('connected provider transports expose real image attachment support', () => {
  for (const provider of ['deepseek','qwen','glm','codex','chatgpt','googleai']) {
    assert.equal(resolveModelMediaCapabilities(provider).imageInput, true, provider);
  }
  assert.equal(resolveModelMediaCapabilities('antigravity').imageInput, false);
  assert.equal(resolveModelMediaCapabilities('qwen','qwen3-coder-plus').imageInput, false);
});
test('composer sends image bytes to the selected provider rather than the DeepSeek-only upload route', () => {
  const source = fs.readFileSync(new URL('../src/window-app/ui-html.mjs', import.meta.url),'utf8');
  assert.equal(/const inlineImages = imageFiles\.map/.test(source), true);
  assert.equal(/await api\("\/api\/upload"/.test(source), false);
});
