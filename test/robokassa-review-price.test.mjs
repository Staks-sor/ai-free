import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { createLicenseService } from '../services/licensing/service.mjs';
import { createRobokassa } from '../services/licensing/robokassa.mjs';
test('global review price applies to every installation in merchant mode', () => {
  const s = createLicenseService({ database: ':memory:', privateKey: generateKeyPairSync('ed25519').privateKey, mode: 'merchant', reviewInstallationId: '*' });
  try {
    const r = createRobokassa({ service:s, password1:'one', password2:'two' });
    for (let i=0; i<2; i++) {
      const account=s.register();
      s.acceptForInstallation(account.id, { legalVersion:s.legalVersion, termsAccepted:true, personalDataAccepted:true, alphaAcknowledged:true });
      assert.equal(s.rubAmountForInstallation(account.id), 100);
      const p=r.checkout(account.key, 'global-review');
      assert.equal(p.fields.OutSum, '1.00');
      assert.equal(JSON.parse(decodeURIComponent(p.fields.Receipt)).items[0].sum, 1);
    }
  } finally { s.close(); }
});
test('one-ruble review price is installation-scoped and signed, receipted and credited consistently', () => {
  const id = '6d6e048a-36f2-4c8b-92e2-8a8b242467c0';
  const s = createLicenseService({ database: ':memory:', privateKey: generateKeyPairSync('ed25519').privateKey, mode: 'merchant', reviewInstallationId: id });
  try {
    const account = s.register();
    s.db.prepare('UPDATE licenses SET id=? WHERE id=?').run(id, account.id);
    const r = createRobokassa({ service:s, password1:'one', password2:'two' });
    s.acceptForInstallation(id, { legalVersion:s.legalVersion, termsAccepted:true, personalDataAccepted:true, alphaAcknowledged:true });
    const p = r.checkout(account.key, 'review');
    assert.equal(p.fields.OutSum, '1.00');
    assert.equal(JSON.parse(decodeURIComponent(p.fields.Receipt)).items[0].sum, 1);
    const other = s.register();
    assert.equal(s.rubAmountForInstallation(other.id), 9900);
    assert.equal(r.view(new URL(r.link(account.key).url).searchParams.get('token')).priceRub, 1);
    const callback = amount => new URLSearchParams({ OutSum:amount, InvId:p.fields.InvId, SignatureValue:createHash('md5').update(`${amount}:${p.fields.InvId}:two`).digest('hex') });
    assert.throws(() => r.result(callback('0.990000')), /amount/);
    assert.equal(r.result(callback('1.000000')), `OK${p.fields.InvId}`);
    const until=s.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(id).access_until;
    r.result(callback('1.000000'));
    assert.equal(s.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(id).access_until, until);
  } finally { s.close(); }
});
