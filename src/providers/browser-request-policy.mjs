import { createProviderCooldown } from './request-cooldown.mjs';

function restrictionResponse(provider, response) {
  if (response.status() !== 429) return null;
  const url = new URL(response.url()), request = response.request();
  const method = request.method();
  if (provider === 'chatgpt' && url.hostname === 'chatgpt.com' && method === 'POST'
    && /^\/backend-api\/(?:f\/)?conversation(?:\/|$)/.test(url.pathname)) return 'rejected';
  if (provider === 'glm' && url.hostname === 'chat.z.ai' && method === 'POST'
    && /^\/api\/(?:v\d+\/)?chat\/completions(?:\/|$)/.test(url.pathname)) return 'rejected';
  if (provider === 'googleai' && /^(?:www\.)?google\.com$/.test(url.hostname)) {
    if (method === 'GET' && request.isNavigationRequest() && url.pathname === '/search' && url.searchParams.has('q')) return 'rejected';
    // Google RPCs also carry non-generation operations: persist the restriction,
    // but their rejection alone cannot prove that the model prompt was rejected.
    if (method === 'POST' && /^\/(?:async\/|_\/SearchUi\/data\/batchexecute)/.test(url.pathname)) return 'unknown';
  }
  return null;
}

export function createBrowserRequestPolicy(provider, options = {}) {
  if (!['chatgpt', 'glm', 'googleai'].includes(provider)) throw new TypeError('Unknown browser provider');
  const code = `${provider.toUpperCase()}_RATE_LIMIT`;
  const cooldown = createProviderCooldown({ provider, errorCode: code, ...options });
  async function observe(page, { accountId = 'default', signal = null } = {}, work) {
    cooldown.assertAvailable(accountId);
    let submitted = false, failure = null, partial = false;
    const response = value => {
      if (!submitted) return;
      try {
        const delivery = restrictionResponse(provider, value);
        if (!delivery) return;
        const retryAfterMs = cooldown.recordRateLimit(value.headers()['retry-after'], accountId);
        failure = Object.assign(new Error(`${provider}: ограничение провайдера; задача сохранена.`),
          { code, status: 429, retryAfterMs, delivery: partial ? 'unknown' : delivery });
      } catch (error) { error.delivery = 'unknown'; failure = error; }
    };
    const check = () => { signal?.throwIfAborted(); if (failure) throw failure; };
    check.beforeSend = () => { check(); cooldown.assertAvailable(accountId); submitted = true; };
    check.onText = text => { if (text) { partial = true; if (failure) failure.delivery = 'unknown'; } };
    page.on?.('response', response);
    try { const result = await work(check); check(); return result; }
    catch (error) { check(); throw error; }
    finally { page.off?.('response', response); }
  }
  return { assertAvailable: cooldown.assertAvailable, observe };
}

export const browserRequestPolicies = Object.fromEntries(['chatgpt', 'glm', 'googleai']
  .map(provider => [provider, createBrowserRequestPolicy(provider)]));
