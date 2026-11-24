import assert from 'node:assert/strict';
import test from 'node:test';
import { attachBrowserScreenshot, MAX_BROWSER_SCREENSHOT_BYTES } from '../src/browser/service.mjs';

test('browser snapshot attaches a JPEG above the former 900 KB threshold', () => {
  const result = attachBrowserScreenshot({}, Buffer.alloc(900_001, 7), {
    path: '/tmp/browser.jpg', bytes: 900_001, mime: 'image/jpeg',
  }, true);
  assert.equal(result.screenshot.base64.length > 0, true);
  assert.equal(result.visionUnavailable, undefined);
});

test('browser snapshot explicitly marks a screenshot over the shared attachment limit unavailable', () => {
  const bytes = MAX_BROWSER_SCREENSHOT_BYTES + 1;
  const result = attachBrowserScreenshot({}, Buffer.alloc(bytes, 7), {
    path: '/tmp/browser.jpg', bytes, mime: 'image/jpeg',
  }, true);
  assert.equal(result.screenshot.base64, undefined);
  assert.match(result.visionUnavailable, /16 MB/i);
});
