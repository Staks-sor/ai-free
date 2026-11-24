import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderWindowHtml } from "../src/window-app/ui-html.mjs";

describe("free desktop UI", () => {
  it("does not render the subscription, renewal, or checkout surfaces", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.doesNotMatch(html, /id="sidebarSubscription"/);
    assert.doesNotMatch(html, /id: "subscription", label: "Подписка"/);
    assert.doesNotMatch(html, /renderSubscriptionSettings\(panels\.subscription\)/);
    assert.doesNotMatch(html, /async function renderSubscriptionSettings/);
    assert.doesNotMatch(html, /\.subscriptionCard\s*\{/);
  });

  it("keeps the separate legal consent flow", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(html, /termsAccepted/);
    assert.match(html, /personalDataAccepted/);
    assert.match(html, /alphaAcknowledged/);
    assert.match(html, /\/api\/legal\/consents/);
    assert.doesNotMatch(html, /api\("\/api\/subscription"\)\.then/);
  });
});
