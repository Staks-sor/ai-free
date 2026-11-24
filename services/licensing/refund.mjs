import fs from 'node:fs';
import path from 'node:path';
import { createLicenseService } from './service.mjs';
import { createStarsPayments } from './stars.mjs';

const [directory, orderId, confirmation] = process.argv.slice(2);
if (!directory || !path.isAbsolute(directory) || !orderId || confirmation !== '--confirm') throw new Error('Usage: refund.mjs PRIVATE_DATA_DIR ORDER_ID --confirm; set SYNVOX_BOT_TOKEN_FILE securely');
const token = fs.readFileSync(process.env.SYNVOX_BOT_TOKEN_FILE, 'utf8').trim();
const service = createLicenseService({ database: path.join(directory, 'licenses.sqlite'), privateKey: fs.readFileSync(path.join(directory, 'private.pem')), mode: 'stars' });
const telegram = async (method, body) => {
  const response = await fetch('https://api.telegram.org/bot' + token + '/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  const result = await response.json();
  if (!result.ok) throw new Error('Refund not confirmed. Check Telegram transactions before retrying; do not manually credit/debit blindly.');
  return result.result;
};
try { console.log(await createStarsPayments({ service, telegram, priceStars: 100 }).refund(orderId)); }
finally { service.close(); }
