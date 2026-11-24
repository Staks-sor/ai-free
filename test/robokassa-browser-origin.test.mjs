import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { handleRobokassaHttp } from '../services/licensing/robokassa-http.mjs';

test('browser retains same-site POST origin while external referrers stay private', async () => {
  let received;
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST') { received = req.headers.origin; res.end('received'); return; }
    await handleRobokassaHttp(req, res, new URL(req.url, 'https://synvox.pro'), { view: () => ({ license_id: 'test-only' }) }, 'test');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await browser.newPage();
    await page.goto(`${base}/v1/license/robokassa/checkout?token=test`);
    for (const name of ['terms', 'privacy', 'alpha']) await page.locator(`input[name="${name}"]`).check();
    await Promise.all([page.waitForURL('**/checkout'), page.getByRole('button').click()]);
    assert.equal(received, base);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
