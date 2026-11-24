import test from 'node:test';
import assert from 'node:assert/strict';
import { siteNavigation } from '../src/lib/content/navigation.js';
test('language switch keeps the current page and section', () => {
  assert.equal(siteNavigation('/documents/', '#refunds').alternate, '/en/documents/#refunds');
  assert.equal(siteNavigation('/en/instructions/').alternate, '/instructions/');
  assert.equal(siteNavigation('/').alternate, '/en/');
  assert.equal(siteNavigation('/en/').alternate, '/');
});
test('every language has matching instruction, document and download destinations', () => {
  for (const prefix of ['', '/en']) {
    const nav=siteNavigation(prefix+'/documents/');
    assert.ok(nav.items.some(x=>x.href===prefix+'/instructions/'));
    assert.ok(nav.items.some(x=>x.href===prefix+'/documents/'));
    assert.equal(nav.download,prefix+'/#download');
  }
});
