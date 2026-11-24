import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createLicenseService } from './service.mjs';
import { createMerchantBot } from './merchant-bot.mjs';
import { createMerchantHttp } from './merchant-http.mjs';
import { createRobokassa } from './robokassa.mjs';
import { createYooKassa } from './yookassa.mjs';
import { createTelegramTransport } from './telegram-transport.mjs';

const directory = process.env.SYNVOX_DATA_DIR;
if (!directory || !path.isAbsolute(directory)) throw new Error('Private data directory required');
const token = fs.readFileSync(process.env.SYNVOX_BOT_TOKEN_FILE, 'utf8').trim();
if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw new Error('Invalid bot configuration');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const privatePath = path.join(directory, 'private.pem');
if (!fs.existsSync(privatePath)) {
  const pair = generateKeyPairSync('ed25519');
  fs.writeFileSync(privatePath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(directory, 'public.pem'), pair.publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx', mode: 0o644 });
}
const roboConfig = process.env.SYNVOX_ROBOKASSA_CONFIG_FILE ? JSON.parse(fs.readFileSync(process.env.SYNVOX_ROBOKASSA_CONFIG_FILE, 'utf8')) : null;
const yooConfig = process.env.SYNVOX_YOOKASSA_CONFIG_FILE ? JSON.parse(fs.readFileSync(process.env.SYNVOX_YOOKASSA_CONFIG_FILE, 'utf8')) : null;
const service = createLicenseService({ database: path.join(directory, 'licenses.sqlite'), privateKey: fs.readFileSync(privatePath), mode: roboConfig || yooConfig ? 'merchant' : 'stars', reviewInstallationId: process.env.SYNVOX_REVIEW_INSTALLATION_ID || '' });
const telegramTransport = await createTelegramTransport(process.env.SYNVOX_TELEGRAM_PROXY_URL || '');
const robokassa = roboConfig ? createRobokassa({ service, ...roboConfig }) : undefined;
const yookassa = yooConfig ? createYooKassa({ service, ...yooConfig }) : undefined;
service.db.exec('CREATE TABLE IF NOT EXISTS telegram_cursor(id INTEGER PRIMARY KEY CHECK(id=1),next_update INTEGER NOT NULL); INSERT OR IGNORE INTO telegram_cursor VALUES(1,0)');
const telegram = async (method, data) => {
  let response;
  try { response = await telegramTransport.fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(method === 'getUpdates' ? 35000 : 8000),
  }); } catch { throw new Error('Telegram transport unavailable'); }
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error('Telegram API rejected ' + method);
  return result.result;
};
// Keep receiving and reconciling past payments while closing new sales.
const bot = createMerchantBot({ service, telegram, paymentsEnabled: false });
const server = createMerchantHttp({ service, bot, robokassa, yookassa, paymentsEnabled: false });
await new Promise(resolve => server.listen(4329, '127.0.0.1', resolve));
console.log('SYNVOX payment support running; new sales are closed.');
let running = true;
let telegramReady = false;
let reconciliationTimer;
async function reconcilePayments() {
  try {
    const result = await yookassa.reconcilePending();
    if (result.failed) console.error('YooKassa reconciliation requires retry: ' + result.failed);
  } catch { console.error('YooKassa reconciliation unavailable; retrying'); }
  if (running) reconciliationTimer = setTimeout(reconcilePayments, 60000);
}
if (yookassa) reconciliationTimer = setTimeout(reconcilePayments, 1000);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { running = false; clearTimeout(reconciliationTimer); server.close(); });
while (running) {
  try {
    if (!telegramReady) {
      const me = await telegram('getMe', {});
      if (me.username?.toLowerCase() !== 'synvox_bot') throw new Error('Wrong merchant bot');
      const webhook = await telegram('getWebhookInfo', {});
      if (webhook.url) throw new Error('Existing webhook configured; refusing to replace it');
      await telegram('setMyCommands', { commands: [
        { command: 'start', description: 'SYNVOX — menu / меню' },
        { command: 'paysupport', description: 'Payment support and refunds / Возвраты' },
      ] });
      await telegram('setMyDescription', { description: 'SYNVOX payments are closed. Free download: https://synvox.pro/. Use /paysupport for previous payments. Оплата отключена. По прежним платежам: /paysupport.' });
      telegramReady = true;
    }
    const offset = service.db.prepare('SELECT next_update FROM telegram_cursor WHERE id=1').get().next_update;
    const updates = await telegram('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query', 'pre_checkout_query'] });
    for (const update of updates) {
      try { await bot.handle(update); }
      catch {
        if (update.message?.successful_payment) throw new Error('Payment requires retry or reconciliation');
        const id = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
        if (id > 0) await telegram('sendMessage', { chat_id: id, text: 'Не удалось завершить действие. Обратитесь в поддержку: /paysupport.\nUnable to complete. Contact /paysupport.' });
      }
      service.db.prepare('UPDATE telegram_cursor SET next_update=? WHERE id=1').run(update.update_id + 1);
    }
    await bot.flushNotices();
  } catch (error) { console.error(error.message); await delay(3000); }
}
service.close();
await telegramTransport.close();
