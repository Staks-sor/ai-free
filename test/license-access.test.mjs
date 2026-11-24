import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createLicenseService, verifyAccess } from '../services/licensing/service.mjs';

test('unique hashed keys, trial expiry, mock extension, revocation and minimum version', () => {
  let now = Date.UTC(2026, 8, 7);
  const keys = generateKeyPairSync('ed25519');
  const svc = createLicenseService({ database: ':memory:', privateKey: keys.privateKey, now: () => now });
  const a = svc.register(), b = svc.register();
  assert.notEqual(a.key, b.key);
  assert.equal(svc.db.prepare('SELECT key_hash FROM licenses WHERE id = ?').get(a.id).key_hash.includes(a.key), false);
  const check = () => verifyAccess(svc.status(a.key), keys.publicKey, { now, version: '0.4.26' });
  assert.equal(check().allowed, true);
  now += 3 * 86400000;
  assert.equal(check().reason, 'payment_required');
  svc.acceptConsents(a.key, { legalVersion: '2026-09-07', termsAccepted: true, personalDataAccepted: true, alphaAcknowledged: true });
  const order = svc.checkout(a.key, 'checkout-1');
  assert.equal(svc.checkout(a.key, 'checkout-1').id, order.id);
  assert.throws(() => svc.mockPay(b.key, order.id));
  svc.mockPay(a.key, order.id); svc.mockPay(a.key, order.id);
  assert.equal(check().accessUntil, now + 30 * 86400000);
  svc.setMinimumVersion('0.4.27');
  assert.equal(check().reason, 'update_required');
  svc.setMinimumVersion('0.4.26'); svc.revoke(a.id);
  assert.equal(check().reason, 'revoked');
  svc.close();
});

test('signed proofs reject tampering, expiry and a foreign installation', () => {
  const keys = generateKeyPairSync('ed25519');
  const svc = createLicenseService({ database: ':memory:', privateKey: keys.privateKey, now: () => 1000000 });
  const a = svc.register(); const proof = svc.status(a.key);
  assert.throws(() => verifyAccess({ ...proof, payload: proof.payload + 'A' }, keys.publicKey, { now: 1000000, version: '0.4.26' }));
  assert.throws(() => verifyAccess(proof, keys.publicKey, { now: 1000000, version: '0.4.26', installationId: 'foreign' }));
  assert.throws(() => verifyAccess(proof, keys.publicKey, { now: 1000000 + 86400001, version: '0.4.26' }));
  svc.close();
});

test('mock payment cannot run in production mode', () => {
  const keys = generateKeyPairSync('ed25519');
  assert.throws(() => createLicenseService({ database: ':memory:', privateKey: keys.privateKey, mode: 'production' }), /not configured/);
});
