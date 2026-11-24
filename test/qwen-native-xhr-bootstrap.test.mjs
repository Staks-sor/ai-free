import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { installQwenNativeCapture } from '../src/providers/qwen/native-composer.mjs';

const turn = { workerId: 'worker-xhr', turnId: 'turn-xhr', chatId: 'empty-chat', parentId: null,
  allowNativeRootChat: true, model: 'qwen-model', prompt: 'synthetic prompt', timeoutMs: 1000 };

function fakePage({ response = { status: 200, body: { success: true, data: { id: 'native-chat' } } }, acknowledge, hold = false } = {}) {
  const sent = [];
  const forwarded = [];
  const page = {
    location: { href: 'https://chat.qwen.ai/', origin: 'https://chat.qwen.ai' },
    fetch: async (...args) => { forwarded.push(args); return { ok: true, status: 200, headers: { get: () => null }, clone() { return this; }, text: async () => '' }; },
    __qwenRawStreamChunk: async () => true,
    __qwenNativeBootstrap: acknowledge || (async () => true),
  };
  class FakeXMLHttpRequest {
    constructor() { this.listeners = new Map(); this.status = 0; this.readyState = 0; this.responseText = ''; this.response = null; this.aborted = false; }
    addEventListener(type, handler) { const list = this.listeners.get(type) || []; list.push(handler); this.listeners.set(type, list); }
    removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== handler)); }
    dispatch(type) { for (const handler of this.listeners.get(type) || []) handler.call(this, { type, target: this }); this[`on${type}`]?.call(this, { type, target: this }); }
    open(...args) { this.openArgs = args; this.readyState = 1; }
    setRequestHeader(name, value) { (this.headers ||= []).push([name, value]); }
    send(body) {
      this.body = body; sent.push(this);
      if (hold) return;
      setTimeout(() => {
        if (this.aborted) return;
        this.status = response.status;
        this.responseText = JSON.stringify(response.body);
        this.response = this.responseText;
        this.readyState = 4;
        this.dispatch('readystatechange');
        this.dispatch('load');
        this.dispatch('loadend');
      }, 5);
    }
    abort() { this.aborted = true; this.dispatch('abort'); }
  }
  page.XMLHttpRequest = FakeXMLHttpRequest;
  const originalXhrMethods = { open: FakeXMLHttpRequest.prototype.open, send: FakeXMLHttpRequest.prototype.send };
  const context = vm.createContext({ window: page, URL, AbortController, TextDecoder, setTimeout, clearTimeout,
    JSON, Promise, Error, String, Number, Boolean });
  vm.runInContext(`(${installQwenNativeCapture.toString()})(${JSON.stringify(turn)})`, context);
  return { page, sent, forwarded, originalXhrMethods };
}

function waitFor(predicate, timeoutMs = 300) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting for condition'));
      setTimeout(check, 2);
    };
    check();
  });
}

test('captures Qwen native XHR chat creation without changing request arguments or headers', async () => {
  const markers = [];
  const { page, sent } = fakePage({ acknowledge: async (_workerId, marker) => { markers.push(marker); return true; } });
  const xhr = new page.XMLHttpRequest();
  xhr.open('POST', 'https://chat.qwen.ai/api/v2/chats/new', true);
  xhr.setRequestHeader('content-type', 'application/json');
  xhr.setRequestHeader('x-qwen-web', 'keep-this');
  const body = JSON.stringify({ models: ['qwen-model'], title: 'synthetic' });
  xhr.send(body);

  await waitFor(() => markers.length > 0);

  assert.deepEqual(sent.length, 1);
  assert.deepEqual(xhr.openArgs, ['POST', 'https://chat.qwen.ai/api/v2/chats/new', true]);
  assert.deepEqual(xhr.headers, [['content-type', 'application/json'], ['x-qwen-web', 'keep-this']]);
  assert.equal(xhr.body, body);
  assert.deepEqual(JSON.parse(JSON.stringify(markers[0])), { previousChatId: 'empty-chat', chatId: 'native-chat' });
  page.__synvoxQwenNativeCapture.dispose();
});

