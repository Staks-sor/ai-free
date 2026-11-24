import fs from 'node:fs';
import { createSupportService } from './service.mjs';
import { createSupportHttp } from './server.mjs';
import { createTelegramTransport } from '../licensing/telegram-transport.mjs';

const ready = process.env.SYNVOX_SUPPORT_OPERATOR_READY === '1' && process.env.SYNVOX_SUPPORT_STORAGE_REGION === 'RU';
const adminPassword = fs.readFileSync(process.env.SYNVOX_SUPPORT_ADMIN_PASSWORD_FILE, 'utf8').trim();
let transport;
let notify;
if (ready) {
  const token = fs.readFileSync(process.env.SYNVOX_SUPPORT_BOT_TOKEN_FILE, 'utf8').trim();
  const chatId = process.env.SYNVOX_SUPPORT_CHAT_ID || '';
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token) || !/^\d+$/.test(chatId)) throw new Error('Private owner Telegram chat configuration required');
  transport = await createTelegramTransport(process.env.SYNVOX_TELEGRAM_PROXY_URL || '');
  notify = async text => {
    const response = await transport.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ chat_id: chatId, text: text + '\nhttps://support.synvox.pro/support-admin/', disable_web_page_preview: true, protect_content: true }),
    });
    const result = await response.json();
    if (!response.ok || result.ok !== true) throw new Error('Support notification unavailable');
  };
}
const service = createSupportService({ directory: process.env.SYNVOX_SUPPORT_DATA_DIR,
  storageRegion: process.env.SYNVOX_SUPPORT_STORAGE_REGION, operatorReady: ready, notify });
const server = createSupportHttp({ service, adminPassword });
server.listen(4330, '127.0.0.1', () => console.log('SYNVOX support ready; intake=' + service.enabled));
const interval = setInterval(() => {
  try { service.purge(); } catch { console.error('Support retention maintenance unavailable'); }
  service.flushNotices().catch(() => console.error('Support maintenance unavailable'));
}, 60000);
service.purge();
service.flushNotices().catch(() => console.error('Support maintenance unavailable'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearInterval(interval); server.close(async () => { await transport?.close(); process.exit(0); }); });
