import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createLicenseService } from '../services/licensing/service.mjs';
import { createMerchantHttp } from '../services/licensing/merchant-http.mjs';
import { createRobokassa } from '../services/licensing/robokassa.mjs';

test('Robokassa HTTP requires bearer link, explicit consent, origin and signed result', async () => {
  const service = createLicenseService({ database: ':memory:', privateKey: generateKeyPairSync('ed25519').privateKey, mode: 'merchant' });
  const robokassa = createRobokassa({ service, password1: 'one', password2: 'two' });
  const server = createMerchantHttp({ service, bot: {}, robokassa });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const identity = service.register();
    const auth = { Authorization: 'Bearer ' + identity.key };
    assert.equal((await fetch(base + '/v1/license/robokassa/link', { method: 'POST' })).status, 400);
    const link = await (await fetch(base + '/v1/license/robokassa/link', { method: 'POST', headers: auth })).json();
    const remote = new URL(link.url), path = remote.pathname + remote.search;
    const page = await fetch(base + path);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('referrer-policy'), 'same-origin');
    const html = await page.text();
    assert.match(html, /99 ₽/);
    assert.ok(html.includes(identity.id));
    assert.ok(!html.includes('checked'));
    const body = new URLSearchParams({ token: remote.searchParams.get('token'), terms: 'yes', privacy: 'yes', alpha: 'yes', version: service.legalVersion });
    const submit = origin => fetch(base + remote.pathname, { method: 'POST', headers: { Origin: origin }, body, redirect: 'manual' });
    assert.equal((await submit('https://evil.invalid')).status, 403);
    const checkout = await submit('https://synvox.pro');
    assert.equal(checkout.status, 303);
    const destination = new URL(checkout.headers.get('location'));
    assert.equal(destination.origin, 'https://auth.robokassa.ru');
    assert.equal(destination.pathname, '/Merchant/Index.aspx');
    assert.equal(destination.searchParams.get('OutSum'), '99.00');
    const params = destination.searchParams;
    assert.equal(params.get('SignatureValue'), createHash('md5').update(`synvox:99.00:${params.get('InvId')}:${params.get('Receipt')}:one`).digest('hex'));
    assert.equal(await checkout.text(), '');
    const invoice = service.db.prepare('SELECT inv_id FROM robokassa_payments').get().inv_id;
    const resultBody = new URLSearchParams({ OutSum: '99.000000', InvId: String(invoice), SignatureValue: createHash('md5').update(`99.000000:${invoice}:two`).digest('hex') });
    const result = await fetch(base + '/v1/license/robokassa/result', { method: 'POST', body: resultBody });
    assert.equal(await result.text(), `OK${invoice}`);
    assert.equal((await fetch(base + '/v1/license/robokassa/result')).status, 405);
  } finally { await new Promise(r => server.close(r)); service.close(); }
});
