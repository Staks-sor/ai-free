import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createLicenseService } from '../services/licensing/service.mjs';
import { createMockLicenseServer } from '../services/licensing/server.mjs';
import { handleRequest } from '../api/openai-handler.mjs';

test('local AI API does not require an installation license before inference', async () => {
  const previous = process.env.SYNVOX_LICENSE_ENFORCE;
  const previousIdentity = process.env.SYNVOX_LICENSE_IDENTITY_FILE;
  const previousUrl = process.env.SYNVOX_LICENSE_URL;
  process.env.SYNVOX_LICENSE_ENFORCE = '1';
  process.env.SYNVOX_LICENSE_IDENTITY_FILE = '/nonexistent/synvox-test-identity';
  process.env.SYNVOX_LICENSE_URL = 'invalid-test-endpoint';
  try {
    for (const url of ['/v1/chat/completions', '/v1/responses', '/v1/messages']) {
      let status, payload;
      const response = { setHeader() {}, set statusCode(code) { status = code; }, writeHead(code) { status = code; }, end(body) { payload = JSON.parse(body); } };
      await handleRequest({ url, method: 'POST', headers: { host: '127.0.0.1' } }, response);
      assert.equal(status, 400); assert.notEqual(payload.error?.type, 'license_error');
    }
  } finally {
    if (previous === undefined) delete process.env.SYNVOX_LICENSE_ENFORCE; else process.env.SYNVOX_LICENSE_ENFORCE = previous;
    if (previousIdentity === undefined) delete process.env.SYNVOX_LICENSE_IDENTITY_FILE; else process.env.SYNVOX_LICENSE_IDENTITY_FILE = previousIdentity;
    if (previousUrl === undefined) delete process.env.SYNVOX_LICENSE_URL; else process.env.SYNVOX_LICENSE_URL = previousUrl;
  }
});

test('mock HTTP registration, checkout, payment and browser-origin rejection', async () => {
  const pair = generateKeyPairSync('ed25519');
  const service = createLicenseService({ database: ':memory:', privateKey: pair.privateKey });
  const server = createMockLicenseServer(service);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const blocked = await fetch(url + '/v1/license/register', { method: 'POST', headers: { Origin: 'https://example.com' } });
    assert.equal(blocked.status, 403);
    const identity = await (await fetch(url + '/v1/license/register', { method: 'POST' })).json();
    const headers = { Authorization: `Bearer ${identity.key}`, 'Content-Type': 'application/json' };
    const denied = await fetch(url + '/v1/license/checkout', { method: 'POST', headers, body: JSON.stringify({ requestId: 'before-consent' }) });
    assert.equal(denied.status, 400);
    const consent = await fetch(url + '/v1/license/consents', { method: 'POST', headers, body: JSON.stringify({ legalVersion: '2026-09-07', termsAccepted: true, personalDataAccepted: true, alphaAcknowledged: true }) });
    assert.equal(consent.status, 200);
    const order = await (await fetch(url + '/v1/license/checkout', { method: 'POST', headers, body: JSON.stringify({ requestId: 'test' }) })).json();
    assert.equal(order.amount, 9900);
    const paid = await (await fetch(url + '/v1/license/mock-pay', { method: 'POST', headers, body: JSON.stringify({ orderId: order.id }) })).json();
    assert.equal(paid.mock, true); assert.equal(paid.receipt, null);
  } finally { await new Promise(resolve => server.close(resolve)); service.close(); }
});
