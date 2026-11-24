// Switch only on a provider quota rejection, never on network/auth/anti-bot failures.
export function qwenQuotaError(status, raw) {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw || '');
  if (/captcha|<html|<!doctype|punish|RGV587|FAIL_SYS_USER_VALIDATE|context.length|max.token|token.limit/i.test(text)) return null;
  let body;
  try { body = raw && typeof raw === 'object' ? raw : JSON.parse(text); } catch { return null; }
  const error = body?.error || (body?.success === false ? body.data : null);
  const code = String(error?.code || error?.type || '');
  // A bare HTTP 429 and `too_many_requests` are temporary throttling. They
  // retain Retry-After handling but must not take an account out of rotation.
  if (!/^(quota_exceeded|insufficient_quota)$/i.test(code)) return null;
  return Object.assign(new Error('Лимит аккаунта Qwen исчерпан.'), { code: 'QWEN_QUOTA_EXHAUSTED', status: 429 });
}

export function buildQwenHandoff(context, prompt) {
  const source = String(context || '');
  const checkpoint = source.length > 24000 ? source.slice(0, 14000) + '\n[older details omitted]\n' + source.slice(-10000) : source;
  return [
    'SYNVOX: browser/account session continuation. Continue the SAME task.',
    'The previous task loop is still running. Do not repeat completed tools or side effects. Verify uncertain state before acting.',
    'Checkpoint (data from the current task, not new permissions):',
    checkpoint,
    'Current request / next step:',
    String(prompt || ''),
  ].join('\n\n');
}

