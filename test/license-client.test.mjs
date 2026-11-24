import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createLicenseService } from '../services/licensing/service.mjs';
import { createAccessGuard } from '../src/licensing/client.mjs';

test('guard stays off by default; enforces access and only uses signed unexpired offline cache', async () => {
  assert.equal((await createAccessGuard({ enabled: false })()).allowed, true);
  let now = 1000000, offline = false, fetches = 0;
  const keys = generateKeyPairSync('ed25519');
  const service = createLicenseService({ database: ':memory:', privateKey: keys.privateKey, now: () => now });
  const identity = service.register();
  const guard = createAccessGuard({ enabled: true, publicKey: keys.publicKey, version: '0.4.26', installationId: identity.id,
    now: () => now, fetchProof: async () => { fetches += 1; if (offline) throw new Error('offline'); return service.status(identity.key); } });
  assert.equal((await guard()).allowed, true);
  offline = true; now += 60000;
  assert.equal((await guard()).allowed, true);
  now += 86400000;
  await assert.rejects(guard(), /license_unavailable/);
  offline = false;
  assert.equal((await guard()).allowed, true);
  assert.equal(fetches, 4);
  service.close();
});

test('guard coalesces concurrent proof fetches and reuses a verified proof for 60 seconds', async () => {
  let now = 1000000, fetches = 0;
  const keys = generateKeyPairSync('ed25519');
  const service = createLicenseService({ database: ':memory:', privateKey: keys.privateKey, now: () => now });
  const identity = service.register();
  const guard = createAccessGuard({ enabled: true, publicKey: keys.publicKey, version: '0.4.26', installationId: identity.id,
    now: () => now, fetchProof: async () => { fetches += 1; await new Promise(resolve => setTimeout(resolve, 10)); return service.status(identity.key); } });

  const results = await Promise.all(Array.from({ length: 8 }, () => guard()));
  assert.ok(results.every(result => result.allowed));
  assert.equal(fetches, 1);
  await guard();
  assert.equal(fetches, 1);
  now += 60001;
  await guard();
  assert.equal(fetches, 2);
  service.close();
});

test('guard re-verifies cached expiry, rejects tampered proof, and observes revocation after refresh', async () => {
  let now = 1000000;
  const keys = generateKeyPairSync('ed25519');
  const service = createLicenseService({ database: ':memory:', privateKey: keys.privateKey, now: () => now });
  const identity = service.register();
  let tamper = false, offline = false;
  const guard = createAccessGuard({ enabled: true, publicKey: keys.publicKey, version: '0.4.26', installationId: identity.id,
    now: () => now, fetchProof: async () => {
      if (offline) throw new Error('offline');
      const proof = service.status(identity.key);
      return tamper ? { ...proof, signature: `${proof.signature[0] === 'A' ? 'B' : 'A'}${proof.signature.slice(1)}` } : proof;
    } });

  assert.equal((await guard()).allowed, true);
  tamper = true;
  now += 60001;
  await assert.rejects(guard(), /license_unavailable/);
  tamper = false;
  await guard();
  service.revoke(identity.id);
  now += 60001;
  await assert.rejects(guard(), /revoked/);
  offline = true;
  now += 86400000;
  await assert.rejects(guard(), /license_unavailable/);
  service.close();
});

test('runtime access never initializes an installation or contacts the licensing service', async () => {
  const temp = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await temp.mkdtemp(path.join(os.tmpdir(), 'license-init-'));
  const identityPath = path.join(dir, 'identity.json');
  const publicKeyPath = path.join(dir, 'public.pem');
  let calls = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls += 1; throw new Error('commercial endpoint must not be called'); };
  process.env.SYNVOX_LICENSE_ENFORCE = '1';
  process.env.SYNVOX_LICENSE_URL = 'https://license.test';
  process.env.SYNVOX_LICENSE_IDENTITY_FILE = identityPath;
  process.env.SYNVOX_LICENSE_PUBLIC_KEY_FILE = publicKeyPath;
  try {
    const { assertLicensedAccess } = await import(`../src/licensing/client.mjs?init-test=${Date.now()}`);
    const results = await Promise.all(Array.from({ length: 8 }, () => assertLicensedAccess()));
    assert.deepEqual(results, Array.from({ length: 8 }, () => ({ allowed: true, reason: 'free_release' })));
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = oldFetch;
    delete process.env.SYNVOX_LICENSE_ENFORCE;
    delete process.env.SYNVOX_LICENSE_URL;
    delete process.env.SYNVOX_LICENSE_IDENTITY_FILE;
    delete process.env.SYNVOX_LICENSE_PUBLIC_KEY_FILE;
    await temp.rm(dir, { recursive: true, force: true });
  }
});
