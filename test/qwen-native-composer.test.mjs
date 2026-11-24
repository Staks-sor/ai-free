import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { installQwenNativeCapture } from '../src/providers/qwen/native-composer.mjs';
import { fetchQwenCompletionWithMetrics } from '../src/providers/qwen/client.mjs';

const turn = {
  workerId: 'worker-a',
  turnId: 'turn-a',
  chatId: 'chat-a',
  prompt: 'hello from the composer',
  parentId: 'parent-a',
  model: 'qwen-model-a',
  timeoutMs: 1000,
};

test('the public account proxy exposes native submission without launching a browser', async () => {
  const { getQwenBrowserProxy, closeQwenBrowserProxy } = await import('../src/providers/qwen/browser-proxy.mjs');
  const proxy = await getQwenBrowserProxy({ accountId: 'native-facade-test' });
  try { assert.equal(typeof proxy.submitNativeTurn, 'function'); }
  finally { await closeQwenBrowserProxy('native-facade-test'); }
});

function completionRequest({ chatId = turn.chatId, prompt = turn.prompt,
  parentId = turn.parentId, model = turn.model, files } = {}) {
  const userMessage = { role: 'user', content: prompt, parentId, parent_id: parentId };
  if (files !== undefined) userMessage.files = files;
  return {
    url: `https://chat.qwen.ai/api/v2/chat/completions?chat_id=${encodeURIComponent(chatId)}`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-qwen-web': 'preserve-me' },
      body: JSON.stringify({
        chatId,
        chat_id: chatId,
        parentId,
        parent_id: parentId,
        model,
        messages: [userMessage],
      }),
    },
  };
}

function responseWithChunks(chunks) {
  const makeBody = () => {
    let index = 0;
    return { getReader: () => ({
      async read() { return index < chunks.length ? { done: false, value: Buffer.from(chunks[index++]) } : { done: true }; },
      releaseLock() {},
    }) };
  };
  return {
    ok: true,
    status: 200,
    headers: { get: name => name.toLowerCase() === 'content-type' ? 'text/event-stream' : null },
    body: makeBody(),
    clone() { return { ...this, body: makeBody(), clone: this.clone }; },
  };
}

async function installInFakePage(originalFetch, turnOverrides = {}) {
  const bridged = [];
  const page = {
    fetch: originalFetch,
    location: { href: 'https://chat.qwen.ai/c/chat-a', origin: 'https://chat.qwen.ai' },
    __qwenRawStreamChunk: async (workerId, chunk) => { bridged.push({ workerId, chunk }); return true; },
  };
  const context = vm.createContext({
    window: page,
    turn: { ...turn, ...turnOverrides },
    location: page.location,
    URL,
    URLSearchParams,
    AbortController,
    TextDecoder,
    setTimeout,
    clearTimeout,
    JSON,
    Promise,
    Error,
    String,
    Number,
    Boolean,
  });
  await vm.runInContext(`(${installQwenNativeCapture.toString()})(turn)`, context, {
    timeout: 1000,
    contextCodeGeneration: { strings: false, wasm: false },
  });
  return { page, bridged };
}

test('a proven empty root follows exactly the chat created by the native composer', async () => {
  const calls = [];
  const createdId = 'native-chat';
  const { page } = await installInFakePage(async (url, init) => {
    calls.push(url);
    if (url.endsWith('/api/v2/chats/new')) return { ok: true, clone: () => ({ json: async () => ({ success: true, data: { id: createdId } }) }) };
    return responseWithChunks(['data: [DONE]\n\n']);
  }, { parentId: null, allowNativeRootChat: true });
  await page.fetch('https://chat.qwen.ai/api/v2/chats/new', { method: 'POST', body: JSON.stringify({ models: [turn.model] }) });
  const request = completionRequest({ chatId: createdId, parentId: null });
  await page.fetch(request.url, request.init);
  const capture = await waitForCapture(page);
  assert.deepEqual(JSON.parse(JSON.stringify(capture.bootstrap)), { previousChatId: turn.chatId, chatId: createdId });
  assert.equal(capture.result.status, 200);
  assert.equal(calls.length, 2);
  capture.dispose();
});

