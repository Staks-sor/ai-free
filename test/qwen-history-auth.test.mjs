import test from 'node:test';
import assert from 'node:assert/strict';
import { qwenApiGetInPage } from '../src/providers/qwen/browser-proxy.mjs';

async function withPage(token, run) {
  const original = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, window: globalThis.window };
  const calls = [];
  globalThis.window = { location: { href: 'https://chat.qwen.ai/c/chat', origin: 'https://chat.qwen.ai' } };
  globalThis.localStorage = { getItem: key => key === 'token' ? token : null };
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, json: async () => ({ success: true }) }; };
  try { await run(calls); }
  finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
}

test('Qwen history reads use the current page token with credentials and web headers', async () => {
  await withPage('fresh-test-token', async calls => {
    assert.equal((await qwenApiGetInPage({ path: '/api/v2/chats/chat?limit=100', timeoutMs: 1000, authToken: 'older-test-token' })).json.success, true);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer fresh-test-token');
    assert.equal(calls[0].options.headers.source, 'web');
    assert.equal(calls[0].options.credentials, 'include');
    assert.equal(calls[0].options.method, 'GET');
  });
});

test('Qwen history auth falls back to the pinned account token when page storage is empty', async () => {
  await withPage(null, async calls => {
    await qwenApiGetInPage({ path: '/api/v2/chats/chat', timeoutMs: 1000, authToken: 'pinned-test-token' });
    assert.equal(calls[0].options.headers.Authorization, 'Bearer pinned-test-token');
  });
});

test('history requests never send account authorization to another origin or a non-API URL', async () => {
  await withPage('test-token', async calls => {
    for (const path of ['https://example.test/api/v2/chats/chat', '/unrelated']) {
      await assert.rejects(qwenApiGetInPage({ path, timeoutMs: 1000 }), /Qwen/);
    }
    assert.equal(calls.length, 0);
  });
});
