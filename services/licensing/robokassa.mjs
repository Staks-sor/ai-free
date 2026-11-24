import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Server-only credentials. MD5 matches the merchant's existing Robokassa settings.
export function createRobokassa({ service, password1, password2, merchantLogin = 'synvox', isTest = false, now = Date.now }) {
  if (![password1, password2, merchantLogin].every(v => typeof v === 'string' && v.length > 0) || password1 === password2) throw new Error('Robokassa credentials required');
  const db = service.db;
  db.exec(`CREATE TABLE IF NOT EXISTS robokassa_payments(inv_id INTEGER PRIMARY KEY AUTOINCREMENT,order_id TEXT UNIQUE NOT NULL REFERENCES orders(id),is_test INTEGER NOT NULL,paid_at INTEGER);`);
  db.exec(`CREATE TABLE IF NOT EXISTS robokassa_links(token_hash TEXT PRIMARY KEY,license_id TEXT NOT NULL REFERENCES licenses(id),expires_at INTEGER NOT NULL,version TEXT NOT NULL);`);
  const tokenHash = token => createHash('sha256').update(token).digest('hex');
  const view = token => {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(token)) throw new Error('Link expired');
    const row = db.prepare('SELECT * FROM robokassa_links WHERE token_hash=? AND expires_at>? AND version=?').get(tokenHash(token), now(), service.legalVersion);
    if (!row) throw new Error('Link expired');
    return { ...row, priceRub: service.rubAmountForInstallation(row.license_id) / 100 };
  };
  const digest = value => createHash('md5').update(value).digest('hex');
  const description = 'Право использования SYNVOX на 30 дней для одной установки';
  const issue = (order, culture = 'ru') => {
      const sum = (order.amount / 100).toFixed(2);
      const receipt = encodeURIComponent(JSON.stringify({ items: [{ name: description, quantity: 1, sum: order.amount / 100, tax: 'none', payment_method: 'full_payment', payment_object: 'intellectual_activity' }] }));
      if (order.paid) throw new Error('Order already paid');
      db.prepare('INSERT OR IGNORE INTO robokassa_payments(order_id,is_test) VALUES(?,?)').run(order.id, Number(isTest));
      const payment = db.prepare('SELECT * FROM robokassa_payments WHERE order_id=?').get(order.id);
      if (payment.is_test !== Number(isTest)) throw new Error('Payment mode conflict');
      const invId = String(payment.inv_id);
      return { orderId: order.id, action: 'https://auth.robokassa.ru/Merchant/Index.aspx', fields: {
        MerchantLogin: merchantLogin, OutSum: sum, InvId: invId,
        Description: description, Receipt: receipt, Culture: culture === 'en' ? 'en' : 'ru', Encoding: 'utf-8',
        IsTest: isTest ? '1' : '0', SignatureValue: digest(`${merchantLogin}:${sum}:${invId}:${receipt}:${password1}`),
      } };
    };
  return {
    view,
    link(key) {
      const licenseId = service.installationId(key);
      if (db.prepare('SELECT revoked FROM licenses WHERE id=?').get(licenseId).revoked) throw new Error('Installation unavailable');
      db.prepare('DELETE FROM robokassa_links WHERE expires_at<=? OR license_id=?').run(now(), licenseId);
      const token = randomBytes(24).toString('base64url');
      db.prepare('INSERT INTO robokassa_links VALUES(?,?,?,?)').run(tokenHash(token), licenseId, now() + 600000, service.legalVersion);
      return { url: 'https://synvox.pro/v1/license/robokassa/checkout?token=' + token, installationId: licenseId, expiresIn: 600 };
    },
    accept(token, fields) {
      const row = view(token);
      if (['terms', 'privacy', 'alpha'].some(k => fields.getAll(k).length !== 1 || fields.get(k) !== 'yes') || fields.get('version') !== row.version) throw new Error('Explicit current consents required');
      service.acceptForInstallation(row.license_id, { legalVersion: row.version, termsAccepted: true, personalDataAccepted: true, alphaAcknowledged: true });
      return issue(service.checkoutForInstallation(row.license_id, row.token_hash, { currency: 'RUB', amount: service.rubAmountForInstallation(row.license_id) }), fields.get('culture'));
    },
    checkout(key, requestId, culture = 'ru') {
      return issue(service.checkout(key, requestId, { currency: 'RUB', amount: service.rubAmountForInstallation(service.installationId(key)) }), culture);
    },
    result(params) {
      for (const name of ['OutSum', 'InvId', 'SignatureValue']) if (params.getAll(name).length !== 1) throw new Error('Invalid callback');
      if ([...params.keys()].some(name => /^shp_/i.test(name))) throw new Error('Unexpected custom parameters');
      const sum = params.get('OutSum'), invId = params.get('InvId'), signature = params.get('SignatureValue');
      if (!/^[1-9]\d{0,14}$/.test(invId) || !/^[a-f0-9]{32}$/i.test(signature)) throw new Error('Invalid signature');
      if (!timingSafeEqual(Buffer.from(signature.toLowerCase()), Buffer.from(digest(`${sum}:${invId}:${password2}`)))) throw new Error('Invalid signature');
      // Match decimal representations exactly; never round an underpayment.
      if (!/^(?:1|99)(?:\.0{1,6})?$/.test(sum)) throw new Error('Invalid amount');
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db.prepare('SELECT p.*,o.license_id,o.paid,o.amount,o.currency FROM robokassa_payments p JOIN orders o ON o.id=p.order_id WHERE p.inv_id=?').get(Number(invId));
        if (!row || row.is_test !== Number(isTest) || row.currency !== 'RUB') throw new Error('Unknown payment');
        if (row.amount !== Number(sum) * 100) throw new Error('Invalid amount');
        if (!row.paid) {
          // A test callback must never grant real access. Revocation remains effective.
          if (!isTest) db.prepare('UPDATE licenses SET access_until=MAX(access_until,?)+? WHERE id=?').run(now(), 30 * 86400000, row.license_id);
          db.prepare('UPDATE orders SET paid=1 WHERE id=?').run(row.order_id);
          db.prepare('UPDATE robokassa_payments SET paid_at=? WHERE inv_id=?').run(now(), Number(invId));
        }
        db.exec('COMMIT');
        return `OK${invId}`;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}