test('an empty-root attestation cannot accept an unrelated completion chat', async () => {
  let completions = 0;
  const { page } = await installInFakePage(async url => {
    if (url.endsWith('/api/v2/chats/new')) return { ok: true, clone: () => ({ json: async () => ({ success: true, data: { id: 'native-chat' } }) }) };
    completions++;
    return responseWithChunks([]);
  }, { parentId: null, allowNativeRootChat: true });
  await page.fetch('https://chat.qwen.ai/api/v2/chats/new', { method: 'POST', body: JSON.stringify({ models: [turn.model] }) });
  const request = completionRequest({ chatId: 'unrelated', parentId: null });
  await assert.rejects(page.fetch(request.url, request.init));
  assert.equal(completions, 0);
  page.__synvoxQwenNativeCapture.dispose();
});

test('a native chat creation for another model cannot attest a replacement', async () => {
  let requests = 0;
  const { page } = await installInFakePage(async () => { requests++; return responseWithChunks([]); },
    { parentId: null, allowNativeRootChat: true });
  await assert.rejects(page.fetch('https://chat.qwen.ai/api/v2/chats/new', { method: 'POST', body: JSON.stringify({ models: ['other-model'] }) }));
  assert.equal(requests, 0);
  page.__synvoxQwenNativeCapture.dispose();
});

test('Stop during native root creation aborts that request before the page can post a model turn', async () => {
  let finish, forwarded;
  const { page } = await installInFakePage((_url, init) => {
    forwarded = init.signal;
    return new Promise(resolve => { finish = resolve; });
  }, { parentId: null, allowNativeRootChat: true });
  const pending = page.fetch('https://chat.qwen.ai/api/v2/chats/new', { method: 'POST', body: JSON.stringify({ models: [turn.model] }) });
  page.__synvoxQwenNativeCapture.controller.abort();
  finish({ ok: true, clone: () => ({ json: async () => ({ success: true, data: { id: 'native-chat' } }) }) });
  await assert.rejects(pending, error => error.code === 'ABORT_ERR' && error.delivery === 'not_sent');
  assert.equal(forwarded.aborted, true);
  assert.equal(page.__synvoxQwenNativeCapture.started, false);
  page.__synvoxQwenNativeCapture.dispose();
});

test('a failed native root creation settles capture as not sent', async () => {
  const { page } = await installInFakePage(async () => { throw new Error('network interrupted'); },
    { parentId: null, allowNativeRootChat: true });
  await assert.rejects(page.fetch('https://chat.qwen.ai/api/v2/chats/new', { method: 'POST', body: JSON.stringify({ models: [turn.model] }) }));
  assert.equal(page.__synvoxQwenNativeCapture.error?.code, 'QWEN_BROWSER_TRANSPORT_FAILURE');
  assert.equal(page.__synvoxQwenNativeCapture.error?.delivery, 'not_sent');
  page.__synvoxQwenNativeCapture.dispose();
});

async function waitForCapture(page, timeoutMs = 1000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const capture = page.__synvoxQwenNativeCapture;
    if (capture?.result || capture?.error) return capture;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  throw new Error('Timed out waiting for native capture result');
}

test('captures the matching native composer POST once and tees SSE without consuming the page response', async () => {
  const calls = [];
  const originalFetch = async (...args) => {
    calls.push(args);
    return responseWithChunks(['data: {"delta":"hi"}\n\n', 'data: [DONE]\n\n']);
  };
  const { page, bridged } = await installInFakePage(originalFetch);
  const request = completionRequest();
  const response = await page.fetch(request.url, request.init);
  const pageReader = response.body.getReader();
  const pageChunks = [];
  for (;;) {
    const part = await pageReader.read();
    if (part.done) break;
    pageChunks.push(new TextDecoder().decode(part.value));
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], request.url);
  assert.equal(calls[0][1].body, request.init.body);
  assert.equal(calls[0][1].headers['x-qwen-web'], 'preserve-me');
  assert.equal(pageChunks.join(''), 'data: {"delta":"hi"}\n\ndata: [DONE]\n\n');
  const capture = await waitForCapture(page);
  assert.deepEqual(bridged.map(item => item.workerId), ['worker-a', 'worker-a']);
  assert.equal(bridged.map(item => item.chunk).join(''), pageChunks.join(''));
  assert.equal(capture.turnId, 'turn-a');
  assert.equal(capture.started, true);
  assert.equal(capture.result.text, pageChunks.join(''));
});

