import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSubscriptionStatus } from '../src/licensing/settings.mjs';
import { renderWindowHtml } from '../src/window-app/ui-html.mjs';

test('desktop hides subscription and payment UI while retaining legal documents', () => {
  const html = renderWindowHtml({ language: 'ru' });
  assert.doesNotMatch(html, /id="sidebarSubscription"/);
  assert.doesNotMatch(html, /id: "subscription", label: "Подписка"/);
  assert.doesNotMatch(html, /renderSubscriptionSettings\(panels\.subscription\)/);
  assert.match(html, /\/api\/legal\/consents/);
});

test('legacy subscription status is local and always free', async () => {
  const free = await getSubscriptionStatus();
  assert.equal(free.state, 'free_release');
  assert.equal(free.paymentEnabled, false);
});
