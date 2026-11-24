import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const source = new URL('../src/providers/qwen/client.mjs', import.meta.url).href;

test('native structured upstream errors fail the completion without a synthetic retry', async () => {
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    const source = ${JSON.stringify(source)};
    const proxyStub = 'data:text/javascript,' + encodeURIComponent(
      'export const getQwenBrowserProxy=async()=>globalThis.proxy; export const resetQwenBrowserProxy=async()=>{globalThis.resetCalls++;};');
    const code = fs.readFileSync(new URL(source), 'utf8').replace(/from "(\\.[^"]+)"/g, (_, specifier) =>
      'from ' + JSON.stringify(specifier === './browser-proxy.mjs' ? proxyStub : new URL(specifier, source).href));
    const { QwenChatClient } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
    const variants = [
      ['error object', { error: { code: 'internal_error', details: 'Произошла непредвиденная ошибка.' }, response_id: 'r1', response_index: 0 }],
      ['success false data', { success: false, data: { code: 'internal_error', details: 'Произошла непредвиденная ошибка.' }, response_id: 'r1', response_index: 0 }],
      ['partial then error', { error: { code: 'internal_error', details: 'Произошла непредвиденная ошибка.' }, response_id: 'r1', response_index: 0 }],
    ];
    for (const [label, payload] of variants) {
      let nativeCalls = 0, syntheticCalls = 0, createChatCalls = 0;
      globalThis.resetCalls = 0;
      const events = [];
      if (label === 'partial then error') events.push('data: ' + JSON.stringify({ response_id: 'r1', content: 'partial answer' }) + '\\n\\n');
      events.push('data: ' + JSON.stringify(payload) + '\\n\\n', 'data: [DONE]\\n\\n');
      const raw = events.join('');
      globalThis.proxy = {
        pendingCompletionRequests: () => 0,
        async submitNativeTurn({ onRawChunk }) {
          nativeCalls++;
          onRawChunk(raw);
          return { ok: true, status: 200, contentType: 'text/event-stream', text: raw };
        },
        async proxyFetch() { syntheticCalls++; throw new Error('synthetic POST forbidden'); },
        async proxyFetchStream() { syntheticCalls++; throw new Error('synthetic POST forbidden'); },
      };
      const client = new QwenChatClient({ token: '', cookieHeader: '' });
      client.createChat = async () => { createChatCalls++; return 'fresh-chat'; };
      await assert.rejects(client.complete({ chatId: 'saved-chat', parentId: 'saved-parent', prompt: 'diagnostic prompt',
        model: 'qwen-native-model', thinking: false, search: false }), error => {
        assert.equal(error.code, 'QWEN_UPSTREAM_ERROR', label);
        assert.equal(error.delivery, 'rejected', label);
        assert.equal(error.upstreamCode, 'internal_error', label);
        assert.equal(error.qwenTurn?.chatId, 'saved-chat', label);
        assert.equal(error.qwenTurn?.parentMessageId, 'saved-parent', label);
        return true;
      });
      assert.equal(nativeCalls, 1, label + ': native request must be submitted once');
      assert.equal(syntheticCalls, 0, label + ': no synthetic POST or stream fallback');
      assert.equal(createChatCalls, 0, label + ': must not create a replacement chat');
      assert.equal(globalThis.resetCalls, 0, label + ': must not reset proxy/retry');
    }
  `;
  await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, QWEN_TRANSPORT: 'browser', QWEN_COMPLETION_MIN_INTERVAL_MS: '0',
      QWEN_AUTO_RETRY_MAX_ATTEMPTS: '1', QWEN_AUTO_RETRY_BASE_DELAY_MS: '0', QWEN_AUTO_RETRY_MAX_DELAY_MS: '0' },
    timeout: 15_000,
  });
});

test('ordinary assistant text mentioning internal_error remains a successful answer', async () => {
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    const source = ${JSON.stringify(source)};
    const proxyStub = 'data:text/javascript,' + encodeURIComponent('export const getQwenBrowserProxy=async()=>globalThis.proxy; export const resetQwenBrowserProxy=async()=>{};');
    const code = fs.readFileSync(new URL(source), 'utf8').replace(/from "(\\.[^"]+)"/g, (_, specifier) =>
      'from ' + JSON.stringify(specifier === './browser-proxy.mjs' ? proxyStub : new URL(specifier, source).href));
    const { QwenChatClient } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
    const raw = 'data: ' + JSON.stringify({ response_id: 'r1', content: 'The literal internal_error string is part of this diagnostic.' }) + '\\n\\ndata: [DONE]\\n\\n';
    globalThis.proxy = { pendingCompletionRequests: () => 0, async submitNativeTurn({ onRawChunk }) {
      onRawChunk(raw); return { ok: true, status: 200, contentType: 'text/event-stream', text: raw };
    } };
    const client = new QwenChatClient({ token: '', cookieHeader: '' });
    const result = await client.complete({ chatId: 'saved-chat', parentId: 'saved-parent', prompt: 'diagnostic prompt', model: 'qwen-native-model' });
    assert.match(result.text, /literal internal_error string/);
  `;
  await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, QWEN_TRANSPORT: 'browser', QWEN_COMPLETION_MIN_INTERVAL_MS: '0' }, timeout: 15_000,
  });
});