test('rejects a mismatched chat, parent, model, or prompt before dispatch', async t => {
  for (const [label, options] of [
    ['chat', { chatId: 'other-chat' }],
    ['parent', { parentId: 'other-parent' }],
    ['model', { model: 'other-model' }],
    ['prompt', { prompt: 'different prompt' }],
  ]) {
    await t.test(label, async () => {
      let calls = 0;
      const { page } = await installInFakePage(async () => { calls += 1; return responseWithChunks([]); });
      const request = completionRequest(options);
      await assert.rejects(page.fetch(request.url, request.init));
      assert.equal(calls, 0, `${label} mismatch must be rejected before original fetch`);
    });
  }
});

test('rejects missing, duplicate, or incomplete native image file ids before dispatch', async t => {
  for (const [label, imageCount, files] of [
    ['missing files', 1, undefined],
    ['duplicate ids', 2, [{ id: 'file-a' }, { file: { id: 'file-a' } }]],
    ['missing id', 1, [{ file: {} }]],
    ['URL reference is not an image', 1, [{ type: 'file', file_class: 'url', file_type: null, url: 'https://example.org/reference' }]],
  ]) {
    await t.test(label, async () => {
      let calls = 0;
      const { page } = await installInFakePage(async () => {
        calls += 1;
        return responseWithChunks([]);
      }, { imageCount });
      const request = completionRequest({ files });
      await assert.rejects(page.fetch(request.url, request.init), error => error.code === 'QWEN_NATIVE_IMAGE_MISMATCH');
      assert.equal(calls, 0, `${label} must be rejected before original fetch`);
      page.__synvoxQwenNativeCapture.dispose();
    });
  }
});

test('preserves native image request bytes and captures exact provider file ids', async () => {
  const calls = [];
  const files = [{ file: { id: 'provider-image-a' }, name: 'first.png' }, { id: 'provider-image-b', name: 'second.jpg' }];
  const { page } = await installInFakePage(async (...args) => {
    calls.push(args);
    return responseWithChunks(['data: [DONE]\\n\\n']);
  }, { imageCount: files.length });
  const request = completionRequest({ files });
  await page.fetch(request.url, request.init);
  const capture = await waitForCapture(page);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].body, request.init.body);
  assert.equal(calls[0][1].headers['x-qwen-web'], 'preserve-me');
  assert.deepEqual(JSON.parse(JSON.stringify(capture.result.qwenImageFileIds)), ['provider-image-a', 'provider-image-b']);
  capture.dispose();
});

test('native URL references do not count as uploaded images on text or image turns', async t => {
  for (const hasImage of [false, true]) {
    await t.test(hasImage ? 'image and URL reference' : 'text and URL reference', async () => {
      const calls = [];
      const prompt = 'Inspect https://example.org/reference';
      const urlReference = { type: 'file', file_class: 'url', file_type: null, url: 'https://example.org/reference' };
      const files = hasImage ? [{ file: { id: 'provider-image-a' } }, urlReference] : [urlReference];
      const { page } = await installInFakePage(async (...args) => {
        calls.push(args);
        return responseWithChunks(['data: [DONE]\n\n']);
      }, { prompt, imageCount: hasImage ? 1 : 0 });
      try {
        const request = completionRequest({ prompt, files });
        await page.fetch(request.url, request.init);
        const capture = await waitForCapture(page);
        assert.equal(calls.length, 1);
        assert.equal(calls[0][1].body, request.init.body);
        assert.deepEqual(JSON.parse(JSON.stringify(capture.result.qwenImageFileIds)), hasImage ? ['provider-image-a'] : []);
      } finally { page.__synvoxQwenNativeCapture.dispose(); }
    });
  }
});

