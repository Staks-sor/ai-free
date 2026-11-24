import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, sign } from 'node:crypto';
import { versionParts } from '../../src/licensing/verify.mjs';
export { verifyAccess } from '../../src/licensing/verify.mjs';

const DAY = 86400000;
const hash = key => createHash('sha256').update(key).digest('hex');

// Server-only module. Never bundle the database or signing key with the client.
export function createLicenseService({ database, privateKey, mode = 'mock', legalVersion = '2026-09-07', now = Date.now, reviewInstallationId = '' }) {
  if (!['mock', 'stars', 'merchant'].includes(mode)) throw new Error('Real payment provider is not configured');
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS licenses(id TEXT PRIMARY KEY,key_hash TEXT UNIQUE NOT NULL,created_at INTEGER NOT NULL,access_until INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,license_id TEXT NOT NULL REFERENCES licenses(id),request_id TEXT NOT NULL,amount INTEGER NOT NULL,currency TEXT NOT NULL,paid INTEGER NOT NULL DEFAULT 0,UNIQUE(license_id,request_id));
    CREATE TABLE IF NOT EXISTS policy(id INTEGER PRIMARY KEY CHECK(id=1),minimum_version TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS consents(license_id TEXT NOT NULL REFERENCES licenses(id),legal_version TEXT NOT NULL,accepted_at INTEGER NOT NULL,terms_accepted INTEGER NOT NULL,personal_data_accepted INTEGER NOT NULL,alpha_acknowledged INTEGER NOT NULL,PRIMARY KEY(license_id,legal_version));
    INSERT OR IGNORE INTO policy VALUES(1,'0.4.26');`);
  const account = key => {
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('Invalid access key');
    const row = db.prepare('SELECT * FROM licenses WHERE key_hash=?').get(hash(key));
    if (!row) throw new Error('Unknown access key');
    return row;
  };
  const installation = id => {
    const row = db.prepare('SELECT * FROM licenses WHERE id=?').get(id);
    if (!row || row.revoked) throw new Error('Installation unavailable');
    return row;
  };
  const accept = (row, consent) => {
    if (row.revoked) throw new Error('Revoked access key');
    if (!consent || consent.legalVersion !== legalVersion || consent.termsAccepted !== true || consent.personalDataAccepted !== true || consent.alphaAcknowledged !== true) throw new Error('Explicit current consents are required');
    db.prepare('INSERT OR IGNORE INTO consents VALUES(?,?,?,?,?,?)').run(row.id, legalVersion, now(), 1, 1, 1);
    return { accepted: true, legalVersion };
  };
  const checkout = (row, requestId, { currency = 'RUB', amount = 9900 } = {}) => {
    if (row.revoked) throw new Error('Revoked access key');
    if (!db.prepare('SELECT 1 FROM consents WHERE license_id=? AND legal_version=?').get(row.id, legalVersion)) throw new Error('Current consents are required before checkout');
    if (typeof requestId !== 'string' || !/^[\w-]{1,80}$/.test(requestId)) throw new Error('Invalid request ID');
    if (!((currency === 'RUB' && (amount === 9900 || (mode === 'merchant' && (reviewInstallationId === '*' || row.id === reviewInstallationId) && amount === 100)) && ['mock', 'merchant'].includes(mode)) || (currency === 'XTR' && Number.isSafeInteger(amount) && amount > 0 && amount <= 100000))) throw new Error('Invalid order price');
    db.prepare('INSERT OR IGNORE INTO orders(id,license_id,request_id,amount,currency) VALUES(?,?,?,?,?)').run(randomUUID(), row.id, requestId, amount, currency);
    const order = db.prepare('SELECT * FROM orders WHERE license_id=? AND request_id=?').get(row.id, requestId);
    if (order.currency !== currency || order.amount !== amount) throw new Error('Order price conflict');
    return order;
  };
  return {
    db,
    legalVersion,
    rubAmountForInstallation: id => mode === 'merchant' && (reviewInstallationId === '*' || id === reviewInstallationId) ? 100 : 9900,
    // Trusted in-process merchant operations, never expose IDs as public authentication.
    installationId: key => account(key).id,
    acceptForInstallation: (id, consent) => accept(installation(id), consent),
    checkoutForInstallation: (id, requestId, price) => checkout(installation(id), requestId, price),
    close: () => db.close(),
    register(key = randomBytes(32).toString('base64url')) {
      if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('Invalid installation key');
      const timestamp = now();
      db.prepare('INSERT OR IGNORE INTO licenses(id,key_hash,created_at,access_until) VALUES(?,?,?,?)').run(randomUUID(), hash(key), timestamp, timestamp + 3 * DAY);
      return { id: account(key).id, key };
    },
    status(key) {
      const row = account(key), timestamp = now();
      const payload = Buffer.from(JSON.stringify({ audience: 'synvox', installationId: row.id, issuedAt: timestamp,
        expiresAt: timestamp + DAY, accessUntil: row.access_until, revoked: Boolean(row.revoked),
        minimumVersion: db.prepare('SELECT minimum_version FROM policy WHERE id=1').get().minimum_version })).toString('base64url');
      return { payload, signature: sign(null, Buffer.from(payload), privateKey).toString('base64url') };
    },
    acceptConsents(key, consent) {
      return accept(account(key), consent);
    },
    checkout(key, requestId, { currency = 'RUB', amount = 9900 } = {}) {
      return checkout(account(key), requestId, { currency, amount });
    },
    mockPay(key, orderId) {
      if (mode !== 'mock') throw new Error('Mock payments disabled');
      const row = account(key);
      if (row.revoked) throw new Error('Revoked access key');
      db.exec('BEGIN IMMEDIATE');
      try {
        const order = db.prepare('SELECT * FROM orders WHERE id=? AND license_id=?').get(orderId, row.id);
        if (!order) throw new Error('Unknown order');
        if (order.currency !== 'RUB') throw new Error('Cannot mock-pay a Stars order');
        if (!order.paid) {
          db.prepare('UPDATE licenses SET access_until=MAX(access_until,?)+? WHERE id=?').run(now(), 30 * DAY, row.id);
          db.prepare('UPDATE orders SET paid=1 WHERE id=?').run(order.id);
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return { orderId, mock: true, receipt: null };
    },
    revoke(id) { db.prepare('UPDATE licenses SET revoked=1 WHERE id=?').run(id); },
    setMinimumVersion(version) { versionParts(version); db.prepare('UPDATE policy SET minimum_version=? WHERE id=1').run(version); },
  };
}
