import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createLicenseService } from '../services/licensing/service.mjs';
import { createRobokassa } from '../services/licensing/robokassa.mjs';

test('Robokassa signs receipt, binds installation, verifies amount and credits once', () => {
  const service = createLicenseService({ database: ':memory:', privateKey: generateKeyPairSync('ed25519').privateKey, mode: 'merchant' });
  const md5 = value => createHash('md5').update(value).digest('hex');
  try {
    const gateway = createRobokassa({ service, password1: 'test-one', password2: 'test-two' });
    const identity = service.register();
    const other = service.register();
    assert.throws(() => gateway.checkout(identity.key, 'first'), /consents/i);
    service.acceptConsents(identity.key, { legalVersion: service.legalVersion, termsAccepted: true, personalDataAccepted: true, alphaAcknowledged: true });
    const first = gateway.checkout(identity.key, 'first');
    assert.deepEqual(gateway.checkout(identity.key, 'first'), first);
    const p = first.fields;
    assert.equal(p.OutSum, '99.00');
    assert.equal(p.SignatureValue, md5(`synvox:99.00:${p.InvId}:${p.Receipt}:test-one`));
    assert.equal(JSON.parse(decodeURIComponent(p.Receipt)).items[0].sum, 99);
    assert.ok(!JSON.stringify(first).includes(identity.key));
    const callback = (sum, password = 'test-two') => new URLSearchParams({ OutSum: sum, InvId: p.InvId, SignatureValue: md5(`${sum}:${p.InvId}:${password}`) });
    assert.throws(() => gateway.result(callback('99.00', 'test-one')), /signature/i);
    assert.throws(() => gateway.result(callback('1.00')), /amount/i);
    const before = service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(identity.id).access_until;
    const otherBefore = service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(other.id).access_until;
    assert.equal(gateway.result(callback('99.000000')), `OK${p.InvId}`);
    assert.equal(gateway.result(callback('99.00')), `OK${p.InvId}`);
    assert.equal(service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(identity.id).access_until, before + 30 * 86400000);
    assert.equal(service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(other.id).access_until, otherBefore);
    assert.throws(() => service.mockPay(identity.key, first.orderId), /disabled/i);
  } finally { service.close(); }
});

test('Robokassa web link requires current explicit consent and a test payment never grants access', () => {
  const service = createLicenseService({ database: ':memory:', privateKey: generateKeyPairSync('ed25519').privateKey, mode: 'merchant' });
  try {
    const gateway = createRobokassa({ service, password1: 'test-one', password2: 'test-two', isTest: true });
    const identity = service.register();
    const link = gateway.link(identity.key);
    assert.ok(!link.url.includes(identity.key));
    const token = new URL(link.url).searchParams.get('token');
    assert.equal(gateway.view(token).license_id, identity.id);
    assert.throws(() => gateway.accept(token, new URLSearchParams()), /consent/i);
    const fields = new URLSearchParams({ terms: 'yes', privacy: 'yes', alpha: 'yes', version: service.legalVersion });
    const payment = gateway.accept(token, fields);
    const before = service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(identity.id).access_until;
    const params = new URLSearchParams({ OutSum: '99.00', InvId: payment.fields.InvId });
    params.set('SignatureValue', createHash('md5').update(`99.00:${payment.fields.InvId}:test-two`).digest('hex'));
    gateway.result(params);
    assert.equal(service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(identity.id).access_until, before);
  } finally { service.close(); }
});