test('rejects contradictory duplicate identity fields instead of trusting one alias', async t => {
  for (const [label, mutate] of [
    ['chat aliases', body => { body.chatId = 'other-chat'; }],
    ['parent aliases', body => { body.messages[0].parent_id = 'other-parent'; }],
  ]) {
    await t.test(label, async () => {
      let calls = 0;
      const { page } = await installInFakePage(async () => { calls += 1; return responseWithChunks([]); });
      const request = completionRequest();
      const body = JSON.parse(request.init.body);
      mutate(body);
      request.init.body = JSON.stringify(body);
      await assert.rejects(page.fetch(request.url, request.init));
      assert.equal(calls, 0, 'contradictory turn identity must be rejected before dispatch');
    });
  }
});

test('blocks a second matching completion POST and restores the original fetch on dispose', async () => {
  let calls = 0;
  const originalFetch = async () => { calls += 1; return responseWithChunks(['data: [DONE]\n\n']); };
  const { page } = await installInFakePage(originalFetch);
  const request = completionRequest();
  const first = await page.fetch(request.url, request.init);
  const reader = first.body.getReader();
  while (!(await reader.read()).done) {}

  await assert.rejects(page.fetch(request.url, request.init));
  assert.equal(calls, 1);
  page.__synvoxQwenNativeCapture.dispose();
  assert.equal(page.fetch, originalFetch);
  await page.fetch(request.url, request.init);
  assert.equal(calls, 2, 'disposed capture must leave later fetches untouched');
});

test('concurrent matching completion calls can dispatch only one model POST', async () => {
  let calls = 0;
  const { page } = await installInFakePage(async () => {
    calls++;
    return responseWithChunks(['data: [DONE]\n\n']);
  });
  const request = completionRequest();
  const results = await Promise.allSettled([
    page.fetch(request.url, request.init), page.fetch(request.url, request.init),
  ]);
  assert.equal(calls, 1);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const capture = await waitForCapture(page);
  assert.equal(capture.error, null, 'duplicate invocation must not discard the original reply');
  assert.equal(capture.result.status, 200);
  capture.dispose();
});

test('cancellation reaches the in-flight native request through an owned signal', async () => {
  let forwardedSignal;
  const originalFetch = async (_url, init) => {
    forwardedSignal = init.signal;
    return responseWithChunks(['data: [DONE]\n\n']);
  };
  const { page } = await installInFakePage(originalFetch);
  const request = completionRequest();
  const upstream = new AbortController();
  const pending = page.fetch(request.url, { ...request.init, signal: upstream.signal });
  await pending;
  assert.notEqual(forwardedSignal, upstream.signal);
  assert.equal(forwardedSignal.aborted, false);
  upstream.abort('user stopped');
  assert.equal(forwardedSignal.aborted, true);
  assert.equal(forwardedSignal.reason, 'user stopped');
});

test('non-completion fetches pass through unchanged and are not captured', async () => {
  const response = { ok: true, status: 204 };
  const calls = [];
  const originalFetch = async (...args) => { calls.push(args); return response; };
  const { page } = await installInFakePage(originalFetch);
  const options = { method: 'POST', body: 'not a completion' };
  assert.equal(await page.fetch('https://chat.qwen.ai/api/v2/chats/new', options), response);
  assert.deepEqual(calls, [['https://chat.qwen.ai/api/v2/chats/new', options]]);
  assert.equal(page.__synvoxQwenNativeCapture.started, false);
});

test('completion boundary prefers native submit for an initial body request', async () => {
  const calls = [];
  const nativeTurn = { prompt: turn.prompt, parentId: turn.parentId, model: turn.model,
    thinking: true, search: false, signal: new AbortController().signal };
  const proxy = {
    async submitNativeTurn(options) {
      calls.push(['native', options]);
      options.onRawChunk?.('data: [DONE]\n\n');
      return { ok: true, status: 200, contentType: 'text/event-stream', text: 'data: [DONE]\n\n' };
    },
    async proxyFetchStream(options) { calls.push(['stream', options]); throw new Error('initial body must use native composer'); },
  };
  const { parser } = await fetchQwenCompletionWithMetrics(proxy, {
    url: 'https://chat.qwen.ai/api/v2/chat/completions?chat_id=chat-a',
    body: JSON.stringify({ messages: [{ role: 'user', content: turn.prompt }] }),
    chatId: turn.chatId,
    nativeTurn,
  });
  assert.ok(parser, 'native initial turn must keep incremental parsing enabled');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'native');
  const forwarded = calls[0][1];
  assert.equal(forwarded.nativeTurn?.prompt ?? forwarded.prompt, turn.prompt);
  assert.equal(forwarded.nativeTurn?.parentId ?? forwarded.parentId, turn.parentId);
  assert.equal(forwarded.nativeTurn?.model ?? forwarded.model, turn.model);
  assert.equal(forwarded.nativeTurn?.signal ?? forwarded.signal, nativeTurn.signal);
});

