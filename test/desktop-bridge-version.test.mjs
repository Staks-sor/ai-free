import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_FREE_VERSION } from '../src/config.mjs';
import { renderWindowHtml } from '../src/window-app/ui-html.mjs';

test('desktop bridge shows the running package version', () => {
  assert.ok(renderWindowHtml({ language: 'ru' }).includes(`<title>SYNVOX v${AI_FREE_VERSION}</title>`));
});
