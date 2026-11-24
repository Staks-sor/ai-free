import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import { normalizeSupportReport, redactSupportText, SUPPORT_CONSENT_VERSION } from '../src/support/report.mjs';
import { createSupportDrafts, collectSupportDiagnostics } from '../src/support/client.mjs';
import { requiresDesktopLicense } from '../src/licensing/desktop-gate.mjs';

export const exampleReport = () => ({ schema: 1, id: randomUUID(), createdAt: '2026-11-10T12:00:00.000Z',
  description: 'Qwen не отвечает', contact: '', screenshot: null,
  diagnostics: { app: { version: '0.5.63', build: 'a'.repeat(64), surface: 'desktop', node: 'v22.0.0' },
    system: { platform: 'win32', release: '10.0.26200', arch: 'x64' },
    runtime: { python: '3.12.1', camoufox: '0.5.4', browserPhase: 'ready' },
    failure: { provider: 'qwen', model: 'qwen3.8-plus', code: 'QWEN_RUNTIME_NOT_READY' }, events: [] } });

test('support report uses an allowlist, excludes workspace/account identifiers and strips credentials', () => {
  const raw = exampleReport();
  raw.installationId = 'private-installation'; raw.key = 'private-license';
  raw.diagnostics.app.path = 'C:\\Users\\Alice\\project';
  raw.diagnostics.workspace = { root: '/Users/Alice/private', messages: ['private prompt'] };
  raw.description += ' Authorization: Bearer abcdefsecret token=secretValue C:\\Users\\Alice\\project /Users/Alice/private';
  const clean = normalizeSupportReport(raw);
  assert.doesNotMatch(JSON.stringify(clean), /Alice|abcdefsecret|secretValue|private-installation|private-license|private prompt/);
  assert.equal(clean.diagnostics.failure.code, 'QWEN_RUNTIME_NOT_READY');
  assert.equal(clean.id, raw.id);
  assert.match(redactSupportText('eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop.abcdefghijklmnop'), /redacted/);
});

test('screenshot is validated, bounded and re-encoded; arbitrary files are rejected', () => {
  const raw = exampleReport();
  raw.screenshot = 'data:image/png;base64,' + PNG.sync.write(new PNG({ width: 2, height: 2 })).toString('base64');
  assert.match(normalizeSupportReport(raw).screenshot, /^data:image\/png;base64,/);
  raw.screenshot = 'data:text/html;base64,PGgxPnByaXZhdGU8L2gxPg==';
  assert.throws(() => normalizeSupportReport(raw), /screenshot/i);
  raw.screenshot = 'data:image/png;base64,' + Buffer.alloc(2_000_000).toString('base64');
  assert.throws(() => normalizeSupportReport(raw), /screenshot/i);
});

test('diagnostics report actual running build, contain no home/path and do not read user history', async () => {
  const data = await collectSupportDiagnostics({ context: { provider: 'qwen', model: 'qwen3.8-plus', error: 'QWEN_RUNTIME_NOT_READY' },
    probePython: async () => 'Python 3.12.1', readEvents: () => [] });
  assert.match(data.app.version, /^\d+\.\d+\.\d+/);
  assert.match(data.app.build, /^[a-f0-9]{64}$/);
  assert.equal(data.runtime.python, '3.12.1');
  assert.doesNotMatch(JSON.stringify(data), /state\.json|auth\.json|license|workspace|\/Users\/|C:\\\\Users/i);
});

test('drafts never send before separate consent and retry the exact preview with one request id', async () => {
  let calls = 0, submitted;
  const drafts = createSupportDrafts({ collect: async () => exampleReport().diagnostics,
    enabled: true, send: async payload => { calls++; submitted = payload; return { id: payload.report.id, accepted: true }; } });
  const draft = await drafts.prepare({ description: 'не отвечает', context: { error: 'secret' } });
  assert.equal(calls, 0);
  await assert.rejects(drafts.submit({ draftId: draft.draftId, consent: false }), /consent/i);
  assert.equal(calls, 0);
  const receipt = await drafts.submit({ draftId: draft.draftId, consent: true });
  assert.equal(receipt.id, draft.report.id);
  assert.deepEqual(submitted.report, draft.report);
  assert.equal(submitted.consent.version, SUPPORT_CONSENT_VERSION);
  await drafts.submit({ draftId: draft.draftId, consent: true });
  assert.equal(calls, 1);
  assert.equal(requiresDesktopLicense('POST', '/api/support/drafts'), false);
  assert.equal(requiresDesktopLicense('POST', '/api/support/send'), false);
});

test('offline/disabled reporting preserves local export without transmitting or changing saved data', async () => {
  let calls = 0;
  const drafts = createSupportDrafts({ collect: async () => exampleReport().diagnostics, enabled: false, send: async () => { calls++; } });
  const draft = await drafts.prepare({ description: 'ошибка' });
  await assert.rejects(drafts.submit({ draftId: draft.draftId, consent: true }), /disabled/i);
  assert.ok(draft.report.id);
  assert.equal(calls, 0);
});

test('an ambiguous network failure keeps the same report for retry and ignores edits to the returned preview', async () => {
  const sent = []; let attempts = 0;
  const drafts = createSupportDrafts({ collect: async () => exampleReport().diagnostics, enabled: true,
    send: async payload => { sent.push(payload); if (!attempts++) throw Error('network'); return { accepted: true, id: payload.report.id }; } });
  const draft = await drafts.prepare({ description: 'initial' });
  draft.report.description = 'changed outside the draft';
  await assert.rejects(drafts.submit({ draftId: draft.draftId, consent: true }), /network/);
  await drafts.submit({ draftId: draft.draftId, consent: true });
  assert.deepEqual(sent[0], sent[1]); assert.equal(sent[1].report.description, 'initial');
});

test('bounded structured event tail drops messages, paths, request bodies and foreign fields', async () => {
  const data = await collectSupportDiagnostics({ probePython: async () => '', readEvents: () => [
    { timestamp: '2026-11-10T12:00:00Z', level: 'error', component: 'qwen', event: 'runtime.not_ready', error: { code: 'QWEN_RUNTIME_NOT_READY', message: 'private conversation' },
      data: { provider: 'qwen', durationMs: 45000, token: 'SECRET', workspace: '/secret', body: 'private prompt' } }
  ] });
  assert.equal(data.events[0].code, 'QWEN_RUNTIME_NOT_READY');
  assert.equal(data.events[0].durationMs, 45000);
  assert.doesNotMatch(JSON.stringify(data), /SECRET|private conversation|private prompt|\/secret/);
});

test('DeepSeek CAPTCHA diagnostics include only outcome/status and known service error codes', async () => {
  const data = await collectSupportDiagnostics({ probePython: async () => '', readEvents: () => [
    { level: 'info', component: 'deepseek-captcha', event: 'captcha.result', data: { provider: 'deepseek', status: 200,
      captchaResult: 'rejected', captchaErrorCodes: ['invalid-input-response', 'PRIVATE_CUSTOMER_VALUE'], token: 'SECRET' } }
  ] });
  assert.equal(data.events[0].captchaResult, 'rejected');
  assert.deepEqual(data.events[0].captchaErrorCodes, ['invalid-input-response']);
  assert.doesNotMatch(JSON.stringify(data), /SECRET|PRIVATE_CUSTOMER_VALUE/);
});