test('response_id resume stays on the streaming proxy even when available', async () => {
  const calls = [];
  const proxy = {
    async submitNativeTurn(options) { calls.push(['native', options]); throw new Error('resume must not submit composer'); },
    async proxyFetchStream(options) {
      calls.push(['stream', options]);
      options.onRawChunk?.('data: [DONE]\n\n');
      return { ok: true, status: 200, contentType: 'text/event-stream', text: 'data: [DONE]\n\n' };
    },
  };
  await fetchQwenCompletionWithMetrics(proxy, {
    url: 'https://chat.qwen.ai/api/v2/chat/completions?chat_id=chat-a&response_id=response-a',
    body: '{}',
    chatId: turn.chatId,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'stream');
  assert.match(calls[0][1].url, /response_id=response-a/);
});

test('native progress and invalid-parent errors stop at the same chat without retries or fresh chats', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const source = new URL('../src/providers/qwen/client.mjs', import.meta.url).href;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    const source = ${JSON.stringify(source)};
    const stub = 'data:text/javascript,' + encodeURIComponent(
      'export const getQwenBrowserProxy=async()=>globalThis.proxy; export const resetQwenBrowserProxy=async()=>{};');
    const code = fs.readFileSync(new URL(source), 'utf8').replace(/from "(\\.[^"]+)"/g, (_, specifier) =>
      'from ' + JSON.stringify(specifier === './browser-proxy.mjs' ? stub : new URL(specifier, source).href));
    const { QwenChatClient } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
    const cases = [
      ['progress', { code: 'Bad_Request', details: 'The chat is in progress!' }],
      ['invalid parent', { code: 'Bad_Request', details: 'Invalid input chat parent_id old-parent is not exist.' }],
    ];
    for (const [label, error] of cases) {
      let nativeCalls = 0, syntheticCalls = 0, createChatCalls = 0;
      const event = 'data: ' + JSON.stringify({ success: false, data: error }) + '\\n\\n';
      globalThis.proxy = {
        pendingCompletionRequests: () => 0,
        async submitNativeTurn({ onRawChunk }) {
          nativeCalls += 1;
          onRawChunk(event);
          return { ok: true, status: 200, contentType: 'text/event-stream', text: event };
        },
        async proxyFetch() { syntheticCalls += 1; throw new Error('synthetic POST forbidden'); },
        async proxyFetchStream() { syntheticCalls += 1; throw new Error('synthetic POST forbidden'); },
      };
      const client = new QwenChatClient({ token: '', cookieHeader: '' });
      client.createChat = async () => { createChatCalls += 1; return 'fresh-chat'; };
      await assert.rejects(client.complete({ chatId: 'saved-chat', parentId: 'old-parent',
        prompt: 'continue exact work', model: 'qwen-native-model', thinking: false, search: false, autoRetry: true }),
        err => {
          assert.equal(err.delivery, 'rejected', label);
          assert.equal(err.qwenTurn?.chatId, 'saved-chat', label);
          assert.equal(err.qwenTurn?.parentMessageId, 'old-parent', label);
          assert.equal(err.qwenTurn?.prompt, 'continue exact work', label);
          return true;
        });
      assert.equal(nativeCalls, 1, label + ': native submission must happen once');
      assert.equal(syntheticCalls, 0, label + ': must not fall back to synthetic POST');
      assert.equal(createChatCalls, 0, label + ': must not move to a new chat');
    }
  `], { env: { ...process.env, QWEN_TRANSPORT: 'browser', QWEN_COMPLETION_MIN_INTERVAL_MS: '0',
    QWEN_AUTO_RETRY_MAX_ATTEMPTS: '1', QWEN_AUTO_RETRY_BASE_DELAY_MS: '0', QWEN_AUTO_RETRY_MAX_DELAY_MS: '0' }, timeout: 15_000 });
});

test('client forwards images to the native composer and checkpoints captured provider file ids', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const source = new URL('../src/providers/qwen/client.mjs', import.meta.url).href;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    const source = ${JSON.stringify(source)};
    const stub = 'data:text/javascript,' + encodeURIComponent(
      'export const getQwenBrowserProxy=async()=>globalThis.proxy; export const resetQwenBrowserProxy=async()=>{};');
    const code = fs.readFileSync(new URL(source), 'utf8').replace(/from "(\\.[^"]+)"/g, (_, specifier) =>
      'from ' + JSON.stringify(specifier === './browser-proxy.mjs' ? stub : new URL(specifier, source).href));
    const { QwenChatClient } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
    const images = [{ name: 'first.png', mimeType: 'image/png', dataBase64: 'YWJj' }];
    let forwarded;
    globalThis.proxy = {
      async submitNativeTurn(options) {
        forwarded = options;
        throw Object.assign(new Error('native UI refused after upload'), {
          code: 'QWEN_NATIVE_UI_ERROR', delivery: 'rejected', qwenImageFileIds: ['provider-file-a'],
        });
      },
    };
    const client = new QwenChatClient({ token: '', cookieHeader: '' });
    await assert.rejects(client.complete({ chatId: 'saved-chat', parentId: 'saved-parent',
      prompt: 'inspect image', images, model: 'qwen-native-model', thinking: false, search: false }), error => {
      assert.deepEqual(forwarded.images, images);
      assert.equal(error.qwenTurn?.imageCount, 1);
      assert.deepEqual(error.qwenTurn?.expectedImageFileIds, ['provider-file-a']);
      return true;
    });
  `], { env: { ...process.env, QWEN_TRANSPORT: 'browser', QWEN_COMPLETION_MIN_INTERVAL_MS: '0' }, timeout: 15_000 });
});

