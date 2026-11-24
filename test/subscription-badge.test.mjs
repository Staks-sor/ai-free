import test from 'node:test';
import assert from 'node:assert/strict';
import { renderWindowHtml } from '../src/window-app/ui-html.mjs';

test('free desktop no longer renders or polls a subscription badge', () => {
  const html = renderWindowHtml({ language: 'ru' });
  assert.doesNotMatch(html, /sidebarSubscription/);
  assert.doesNotMatch(html, /api\("\/api\/subscription"\)\.then/);
});
