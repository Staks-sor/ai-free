import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveQwenNativeParent } from '../src/providers/qwen/client.mjs';

const history = (nodes, currentId = null) => ({ ok: true, json: { success: true, data: { chat: {
  messages: Object.values(nodes), history: { currentId, messages: nodes, pagination: { has_more_newer: false, newest_id: currentId } },
} } } });
function proxy(response, pending = 0) {
  let reads = 0;
  return { pendingCompletionRequests: async () => pending,
    proxyApiGet: async request => { reads++; assert.equal(request.chatId, 'saved-chat'); return response; },
    reads: () => reads };
}

test('an explicit native parent remains pinned without a history request', async () => {
  const p = proxy(history({}));
  assert.equal(await resolveQwenNativeParent(p, 'saved-chat', 'explicit-parent'), 'explicit-parent');
  assert.equal(p.reads(), 0);
});

test('an omitted parent appends to the completed current native chat after Stop', async () => {
  const p = proxy(history({ answer: { id: 'answer', role: 'assistant', done: true, childrenIds: [] } }, 'answer'));
  assert.equal(await resolveQwenNativeParent(p, 'saved-chat', null), 'answer');
  assert.equal(p.reads(), 1);
});

test('a completion that starts while history is being read cannot authorize an append', async () => {
  let pending = 0;
  const response = history({ answer: { id: 'answer', role: 'assistant', done: true, childrenIds: [] } }, 'answer');
  const p = {
    async pendingCompletionRequests() { return pending; },
    async proxyApiGet() { pending = 1; return response; },
  };
  await assert.rejects(resolveQwenNativeParent(p, 'saved-chat', null), error => error.delivery === 'not_sent');
});

test('a proven empty native chat keeps a root turn', async () => {
  assert.equal(await resolveQwenNativeParent(proxy(history({})), 'saved-chat', null), null);
});

test('expired history authorization requests normal same-account auth recovery before any POST', async () => {
  await assert.rejects(resolveQwenNativeParent(proxy({ ok: true, status: 200, json: { success: false, data: { code: 'unauthorized' } } }), 'saved-chat', null),
    error => error.isQwenSessionExpired === true && error.delivery === 'not_sent');
});

test('active, incomplete or ambiguous native history cannot authorize a root or guessed parent', async () => {
  for (const [response, pending] of [
    [history({ answer: { id: 'answer', role: 'assistant', done: true } }, 'answer'), 1],
    [history({ answer: { id: 'answer', role: 'assistant', done: false } }, 'answer'), 0],
    [history({ user: { id: 'user', role: 'user', done: true } }, 'user'), 0],
    [history({ answer: { id: 'answer', role: 'assistant', done: true, childrenIds: ['next'] } }, 'answer'), 0],
    [{ ok: false, status: 503 }, 0],
    [{ ok: true, json: { success: true, data: {} } }, 0],
  ]) {
    await assert.rejects(resolveQwenNativeParent(proxy(response, pending), 'saved-chat', null), error => error.delivery === 'not_sent');
  }
});
