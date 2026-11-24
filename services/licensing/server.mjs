import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createLicenseService } from './service.mjs';

// Explicit local mock server; cannot bind a public interface or take real payments.
export function createMockLicenseServer(service) {
  return http.createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      if (req.headers.origin || !/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host || '')) return send(403, { error: 'Only local development requests are allowed' });
      const url = new URL(req.url, 'http://127.0.0.1');
      const key = String(req.headers.authorization || '').replace(/^Bearer /, '');
      if (req.method === 'GET' && url.pathname === '/v1/license/status') return send(200, service.status(key));
      if (req.method !== 'POST') return send(404, { error: 'Not found' });
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 8192) return send(413, { error: 'Request too large' }); }
      const body = raw ? JSON.parse(raw) : {};
      if (url.pathname === '/v1/license/register') return send(201, service.register(body.key));
      if (url.pathname === '/v1/license/consents') return send(200, service.acceptConsents(key, body));
      if (url.pathname === '/v1/license/checkout') return send(200, service.checkout(key, body.requestId));
      if (url.pathname === '/v1/license/mock-pay') return send(200, service.mockPay(key, body.orderId));
      return send(404, { error: 'Not found' });
    } catch { return send(400, { error: 'Invalid license request' }); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2];
  if (!directory || !path.isAbsolute(directory)) throw new Error('Provide an absolute private data directory outside the release/repository');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const privatePath = path.join(directory, 'private.pem');
  if (!fs.existsSync(privatePath)) {
    const pair = generateKeyPairSync('ed25519');
    fs.writeFileSync(privatePath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(path.join(directory, 'public.pem'), pair.publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx', mode: 0o644 });
  }
  const database = path.join(directory, 'licenses.sqlite');
  const service = createLicenseService({ database, privateKey: fs.readFileSync(privatePath) });
  fs.chmodSync(database, 0o600);
  const server = createMockLicenseServer(service);
  server.listen(4329, '127.0.0.1', () => console.log('SYNVOX MOCK licensing: http://127.0.0.1:4329 — no real payments'));
  const shutdown = () => server.close(() => { service.close(); process.exit(0); });
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