test('native A/B stream ignores index-1 internal_error and returns the index-0 answer', async () => {
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    const source = ${JSON.stringify(source)};
    const proxyStub = 'data:text/javascript,' + encodeURIComponent(
      'export const getQwenBrowserProxy=async()=>globalThis.proxy; export const resetQwenBrowserProxy=async()=>{globalThis.resetCalls++;};');
    const code = fs.readFileSync(new URL(source), 'utf8').replace(/from "(\\.[^"]+)"/g, (_, specifier) =>
      'from ' + JSON.stringify(specifier === './browser-proxy.mjs' ? proxyStub : new URL(specifier, source).href));
    const { QwenChatClient } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
    const events = [
      { 'response.created': { response_id: 'secondary', response_index: 1 } },
      { 'response.created': { response_id: 'primary', response_index: 0 } },
      { response_id: 'secondary', error: { code: 'internal_error', details: 'Произошла непредвиденная ошибка.' } },
      { response_id: 'primary', id: 'primary-answer', role: 'assistant', content: 'Primary answer is valid.' },
    ].map(event => 'data: ' + JSON.stringify(event) + '\\n\\n');
    const raw = events.join('') + 'data: [DONE]\\n\\n';
    let nativeCalls = 0, syntheticCalls = 0;
    globalThis.resetCalls = 0;
    globalThis.proxy = {
      pendingCompletionRequests: () => 0,
      async submitNativeTurn({ onRawChunk }) {
        nativeCalls++;
        onRawChunk(raw);
        return { ok: true, status: 200, contentType: 'text/event-stream', text: raw };
      },
      async proxyFetch() { syntheticCalls++; throw new Error('synthetic request forbidden'); },
      async proxyFetchStream() { syntheticCalls++; throw new Error('synthetic request forbidden'); },
    };
    const client = new QwenChatClient({ token: '', cookieHeader: '' });
    const result = await client.complete({ chatId: 'saved-chat', parentId: 'saved-parent', prompt: 'diagnostic prompt',
      model: 'qwen-native-model', thinking: false, search: false });
    assert.equal(result.text, 'Primary answer is valid.');
    assert.equal(result.lastMessageId, 'primary-answer');
    assert.equal(nativeCalls, 1);
    assert.equal(syntheticCalls, 0);
    assert.equal(globalThis.resetCalls, 0);
  `;
  await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, QWEN_TRANSPORT: 'browser', QWEN_COMPLETION_MIN_INTERVAL_MS: '0',
      QWEN_AUTO_RETRY_MAX_ATTEMPTS: '1', QWEN_AUTO_RETRY_BASE_DELAY_MS: '0', QWEN_AUTO_RETRY_MAX_DELAY_MS: '0' },
    timeout: 15_000,
  });
});
