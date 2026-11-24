import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createLicenseService } from '../services/licensing/service.mjs';
import { createMerchantBot } from '../services/licensing/merchant-bot.mjs';
import { createMerchantHttp } from '../services/licensing/merchant-http.mjs';

test('closed sales reject old purchase URLs before issuing an order and keep existing confirmations and status', async t => {
  const calls = [];
  const service = { legalVersion: 'fixture', status: () => ({ statusChecked: true }) };
  const robokassa = { result: fields => { calls.push(fields.get('InvId')); return 'OK42'; } };
  const server = createMerchantHttp({ service, robokassa, paymentsEnabled: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  for (const [method, pathname] of [
    ['GET', 'robokassa/checkout'], ['POST', 'robokassa/checkout'],
    ['POST', 'robokassa/link'], ['POST', 'telegram'], ['POST', 'register'],
  ]) {
    const response = await fetch(origin + '/v1/license/' + pathname, { method });
    assert.equal(response.status, 410, pathname);
    assert.equal(response.headers.has('location'), false, pathname);
    assert.match(await response.text(), /SYNVOX/);
  }
  const confirmation = await fetch(origin + '/v1/license/robokassa/result', { method: 'POST', body: 'InvId=42' });
  assert.equal(await confirmation.text(), 'OK42');
  assert.deepEqual(calls, ['42']);
  assert.deepEqual(await (await fetch(origin + '/v1/license/status')).json(), { statusChecked: true });
});

test('retired Stars bot refuses pre-checkout and old pay buttons without creating orders', async t => {
  const service = createLicenseService({ database: ':memory:', privateKey: generateKeyPairSync('ed25519').privateKey });
  t.after(() => service.close());
  const calls = [];
  const bot = createMerchantBot({ service, paymentsEnabled: false, telegram: async (method, data) => { calls.push({ method, data }); } });
  const from = { id: 12, language_code: 'ru' };
  const chat = { id: 12, type: 'private' };
  await bot.handle({ pre_checkout_query: { id: 'old-invoice', from } });
  assert.equal(calls[0].method, 'answerPreCheckoutQuery');
  assert.equal(calls[0].data.ok, false);
  assert.match(calls[0].data.error_message, /закрыт/);
  await bot.handle({ message: { from, chat, text: '/pay' } });
  await bot.handle({ callback_query: { from, id: 'old-button', message: { chat }, data: 'pay:old' } });
  assert.ok(calls.some(call => call.method === 'answerCallbackQuery'));
  assert.equal(calls.filter(call => call.method === 'sendMessage').length, 2);
  assert.ok(calls.filter(call => call.method === 'sendMessage').every(call => call.data.text.includes('https://synvox.pro/')));
  assert.equal(calls.some(call => call.method === 'sendInvoice'), false);
  assert.equal(service.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
  assert.equal(service.db.prepare('SELECT COUNT(*) AS n FROM bot_sessions').get().n, 0);
});
