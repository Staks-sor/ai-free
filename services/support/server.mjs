import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { SUPPORT_MAX_BODY } from '../../src/support/report.mjs';

const digest = value => createHash('sha256').update(value).digest();
const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const page = (title, content) => `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><style>body{font:16px system-ui;max-width:960px;margin:32px auto;padding:16px;overflow-wrap:anywhere}pre{white-space:pre-wrap}article{padding:16px;border-bottom:1px solid #ccc}img{max-width:100%;height:auto}a{color:#2457a7}</style><h1>${escape(title)}</h1>${content}</html>`;

export function createSupportHttp({ service, adminPassword } = {}) {
  if (typeof adminPassword !== 'string' || adminPassword.length < 24) throw new Error('Private support admin credential required');
  const adminDigest = digest('Basic ' + Buffer.from('support:' + adminPassword).toString('base64'));
  const limits = new Map();
  return http.createServer({ requestTimeout: 20000, headersTimeout: 10000 }, async (req, res) => {
    const send = (code, data, type = 'application/json; charset=utf-8') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'" });
      res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
    };
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/support-admin/')) {
        if (!timingSafeEqual(adminDigest, digest(String(req.headers.authorization || '')))) {
          res.setHeader('WWW-Authenticate', 'Basic realm="SYNVOX support", charset="UTF-8"');
          return send(401, { error: 'Authentication required' });
        }
        if (req.method !== 'GET') return send(405, { error: 'Read-only panel' });
        if (url.pathname === '/support-admin/') {
          const rows = service.list().slice(0, 200).map(r => `<article><a href="/support-admin/${r.report.id}">${escape(r.report.id)}</a> · ${escape(r.receivedAt)}<p>${escape(r.report.diagnostics.app.surface)} ${escape(r.report.diagnostics.app.version)} · ${escape(r.report.diagnostics.system.platform)} · ${escape(r.report.diagnostics.failure.provider)}</p><p>${escape(r.report.description.slice(0, 200))}</p></article>`).join('');
          return send(200, page('Обращения SYNVOX', rows || '<p>Обращений нет.</p>'), 'text/html; charset=utf-8');
        }
        const match = url.pathname.match(/^\/support-admin\/([a-f0-9-]{36})(\/screenshot)?$/);
        if (!match) return send(404, { error: 'Not found' });
        const record = service.get(match[1]);
        if (match[2]) {
          if (!record.report.screenshot) return send(404, { error: 'No screenshot' });
          return send(200, Buffer.from(record.report.screenshot.split(',')[1], 'base64'), 'image/png');
        }
        const { screenshot, ...report } = record.report;
        return send(200, page('Обращение ' + report.id,
          `<a href="/support-admin/">Все обращения</a><pre>${escape(JSON.stringify({ ...record, report }, null, 2))}</pre>`
          + (screenshot ? `<img alt="Изображение пользователя" src="/support-admin/${report.id}/screenshot">` : '')), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/v1/support/health') return send(200, { enabled: service.enabled });
      if (req.method !== 'POST' || url.pathname !== '/v1/support/reports') return send(404, { error: 'Not found' });
      // Reports come through the application's loopback backend, never a third-party web form.
      if (req.headers.origin || req.headers['content-encoding']) return send(403, { error: 'Desktop support API only' });
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(415, { error: 'JSON required' });
      if (!service.enabled) return send(503, { error: 'Reporting disabled' });
      const now = Date.now();
      for (const [key, value] of limits) if (value.until <= now) limits.delete(key);
      const bucket = digest(String(req.headers['x-synvox-ip'] || req.socket.remoteAddress)).toString('hex');
      if (limits.size >= 5000 && !limits.has(bucket)) return send(429, { error: 'Please retry later' });
      const usage = limits.get(bucket) || { until: now + 600_000, count: 0 }; limits.set(bucket, usage);
      if (++usage.count > 20) return send(429, { error: 'Please retry later' });
      if (Number(req.headers['content-length']) > SUPPORT_MAX_BODY) { req.resume(); return send(413, { error: 'Report too large' }); }
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > SUPPORT_MAX_BODY) { send(413, { error: 'Report too large' }); return; }
        chunks.push(chunk);
      }
      const receipt = service.accept(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      return send(201, receipt);
    } catch (error) { return send(error.status || 400, { error: error.status === 404 ? 'Report not found' : 'Unable to accept support request' }); }
  });
}