test('Stop after composer click aborts capture before any completion fetch arrives', async () => {
  const { submitQwenNativeTurn } = await import('../src/providers/qwen/native-composer.mjs');
  const abort = new AbortController();
  let clicks = 0, captures = 0, fetches = 0;
  const state = { result: null, error: null, controller: new AbortController(), started: false,
    dispose() { this.disposed = true; } };
  const input = { async waitFor() {}, async fill() {}, async inputValue() { return turn.prompt; } };
  const send = { async isEnabled() { return true; }, async click() { clicks += 1; abort.abort(); } };
  const page = {
    locator(selector) {
      if (selector === 'textarea.message-input-textarea') return input;
      if (selector === '.qwen-chat-v2-dropdown-menu-select-label') return { async innerText() { return 'Fast'; } };
      if (selector === '.mode-select-current-mode') return { async count() { return 0; } };
      throw new Error(`Unexpected locator: ${selector}`);
    },
    getByRole(role, options) {
      if (role === 'button' && (options.name instanceof RegExp ? options.name.test('Select Model') : options.name === 'Select Model')) return { async innerText() { return turn.model; } };
      if (role === 'button' && (options.name instanceof RegExp ? options.name.test('Send') : options.name === 'Send')) return send;
      throw new Error(`Unexpected role: ${role} ${options.name}`);
    },
    async evaluate(fn) {
      if (fn.name === 'installQwenNativeCapture') {
        captures += 1;
        state.turnId = turn.turnId;
        page.window.__synvoxQwenNativeCapture = state;
        return;
      }
      if (String(fn).includes('state.dispose()')) {
        state.controller.abort();
        state.dispose();
        delete page.window.__synvoxQwenNativeCapture;
        return;
      }
      if (state) {
        state.error ||= { message: 'stopped', code: 'ABORT_ERR', delivery: state.started ? 'unknown' : 'not_sent' };
        state.controller.abort();
      }
    },
    window: { fetch: async () => { fetches += 1; } },
    async waitForFunction(_predicate, _arg, { timeout }) {
      const until = Date.now() + timeout;
      while (!state.result && !state.error && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 1));
      if (!state.result && !state.error) throw new Error('timeout');
    },
  };
  await assert.rejects(submitQwenNativeTurn(page, { ...turn }, { signal: abort.signal, timeoutMs: 1000 }),
    error => error.name === 'AbortError');
  assert.equal(clicks, 1);
  assert.equal(captures, 1);
  assert.equal(fetches, 0);
  assert.equal(state.controller.signal.aborted, true);
  assert.equal(state.error.delivery, 'not_sent');
  assert.equal(state.disposed, true);
  assert.equal(page.window.__synvoxQwenNativeCapture, undefined);
});

