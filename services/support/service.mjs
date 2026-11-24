import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { normalizeSupportReport, SUPPORT_CONSENT_VERSION, SUPPORT_RETENTION_DAYS } from '../../src/support/report.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = report => createHash('sha256').update(JSON.stringify(report)).digest('hex');
const fail = (message, status) => { throw Object.assign(new Error(message), { status }); };

export function createSupportService({ directory, storageRegion = '', operatorReady = false, notify, now = Date.now } = {}) {
  if (!directory || !path.isAbsolute(directory)) throw new Error('Absolute private support directory required');
  const enabled = storageRegion === 'RU' && operatorReady === true;
  if (enabled) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = id => {
    if (!UUID.test(id || '')) fail('Report not found', 404);
    return path.join(directory, id + '.json');
  };
  function write(file, data, create = false) {
    const temp = path.join(directory, '.' + randomUUID() + '.tmp');
    let fd;
    try {
      fd = fs.openSync(temp, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      if (create) fs.linkSync(temp, file); else fs.renameSync(temp, file);
      const directoryFd = fs.openSync(directory, 'r');
      try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  function get(id) {
    const file = filename(id);
    if (!fs.existsSync(file)) fail('Report not found', 404);
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.parse(record.expiresAt) <= now()) { fs.unlinkSync(file); fail('Report expired', 404); }
    return record;
  }
  function purge() {
    if (!fs.existsSync(directory)) return;
    for (const name of fs.readdirSync(directory)) {
      if (!UUID.test(name.replace(/\.json$/, '')) || !name.endsWith('.json')) continue;
      const file = path.join(directory, name);
      const record = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Date.parse(record.expiresAt) <= now()) fs.unlinkSync(file);
    }
  }
  function list() {
    if (!enabled) return [];
    purge();
    return fs.readdirSync(directory).filter(name => UUID.test(name.replace(/\.json$/, '')) && name.endsWith('.json'))
      .map(name => get(name.slice(0, -5))).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }
  let flushing;
  return {
    enabled, get, list, purge,
    accept(input = {}) {
      if (!enabled) fail('Reporting disabled', 503);
      if (input.consent?.accepted !== true || input.consent?.version !== SUPPORT_CONSENT_VERSION) fail('Separate support consent required', 400);
      const report = normalizeSupportReport(input.report);
      const file = filename(report.id);
      if (fs.existsSync(file)) {
        const previous = get(report.id);
        if (hash(previous.report) !== hash(report)) fail('Report id conflict', 409);
        return previous.receipt;
      }
      purge();
      if (fs.readdirSync(directory).filter(name => name.endsWith('.json')).length >= 10000) fail('Support storage full', 503);
      const receivedAt = new Date(now()).toISOString();
      const receipt = { accepted: true, id: report.id, receivedAt };
      write(file, { report, receivedAt, expiresAt: new Date(now() + SUPPORT_RETENTION_DAYS * 86400_000).toISOString(),
        consent: { accepted: true, version: SUPPORT_CONSENT_VERSION, acceptedAt: receivedAt }, receipt, noticePending: true }, true);
      return receipt;
    },
    async flushNotices() {
      if (!enabled || !notify) return;
      if (flushing) return flushing;
      flushing = (async () => {
        // One generic notice may cover several reports. Never send identifiers or content to Telegram.
        const pending = list().filter(record => record.noticePending);
        if (!pending.length) return;
        try { await notify('SYNVOX: поступили новые обращения в поддержку. Откройте защищённую панель поддержки.'); }
        catch { return; }
        for (const record of pending) {
          const file = filename(record.report.id);
          if (!fs.existsSync(file) || Date.parse(record.expiresAt) <= now()) continue;
          record.noticePending = false; write(file, record);
        }
      })().finally(() => { flushing = null; });
      return flushing;
    },
    remove(id) { const file = filename(id); if (fs.existsSync(file)) fs.unlinkSync(file); },
  };
}
