import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { createLicenseService } from '../services/licensing/service.mjs';
import { createMerchantBot } from '../services/licensing/merchant-bot.mjs';
import { createMerchantHttp } from '../services/licensing/merchant-http.mjs';

test('public merchant API registers stable identity and issues bearer-authenticated short links, never mock pays', async () => {
  const service = createLicenseService({ database: ':memory:', privateKey: generateKeyPairSync('ed25519').privateKey, mode: 'stars' });
  const bot = createMerchantBot({ service, telegram: async () => true });
  const server = createMerchantHttp({ service, bot });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port;
  const key = randomBytes(32).toString('base64url');
  const post = (route, body, headers = {}) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const a = await (await post('/v1/license/register', { key })).json();
    const b = await (await post('/v1/license/register', { key })).json();
    assert.equal(a.id, b.id);
    assert.equal((await post('/v1/license/telegram', {})).status, 400);
    const pair = await (await post('/v1/license/telegram', {}, { Authorization: 'Bearer ' + key })).json();
    assert.match(pair.url, /^https:\/\/t.me\/Synvox_bot\?start=/);
    assert.ok(!pair.url.includes(key));
    assert.equal((await post('/v1/license/mock-pay', {})).status, 404);
    assert.equal((await post('/v1/license/register', { key }, { Origin: 'https://evil.invalid' })).status, 403);
    assert.throws(() => service.mockPay(key, 'anything'), /disabled/);
  } finally { await new Promise(r => server.close(r)); service.close(); }
});
