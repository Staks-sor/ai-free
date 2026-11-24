import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMerchantHttp } from '../services/licensing/merchant-http.mjs';

test('existing checkout links use YooKassa and status reconciles before responding', async () => {
  let reconciled = false;
  const yookassa = {
    provider: 'yookassa',
    view: () => ({ license_id: 'installation', priceRub: 99 }),
    accept: async () => ({ url: 'https://yoomoney.ru/checkout/payments/v2/contract?orderId=test' }),
    reconcileInstallation: async key => { assert.equal(key, 'key'); reconciled = true; },
  };
  const server = createMerchantHttp({ service: { legalVersion: 'test', status: () => ({ reconciled }) }, bot: {}, yookassa });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const html = await (await fetch(base + '/v1/license/robokassa/checkout?token=test')).text();
    assert.match(html, /ЮKassa/);
    assert.doesNotMatch(html, /Robokassa/);
    const response = await fetch(base + '/v1/license/robokassa/checkout', { method: 'POST', headers: { Origin: 'https://synvox.pro' }, body: 'token=test', redirect: 'manual' });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), 'https://yoomoney.ru/checkout/payments/v2/contract?orderId=test');
    const status = await (await fetch(base + '/v1/license/status', { headers: { Authorization: 'Bearer key' } })).json();
    assert.equal(status.reconciled, true);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
