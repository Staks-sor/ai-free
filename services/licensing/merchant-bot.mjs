import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createStarsPayments } from './stars.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
export function createMerchantBot({ service, telegram, priceStars = 100, now = Date.now, paymentsEnabled = true }) {
  const db = service.db;
  const stars = createStarsPayments({ service, telegram, priceStars, now });
  db.exec(`CREATE TABLE IF NOT EXISTS bot_pairings(token_hash TEXT PRIMARY KEY,license_id TEXT NOT NULL REFERENCES licenses(id),expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS bot_sessions(user_id INTEGER PRIMARY KEY,license_id TEXT REFERENCES licenses(id),nonce TEXT NOT NULL,version TEXT NOT NULL,terms_at INTEGER,privacy_at INTEGER,alpha_at INTEGER);
    CREATE TABLE IF NOT EXISTS bot_acceptances(user_id INTEGER NOT NULL,license_id TEXT NOT NULL,version TEXT NOT NULL,terms_at INTEGER NOT NULL,privacy_at INTEGER NOT NULL,alpha_at INTEGER NOT NULL,PRIMARY KEY(user_id,license_id,version));
    CREATE TABLE IF NOT EXISTS bot_user_consents(user_id INTEGER NOT NULL,version TEXT NOT NULL,terms_at INTEGER NOT NULL,privacy_at INTEGER NOT NULL,alpha_at INTEGER NOT NULL,PRIMARY KEY(user_id,version));
    CREATE TABLE IF NOT EXISTS bot_notices(order_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,text TEXT NOT NULL,sent INTEGER NOT NULL DEFAULT 0);`);
  const send = (id, text, keyboard) => telegram('sendMessage', { chat_id: id, text, ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}) });
  const session = id => {
    db.prepare('INSERT OR IGNORE INTO bot_sessions(user_id,nonce,version) VALUES(?,?,?)').run(id, randomBytes(8).toString('hex'), service.legalVersion);
    let s = db.prepare('SELECT * FROM bot_sessions WHERE user_id=?').get(id);
    if (s.version !== service.legalVersion) {
      db.prepare('UPDATE bot_sessions SET version=?,nonce=?,terms_at=NULL,privacy_at=NULL,alpha_at=NULL WHERE user_id=?').run(service.legalVersion, randomBytes(8).toString('hex'), id);
      s = db.prepare('SELECT * FROM bot_sessions WHERE user_id=?').get(id);
    }
    return s;
  };
  const menu = async (id, ru, forceTerms = false) => {
    const s = session(id);
    const step = !s.terms_at ? 0 : !s.privacy_at ? 1 : !s.alpha_at ? 2 : -1;
    if (step !== -1) {
      const action = ['terms', 'privacy', 'alpha'][step];
      const descriptions = ru ? [
        `Добро пожаловать в SYNVOX!\n\nДоступ к одной установке — ${priceStars} Stars за 30 дней, без автопродления. Аккаунты и лимиты сторонних AI не входят.\n\nОзнакомьтесь с офертой и правилами возврата по кнопке «Документы».`,
        'Для привязки и оплаты мы сохраняем Telegram ID, ID установки, заказа и платежа, а также подтверждения согласий. ФИО и реквизиты карты не запрашиваем.\n\nДанные хранятся на сервере в РФ для предоставления доступа и возвратов. Обязательные платёжные записи сохраняются по закону; остальные — пока нужны для этих целей. Отзыв согласия: stas.sor@gmail.com. Рекламных рассылок нет.',
        'SYNVOX — альфа-продукт в разработке: возможны ошибки и изменения функций. Ваши законные права, включая права на возврат, сохраняются.',
      ] : [
        `Welcome to SYNVOX!\n\nAccess for one installation costs ${priceStars} Stars / 30 days, with no automatic renewal. Third-party AI accounts and limits are not included.\n\nRead the terms and refund policy using the Documents button. The linked legal documents are currently in Russian.`,
        'We store your Telegram ID, installation, order and payment IDs, and consent confirmations to link your installation, process payments, provide access and handle refunds. We do not request your name or card details.\n\nData is stored in Russia. Legally required payment records are retained; other data is kept while needed for these purposes. Withdraw consent: stas.sor@gmail.com. No marketing subscription.',
        'SYNVOX is an alpha product under development. Errors and feature changes are possible. Your statutory rights, including refund rights, remain unaffected.',
      ];
      const labels = ru ? ['Принимаю оферту — далее', 'Согласен на обработку данных — далее', 'Понимаю альфа-статус — в меню'] : ['Accept terms — continue', 'Consent to data processing — continue', 'Acknowledge alpha status — open menu'];
      return send(id, `SYNVOX · ${ru ? 'Шаг' : 'Step'} ${step + 1}/3\n\n${descriptions[step]}\n\n${ru ? 'Чтобы подтвердить, нажмите кнопку ниже.' : 'To confirm, press the button below.'}\n${ru ? 'Редакция' : 'Version'}: ${s.version}`, [
        [{ text: labels[step], callback_data: action + ':' + s.nonce }],
        [{ text: ru ? 'Документы' : 'Documents', url: 'https://synvox.pro/documents/' }],
        [{ text: ru ? 'Поддержка' : 'Support', url: 'https://t.me/Staks_sor' }],
      ]);
    }
    if (s.terms_at && s.privacy_at && s.alpha_at) {
      db.prepare('INSERT OR IGNORE INTO bot_user_consents VALUES(?,?,?,?,?)').run(id, s.version, s.terms_at, s.privacy_at, s.alpha_at);
      if (!forceTerms) return send(id, ru
        ? `SYNVOX · Меню\n\n${s.license_id ? 'Установка: ' + s.license_id + '\nОплата продлит доступ именно этой установки.' : 'Установка пока не привязана. В SYNVOX откройте Настройки → Подписка → Telegram Stars и перейдите по ссылке. После привязки появится оплата.'}\n\n${priceStars} Stars за 30 дней, без автопродления. Аккаунты и лимиты сторонних AI не входят. Согласия сохранены. Не присылайте секретный ключ в чат.`
        : `SYNVOX · Menu\n\n${s.license_id ? 'Installation: ' + s.license_id + '\nPayment extends access for this installation only.' : 'No installation linked. In SYNVOX open Settings → Subscription → Telegram Stars and follow the link. Payment becomes available after linking.'}\n\n${priceStars} Stars / 30 days, no automatic renewal. Third-party AI accounts and limits are not included. Consents saved. Never send your secret key in this chat.`, [
          [s.license_id
            ? { text: ru ? `Оплатить ${priceStars} Stars` : `Pay ${priceStars} Stars`, callback_data: 'pay:' + s.nonce }
            : { text: ru ? 'Привязать SYNVOX и перейти к оплате' : 'Link SYNVOX and proceed to payment', callback_data: 'link:' + s.nonce }],
          [{ text: ru ? 'Документы' : 'Documents', url: 'https://synvox.pro/documents/' }],
          [{ text: ru ? 'Поддержка / возврат' : 'Support / refund', url: 'https://t.me/Staks_sor' }],
        ]);
    }
    const text = ru
      ? `SYNVOX · ${priceStars} Stars за 30 дней\nБез автопродления. Оплачивается одна установка. Аккаунты и лимиты сторонних AI не входят.\n\n${s.license_id ? 'Установка: ' + s.license_id : 'Установка пока не привязана. В программе откройте Настройки → Подписка → Telegram Stars. Не присылайте секретный ключ в чат.'}\n\nПеред оплатой прочитайте условия и подтвердите каждый пункт:\n1. Принимаю оферту и ознакомлен с возвратами.\n2. Согласен на обработку Telegram ID, ID установки, заказа, платежа и подтверждений для оплаты, выдачи доступа и возвратов. ФИО и номер карты не запрашиваем. Отзыв: stas.sor@gmail.com.\n3. Понимаю, что это альфа-продукт: возможны ошибки и изменения. Законные права сохраняются.\n\nДокументы: https://synvox.pro/documents/\nРедакция: ${s.version}. Данные хранятся на сервере в РФ. Обязательные платёжные записи сохраняются по закону; остальные — пока нужны для указанных целей. Рекламных рассылок нет.`
      : `SYNVOX · ${priceStars} Stars / 30 days\nOne installation. No automatic renewal. Third-party AI accounts and limits are not included.\n\n${s.license_id ? 'Installation: ' + s.license_id : 'Not linked yet. In SYNVOX open Settings → Subscription → Telegram Stars. Never send your secret key in this chat.'}\n\nConfirm each item before payment:\n1. I accept the terms and have read the refund policy.\n2. I consent to processing my Telegram ID, installation/order/payment IDs and confirmations for payment, access and refunds. No name or card details requested. Withdraw consent: stas.sor@gmail.com.\n3. I understand this is an alpha product with possible errors and changes. Statutory rights remain unaffected.\n\nhttps://synvox.pro/documents/\nVersion: ${s.version}. Data stored in Russia for these purposes; legally required payment records are retained. No marketing subscription. The linked legal documents are currently in Russian.`;
    return send(id, text, [
      [{ text: (s.terms_at ? '✓ ' : '') + (ru ? 'Принимаю оферту' : 'Accept terms'), callback_data: 'terms:' + s.nonce }],
      [{ text: (s.privacy_at ? '✓ ' : '') + (ru ? 'Согласен на обработку данных' : 'Consent to data processing'), callback_data: 'privacy:' + s.nonce }],
      [{ text: (s.alpha_at ? '✓ ' : '') + (ru ? 'Понимаю альфа-статус' : 'Acknowledge alpha status'), callback_data: 'alpha:' + s.nonce }],
      ...(s.terms_at && s.privacy_at && s.alpha_at ? [[{ text: ru ? 'В меню' : 'Open menu', callback_data: 'menu:' + s.nonce }]] : []),
      [{ text: ru ? 'Поддержка / возврат' : 'Support / refund', url: 'https://t.me/Staks_sor' }],
    ]);
  };
  return {
    async flushNotices() {
      for (const row of db.prepare('SELECT * FROM bot_notices WHERE sent=0 LIMIT 10').all()) {
        try { await send(row.user_id, row.text); db.prepare('UPDATE bot_notices SET sent=1 WHERE order_id=?').run(row.order_id); }
        catch { /* Payment is committed; a failed notification must not block updates. */ }
      }
    },
    pair(key) {
      const licenseId = service.installationId(key);
      const row = db.prepare('SELECT revoked FROM licenses WHERE id=?').get(licenseId);
      if (row.revoked) throw new Error('Installation unavailable');
      db.prepare('DELETE FROM bot_pairings WHERE expires_at<=? OR license_id=?').run(now(), licenseId);
      const token = randomBytes(24).toString('base64url');
      db.prepare('INSERT INTO bot_pairings VALUES(?,?,?)').run(hash(token), licenseId, now() + 600000);
      return { token, url: 'https://t.me/Synvox_bot?start=' + token, expiresIn: 600 };
    },
    async handle(update) {
      if (update.pre_checkout_query) {
        if (paymentsEnabled) return stars.preCheckout(update.pre_checkout_query);
        return telegram('answerPreCheckoutQuery', { pre_checkout_query_id: update.pre_checkout_query.id, ok: false,
          error_message: 'Оплата SYNVOX закрыта. / SYNVOX payments are closed.' });
      }
      const message = update.message || update.callback_query?.message;
      const from = update.callback_query?.from || message?.from;
      if (!from || !Number.isSafeInteger(from.id) || message?.chat?.type !== 'private' || message.chat.id !== from.id) return;
      const id = from.id, ru = (from.language_code || 'en').startsWith('ru');
      if (message.successful_payment) {
        const result = stars.success(id, message.successful_payment);
        db.prepare('INSERT OR IGNORE INTO bot_notices(order_id,user_id,text) VALUES(?,?,?)').run(result.orderId, id, (ru ? 'Оплата получена. Доступ продлён на 30 дней. В программе нажмите «Проверить статус». Заказ: ' : 'Payment received. Access extended by 30 days. Refresh subscription status in SYNVOX. Order: ') + result.orderId);
        return;
      }
      const text = String(message.text || '');
      if (/^\/(paysupport|support|refund)(?:\s|$)/.test(text)) return send(id, ru ? 'Оплата и возвраты: stas.sor@gmail.com или @Staks_sor. Укажите номер заказа. Не присылайте ключ, пароль или реквизиты карты. Telegram не обслуживает покупки SYNVOX. Условия: https://synvox.pro/documents/#refunds' : 'Payment support and refunds: stas.sor@gmail.com or @Staks_sor. Include your order ID, never your secret key or card details. Telegram support does not handle SYNVOX purchases. https://synvox.pro/documents/#refunds');
      if (!paymentsEnabled) {
        if (update.callback_query) await telegram('answerCallbackQuery', { callback_query_id: update.callback_query.id });
        if (update.callback_query || /^\/(start|terms|pay)(?:\s|$)/.test(text)) return send(id, ru
          ? 'Оплата SYNVOX отключена. Бесплатная версия доступна на https://synvox.pro/. По ранее совершённым платежам: /paysupport.'
          : 'SYNVOX payments are closed. The free version is available at https://synvox.pro/. For past payments: /paysupport.');
        return;
      }
      const start = text.match(/^\/start\s+([A-Za-z0-9_-]{32})$/);
      if (start) {
        db.exec('BEGIN IMMEDIATE');
        try {
          const pair = db.prepare('SELECT * FROM bot_pairings WHERE token_hash=? AND expires_at>?').get(hash(start[1]), now());
          if (!pair) throw new Error('Link expired or used');
          session(id);
          db.prepare('UPDATE bot_sessions SET license_id=?,nonce=? WHERE user_id=?').run(pair.license_id, randomBytes(8).toString('hex'), id);
          db.prepare('DELETE FROM bot_pairings WHERE token_hash=?').run(hash(start[1]));
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
      const s = session(id);
      let pay = /^\/pay(?:\s|$)/.test(text);
      if (update.callback_query) {
        const [action, nonce] = String(update.callback_query.data || '').split(':');
        await telegram('answerCallbackQuery', { callback_query_id: update.callback_query.id });
        if (nonce !== s.nonce) return menu(id, ru);
        const expected = !s.terms_at ? 'terms' : !s.privacy_at ? 'privacy' : !s.alpha_at ? 'alpha' : null;
        if (action === expected) db.prepare(`UPDATE bot_sessions SET ${action}_at=COALESCE(${action}_at,?) WHERE user_id=?`).run(now(), id);
        if (action === 'link' && !expected) return send(id, ru
          ? 'Привязка SYNVOX → оплата\n\n1. Откройте SYNVOX на компьютере.\n2. Перейдите в Настройки → Подписка → Telegram Stars.\n3. Откройте выданную ссылку и нажмите «Запустить» в Telegram.\n\nЗдесь появятся ID вашей установки и кнопка оплаты. Секретный ключ вводить в чат не нужно.\n\nЕсли в программе нет Telegram Stars, обратитесь в поддержку: ваша версия ещё не поддерживает привязку.'
          : 'Link SYNVOX → payment\n\n1. Open SYNVOX on your computer.\n2. Go to Settings → Subscription → Telegram Stars.\n3. Follow the generated link and press Start in Telegram.\n\nYour installation ID and payment button will appear here. Never paste your secret key into chat.\n\nIf Telegram Stars is missing in your app, contact support: your version does not support linking yet.', [
            [{ text: ru ? 'Вернуться в меню' : 'Back to menu', callback_data: 'menu:' + s.nonce }],
            [{ text: ru ? 'Нужна помощь с привязкой' : 'Help with linking', url: 'https://t.me/Staks_sor' }],
          ]);
        pay = action === 'pay';
      }
      if (pay) {
        const current = session(id);
        if (!current.license_id || !current.terms_at || !current.privacy_at || !current.alpha_at) return menu(id, ru);
        service.acceptForInstallation(current.license_id, { legalVersion: current.version, termsAccepted: true, personalDataAccepted: true, alphaAcknowledged: true });
        db.prepare('INSERT OR IGNORE INTO bot_acceptances VALUES(?,?,?,?,?,?)').run(id, current.license_id, current.version, current.terms_at, current.privacy_at, current.alpha_at);
        // Reuse an unpaid order so repeated clicks cannot create duplicate charges.
        const existing = db.prepare("SELECT o.request_id FROM orders o JOIN stars_payments p ON p.order_id=o.id WHERE o.license_id=? AND p.telegram_user_id=? AND o.paid=0 AND o.amount=? AND o.currency='XTR' AND p.expires_at>? AND p.legal_version=? LIMIT 1").get(current.license_id, id, priceStars, now(), service.legalVersion);
        return stars.invoice(null, existing?.request_id || randomUUID(), id, current.license_id);
      }
      return menu(id, ru, /^\/terms(?:\s|$)/.test(text));
    },
  };
}
