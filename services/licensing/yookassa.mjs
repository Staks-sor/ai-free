import { createHash, randomBytes } from 'node:crypto';

// Server only. Never trust a browser return or a webhook's payment fields.
export function createYooKassa({ service, shopId, secretKey, request = fetch, now = Date.now }) {
  if (!/^\d+$/.test(shopId || '') || !secretKey) throw new Error('YooKassa credentials required');
  const db = service.db;
  db.exec(`CREATE TABLE IF NOT EXISTS yookassa_payments(order_id TEXT PRIMARY KEY REFERENCES orders(id),payment_id TEXT UNIQUE,confirmation_url TEXT,created_at INTEGER NOT NULL,paid_at INTEGER);
    CREATE TABLE IF NOT EXISTS yookassa_links(token_hash TEXT PRIMARY KEY,license_id TEXT NOT NULL REFERENCES licenses(id),expires_at INTEGER NOT NULL,version TEXT NOT NULL);`);
  const hash = value => createHash('sha256').update(value).digest('hex');
  const call = async (path, init = {}) => {
    const response = await request('https://api.yookassa.ru/v3' + path, { ...init,
      headers: { Authorization: 'Basic ' + Buffer.from(shopId + ':' + secretKey).toString('base64'), 'Content-Type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('YooKassa request rejected');
    return response.json();
  };
  const validate = (payment, order) => {
    if (!payment || payment.test !== false || payment.recipient?.account_id !== shopId
      || payment.amount?.currency !== 'RUB' || payment.amount?.value !== (order.amount / 100).toFixed(2)
      || payment.metadata?.product !== 'synvox' || payment.metadata?.order_id !== order.id
      || payment.metadata?.installation_id !== order.license_id) throw new Error('Payment mismatch');
  };
  const view = token => {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(token)) throw new Error('Link expired');
    const row = db.prepare('SELECT * FROM yookassa_links WHERE token_hash=? AND expires_at>? AND version=?').get(hash(token), now(), service.legalVersion);
    if (!row) throw new Error('Link expired');
    return { ...row, priceRub: service.rubAmountForInstallation(row.license_id) / 100 };
  };
  const issue = async order => {
    if (order.paid) throw new Error('Order already paid');
    db.prepare('INSERT OR IGNORE INTO yookassa_payments(order_id,created_at) VALUES(?,?)').run(order.id, now());
    const existing = db.prepare('SELECT * FROM yookassa_payments WHERE order_id=?').get(order.id);
    if (existing.confirmation_url) return { orderId: order.id, url: existing.confirmation_url };
    // YooKassa retains idempotency keys for 24h. Never retry an uncertain old creation.
    if (now() - existing.created_at >= 23 * 3600000) throw new Error('Payment requires reconciliation');
    const payment = await call('/payments', { method: 'POST', headers: { 'Idempotence-Key': order.id }, body: JSON.stringify({
      amount: { value: (order.amount / 100).toFixed(2), currency: 'RUB' }, capture: true,
      confirmation: { type: 'redirect', return_url: 'https://synvox.pro/v1/license/robokassa/success' },
      description: 'Право использования SYNVOX на 30 дней. ID установки: ' + order.license_id,
      metadata: { product: 'synvox', order_id: order.id, installation_id: order.license_id },
    }) });
    validate(payment, order);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(payment.id || '')) throw new Error('Invalid payment ID');
    const url = new URL(payment.confirmation?.confirmation_url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !['yookassa.ru', 'yoomoney.ru'].some(host => url.hostname === host || url.hostname.endsWith('.' + host))) throw new Error('Invalid confirmation URL');
    db.prepare('UPDATE yookassa_payments SET payment_id=?,confirmation_url=? WHERE order_id=?').run(payment.id, url.href, order.id);
    return { orderId: order.id, url: url.href };
  };
  const reconcile = async paymentId => {
    const row = db.prepare('SELECT p.*,o.id,o.amount,o.currency,o.license_id FROM yookassa_payments p JOIN orders o ON o.id=p.order_id WHERE p.payment_id=?').get(paymentId);
    if (!row) return false; // Shared shop: ignore VPN and other applications.
    const payment = await call('/payments/' + encodeURIComponent(paymentId));
    validate(payment, row);
    if (payment.id !== paymentId) throw new Error('Payment mismatch');
    if (payment.status !== 'succeeded' || payment.paid !== true) return false;
    db.exec('BEGIN IMMEDIATE');
    try {
      const order = db.prepare('SELECT paid FROM orders WHERE id=?').get(row.order_id);
      if (!order.paid) {
        db.prepare('UPDATE licenses SET access_until=MAX(access_until,?)+? WHERE id=?').run(now(), 30 * 86400000, row.license_id);
        db.prepare('UPDATE orders SET paid=1 WHERE id=?').run(row.order_id);
        db.prepare('UPDATE yookassa_payments SET paid_at=? WHERE order_id=?').run(now(), row.order_id);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return true;
  };
  let reconciliationCursor = '';
  return {
    provider: 'yookassa', view, reconcile,
    async reconcilePending() {
      const rows = db.prepare('SELECT p.payment_id FROM yookassa_payments p JOIN orders o ON o.id=p.order_id WHERE o.paid=0 AND p.payment_id>? ORDER BY p.payment_id LIMIT 25').all(reconciliationCursor);
      let failed = 0;
      for (const row of rows) {
        try { await reconcile(row.payment_id); } catch { failed++; }
        reconciliationCursor = row.payment_id;
      }
      if (rows.length < 25) reconciliationCursor = '';
      return { checked: rows.length, failed };
    },
    async reconcileInstallation(key) {
      const id = service.installationId(key);
      const rows = db.prepare('SELECT p.payment_id FROM yookassa_payments p JOIN orders o ON o.id=p.order_id WHERE o.license_id=? AND o.paid=0 AND p.payment_id IS NOT NULL ORDER BY p.created_at DESC LIMIT 5').all(id);
      for (const row of rows) await reconcile(row.payment_id);
    },
    link(key) {
      const id = service.installationId(key);
      if (db.prepare('SELECT revoked FROM licenses WHERE id=?').get(id).revoked) throw new Error('Installation unavailable');
      const token = randomBytes(24).toString('base64url');
      db.prepare('INSERT INTO yookassa_links VALUES(?,?,?,?)').run(hash(token), id, now() + 600000, service.legalVersion);
      // Kept for installed 0.5.0 clients that validate this exact wrapper URL.
      return { url: 'https://synvox.pro/v1/license/robokassa/checkout?token=' + token, installationId: id, expiresIn: 600 };
    },
    async accept(token, fields) {
      const row = view(token);
      if (['terms', 'privacy', 'alpha'].some(k => fields.getAll(k).length !== 1 || fields.get(k) !== 'yes') || fields.get('version') !== row.version) throw new Error('Explicit current consents required');
      service.acceptForInstallation(row.license_id, { legalVersion: row.version, termsAccepted: true, personalDataAccepted: true, alphaAcknowledged: true });
      return issue(service.checkoutForInstallation(row.license_id, row.token_hash, { currency: 'RUB', amount: service.rubAmountForInstallation(row.license_id) }));
    },
    async checkout(key, requestId) {
      return issue(service.checkout(key, requestId, { currency: 'RUB', amount: service.rubAmountForInstallation(service.installationId(key)) }));
    },
  };
}
