import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const [action, identityPath] = process.argv.slice(2);
if (!['register', 'status', 'accept-consents', 'mock-pay'].includes(action) || !identityPath || !path.isAbsolute(identityPath)) throw new Error('Usage: node scripts/license-dev.mjs register|status|accept-consents|mock-pay ABSOLUTE_IDENTITY_PATH');
const request = async (route, key, body) => {
  const response = await fetch('http://127.0.0.1:4329/v1/license/' + route, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`Mock licensing returned ${response.status}`);
  return response.json();
};
if (action === 'register') {
  if (fs.existsSync(identityPath)) throw new Error('Identity exists; reuse it instead of creating another trial');
  const identity = await request('register', null, {});
  fs.writeFileSync(identityPath, JSON.stringify(identity), { flag: 'wx', mode: 0o600 });
  console.log('Test identity saved. Keep this file private; no key printed.');
} else {
  const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
  if (action === 'accept-consents') {
    if (!process.argv.includes('--confirm')) throw new Error('Read https://synvox.pro/documents/ first. To explicitly record test consent, add --confirm. This is a local development database only.');
    await request('consents', identity.key, { legalVersion: '2026-09-07', termsAccepted: true, personalDataAccepted: true, alphaAcknowledged: true });
    console.log('Explicit test consent recorded in the local mock database; no production account changed.');
  } else if (action === 'mock-pay') {
    const order = await request('checkout', identity.key, { requestId: randomUUID() });
    await request('mock-pay', identity.key, { orderId: order.id });
    console.log('MOCK: 30 days credited; no money charged and no tax receipt issued.');
  } else {
    const proof = await request('status', identity.key);
    console.log(JSON.parse(Buffer.from(proof.payload, 'base64url').toString()));
  }
}
