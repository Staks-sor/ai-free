import test from 'node:test';
import assert from 'node:assert/strict';
import { renderWindowHtml } from '../src/window-app/ui-html.mjs';

test('free desktop does not render a checkout action', () => {
  for (const language of ['ru', 'en']) {
    const html = renderWindowHtml({ language });
    assert.doesNotMatch(html, /ЮKassa|YooKassa|Telegram Stars/);
    assert.doesNotMatch(html, /\/api\/subscription\/(?:robokassa|telegram)/);
  }
});
