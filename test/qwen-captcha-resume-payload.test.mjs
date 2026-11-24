import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { renderWindowHtml } from '../src/window-app/ui-html.mjs';

function resumeHarness() {
  const html = renderWindowHtml({ language: 'ru' });
  const start = html.indexOf('async function resumeQwenCaptcha(');
  const end = html.indexOf('\n\n    // Кнопка «Стоп»', start);
  assert.ok(start >= 0 && end > start, 'expected the CAPTCHA resume function in rendered UI');
  const calls = [];
  const resume = vm.runInNewContext(`(${html.slice(start, end).trim()})`, {
    api: async url => ({ conversation: { id: 'chat', provider: 'qwen' } }),
    postStreamingMessage: async (...args) => calls.push(JSON.parse(JSON.stringify(args))),
  });
  return { calls, resume };
}

test('coding CAPTCHA resume sends continuation in the server-recognized content field', async () => {
  const { calls, resume } = resumeHarness();
  await resume('chat', true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 3), ['chat', { content: 'продолжи' }, 'qwen']);
  assert.deepEqual(calls[0][3], { id: 'chat', provider: 'qwen' });
});

test('normal chat CAPTCHA resume preserves the saved-turn resume flag', async () => {
  const { calls, resume } = resumeHarness();
  await resume('chat', false);
  assert.deepEqual(calls[0].slice(0, 3), ['chat', { resumeQwenCaptcha: true }, 'qwen']);
});