test('retries the composer click once only when the first click produces no POST', async () => {
  const { submitQwenNativeTurn } = await import('../src/providers/qwen/native-composer.mjs');
  let clicks = 0, captures = 0, actualPosts = 0;
  const state = { turnId: turn.turnId, result: null, error: null, started: false,
    controller: new AbortController(), dispose() { this.disposed = true; } };
  const input = { async waitFor() {}, async fill() {}, async inputValue() { return turn.prompt; } };
  const send = { async isEnabled() { return true; }, async click() {
    clicks += 1;
    if (clicks === 2) {
      actualPosts += 1;
      state.started = true;
      state.result = { ok: true, status: 200, text: 'data: [DONE]\n\n', contentType: 'text/event-stream' };
    }
  } };
  const waits = [];
  const page = {
    locator(selector) {
      if (selector === 'textarea.message-input-textarea') return input;
      if (selector === '.qwen-chat-v2-dropdown-menu-select-label') return { async innerText() { return 'Fast'; } };
      if (selector === '.mode-select-current-mode') return { async count() { return 0; } };
      throw new Error(`Unexpected locator: ${selector}`);
    },
    getByRole(role, options) {
      if (role === 'button' && (options.name instanceof RegExp ? options.name.test('Select Model') : options.name === 'Select Model')) return { async innerText() { return turn.model; } };
      if (role === 'button' && (options.name instanceof RegExp ? options.name.test('Send') : options.name === 'Send')) return send;
      throw new Error(`Unexpected role: ${role} ${options.name}`);
    },
    async evaluate(fn, arg) {
      if (fn.name === 'installQwenNativeCapture') { captures += 1; page.window.__synvoxQwenNativeCapture = state; return; }
      if (String(fn).includes('state.dispose()')) { state.dispose(); delete page.window.__synvoxQwenNativeCapture; return; }
      if (String(fn).includes('state?.turnId === turnId')) return state.turnId === arg && state.started === false && !state.error;
      if (String(fn).includes('const { result, error }')) return { result: state.result, error: state.error };
      return undefined;
    },
    window: {},
    async waitForFunction(predicate, _arg, options) {
      waits.push({ predicate: String(predicate), timeout: options.timeout });
      if (vm.runInNewContext(`(${predicate.toString()})()`, { window: page.window })) return;
      throw new Error(`Timeout ${options.timeout}ms exceeded`);
    },
  };

  const result = await submitQwenNativeTurn(page, { ...turn }, { timeoutMs: 15_000 });
  assert.equal(result.status, 200);
  assert.equal(captures, 1, 'retry must keep the same capture guard installed');
  assert.equal(clicks, 2, 'only the no-POST first click may be retried, once');
  assert.equal(actualPosts, 1, 'the guarded second click must create one completion POST');
  assert.ok(waits.some(wait => wait.timeout <= 2_000), 'dispatch wait must be short and bounded');
  assert.equal(state.disposed, true);
});

