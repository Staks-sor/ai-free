import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('a solved native challenge recovers saved history when the original fetch never settles', async () => {
  const { runQwenNativeTurnWithChallenge } = await import('../src/providers/qwen/browser-proxy.mjs');
  let resolveChallenge;
  let recovered = 0;
  const challenge = new Promise(resolve => { resolveChallenge = resolve; });
  const pendingNative = new Promise(() => {});
  const resultPromise = runQwenNativeTurnWithChallenge({
    submit: () => pendingNative,
    challenge,
    solve: async () => true,
    recover: async () => {
      recovered += 1;
      return { ok: true, status: 200, recoveredNativeAnswer: { text: 'saved', lastMessageId: 'reply' } };
    },
  });
  resolveChallenge({ ok: false, status: 0, punish: true });
  const result = await Promise.race([
    resultPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('history fallback was not bounded')), 100)),
  ]);
  assert.deepEqual(result.recoveredNativeAnswer, { text: 'saved', lastMessageId: 'reply' });
  assert.equal(recovered, 1);
});

test('native history fallback is skipped when challenge solving fails and waits for native completion when history is empty', async () => {
  const { runQwenNativeTurnWithChallenge } = await import('../src/providers/qwen/browser-proxy.mjs');
  let resolveChallenge;
  let recoverCalls = 0;
  const challenge = new Promise(resolve => { resolveChallenge = resolve; });
  const nativeResult = { ok: true, status: 200, text: 'eventual native result' };
  let resolveNative;
  const native = new Promise(resolve => { resolveNative = resolve; });
  const failedSolve = runQwenNativeTurnWithChallenge({
    submit: () => native,
    challenge,
    solve: async () => false,
    recover: async () => { recoverCalls += 1; return null; },
  });
  resolveChallenge({ ok: false, status: 0, punish: true });
  const failedResult = await failedSolve;
  assert.equal(failedResult.punish, true);
  assert.equal(recoverCalls, 0);

  let resolveSecondChallenge;
  const secondChallenge = new Promise(resolve => { resolveSecondChallenge = resolve; });
  const pendingResult = runQwenNativeTurnWithChallenge({
    submit: () => native,
    challenge: secondChallenge,
    solve: async () => true,
    recover: async () => null,
  });
  resolveSecondChallenge({ ok: false, status: 0, punish: true });
  resolveNative(nativeResult);
  assert.equal(await pendingResult, nativeResult);
});

test('client returns a saved native history answer without resubmitting or creating another chat', async () => {
  const source = new URL('../src/providers/qwen/client.mjs', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    const source = ${JSON.stringify(source)};
    const proxyStub = 'data:text/javascript,' + encodeURIComponent(
      'export const getQwenBrowserProxy=async()=>globalThis.proxy; export const resetQwenBrowserProxy=async()=>{};');
    const code = fs.readFileSync(new URL(source), 'utf8').replace(/from "(\\.[^"]+)"/g, (_, specifier) =>
      'from ' + JSON.stringify(specifier === './browser-proxy.mjs' ? proxyStub : new URL(specifier, source).href));
    const { QwenChatClient } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
    let nativeCalls = 0, syntheticCalls = 0, createChatCalls = 0;
    globalThis.proxy = {
      pendingCompletionRequests: () => 0,
      async submitNativeTurn() {
        nativeCalls++;
        return { ok: true, status: 200, contentType: 'text/event-stream', text: '',
          recoveredNativeAnswer: { text: 'saved answer', lastMessageId: 'saved-id' } };
      },
      async proxyFetch() { syntheticCalls++; throw new Error('synthetic POST forbidden'); },
      async proxyFetchStream() { syntheticCalls++; throw new Error('synthetic POST forbidden'); },
    };
    const client = new QwenChatClient({ token: '', cookieHeader: '' });
    client.createChat = async () => { createChatCalls++; return 'new-chat'; };
    const result = await client.complete({ chatId: 'saved-chat', parentId: 'saved-parent', prompt: 'continue exact work',
      model: 'qwen-native-model', thinking: false, search: false });
    assert.equal(result.text, 'saved answer');
    assert.equal(result.lastMessageId, 'saved-id');
    assert.equal(nativeCalls, 1);
    assert.equal(syntheticCalls, 0);
    assert.equal(createChatCalls, 0);
  `;
  await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, QWEN_TRANSPORT: 'browser', QWEN_COMPLETION_MIN_INTERVAL_MS: '0',
      QWEN_AUTO_RETRY_MAX_ATTEMPTS: '1', QWEN_AUTO_RETRY_BASE_DELAY_MS: '0', QWEN_AUTO_RETRY_MAX_DELAY_MS: '0' },
    timeout: 15_000,
  });
});
