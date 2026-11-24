import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { ensureInstallation } from '../src/licensing/installation.mjs';
import { createLicenseService } from '../services/licensing/service.mjs';

test('installation persists before registration; retries and concurrent starts reuse one license', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-installation-'));
  const identityPath = path.join(directory, 'identity.json');
  let now = 1000000;
  const service = createLicenseService({ database: ':memory:', privateKey: generateKeyPairSync('ed25519').privateKey, now: () => now });
  let first = true;
  const fetchImpl = async (_url, options) => {
    const identity = service.register(JSON.parse(options.body).key);
    if (first) { first = false; throw new Error('Response lost'); }
    return { ok: true, json: async () => identity };
  };
  try {
    const options = { identityPath, endpoint: 'http://127.0.0.1:4329', fetchImpl };
    await assert.rejects(ensureInstallation(options), /Response lost/);
    const saved = fs.readFileSync(identityPath, 'utf8');
    now += 86400000;
    const [a, b] = await Promise.all([ensureInstallation(options), ensureInstallation(options)]);
    assert.deepEqual(a, b);
    assert.equal(a.key, JSON.parse(saved).key);
    assert.equal(service.db.prepare('SELECT COUNT(*) AS n FROM licenses').get().n, 1);
    assert.equal(service.db.prepare('SELECT access_until FROM licenses').get().access_until, 1000000 + 3 * 86400000);
    const other = await ensureInstallation({ ...options, identityPath: path.join(directory, 'other.json') });
    assert.notEqual(a.id, other.id);
    assert.notEqual(a.key, other.key);
    const beforeOther = service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(other.id).access_until;
    const consent = { legalVersion: '2026-09-07', termsAccepted: true, personalDataAccepted: true, alphaAcknowledged: true };
    service.acceptConsents(a.key, consent);
    const order = service.checkout(a.key, 'installation-payment');
    assert.equal(order.license_id, a.id);
    assert.throws(() => service.mockPay(other.key, order.id));
    service.mockPay(a.key, order.id);
    service.mockPay(a.key, order.id);
    assert.equal(service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(a.id).access_until, 1000000 + 33 * 86400000);
    assert.equal(service.db.prepare('SELECT access_until FROM licenses WHERE id=?').get(other.id).access_until, beforeOther);
    assert.equal(fs.statSync(identityPath).mode & 0o777, 0o600);
    fs.writeFileSync(identityPath, '{}');
    await assert.rejects(ensureInstallation(options), /Invalid installation/);
    assert.equal(fs.readFileSync(identityPath, 'utf8'), '{}');
  } finally { service.close(); fs.rmSync(directory, { recursive: true }); }
});
