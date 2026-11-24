import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createLicenseService, verifyAccess } from '../services/licensing/service.mjs';

const DAY = 86_400_000;
const LEGAL_VERSION = '2026-09-07';
const consent = { legalVersion: LEGAL_VERSION, termsAccepted: true, personalDataAccepted: true, alphaAcknowledged: true };

function fixture(mode = 'mock') {
  let now = Date.UTC(2026, 8, 7);
  const keys = generateKeyPairSync('ed25519');
  const service = createLicenseService({ database: ':memory:', privateKey: keys.privateKey, mode, now: () => now });
  return { service, publicKey: keys.publicKey, now: () => now, advance: days => { now += days * DAY; } };
}

test('one installation gets one three-day trial; re-registration does not reset it', () => {
  const f = fixture();
  try {
    const first = f.service.register();
    const trialUntil = verifyAccess(f.service.status(first.key), f.publicKey, { now: f.now(), version: '0.4.26' }).accessUntil;
    f.advance(4);
    const again = f.service.register(first.key);
    assert.equal(again.id, first.id);
    assert.equal(verifyAccess(f.service.status(first.key), f.publicKey, { now: f.now(), version: '0.4.26' }).reason, 'payment_required');
    assert.equal(f.service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(first.id).access_until, trialUntil);
  } finally { f.service.close(); }
});

test('checkout requires current separate consents and charges 99 RUB', () => {
  const f = fixture();
  try {
    const user = f.service.register();
    assert.throws(() => f.service.checkout(user.key, 'without-consent'), /consent/i);
    assert.throws(() => f.service.acceptConsents(user.key, { ...consent, personalDataAccepted: false }), /consent/i);
    assert.throws(() => f.service.acceptConsents(user.key, { ...consent, legalVersion: 'old' }), /consent/i);
    f.service.acceptConsents(user.key, consent);
    const order = f.service.checkout(user.key, 'one-click');
    assert.equal(order.amount, 9900);
    assert.equal(order.currency, 'RUB');
    assert.equal(f.service.checkout(user.key, 'one-click').id, order.id);
    assert.throws(() => f.service.checkout(user.key, 'another', { amount: 100 }), /price/i);
  } finally { f.service.close(); }
});

test('mock payment credits only the owning installation and only once', () => {
  const f = fixture();
  try {
    const owner = f.service.register();
    const other = f.service.register();
    f.service.acceptConsents(owner.key, consent);
    const order = f.service.checkout(owner.key, 'owner-payment');
    assert.throws(() => f.service.mockPay(other.key, order.id), /Unknown order/);
    f.service.mockPay(owner.key, order.id);
    f.service.mockPay(owner.key, order.id);
    assert.equal(f.service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(owner.id).access_until, f.now() + 33 * DAY);
    assert.equal(f.service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(other.id).access_until, f.now() + 3 * DAY);
    assert.equal(f.service.db.prepare('SELECT paid FROM orders WHERE id=?').get(order.id).paid, 1);
  } finally { f.service.close(); }
});

test('real merchant mode never exposes mock payment crediting', () => {
  const f = fixture('merchant');
  try {
    const user = f.service.register();
    assert.throws(() => f.service.mockPay(user.key, 'any-order'), /disabled/i);
  } finally { f.service.close(); }
});
