import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createLicenseService } from '../services/licensing/service.mjs';
import { createStarsPayments } from '../services/licensing/stars.mjs';

test('Stars invoice is bound to installation and payer; only valid success credits once', async () => {
  const service = createLicenseService({ database: ':memory:', privateKey: generateKeyPairSync('ed25519').privateKey, now: () => 1000 });
  const calls = [];
  const stars = createStarsPayments({ service, priceStars: 100, telegram: async (method, data) => { calls.push({ method, data }); return true; }, now: () => 1000 });
  try {
    const identity = service.register();
    service.acceptConsents(identity.key, { legalVersion: '2026-09-07', termsAccepted: true, personalDataAccepted: true, alphaAcknowledged: true });
    const before = service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(identity.id).access_until;
    const order = await stars.invoice(identity.key, 'stars-test', 123);
    assert.equal(calls[0].data.currency, 'XTR');
    assert.equal(calls[0].data.prices[0].amount, 100);
    assert.ok(!JSON.stringify(calls).includes(identity.key));
    const payment = { invoice_payload: order.id, currency: 'XTR', total_amount: 100, telegram_payment_charge_id: 'charge-1' };
    service.db.prepare('UPDATE stars_payments SET legal_version=? WHERE order_id=?').run('old', order.id);
    await stars.preCheckout({ id: 'old', from: { id: 123 }, ...payment });
    assert.equal(calls.at(-1).data.ok, false);
    service.db.prepare('UPDATE stars_payments SET legal_version=? WHERE order_id=?').run(service.legalVersion, order.id);
    await stars.preCheckout({ id: 'query', from: { id: 123 }, invoice_payload: order.id, currency: 'XTR', total_amount: 100 });
    assert.equal(calls.at(-1).data.ok, true);
    assert.equal(service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(identity.id).access_until, before);
    for (const p of [{ ...payment, currency: 'RUB' }, { ...payment, total_amount: 1 }]) assert.throws(() => stars.success(123, p));
    assert.throws(() => stars.success(456, payment));
    stars.success(123, payment); stars.success(123, payment);
    assert.equal(service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(identity.id).access_until, before + 30 * 86400000);
    assert.throws(() => service.mockPay(identity.key, order.id));
    await stars.preCheckout({ id: 'again', from: { id: 123 }, ...payment });
    assert.equal(calls.at(-1).data.ok, false);
    await stars.refund(order.id); await stars.refund(order.id);
    assert.equal(calls.filter(c => c.method === 'refundStarPayment').length, 1);
    assert.equal(service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(identity.id).access_until, before);
    stars.success(123, payment);
    assert.equal(service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(identity.id).access_until, before);
  } finally { service.close(); }
});
