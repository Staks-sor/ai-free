import test from 'node:test';
import assert from 'node:assert/strict';
import { renderWindowHtml } from '../src/window-app/ui-html.mjs';
import { setupSupportUi } from '../src/window-app/support-ui.mjs';
import { attachQwenSupportDiagnostics, logQwenRuntimeNotReady } from '../src/providers/qwen/support-network.mjs';

test('shared UI offers preview, separate unchecked consent, attachment, local export and explicit send', () => {
  const html = renderWindowHtml({ language: 'ru' });
  assert.match(html, /setupSupportUi/);
  assert.match(html, /supportReportButton/);
  assert.match(html, /supportUi\.open/);
  assert.match(html, /\.supportDialog \[hidden\]\{display:none!important\}/);
  const ui = setupSupportUi.toString();
  assert.match(ui, /\/api\/support\/drafts/);
  assert.match(ui, /\/api\/support\/send/);
  assert.match(ui, /consent\.checked = false/);
  assert.match(ui, /draftId: draft\.draftId/);
  assert.match(ui, /image\/png,image\/jpeg,image\/webp/);
  assert.doesNotMatch(ui, /getDisplayMedia|captureScreen|api\.telegram\.org|botToken/);
});

test('Qwen resource diagnostics capture failures without URLs, tokens, headers or other providers', () => {
  const handlers = {}, events = [];
  const page = { on: (event, fn) => { handlers[event] = fn; } };
  const logger = { warn: (event, data) => events.push({ event, data }), info: (event, data) => events.push({ event, data }) };
  attachQwenSupportDiagnostics(page, logger);
  handlers.requestfailed({ url: () => 'https://assets.alicdn.com/g/security/SDK.js?token=SECRET', failure: () => ({ errorText: 'NS_ERROR_NET_TIMEOUT /Users/private' }) });
  handlers.response({ url: () => 'https://assets.alicdn.com/g/qwen-chat-fe/123/js/main.js?token=SECRET', status: () => 403 });
  handlers.response({ url: () => 'https://accounts.google.com/private?token=SECRET', status: () => 403 });
  assert.equal(events.length, 2);
  assert.equal(events[0].data.resource, 'qwen-sdk');
  assert.equal(events[0].data.reason, 'timeout');
  assert.equal(events[1].data.resource, 'qwen-app');
  assert.equal(events[1].data.status, 403);
  assert.doesNotMatch(JSON.stringify(events), /SECRET|\/Users|https:|token|google/);
});

test('readiness diagnostics retain only readiness flags, without browser state or tokens', () => {
  let captured;
  logQwenRuntimeNotReady({ sdkInitialized: false, deviceTokenPresent: false, appScriptPresent: true, documentReady: true, token: 'SECRET' },
    { warn: (event, data) => { captured = { event, data }; } });
  assert.equal(captured.data.sdkInitialized, false);
  assert.equal(captured.data.appScriptPresent, true);
  assert.doesNotMatch(JSON.stringify(captured), /SECRET/);
});
