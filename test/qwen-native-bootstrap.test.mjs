import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const source = new URL('../src/providers/qwen/client.mjs', import.meta.url).href;

test('native empty-root bootstrap retargets success and failure metadata only when attested', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-native-bootstrap-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const preload = path.join(home, 'isolate-home.mjs');
  fs.writeFileSync(preload, `import os from 'node:os'; import { syncBuiltinESMExports } from 'node:module'; os.homedir = () => process.env.SYNVOX_TEST_RUNTIME_ROOT; syncBuiltinESMExports();`);
  const env = { ...process.env, SYNVOX_TEST_USER_HOME: os.homedir(), SYNVOX_TEST_RUNTIME_ROOT: home,
    QWEN_TRANSPORT: 'browser', QWEN_COMPLETION_MIN_INTERVAL_MS: '0',
    QWEN_AUTO_RETRY_MAX_ATTEMPTS: '1', QWEN_AUTO_RETRY_BASE_DELAY_MS: '0', QWEN_AUTO_RETRY_MAX_DELAY_MS: '0' };
  delete env.NODE_OPTIONS;
  const script = `
    import assert from 'node:assert/strict'; import fs from 'node:fs';
    const source = ${JSON.stringify(source)};
    const stub = 'data:text/javascript,' + encodeURIComponent(
      'export const getQwenBrowserProxy=async()=>globalThis.proxy; export const resetQwenBrowserProxy=async()=>{};'
    );
    const code = fs.readFileSync(new URL(source), 'utf8').replace(/from (["'])(\\.[^"']+)\\1/g, (_, quote, specifier) =>
      'from ' + JSON.stringify(specifier === './browser-proxy.mjs' ? stub : new URL(specifier, source).href));
    const { QwenChatClient } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
    const originalChatId = 'api-empty-chat';
    const nativeChatId = 'spa-native-chat';
    const emptyHistory = { ok: true, json: { success: true, data: { chat: {
      messages: [], history: { currentId: null, messages: {}, pagination: { has_more_newer: false, newest_id: null } },
    } } } };
    function makeProxy({ marker, fail = false }) {
      const observed = { allowNativeRootChat: null, nativeCalls: 0 };
      return { observed,
        pendingCompletionRequests: () => 0,
        async proxyApiGet() { return emptyHistory; },
        async submitNativeTurn(options) {
          observed.nativeCalls++;
          observed.allowNativeRootChat = options.allowNativeRootChat;
          if (fail) throw Object.assign(new Error('stream interrupted after dispatch'), {
            delivery: 'unknown', qwenNativeBootstrap: marker,
          });
          const text = 'data: {"id":"response","choices":[{"delta":{"content":"answer"}}]}\\n\\ndata: [DONE]\\n\\n';
          options.onRawChunk?.(text);
          return { ok: true, status: 200, contentType: 'text/event-stream', text, nativeBootstrap: marker };
        },
      };
    }
    const attested = { previousChatId: originalChatId, chatId: nativeChatId };

    globalThis.proxy = makeProxy({ marker: attested });
    const successClient = new QwenChatClient({ token: '', cookieHeader: '' });
    const success = await successClient.complete({ chatId: originalChatId, parentId: null,
      prompt: 'first prompt', model: 'qwen3.8-omni-flash', thinking: false, search: false });
    assert.equal(globalThis.proxy.observed.allowNativeRootChat, true);
    assert.equal(globalThis.proxy.observed.nativeCalls, 1);
    assert.equal(success.recoveredChatId, nativeChatId);
    assert.equal(success.text, 'answer');

    globalThis.proxy = makeProxy({ marker: attested, fail: true });
    const failureClient = new QwenChatClient({ token: '', cookieHeader: '' });
    await assert.rejects(failureClient.complete({ chatId: originalChatId, parentId: null,
      prompt: 'first prompt', model: 'qwen3.8-omni-flash', thinking: false, search: false }), error => {
      assert.equal(error.delivery, 'unknown');
      assert.equal(error.qwenTurn.chatId, nativeChatId);
      assert.deepEqual(error.qwenNativeBootstrap, attested);
      return true;
    });
    assert.equal(globalThis.proxy.observed.allowNativeRootChat, true);

    const explicitMarker = { previousChatId: originalChatId, chatId: nativeChatId };
    globalThis.proxy = makeProxy({ marker: explicitMarker });
    const explicitClient = new QwenChatClient({ token: '', cookieHeader: '' });
    const explicit = await explicitClient.complete({ chatId: originalChatId, parentId: 'pinned-parent',
      prompt: 'continue branch', model: 'qwen3.8-omni-flash', thinking: false, search: false });
    assert.equal(globalThis.proxy.observed.allowNativeRootChat, false);
    assert.equal(explicit.recoveredChatId, undefined, 'explicit branches must ignore bootstrap metadata');

    globalThis.proxy = makeProxy({ marker: { previousChatId: 'another-chat', chatId: nativeChatId }, fail: true });
    const mismatchClient = new QwenChatClient({ token: '', cookieHeader: '' });
    await assert.rejects(mismatchClient.complete({ chatId: originalChatId, parentId: null,
      prompt: 'first prompt', model: 'qwen3.8-omni-flash', thinking: false, search: false }), error => {
      assert.equal(error.qwenTurn.chatId, originalChatId);
      assert.deepEqual(error.qwenNativeBootstrap, { previousChatId: 'another-chat', chatId: nativeChatId });
      return true;
    });
  `;
  await execFileAsync(process.execPath, [`--import=${preload}`, '--input-type=module', '-e', script], {
    cwd: home, env, timeout: 20_000,
  });
});
