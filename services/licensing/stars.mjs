// Server-only adapter. Updates MUST originate from authenticated Telegram transport,
// never from the desktop client or an unauthenticated HTTP request.
export function createStarsPayments({ service, priceStars, telegram, now = Date.now }) {
  if (!Number.isSafeInteger(priceStars) || priceStars < 1 || priceStars > 100000) throw new Error('Configure an explicit Stars price');
  const db = service.db;
  db.exec('CREATE TABLE IF NOT EXISTS stars_payments(order_id TEXT PRIMARY KEY REFERENCES orders(id),telegram_user_id INTEGER NOT NULL,charge_id TEXT UNIQUE,paid_at INTEGER)');
  const columns = db.prepare('PRAGMA table_info(stars_payments)').all().map(c => c.name);
  if (!columns.includes('expires_at')) db.exec('ALTER TABLE stars_payments ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0');
  if (!columns.includes('legal_version')) db.exec("ALTER TABLE stars_payments ADD COLUMN legal_version TEXT NOT NULL DEFAULT ''");
  db.exec('CREATE TABLE IF NOT EXISTS stars_refunds(order_id TEXT PRIMARY KEY REFERENCES orders(id),refunded_at INTEGER NOT NULL)');
  const validUser = id => Number.isSafeInteger(id) && id > 0;
  const find = (userId, payment) => {
    if (!validUser(userId) || !payment || typeof payment.invoice_payload !== 'string') throw new Error('Invalid Stars payment');
    const order = db.prepare('SELECT o.*,s.telegram_user_id,s.charge_id,s.expires_at,s.legal_version FROM orders o JOIN stars_payments s ON s.order_id=o.id WHERE o.id=?').get(payment.invoice_payload);
    if (!order || order.telegram_user_id !== userId || order.currency !== 'XTR' || payment.currency !== 'XTR' || payment.total_amount !== order.amount) throw new Error('Stars payment mismatch');
    return order;
  };
  return {
    async invoice(key, requestId, telegramUserId, installationId) {
      if (!validUser(telegramUserId)) throw new Error('Private Telegram user required');
      const order = installationId ? service.checkoutForInstallation(installationId, requestId, { currency: 'XTR', amount: priceStars }) : service.checkout(key, requestId, { currency: 'XTR', amount: priceStars });
      db.prepare('INSERT OR IGNORE INTO stars_payments(order_id,telegram_user_id,expires_at,legal_version) VALUES(?,?,?,?)').run(order.id, telegramUserId, now() + 3600000, service.legalVersion);
      if (db.prepare('SELECT telegram_user_id FROM stars_payments WHERE order_id=?').get(order.id).telegram_user_id !== telegramUserId || order.paid) throw new Error('Order unavailable');
      await telegram('sendInvoice', { chat_id: telegramUserId, title: 'SYNVOX — 30 days', description: 'Access for one SYNVOX installation. No automatic renewal. Third-party AI accounts are not included.',
        payload: order.id, provider_token: '', currency: 'XTR', prices: [{ label: 'SYNVOX — 30 days', amount: order.amount }], start_parameter: 'synvox' });
      return { id: order.id, stars: order.amount };
    },
    async preCheckout(query) {
      let ok = false;
      try {
        const order = find(query.from?.id, query);
        const license = db.prepare('SELECT revoked FROM licenses WHERE id=?').get(order.license_id);
        ok = !order.paid && !license.revoked && order.expires_at > now() && order.legal_version === service.legalVersion && order.amount === priceStars;
      } catch { /* Reject invalid orders without disclosing account information. */ }
      await telegram('answerPreCheckoutQuery', { pre_checkout_query_id: query.id, ok, ...(!ok ? { error_message: 'Order unavailable. Please create a new order in SYNVOX or contact /paysupport.' } : {}) });
    },
    success(telegramUserId, payment) {
      if (typeof payment?.telegram_payment_charge_id !== 'string' || !payment.telegram_payment_charge_id || payment.telegram_payment_charge_id.length > 512) throw new Error('Missing Telegram charge');
      db.exec('BEGIN IMMEDIATE');
      try {
        const order = find(telegramUserId, payment);
        if (order.paid) {
          if (order.charge_id !== payment.telegram_payment_charge_id) throw new Error('Duplicate payment requires reconciliation');
        } else {
          db.prepare('UPDATE stars_payments SET charge_id=?,paid_at=? WHERE order_id=?').run(payment.telegram_payment_charge_id, now(), order.id);
          db.prepare('UPDATE licenses SET access_until=MAX(access_until,?)+? WHERE id=?').run(now(), 30 * 86400000, order.license_id);
          db.prepare('UPDATE orders SET paid=1 WHERE id=?').run(order.id);
        }
        db.exec('COMMIT');
        return { orderId: order.id, credited: true };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    async refund(orderId) {
      if (db.prepare('SELECT 1 FROM stars_refunds WHERE order_id=?').get(orderId)) return { refunded: true };
      const order = db.prepare('SELECT o.*,s.telegram_user_id,s.charge_id FROM orders o JOIN stars_payments s ON s.order_id=o.id WHERE o.id=? AND o.paid=1').get(orderId);
      if (!order?.charge_id) throw new Error('Paid Stars order required');
      const refunded = await telegram('refundStarPayment', { user_id: order.telegram_user_id, telegram_payment_charge_id: order.charge_id });
      if (refunded !== true) throw new Error('Refund not confirmed');
      db.exec('BEGIN IMMEDIATE');
      try {
        const inserted = db.prepare('INSERT OR IGNORE INTO stars_refunds VALUES(?,?)').run(orderId, now());
        if (inserted.changes) db.prepare('UPDATE licenses SET access_until=MAX(?,access_until-?) WHERE id=?').run(now(), 30 * 86400000, order.license_id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return { refunded: true };
    },
  };
}
