import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createLicenseService } from '../services/licensing/service.mjs';
import { createMerchantBot } from '../services/licensing/merchant-bot.mjs';

test('bot starts without a key, requires explicit consents, binds one-time link and invoices correct installation', async () => {
  const service = createLicenseService({ database: ':memory:', privateKey: generateKeyPairSync('ed25519').privateKey });
  const calls = [];
  let failNotification = false;
  const bot = createMerchantBot({ service, priceStars: 100, telegram: async (method, data) => { if (failNotification && method === 'sendMessage') throw new Error('delivery unavailable'); calls.push({ method, data }); return true; } });
  const message = text => ({ message: { chat: { id: 123, type: 'private' }, from: { id: 123, language_code: 'ru' }, text } });
  const callback = data => ({ callback_query: { id: 'callback', from: { id: 123, language_code: 'ru' }, message: { chat: { id: 123, type: 'private' } }, data } });
  try {
    await bot.handle(message('/start'));
    assert.match(calls.at(-1).data.text, /SYNVOX/);
    assert.ok(!JSON.stringify(calls.at(-1).data.reply_markup).includes('pay:'));
    await bot.handle(message('/pay'));
    assert.equal(calls.filter(c => c.method === 'sendInvoice').length, 0);
    const identity = service.register();
    const pair = bot.pair(identity.key);
    assert.ok(!pair.url.includes(identity.key));
    await bot.handle(message('/start ' + pair.token));
    await assert.rejects(bot.handle(message('/start ' + pair.token)), /expired|used/i);
    const menu = calls.filter(c => c.method === 'sendMessage').at(-1).data.reply_markup.inline_keyboard;
    await bot.handle(callback(menu[0][0].callback_data));
    await bot.handle(message('/pay'));
    assert.equal(calls.filter(c => c.method === 'sendInvoice').length, 0);
    await bot.handle(callback(calls.at(-1).data.reply_markup.inline_keyboard[0][0].callback_data));
    await bot.handle(callback(calls.at(-1).data.reply_markup.inline_keyboard[0][0].callback_data));
    const dashboard = calls.at(-1).data;
    assert.match(dashboard.text, /Меню/);
    assert.ok(dashboard.text.includes(identity.id));
    assert.ok(JSON.stringify(dashboard.reply_markup).includes('pay:'));
    assert.ok(!JSON.stringify(dashboard.reply_markup).includes('privacy:'));
    await bot.handle(message('/pay'));
    const invoice = calls.find(c => c.method === 'sendInvoice').data;
    assert.equal(invoice.currency, 'XTR');
    assert.equal(invoice.prices[0].amount, 100);
    assert.equal(service.db.prepare('SELECT license_id FROM orders WHERE id=?').get(invoice.payload).license_id, identity.id);
    assert.ok(!JSON.stringify(calls).includes(identity.key));
    failNotification = true;
    await bot.handle({ message: { chat: { id: 123, type: 'private' }, from: { id: 123 }, successful_payment: { invoice_payload: invoice.payload, currency: 'XTR', total_amount: 100, telegram_payment_charge_id: 'bot-charge' } } });
    await bot.flushNotices();
    assert.equal(service.db.prepare('SELECT paid FROM orders WHERE id=?').get(invoice.payload).paid, 1);
    assert.equal(service.db.prepare('SELECT sent FROM bot_notices').get().sent, 0);
    failNotification = false;
    await bot.flushNotices();
    assert.equal(service.db.prepare('SELECT sent FROM bot_notices').get().sent, 1);
    await bot.handle(message('/paysupport'));
    assert.match(calls.at(-1).data.text, /stas.sor@gmail.com/);
  } finally { service.close(); }
});

test('consent comes before dashboard, survives linking and restart, no pay button without installation', async () => {
  const service = createLicenseService({ database: ':memory:', privateKey: generateKeyPairSync('ed25519').privateKey });
  const calls = [];
  const options = { service, telegram: async (method, data) => { calls.push({ method, data }); return true; } };
  let bot = createMerchantBot(options);
  const message = text => ({ message: { chat: { id: 234, type: 'private' }, from: { id: 234, language_code: 'en' }, text } });
  const callback = data => ({ callback_query: { id: 'cb', from: { id: 234, language_code: 'en' }, message: { chat: { id: 234, type: 'private' } }, data } });
  try {
    await bot.handle(message('/start'));
    const first = calls.at(-1).data.reply_markup.inline_keyboard[0][0].callback_data;
    await bot.handle(callback(first.replace('terms:', 'alpha:')));
    assert.match(calls.at(-1).data.text, /Step 1\/3/);
    assert.equal(service.db.prepare('SELECT alpha_at FROM bot_sessions WHERE user_id=234').get().alpha_at, null);
    for (let step = 0; step < 3; step++) {
      const screen = calls.at(-1).data;
      assert.match(screen.text, new RegExp(`Step ${step + 1}/3`));
      assert.match(screen.text, /press the button below/i);
      assert.equal(screen.reply_markup.inline_keyboard.flat().filter(b => /^(terms|privacy|alpha):/.test(b.callback_data || '')).length, 1);
      await bot.handle(callback(screen.reply_markup.inline_keyboard[0][0].callback_data));
    }
    assert.match(calls.at(-1).data.text, /Menu/);
    assert.ok(!JSON.stringify(calls.at(-1).data.reply_markup).includes('pay:'));
    const linkButton = calls.at(-1).data.reply_markup.inline_keyboard[0][0];
    assert.match(linkButton.text, /Link SYNVOX/);
    await bot.handle(callback(linkButton.callback_data));
    assert.match(calls.at(-1).data.text, /1\./);
    assert.equal(calls.filter(c => c.method === 'sendInvoice').length, 0);
    assert.equal(service.db.prepare('SELECT COUNT(*) AS n FROM bot_user_consents').get().n, 1);
    bot = createMerchantBot(options);
    const identity = service.register();
    await bot.handle(message('/start ' + bot.pair(identity.key).token));
    assert.match(calls.at(-1).data.text, /Menu/);
    assert.ok(calls.at(-1).data.text.includes(identity.id));
    assert.ok(JSON.stringify(calls.at(-1).data.reply_markup).includes('pay:'));
    await bot.handle(message('/terms'));
    assert.ok(!JSON.stringify(calls.at(-1).data.reply_markup).includes('pay:'));
  } finally { service.close(); }
});
