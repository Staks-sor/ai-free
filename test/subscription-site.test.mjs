import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSiteSubscriptionConfig } from '../src/licensing/site-config.mjs';

const config = JSON.parse(readFileSync(new URL('../website/static/api/v1/subscription/config.json', import.meta.url)));
test('legacy subscription configuration is local and does not request the website', async () => {
  let requested;
  const result = await getSiteSubscriptionConfig({ fetchImpl: async (url) => { requested = url; return { ok: true, json: async () => config }; } });
  assert.equal(requested, undefined);
  assert.equal(result.source, 'local');
  assert.equal(result.paymentEnabled, false);
  assert.equal(result.legalVersion, undefined);
});
test('legacy configuration remains free when a caller supplies a network implementation', async () => {
  const result = await getSiteSubscriptionConfig({ fetchImpl: async () => { throw new Error('must not fetch'); } });
  assert.equal(result.source, 'local');
  assert.equal(result.paymentEnabled, false);
});
