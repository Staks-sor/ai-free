const prefix = '/v1/license/robokassa/';
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (body, en = false) => `<!doctype html><html lang="${en ? 'en' : 'ru'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SYNVOX — ${en ? 'Payment' : 'Оплата'}</title><style>*{box-sizing:border-box}body{margin:0;padding:32px 16px;background:#101217;color:#f5f6fa;font:16px/1.6 system-ui,sans-serif}main{max-width:620px;margin:auto;padding:28px;background:#1b1e26;border:1px solid #353a48;border-radius:20px}h1{font-size:32px;line-height:1.2}a{color:#adc8ff}label{display:flex;gap:12px;align-items:flex-start;padding:12px 0;min-height:44px}input[type=checkbox]{width:22px;height:22px;flex-shrink:0;margin-top:3px}button{display:block;width:100%;min-height:48px;padding:12px;border:0;border-radius:10px;background:#f5f6fa;color:#15171e;font:600 17px system-ui;cursor:pointer;margin-top:20px}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid #80b5ff;outline-offset:3px}.muted{color:#c0c6d4}code{overflow-wrap:anywhere;font-size:14px}small{display:block}footer{margin-top:24px}@media(max-width:420px){main{padding:20px}h1{font-size:28px}}</style><main><strong>SYNVOX</strong>${body}<footer><a href="https://synvox.pro/documents/">${en ? 'Documents (Russian)' : 'Документы'}</a> · <a href="mailto:stas.sor@gmail.com">${en ? 'Support / refunds' : 'Поддержка / возврат'}</a></footer></main></html>`;

export async function handleRobokassaHttp(req, res, url, gateway, version) {
  if (!url.pathname.startsWith(prefix)) return false;
  const send = (code, body, type = 'text/html; charset=utf-8') => {
    const paymentOrigins = gateway?.provider === 'yookassa' ? 'https://yookassa.ru https://*.yookassa.ru https://yoomoney.ru https://*.yoomoney.ru' : 'https://auth.robokassa.ru';
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${paymentOrigins}; base-uri 'none'; frame-ancestors 'none'` });
    res.end(type.startsWith('text/html') && gateway?.provider === 'yookassa' ? body.replaceAll('Robokassa', 'ЮKassa') : body); return true;
  };
  if (!gateway) return send(503, page('<h1>Оплата ещё не подключена</h1><p>Payment is not available yet. / Повторите позже.</p>'));
  try {
    const route = url.pathname.slice(prefix.length);
    if (['success', 'fail'].includes(route) && req.method === 'GET') return send(200, page(route === 'success'
      ? '<h1>Проверяем оплату</h1><p>Вернитесь в SYNVOX и нажмите «Проверить статус». Доступ продлевается только после подтверждения от Robokassa.</p><p>Return to SYNVOX and refresh subscription status. Access is extended only after payment confirmation.</p>'
      : '<h1>Оплата не завершена</h1><p>Если деньги списаны, проверьте статус в SYNVOX перед повторной оплатой.</p><p>Payment was not completed. If charged, check your subscription status before retrying.</p>'));
    if (route === 'checkout' && req.method === 'GET') {
      const token = url.searchParams.get('token'), row = gateway.view(token), en = url.searchParams.get('lang') === 'en';
      const label = (key, text) => `<label><input type="checkbox" name="${key}" value="yes" required><span>${text}</span></label>`;
      return send(200, page(`<p><a href="?token=${escape(token)}&amp;lang=${en ? 'ru' : 'en'}">${en ? 'Русский' : 'English'}</a></p><h1>${escape(row.priceRub ?? 99)} ₽ · ${en ? '30 days' : '30 дней'}</h1><p>${en ? 'One installation. No automatic renewal. Third-party AI accounts and limits are not included.' : 'Одна установка. Без автосписаний. Аккаунты и лимиты сторонних AI не входят.'}</p><p class="muted">${en ? 'Installation' : 'Установка'}:<br><code>${escape(row.license_id)}</code></p><p>${en ? 'Read the documents, check each confirmation below, then continue to Robokassa.' : 'Прочитайте документы, отметьте каждый пункт ниже и перейдите к оплате.'}</p><form method="post" action="${prefix}checkout"><input type="hidden" name="token" value="${escape(token)}"><input type="hidden" name="version" value="${escape(version)}"><input type="hidden" name="culture" value="${en ? 'en' : 'ru'}">${label('terms', en ? 'I accept the offer and have read the refund policy.' : 'Принимаю оферту и ознакомлен с порядком возврата.')}${label('privacy', en ? 'I consent to processing my installation ID, consent confirmations and payment data for providing access and handling payments and refunds.' : 'Согласен на обработку ID установки, подтверждений согласий и данных платежа для предоставления доступа, оплаты и возврата.')}${label('alpha', en ? 'I understand this is an alpha product: errors and feature changes are possible. Statutory rights remain unaffected.' : 'Понимаю, что это альфа-продукт: возможны ошибки и изменения функций. Законные права сохраняются.')}<small class="muted">${en ? 'Data is stored on our server in Russia. Required payment records are retained by law, other data while needed for these purposes. No marketing consent. Withdraw consent: stas.sor@gmail.com. Card details are entered only at Robokassa. Legal documents are currently in Russian. Version: ' : 'Данные хранятся на нашем сервере в РФ. Обязательные платёжные записи сохраняются по закону, остальные — пока нужны для указанных целей. Согласие на рекламу не запрашиваем. Отзыв: stas.sor@gmail.com. Реквизиты карты вводятся только в Robokassa. Редакция: '}${escape(version)}</small><button>${en ? 'Continue to Robokassa — ' + (row.priceRub ?? 99) + ' RUB' : 'Перейти в Robokassa — ' + (row.priceRub ?? 99) + ' ₽'}</button></form>`, en));
    }
    if (req.method !== 'POST') return send(405, 'Method not allowed', 'text/plain');
    if (route === 'link') {
      if (req.headers.origin) return send(403, 'Desktop only', 'text/plain');
      const key = String(req.headers.authorization || '').replace(/^Bearer /, '');
      return send(200, JSON.stringify(gateway.link(key)), 'application/json');
    }
    if (!['checkout', 'result'].includes(route)) return send(404, 'Not found', 'text/plain');
    if (route === 'checkout' && req.headers.origin !== 'https://synvox.pro') return send(403, 'Invalid origin', 'text/plain');
    let raw = '', size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 16384) return send(413, 'Too large', 'text/plain'); raw += chunk; }
    const fields = new URLSearchParams(raw);
    if (route === 'result') return send(200, gateway.result(fields), 'text/plain');
    const payment = await gateway.accept(fields.get('token'), fields);
    const destination = new URL(gateway.provider === 'yookassa' ? payment.url : payment.action);
    if (gateway.provider !== 'yookassa') destination.search = new URLSearchParams(payment.fields).toString();
    res.writeHead(303, { Location: destination.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
    res.end();
    return true;
  } catch { return send(400, page('<h1>Не удалось продолжить / Unable to continue</h1><p>Проверьте подтверждения. Если ссылка истекла или заказ уже оплачен — проверьте статус и при необходимости создайте новую ссылку в SYNVOX.</p><p>Check the confirmations and your subscription status. If needed, generate a new link in SYNVOX.</p>')); }
}
