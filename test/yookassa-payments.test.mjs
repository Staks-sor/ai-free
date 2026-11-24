import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createLicenseService } from '../services/licensing/service.mjs';
import { createYooKassa } from '../services/licensing/yookassa.mjs';

test('YooKassa binds orders, checks authoritative payment and credits only once', async () => {
  const service = createLicenseService({ database: ':memory:', privateKey: generateKeyPairSync('ed25519').privateKey, mode: 'merchant' });
  let payment, posts = 0;
  const request = async (url, init) => {
    assert.equal(init.headers.Authorization, 'Basic ' + Buffer.from('989928:test-secret').toString('base64'));
    if (init.method === 'POST') {
      posts++;
      const body = JSON.parse(init.body);
      assert.equal(body.capture, true);
      assert.equal(body.save_payment_method, undefined);
      assert.equal(body.amount.value, '99.00');
      assert.equal(body.description, 'Право использования SYNVOX на 30 дней. ID установки: ' + body.metadata.installation_id);
      assert.ok(body.description.length <= 128);
      payment = { ...body, id: 'payment-1', recipient: { account_id: '989928' }, test: false, status: 'pending', paid: false, confirmation: { confirmation_url: 'https://yoomoney.ru/checkout/payments/v2/contract?orderId=1' } };
    }
    return { ok: true, json: async () => structuredClone(payment) };
  };
  try {
    const gateway = createYooKassa({ service, shopId: '989928', secretKey: 'test-secret', request });
    const a = service.register(), b = service.register();
    await assert.rejects(gateway.checkout(a.key, 'first'), /consents/i);
    service.acceptConsents(a.key, { legalVersion: service.legalVersion, termsAccepted: true, personalDataAccepted: true, alphaAcknowledged: true });
    const first = await gateway.checkout(a.key, 'first');
    assert.deepEqual(await gateway.checkout(a.key, 'first'), first);
    assert.equal(posts, 1);
    const before = service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(a.id).access_until;
    const other = service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(b.id).access_until;
    await gateway.reconcile('payment-1');
    assert.equal(service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(a.id).access_until, before);
    payment.status = 'succeeded'; payment.paid = true;
    payment.test = true;
    await assert.rejects(gateway.reconcile('payment-1'), /mismatch/i);
    payment.test = false; payment.amount.value = '1.00';
    await assert.rejects(gateway.reconcile('payment-1'), /mismatch/i);
    payment.amount.value = '99.00'; payment.metadata.product = 'vpn';
    await assert.rejects(gateway.reconcile('payment-1'), /mismatch/i);
    assert.deepEqual(await gateway.reconcilePending(), { checked: 1, failed: 1 });
    payment.metadata.product = 'synvox';
    assert.deepEqual(await gateway.reconcilePending(), { checked: 1, failed: 0 });
    await gateway.reconcile('payment-1');
    assert.equal(service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(a.id).access_until, before + 30 * 86400000);
    assert.equal(service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(b.id).access_until, other);
    assert.equal(await gateway.reconcile('vpn-payment'), false);
  } finally { service.close(); }
});