test('never clicks a third time if the guarded retry also produces no POST', async () => {
  const { submitQwenNativeTurn } = await import('../src/providers/qwen/native-composer.mjs');
  let clicks = 0;
  const state = { turnId: turn.turnId, result: null, error: null, started: false,
    controller: new AbortController(), dispose() { this.disposed = true; } };
  const input = { async waitFor() {}, async fill() {}, async inputValue() { return turn.prompt; } };
  const send = { async isEnabled() { return true; }, async click() { clicks += 1; } };
  const page = {
    locator(selector) {
      if (selector === 'textarea.message-input-textarea') return input;
      if (selector === '.qwen-chat-v2-dropdown-menu-select-label') return { async innerText() { return 'Fast'; } };
      if (selector === '.mode-select-current-mode') return { async count() { return 0; } };
      throw new Error(`Unexpected locator: ${selector}`);
    },
    getByRole(role, options) {
      if (role === 'button' && (options.name instanceof RegExp ? options.name.test('Select Model') : options.name === 'Select Model')) return { async innerText() { return turn.model; } };
      if (role === 'button' && (options.name instanceof RegExp ? options.name.test('Send') : options.name === 'Send')) return send;
      throw new Error(`Unexpected role: ${role} ${options.name}`);
    },
    window: {},
    async evaluate(fn, arg) {
      if (fn.name === 'installQwenNativeCapture') { page.window.__synvoxQwenNativeCapture = state; return; }
      if (String(fn).includes('state.dispose()')) { state.dispose(); delete page.window.__synvoxQwenNativeCapture; return; }
      if (String(fn).includes('state?.turnId === turnId')) return state.turnId === arg && !state.started && !state.error;
      if (String(fn).includes('const { result, error }')) return { result: state.result, error: state.error };
      return undefined;
    },
    async waitForFunction(predicate, _arg, { timeout }) {
      if (vm.runInNewContext(`(${predicate.toString()})()`, { window: page.window })) return;
      throw new Error(`Timeout ${timeout}ms exceeded`);
    },
  };
  await assert.rejects(submitQwenNativeTurn(page, { ...turn }, { timeoutMs: 1000 }), error => {
    assert.equal(error.delivery, 'unknown');
    assert.equal(error.code, 'QWEN_BROWSER_TRANSPORT_FAILURE');
    return true;
  });
  assert.equal(clicks, 2, 'a third click could create a duplicate turn');
  assert.equal(state.started, false, 'the capture never observed a completion POST');
  assert.equal(state.disposed, true);
  assert.equal(page.window.__synvoxQwenNativeCapture, undefined);
});

test('does not click Send again while the native root chat is being created', async () => {
  const { submitQwenNativeTurn } = await import('../src/providers/qwen/native-composer.mjs');
  let clicks = 0;
  const state = { turnId: turn.turnId, started: false, creatingChat: false, result: null, error: null,
    controller: new AbortController(), dispose() {} };
  const input = { async waitFor() {}, async fill() {}, async inputValue() { return turn.prompt; } };
  const send = { async isEnabled() { return true; }, async click() {
    if (++clicks > 1) throw new Error('Send was clicked again during root creation');
    state.creatingChat = true;
  } };
  const page = {
    window: {},
    locator(selector) {
      if (selector === 'textarea.message-input-textarea') return input;
      if (selector === '.qwen-chat-v2-dropdown-menu-select-label') return { async innerText() { return 'Fast'; } };
      if (selector === '.mode-select-current-mode') return { async count() { return 0; } };
      throw new Error(selector);
    },
    getByRole(role, options) { return (options.name instanceof RegExp ? options.name.test('Select Model') : options.name === 'Select Model') ? { async innerText() { return turn.model; } } : send; },
    async evaluate(fn, arg) {
      if (fn.name === 'installQwenNativeCapture') { page.window.__synvoxQwenNativeCapture = state; return; }
      if (String(fn).includes('state?.turnId === turnId')) return state.turnId === arg && !state.started && !state.error;
      if (String(fn).includes('const { result, error }')) return { result: state.result, error: state.error };
    },
    async waitForFunction(predicate, _arg, { timeout }) {
      if (String(predicate).includes('state?.result')) state.result = { ok: true, status: 200 };
      if (!vm.runInNewContext(`(${predicate.toString()})()`, { window: page.window })) throw new Error(`Timeout ${timeout}ms exceeded`);
    },
  };
  assert.equal((await submitQwenNativeTurn(page, { ...turn, parentId: null, allowNativeRootChat: true })).status, 200);
  assert.equal(clicks, 1);
});
