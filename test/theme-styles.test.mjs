import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { STYLES } from "../src/window-app/ui-styles.mjs";

describe("window themes", () => {
  it("uses theme surfaces for modal and interactive neutral backgrounds", () => {
    assert.match(STYLES, /body\[data-theme="light"\][\s\S]*--modal-bg: #ffffff/);
    assert.match(STYLES, /\.settingsPanel\s*\{[\s\S]*?background: var\(--modal-bg\)/);
    assert.match(STYLES, /\.settingsOverlay\s*\{[\s\S]*?background: var\(--overlay-bg\)/);
    assert.match(STYLES, /\.providerOption\s*\{[\s\S]*?background: var\(--surface-subtle\)/);
    assert.match(STYLES, /\.toolLog\s*\{[\s\S]*?background: var\(--surface-inset\)/);
    assert.doesNotMatch(STYLES, /\.settingsPanel\s*\{[\s\S]*?background: #14171e/);
  });

  it("defines readable accent text for light and contrast themes", () => {
    assert.match(STYLES, /body\[data-theme="light"\][\s\S]*--purple-text: #6d28d9/);
    assert.match(STYLES, /body\[data-theme="contrast"\][\s\S]*--teal-text: #00695c/);
    assert.match(STYLES, /\.modelPicker\s*\{[\s\S]*?color: var\(--blue-text\)/);
  });

  it("gives the light interface distinct navigation, content, and composer surfaces", () => {
    assert.match(STYLES, /body\[data-theme="light"\][\s\S]*--topbar-bg: #ffffff/);
    assert.match(STYLES, /body\[data-theme="light"\][\s\S]*--message-bg: #f8fafc/);
    assert.match(STYLES, /body\[data-theme="light"\][\s\S]*--composer-bg: #eaf0f6/);
    assert.match(STYLES, /\.topbar\s*\{[\s\S]*?background: var\(--topbar-bg\)/);
    assert.match(STYLES, /\.messages\s*\{[\s\S]*?background: var\(--message-bg\)/);
    assert.match(STYLES, /\.composer\s*\{[\s\S]*?background: var\(--composer-bg\)/);
  });
});
