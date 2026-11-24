import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { installQwenNativeCapture } from '../src/providers/qwen/native-composer.mjs';

const turn = {
  workerId: 'worker-baxia', turnId: 'turn-baxia', chatId: 'chat-baxia',
  prompt: 'resume the saved turn', parentId: 'parent-baxia', model: 'qwen-baxia-model', timeoutMs: 1000,
};
const url = `https://chat.qwen.ai/api/v2/chat/completions?chat_id=${turn.chatId}`;
const rawBody = JSON.stringify({
  chat_id: turn.chatId, chatId: turn.chatId, parent_id: turn.parentId, parentId: turn.parentId,
  model: turn.model, messages: [{ role: 'user', content: turn.prompt, parent_id: turn.parentId, parentId: turn.parentId }],
});

function sseResponse(text = 'data: {"delta":"replayed answer"}\n\ndata: [DONE]\n\n') {
  const body = () => {
    let sent = false;
    return { getReader: () => ({
      async read() { if (sent) return { done: true }; sent = true; return { done: false, value: Buffer.from(text) }; },
      releaseLock() {},
    }) };
  };
  return { ok: true, status: 200, headers: { get: key => key.toLowerCase() === 'content-type' ? 'text/event-stream' : null },
    body: body(), clone() { return { ...this, body: body(), clone: this.clone }; } };
}

async function fixture(originalFetch, { initialCookie = '', chunks = [] } = {}) {
  const page = { fetch: originalFetch, location: { href: `https://chat.qwen.ai/c/${turn.chatId}`, origin: 'https://chat.qwen.ai' },
    document: { cookie: initialCookie }, __qwenRawStreamChunk: async (_workerId, chunk) => { chunks.push(chunk); return true; } };
  page.__originalFetchForTest = originalFetch;
  const context = vm.createContext({ window: page, document: page.document, location: page.location,
    URL, URLSearchParams, AbortController, TextDecoder, setTimeout, clearTimeout,
    JSON, Promise, Error, String, Number, Boolean,
  });
  await vm.runInContext(`'use strict'; (${installQwenNativeCapture.toString()})(${JSON.stringify(turn)})`, context, { timeout: 1000 });
  page.__testContext = context;
  return page;
}

function completionRequest(body = rawBody) {
  return page => page.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
}

async function waitForResult(page) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const state = page.__synvoxQwenNativeCapture;
    if (state.result || state.error) return state;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  throw new Error('native capture did not settle');
}

test('after an observed challenge and fresh x5sec, permits one exact-body composer replay', async () => {
  let calls = 0;
  const page = await fixture(async () => {
    calls++;
    if (calls === 1) return new Promise(() => {});
    return sseResponse();
  });
  try {
    const send = completionRequest();
    const first = send(page);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.__synvoxQwenNativeCapture.started, true);
    page.__synvoxQwenNativeCapture.challengeSeen = true;
    page.document.cookie = 'x5sec=fresh-proof';
    const replayedResponse = await send(page);
    assert.equal(replayedResponse.status, 200);
    const state = await waitForResult(page);
    assert.equal(calls, 2);
    assert.equal(state.result.status, 200);
    assert.match(state.result.text, /replayed answer/);
    void first;
  } finally { page.__synvoxQwenNativeCapture.dispose(); }
});

test('same-body retry without a previously observed challenge is rejected before another POST', async () => {
  let calls = 0;
  const page = await fixture(async () => { calls++; return new Promise(() => {}); });
  const send = completionRequest();
  void send(page);
  await new Promise(resolve => setImmediate(resolve));
  page.document.cookie = 'x5sec=fresh-proof';
  await assert.rejects(send(page));
  assert.equal(calls, 1);
  page.__synvoxQwenNativeCapture.dispose();
});

test('same-body retry without x5sec clearance is rejected before another POST', async () => {
  let calls = 0;
  const page = await fixture(async () => { calls++; return new Promise(() => {}); });
  const send = completionRequest();
  void send(page);
  await new Promise(resolve => setImmediate(resolve));
  page.__synvoxQwenNativeCapture.challengeSeen = true;
  await assert.rejects(send(page));
  assert.equal(calls, 1);
  page.__synvoxQwenNativeCapture.dispose();
});

