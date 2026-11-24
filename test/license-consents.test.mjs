import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createLicenseService } from '../services/licensing/service.mjs';

test('server records explicit versioned consents, rejects incomplete and stale consent', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const service = createLicenseService({ database: ':memory:', privateKey, legalVersion: '2026-09-07', now: () => 1000 });
  try {
    const user = service.register();
    assert.throws(() => service.checkout(user.key, 'without-consent'), /consent/i);
    const consent = { legalVersion: '2026-09-07', termsAccepted: true, personalDataAccepted: true, alphaAcknowledged: true };
    for (const field of ['termsAccepted', 'personalDataAccepted', 'alphaAcknowledged']) {
      assert.throws(() => service.acceptConsents(user.key, { ...consent, [field]: false }));
    }
    assert.throws(() => service.acceptConsents(user.key, { ...consent, legalVersion: 'old' }));
    service.acceptConsents(user.key, consent);
    assert.equal(service.checkout(user.key, 'with-consent').amount, 9900);
    service.acceptConsents(user.key, consent);
    const rows = service.db.prepare('SELECT * FROM consents').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].license_id, user.id);
    assert.equal(rows[0].accepted_at, 1000);
    assert.equal(rows[0].legal_version, '2026-09-07');
    assert.equal(rows[0].personal_data_accepted, 1);
    assert.ok(!JSON.stringify(rows).includes(user.key));
  } finally { service.close(); }
});
