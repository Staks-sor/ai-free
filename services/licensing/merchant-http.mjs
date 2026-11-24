import http from 'node:http';
import { createHash } from 'node:crypto';
import { handleRobokassaHttp } from './robokassa-http.mjs';

const purchaseRoutes = new Set([
  '/v1/license/register', '/v1/license/telegram',
  '/v1/license/robokassa/link', '/v1/license/robokassa/checkout',
]);

export function createMerchantHttp({ service, bot, robokassa, yookassa, paymentsEnabled = true }) {
  const limits = new Map();
  return http.createServer({ requestTimeout: 10000, headersTimeout: 10000 }, async (req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (!paymentsEnabled && purchaseRoutes.has(url.pathname)) {
        if (req.method === 'GET' && url.pathname.endsWith('/checkout')) {
          res.writeHead(410, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
          return res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SYNVOX</title><h1>Оплата SYNVOX отключена</h1><p><a href="https://synvox.pro/">Скачать бесплатную версию / Download the free version</a></p><p><a href="https://synvox.pro/documents/#refunds">Ранее совершённые платежи / Past payments</a></p></html>');
        }
        return send(410, { error: 'Оплата SYNVOX отключена / SYNVOX payments are closed.', url: 'https://synvox.pro/' });
      }
      if (url.pathname === '/v1/license/robokassa/result' && await handleRobokassaHttp(req, res, url, robokassa, service.legalVersion)) return;
      if (req.method === 'GET' && url.pathname === '/v1/license/health') return send(200, { ok: true, provider: yookassa ? 'yookassa' : 'telegram-stars', paymentsEnabled });
      const bucket = createHash('sha256').update(String(req.headers['x-synvox-ip'] || req.socket.remoteAddress)).digest('hex');
      const now = Date.now();
      for (const [key, value] of limits) if (value.until <= now) limits.delete(key);
      if (limits.size >= 5000 && !limits.has(bucket)) return send(429, { error: 'Please retry later' });
      const usage = limits.get(bucket) || { count: 0, until: now + 60000 };
      limits.set(bucket, usage);
      if (++usage.count > 60) return send(429, { error: 'Please retry later' });
      if (await handleRobokassaHttp(req, res, url, yookassa || robokassa, service.legalVersion)) return;
      if (req.headers.origin) return send(403, { error: 'Desktop API only' });
      const key = String(req.headers.authorization || '').replace(/^Bearer /, '');
      if (req.method === 'GET' && url.pathname === '/v1/license/status') {
        if (yookassa) await yookassa.reconcileInstallation(key);
        return send(200, service.status(key));
      }
      if (req.method !== 'POST' || !['/v1/license/register', '/v1/license/telegram'].includes(url.pathname)) return send(404, { error: 'Not found' });
      let raw = '', size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 8192) return send(413, { error: 'Too large' }); raw += chunk; }
      const body = JSON.parse(raw || '{}');
      if (url.pathname === '/v1/license/register') {
        if (typeof body.key !== 'string') return send(400, { error: 'Installation key required' });
        return send(200, service.register(body.key));
      }
      const pair = bot.pair(key);
      return send(200, { url: pair.url, expiresIn: pair.expiresIn });
    } catch { return send(400, { error: 'Invalid request or installation unavailable' }); }
  });
}
