import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramTransport } from '../services/licensing/telegram-transport.mjs';

test('Telegram proxy is scoped to Telegram and retains abort/body options', async () => {
  const calls = [];
  let closed = false;
  const dispatcher = { close: async () => { closed = true; } };
  const transport = await createTelegramTransport('http://127.0.0.1:18081', {
    fetch: async (...args) => { calls.push(args); return 'ok'; },
    loadProxy: async () => ({ ProxyAgent: class { constructor(url) { assert.equal(url, 'http://127.0.0.1:18081'); return dispatcher; } } }),
  });
  const options = { method: 'POST', body: '{}', signal: AbortSignal.timeout(1000) };
  assert.equal(await transport.fetch('https://api.telegram.org/bot123:test/getMe', options), 'ok');
  assert.deepEqual(calls[0], ['https://api.telegram.org/bot123:test/getMe', { ...options, dispatcher }]);
  await assert.rejects(transport.fetch('https://api.yookassa.ru/v3/payments', options), /Telegram origin required/);
  assert.equal(calls.length, 1);
  await transport.close();
  assert.equal(closed, true);
});

test('without proxy Telegram uses ordinary fetch and does not load proxy dependency', async () => {
  const calls = [];
  const transport = await createTelegramTransport('', {
    fetch: async (...args) => { calls.push(args); },
    loadProxy: async () => { throw new Error('must not load'); },
  });
  await transport.fetch('https://api.telegram.org/bot123:test/getMe', { method: 'POST' });
  assert.deepEqual(calls[0][1], { method: 'POST' });
  await transport.close();
});

test('proxy must be an explicit loopback HTTP endpoint', async () => {
  for (const url of ['http://example.org:8080', 'http://127.0.0.1:18081/path', 'http://user:pass@127.0.0.1:18081', 'https://127.0.0.1:18081']) {
    await assert.rejects(createTelegramTransport(url), /Loopback HTTP proxy required/);
  }
});
