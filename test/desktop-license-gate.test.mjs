import test from 'node:test';
import assert from 'node:assert/strict';
import { requiresDesktopLicense } from '../src/licensing/desktop-gate.mjs';
import { requiresDesktopLicense as pluginRequiresDesktopLicense } from '../plugin-for-vscode/src/licensing/desktop-gate.mjs';
test('free runtime never requires activation or paid access on either runtime', () => {
  for (const gate of [requiresDesktopLicense, pluginRequiresDesktopLicense]) {
    for (const [method, path] of [
      ['POST', '/api/legal/consents'],
      ['POST', '/api/legal/consents/other'],
      ['POST', '/api/conversations/a/messages'],
      ['POST', '/api/browser/navigate'],
      ['POST', '/api/voice/transcribe'],
      ['POST', '/v1/chat/completions'],
      ['GET', '/provider-frame/chatgpt'],
      ['POST', '/api/browse/mkdir'],
    ]) assert.equal(gate(method, path), false, `${method} ${path}`);
  }
});
