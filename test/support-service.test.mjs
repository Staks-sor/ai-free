import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupportService } from '../services/support/service.mjs';
import { createSupportHttp } from '../services/support/server.mjs';
import { SUPPORT_CONSENT_VERSION } from '../src/support/report.mjs';

const payload = () => ({ report: { schema: 1, id: randomUUID(), createdAt: '2026-11-10T12:00:00Z', description: 'не отвечает', contact: '', screenshot: null,
  diagnostics: { app: { version: '0.5.63', build: 'a'.repeat(64), surface: 'desktop', node: 'v22.0.0' }, system: { platform: 'win32', release: '10.0', arch: 'x64' }, runtime: {}, failure: { provider: 'qwen' }, events: [] } },
  consent: { accepted: true, version: SUPPORT_CONSENT_VERSION } });

test('receipt is durable/idempotent, consent is separate and Telegram gets no customer data', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-support-')); const notifications = [];
  const opts = { directory: dir, storageRegion: 'RU', operatorReady: true, notify: async text => notifications.push(text) };
  const service = createSupportService(opts);
  try {
    const body = payload();
    assert.throws(() => service.accept({ ...body, consent: { accepted: false } }), /consent/i);
    const first = service.accept(body), second = service.accept(body);
    assert.deepEqual(second, first);
    assert.equal(service.list().length, 1);
    const stored = service.get(first.id);
    assert.equal(stored.consent.version, SUPPORT_CONSENT_VERSION);
    assert.ok(stored.receivedAt);
    assert.equal(fs.statSync(path.join(dir, first.id + '.json')).mode & 0o777, 0o600);
    await service.flushNotices();
    assert.equal(notifications.length, 1);
    assert.doesNotMatch(notifications[0], /qwen|0\.5\.63|не отвечает|Windows|win32|[a-f0-9]{8}-/i);
    assert.equal(createSupportService(opts).list().length, 1);
    assert.throws(() => service.accept({ ...body, report: { ...body.report, description: 'different' } }), /conflict/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('foreign/unknown storage stays disabled and failed notification does not lose report', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-support-'));
  try {
    for (const storageRegion of ['DE', '', 'RU']) {
      const disabled = createSupportService({ directory: dir, storageRegion, operatorReady: false });
      assert.equal(disabled.enabled, false);
      assert.throws(() => disabled.accept(payload()), /disabled/i);
    }
    assert.equal(createSupportService({ directory: dir, storageRegion: 'DE', operatorReady: true }).enabled, false);
    const service = createSupportService({ directory: dir, storageRegion: 'RU', operatorReady: true, notify: async () => { throw Error('offline'); } });
    const receipt = service.accept(payload());
    await service.flushNotices();
    assert.equal(service.get(receipt.id).report.id, receipt.id);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('notification completion cannot restore a deleted report; retention also runs with intake disabled', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-support-')); let done, now = Date.parse('2026-11-10T12:00:00Z');
  const service = createSupportService({ directory: dir, storageRegion: 'RU', operatorReady: true, now: () => now,
    notify: () => new Promise(resolve => { done = resolve; }) });
  try {
    const first = service.accept(payload()); const flushing = service.flushNotices();
    service.remove(first.id); done(); await flushing;
    assert.equal(fs.existsSync(path.join(dir, first.id + '.json')), false);
    service.accept(payload()); now += 31 * 86400_000;
    createSupportService({ directory: dir, now: () => now }).purge();
    assert.equal(fs.readdirSync(dir).length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('retention removes expired reports and support HTTP protects admin and validates origin/size', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-support-')); let now = Date.parse('2026-11-10T12:00:00Z');
  const service = createSupportService({ directory: dir, storageRegion: 'RU', operatorReady: true, now: () => now });
  const server = createSupportHttp({ service, adminPassword: 'test-support-password-0123456789' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await fetch(url + '/support-admin/')).status, 401);
    const basic = { Authorization: 'Basic ' + Buffer.from('support:test-support-password-0123456789').toString('base64') };
    assert.equal((await fetch(url + '/support-admin/', { headers: basic })).status, 200);
    const body = payload();
    assert.equal((await fetch(url + '/v1/support/reports', { method: 'POST', headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 403);
    const response = await fetch(url + '/v1/support/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 201);
    const receipt = await response.json();
    assert.equal((await fetch(url + '/support-admin/' + receipt.id)).status, 401);
    assert.equal((await fetch(url + '/support-admin/' + receipt.id, { headers: basic })).status, 200);
    assert.equal((await fetch(url + '/v1/support/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(3_000_001) })).status, 413);
    now += 31 * 24 * 3600_000; service.purge(); assert.equal(service.list().length, 0);
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); }
});