test('preexisting x5sec does not authorize replay without a changed clearance value', async () => {
  let calls = 0;
  const page = await fixture(async () => { calls++; return new Promise(() => {}); }, { initialCookie: 'x5sec=old-proof' });
  const send = completionRequest();
  void send(page);
  await new Promise(resolve => setImmediate(resolve));
  page.__synvoxQwenNativeCapture.challengeSeen = true;
  await assert.rejects(send(page));
  assert.equal(calls, 1);
  page.__synvoxQwenNativeCapture.dispose();
});

test('challenge clearance cannot authorize a changed completion body', async () => {
  let calls = 0;
  const page = await fixture(async () => { calls++; return new Promise(() => {}); });
  const send = completionRequest();
  void send(page);
  await new Promise(resolve => setImmediate(resolve));
  page.__synvoxQwenNativeCapture.challengeSeen = true;
  page.document.cookie = 'x5sec=fresh-proof';
  const changed = JSON.stringify({ ...JSON.parse(rawBody), messages: [{ role: 'user', content: 'changed prompt', parent_id: turn.parentId, parentId: turn.parentId }] });
  await assert.rejects(completionRequest(changed)(page));
  assert.equal(calls, 1);
  page.__synvoxQwenNativeCapture.dispose();
});

test('a third POST is rejected after one challenge-authorized replay', async () => {
  let calls = 0;
  const page = await fixture(async () => { calls++; return sseResponse(); });
  try {
    const send = completionRequest();
    await send(page);
    await waitForResult(page);
    page.__synvoxQwenNativeCapture.challengeSeen = true;
    page.document.cookie = 'x5sec=fresh-proof';
    await send(page);
    await waitForResult(page);
    await assert.rejects(send(page));
    assert.equal(calls, 2);
  } finally { page.__synvoxQwenNativeCapture.dispose(); }
});

test('late original response after the replay is observed only once', async () => {
  let calls = 0, finishFirst;
  const chunks = [];
  const page = await fixture(async () => {
    calls++;
    if (calls === 1) return new Promise(resolve => { finishFirst = resolve; });
    return sseResponse();
  }, { chunks });
  try {
    const send = completionRequest();
    const first = send(page);
    await new Promise(resolve => setImmediate(resolve));
    page.__synvoxQwenNativeCapture.challengeSeen = true;
    page.document.cookie = 'x5sec=fresh-proof';
    await send(page);
    await waitForResult(page);
    const replayChunkCount = chunks.length;
    finishFirst(sseResponse());
    await first;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 2);
    assert.equal(chunks.length, replayChunkCount);
    assert.equal(chunks.length, 1);
  } finally { page.__synvoxQwenNativeCapture.dispose(); }
});

test('teardown aborts an unresolved original fetch after replay completed the capture', async () => {
  let calls = 0, originalSignal;
  const page = await fixture(async (_url, init) => {
    calls++;
    originalSignal ||= init.signal;
    if (calls === 1) return new Promise(() => {});
    return sseResponse();
  });
  const source = fs.readFileSync(new URL('../src/providers/qwen/native-composer.mjs', import.meta.url), 'utf8');
  const cleanup = source.match(/if \(installed\) await page\.evaluate\(((?:\(\) => \{)[\s\S]*?\})\)\.catch\(\(\) => \{\}\);/);
  assert.ok(cleanup, 'expected the existing serialized submitQwenNativeTurn cleanup callback');
  try {
    const send = completionRequest();
    const first = send(page);
    await new Promise(resolve => setImmediate(resolve));
    page.__synvoxQwenNativeCapture.challengeSeen = true;
    page.document.cookie = 'x5sec=fresh-proof';
    await send(page);
    await waitForResult(page);
    assert.equal(page.__synvoxQwenNativeCapture.replayed, true);
    assert.equal(page.__synvoxQwenNativeCapture.result.status, 200);
    await vm.runInContext(`'use strict'; (${cleanup[1]})()`, page.__testContext, { timeout: 1000 });
    assert.equal(originalSignal.aborted, true);
    assert.equal(page.__synvoxQwenNativeCapture, undefined);
    assert.equal(page.fetch, originalFetchRef(page));
    void first;
  } finally { page.__synvoxQwenNativeCapture?.dispose?.(); }
});

function originalFetchRef(page) {
  return page.__originalFetchForTest;
}