test('does not release the site XHR response to trigger completion until bootstrap acknowledgement', async () => {
  let acknowledge;
  const ack = new Promise(resolve => { acknowledge = resolve; });
  let modelRequests = 0;
  const { page, forwarded } = fakePage({ acknowledge: async () => ack });
  const xhr = new page.XMLHttpRequest();
  const completionBody = JSON.stringify({ chatId: 'native-chat', chat_id: 'native-chat', parentId: null,
    parent_id: null, model: 'qwen-model', messages: [{ role: 'user', content: 'synthetic prompt', parentId: null, parent_id: null }] });
  xhr.addEventListener('load', () => {
    modelRequests++;
    void page.fetch('https://chat.qwen.ai/api/v2/chat/completions?chat_id=native-chat', { method: 'POST', body: completionBody });
  });
  xhr.open('POST', 'https://chat.qwen.ai/api/v2/chats/new', true);
  xhr.send(JSON.stringify({ models: ['qwen-model'] }));

  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(modelRequests, 1, 'the site may receive its XHR load event');
  assert.equal(forwarded.length, 0, 'the model request must wait for bootstrap acknowledgement');
  acknowledge(true);
  await waitFor(() => forwarded.length === 1);
  page.__synvoxQwenNativeCapture.dispose();
});

test('Stop during native XHR creation aborts the request and keeps delivery unsent', async () => {
  const { page, sent } = fakePage({ acknowledge: async () => true, hold: true });
  const xhr = new page.XMLHttpRequest();
  xhr.open('POST', 'https://chat.qwen.ai/api/v2/chats/new', true);
  xhr.send(JSON.stringify({ models: ['qwen-model'] }));
  assert.equal(sent.length, 1);
  page.__synvoxQwenNativeCapture.controller.abort(new Error('stopped'));
  assert.equal(xhr.aborted, true);
  assert.equal(page.__synvoxQwenNativeCapture.started, false);
  assert.equal(page.__synvoxQwenNativeCapture.error?.delivery, 'not_sent');
  page.__synvoxQwenNativeCapture.dispose();
});

test('a mismatched model cannot dispatch native XHR chat creation', async () => {
  const { page, sent } = fakePage();
  const xhr = new page.XMLHttpRequest();
  xhr.open('POST', 'https://chat.qwen.ai/api/v2/chats/new', true);
  assert.throws(() => xhr.send(JSON.stringify({ models: ['different-model'] })), /модель.*не совпадает/i);
  assert.equal(sent.length, 0);
  assert.ok(page.__synvoxQwenNativeCapture.error);
  page.__synvoxQwenNativeCapture.dispose();
});

test('a failed native XHR creation is not treated as a sent model turn', async () => {
  const { page } = fakePage({ response: { status: 500, body: { success: false } } });
  const xhr = new page.XMLHttpRequest();
  xhr.open('POST', 'https://chat.qwen.ai/api/v2/chats/new', true);
  xhr.send(JSON.stringify({ models: ['qwen-model'] }));
  await waitFor(() => page.__synvoxQwenNativeCapture.error);
  assert.equal(page.__synvoxQwenNativeCapture.started, false);
  assert.equal(page.__synvoxQwenNativeCapture.error.delivery, 'not_sent');
  page.__synvoxQwenNativeCapture.dispose();
});

test('unrelated XHRs pass through and disposal restores native methods', async () => {
  const { page, sent, originalXhrMethods } = fakePage();
  const NativeXHR = page.XMLHttpRequest;
  const xhr = new NativeXHR();
  xhr.open('GET', 'https://chat.qwen.ai/api/v2/history', true);
  xhr.send(null);
  await waitFor(() => sent.length === 1);
  page.__synvoxQwenNativeCapture.dispose();
  assert.equal(NativeXHR.prototype.open, originalXhrMethods.open);
  assert.equal(NativeXHR.prototype.send, originalXhrMethods.send);
  assert.equal(xhr.body, null);
});
