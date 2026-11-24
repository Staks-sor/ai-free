import test from 'node:test';
import assert from 'node:assert/strict';
import { externalLinkCommand } from '../src/window-app/external-link.mjs';
test('payment links open through the OS with an explicit safe argument list', () => {
  assert.deepEqual(externalLinkCommand('https://synvox.pro/documents/', 'darwin'), ['open',['https://synvox.pro/documents/']]);
  assert.deepEqual(externalLinkCommand('https://t.me/Synvox_bot?start=abc', 'win32'), ['rundll32',['url.dll,FileProtocolHandler','https://t.me/Synvox_bot?start=abc']]);
  for(const url of ['javascript:alert(1)','https://synvox.pro.evil.test/','https://user:secret@synvox.pro/','file:///tmp/a','https://evil.test/']) assert.throws(()=>externalLinkCommand(url));
});