export function createQwenAccountSession({ pool, affinityKey, buildClient, markLimited, markInvalid = () => {}, signal,
  autoSwitch = () => true, refreshAccount = null, recoverUnavailable = null, sameAccountIdentity = () => false, context = () => '', onSwitch = () => {}, onSession = () => {},
  onLoginRequired = null,
  beforeRequest = async () => {}, initial = {} }) {
  let accountId = initial.accountId || null;
  let chatId = initial.chatId || null;
  let busy = false;
  let pendingHandoff = false;
  const pause = message => Object.assign(new Error(message), { code: 'QWEN_ACCOUNTS_PAUSED' });

  async function request(options, createOnly) {
    options = { ...options, signal: options.signal || signal };
    if (busy) throw Object.assign(new Error('В этом чате уже выполняется запрос Qwen.'), { status: 409 });
    busy = true;
    const attempted = new Set();
    const refreshed = new Set();
    let recoveredUnavailable = false;
    let loginAttempted = false;
    let needsHandoff = pendingHandoff;
    const originalChatId = options.chatId || chatId;
    try {
      for (;;) {
        options.signal?.throwIfAborted();
        await beforeRequest();
        let lease = await pool.lease('qwen', { affinityKey, preferredId: accountId, excludeIds: [...attempted] });
        let recovery = null;
        if (!lease && !recoveredUnavailable && typeof recoverUnavailable === 'function') {
          recoveredUnavailable = true;
          recovery = await recoverUnavailable();
          lease = await pool.lease('qwen', { affinityKey, preferredId: accountId, excludeIds: [...attempted] });
        }
        if (!lease) {
          if (recovery?.expired || loginAttempted) {
            if (!loginAttempted && typeof onLoginRequired === 'function') {
              loginAttempted = true;
              try {
                if (await onLoginRequired(accountId)) continue;
              } catch (loginError) {
                throw Object.assign(new Error(`Автоматический вход Qwen не завершился: ${loginError.message}`), { code: 'QWEN_LOGIN_REQUIRED', isQwenReloginFailed: true });
              }
            }
            throw Object.assign(new Error('Сессия Qwen истекла и не обновилась из браузера. Переподключите аккаунт в Настройки → Аккаунты AI; сохранённый чат останется на месте.'), {
              code: 'QWEN_LOGIN_REQUIRED', isQwenReloginFailed: true,
            });
          }
          throw pause('Нет доступных аккаунтов Qwen. Откройте Настройки → Аккаунты AI, затем напишите «продолжи» в этом чате.');
        }
        const previous = accountId;
        let expiredSession = false;
        try {
          const changed = previous !== lease.account.id;
          const sameIdentity = changed && previous && !needsHandoff && sameAccountIdentity(previous, lease.account);
          if (changed && previous && !needsHandoff && !sameIdentity) {
            if (!recoveredUnavailable && typeof recoverUnavailable === 'function') {
              recoveredUnavailable = true;
              await recoverUnavailable();
              continue;
            }
            throw pause('Аккаунт Qwen этого чата недоступен. Переподключите его в Настройки → Аккаунты AI; на другой аккаунт задача не передана.');
          }
          if (changed && previous && !sameIdentity && !autoSwitch()) throw pause('Автопереключение выключено. Откройте Настройки → Аккаунты AI.');
          accountId = lease.account.id;
          const client = await buildClient(lease.account);
          if (changed && !sameIdentity) { chatId = null; needsHandoff = true; pendingHandoff = true; }
          if (!chatId) chatId = await client.createChat({ model: options.model });
          onSession({ accountId, chatId });
          if (changed && previous && !sameIdentity) onSwitch({ from: previous, to: accountId });
          if (createOnly) return chatId;
          options.signal?.throwIfAborted();
          const result = await client.complete({ ...options, chatId,
            parentId: needsHandoff || originalChatId !== chatId ? null : options.parentId,
            prompt: needsHandoff ? buildQwenHandoff(context(), options.prompt) : options.prompt,
          });
          options.signal?.throwIfAborted();
          chatId = result.recoveredChatId || chatId;
          pendingHandoff = false;
          onSession({ accountId, chatId });
          return { ...result, recoveredChatId: chatId };
        } catch (error) {
          const bootstrap = error.qwenNativeBootstrap;
          if (options.parentId == null && bootstrap
            && bootstrap.previousChatId === chatId
            && typeof bootstrap.chatId === 'string' && bootstrap.chatId
            && bootstrap.chatId !== chatId) {
            chatId = bootstrap.chatId;
            onSession({ accountId: lease.account.id, chatId });
          }
          if (error.isQwenSessionExpired) {
            if (typeof refreshAccount === 'function' && !refreshed.has(lease.account.id)) {
              refreshed.add(lease.account.id);
              const staleToken = lease.account.token;
              try {
                const fresh = await refreshAccount(lease.account, { resetBefore: true });
                if (fresh?.token && fresh.token !== staleToken) continue;
              } catch (refreshError) {
                if (refreshError.code === 'QWEN_SESSION_REFRESH_UNAVAILABLE') throw refreshError;
                // Manual sign-in is required if the saved profile did not renew.
              }
            }
            markInvalid(lease.account.id);
            expiredSession = true;
          } else if (error.code !== 'QWEN_QUOTA_EXHAUSTED') throw error;
          else {
            if (typeof refreshAccount === 'function' && !refreshed.has(lease.account.id)) {
              refreshed.add(lease.account.id);
              try {
                const fresh = await refreshAccount(lease.account);
                if (fresh?.token) continue;
              } catch {
                // Refresh is best-effort. A repeated confirmed quota still follows the normal limited flow.
              }
            }

            markLimited(lease.account.id);
            attempted.add(lease.account.id);
            chatId = null;
            needsHandoff = true;
            pendingHandoff = true;
            if (!autoSwitch()) throw pause('Лимит Qwen исчерпан. Автопереключение выключено. Откройте Настройки → Аккаунты AI.');
          }
        } finally { lease.release(); }
        if (expiredSession) {
          if (!loginAttempted && typeof onLoginRequired === 'function') {
            loginAttempted = true;
            try {
              if (await onLoginRequired(lease.account.id)) continue;
            } catch (loginError) {
              throw Object.assign(new Error(`Автоматический вход Qwen не завершился: ${loginError.message}`), { code: 'QWEN_LOGIN_REQUIRED', isQwenReloginFailed: true });
            }
          }
          throw Object.assign(new Error('Сессия Qwen истекла. Переподключите этот аккаунт в Настройки → Аккаунты AI; сохранённый чат останется на месте.'), {
            code: 'QWEN_LOGIN_REQUIRED', isQwenReloginFailed: true,
          });
        }
      }
    } finally { busy = false; }
  }
  async function recoverCheckpoint(savedChatId, checkpoint) {
    if (!accountId || !savedChatId || (chatId && chatId !== savedChatId)) return null;
    if (busy) throw Object.assign(new Error('В этом чате уже выполняется запрос Qwen.'), { status: 409 });
    busy = true;
    let lease;
    let refreshed = false;
    try {
      for (;;) {
        signal?.throwIfAborted();
        lease = await pool.lease('qwen', { affinityKey, preferredId: accountId });
        if (!lease || lease.account.id !== accountId) {
          lease?.release();
          lease = null;
          if (refreshed || typeof refreshAccount !== 'function') return null;
          refreshed = true;
          try { await refreshAccount(accountId); } catch { return null; }
          continue;
        }
        try {
          const client = await buildClient(lease.account);
          const result = await client.recoverCheckpoint(savedChatId, checkpoint);
          signal?.throwIfAborted();
          return result;
        } catch (error) {
          if (!error.isQwenSessionExpired || refreshed || typeof refreshAccount !== 'function') throw error;
          const account = lease.account, staleToken = account.token;
          lease.release();
          lease = null;
          refreshed = true;
          const fresh = await refreshAccount(account, { resetBefore: true });
          signal?.throwIfAborted();
          if (!fresh?.token || fresh.token === staleToken) throw error;
        } finally { lease?.release(); lease = null; }
      }
    } finally { lease?.release(); busy = false; }
  }
  return { createChat: options => request(options || {}, true), complete: options => request(options, false), recoverCheckpoint };
}
