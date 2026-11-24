import fs from 'node:fs';
import { writeAtomicJsonSync } from '../../state/state-writer.mjs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { accountActivity } from '../activity-session.mjs';
import { QWEN_HOME, QWEN_AUTH_FILE, QWEN_BROWSER_PROFILE } from './config.mjs';
import { readQwenAuth } from './auth-files.mjs';
import { loadAccounts, saveAccounts, getAccountProfileDir } from './account-store.mjs';
import { getBrowserLoginProgress } from '../../browser/camoufox-runtime.mjs';

export function selectQwenReconnectAccount(accounts, pinnedIds = []) {
  const pinned = pinnedIds.map(id => accounts.find(account => account.id === id)).filter(Boolean);
  const invalidPinned = pinned.find(account => account.invalid === true);
  if (invalidPinned) {
    const healthyDuplicate = accounts.find(account => account.id !== invalidPinned.id
      && !account.invalid && !account.disabled && !account.limited && account.token && !qwenTokenExpired(account.token)
      && isSameQwenIdentity(account, invalidPinned));
    if (healthyDuplicate) return healthyDuplicate;
  }
  return invalidPinned || pinned[0]
    || accounts.find(account => account.primary === true) || accounts[0] || null;
}

function qwenIdentity(account) {
  try {
    const payload = JSON.parse(Buffer.from(String(account?.token || '').split('.')[1], 'base64url').toString('utf8'));
    if (typeof payload.id === 'string' && payload.id) return 'jwt:' + payload.id;
  } catch {}
  return account?.userId ? 'user:' + account.userId : null;
}

function qwenTokenExpired(token) {
  try {
    const { exp } = JSON.parse(Buffer.from(String(token || '').split('.')[1], 'base64url').toString('utf8'));
    return Number.isFinite(exp) && exp * 1000 <= Date.now();
  } catch { return false; }
}

export function isSameQwenIdentity(left, right) {
  const identity = qwenIdentity(left);
  return Boolean(identity && identity === qwenIdentity(right));
}

function accountRoles(accounts) {
  const groups = new Map();
  accounts.forEach((account, index) => {
    const key = qwenIdentity(account) || 'profile:' + account.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });
  const primaryIndex = accounts.findIndex(account => account.primary === true);
  const primaryKey = primaryIndex < 0 ? [...groups.keys()][0] : qwenIdentity(accounts[primaryIndex]) || 'profile:' + accounts[primaryIndex].id;
  const roles = [];
  for (const [key, indices] of groups) {
    const ready = index => {
      const account = accounts[index];
      return account.token && !qwenTokenExpired(account.token) && !account.invalid && !account.disabled
        && !account.limited && (!account.resetAt || new Date(account.resetAt).getTime() <= Date.now());
    };
    const canonical = indices.find(ready) ?? indices.find(index => accounts[index].primary) ?? indices[0];
    for (const index of indices) roles[index] = {
      role: index === canonical ? key === primaryKey ? 'primary' : 'additional' : 'duplicate',
      duplicateOf: index === canonical ? null : canonical + 1,
    };
  }
  return roles;
}

export function formatQwenSwitchNotice(accounts, { from, to }) {
  const label = id => {
    const index = accounts.findIndex(account => account.id === id);
    if (index < 0) return 'аккаунт Qwen';
    const name = String(accounts[index].label || '').trim();
    return name && name !== id ? name : `аккаунт ${index + 1}`;
  };
  return `Qwen: лимит ${label(from)} исчерпан. Продолжаем через ${label(to)}. Контекст задачи передан.`;
}

export function createQwenAccountManager({ pool, activity = accountActivity, readLegacy = () => readQwenAuth(QWEN_AUTH_FILE),
  prepareLogin = async id => (await import('./browser-proxy.mjs')).closeQwenBrowserProxy(id),
  login = async (file, options) => (await import('./browser-login.mjs')).loginQwenAndSave(file, options),
  refreshOpenBrowser = async id => (await import('./browser-proxy.mjs')).refreshQwenAuthFromOpenBrowser(id),
  refreshProfile = async file => (await import('./browser-login.mjs')).refreshQwenAuthFromProfile(file),
  resetProxy = async id => (await import('./browser-proxy.mjs')).resetQwenBrowserProxy(id) } = {}) {
  let loginState = { state: 'idle' }, loginJob = null, loginAccountId = null;
  let lastUnavailableRecovery = 0;
  let unavailableRecoveryError = null;
  let unavailableRecoveryJob = null;
  const preferencesFile = () => (process.env.QWEN_ACCOUNTS_FILE || path.join(QWEN_HOME, 'accounts.json')) + '.settings';
  const autoSwitch = () => {
    try { return !fs.existsSync(preferencesFile()) || JSON.parse(fs.readFileSync(preferencesFile(), 'utf8')).autoSwitch !== false; }
    catch { return false; }
  };
  const routingAccounts = () => {
    const accounts = list();
    const roles = accountRoles(accounts);
    return accounts.map((account, index) => ({ ...account,
      primary: roles[index].role === 'primary',
      disabled: account.disabled || roles[index].role === 'duplicate' || qwenTokenExpired(account.token),
    }));
  };
  function list() {
    const accounts = loadAccounts();
    const legacy = readLegacy();
    if (legacy?.token && !accounts.some(a => a.id === 'default' || a.token === legacy.token || (legacy.userId && a.userId === legacy.userId))) {
      accounts.push({ ...legacy, id: 'default', label: 'Основной', profileDir: QWEN_BROWSER_PROFILE, primary: !accounts.length });
    }
    return accounts;
  }
  function change(id, update) {
    const accounts = list();
    const account = accounts.find(a => a.id === id);
    if (!account) throw new Error('Аккаунт не найден');
    update(account, accounts);
    saveAccounts(accounts);
  }
  async function refreshAccount(accountOrId, options = {}) {
    const id = typeof accountOrId === 'string' ? accountOrId : accountOrId?.id;
    const release = activity.acquire('qwen', id);
    try { return await refreshAccountSession(accountOrId, options); } finally { release(); }
  }
  async function refreshAccountSession(accountOrId, { resetBefore = false } = {}) {
    const id = typeof accountOrId === 'string' ? accountOrId : accountOrId?.id;
    const existing = list().find(a => a.id === id);
    if (!existing) throw new Error('Аккаунт не найден');
    if (typeof accountOrId === 'object' && accountOrId?.token && existing.token !== accountOrId.token) {
      await resetProxy(id);
      return existing;
    }
    const profileDir = existing.profileDir || (id === 'default' ? QWEN_BROWSER_PROFILE : getAccountProfileDir(id));
    const authFile = id === 'default' ? QWEN_AUTH_FILE : path.join(profileDir, 'auth.json');
    let refreshed = null;
    try {
      const current = await refreshOpenBrowser(id);
      if (current?.token && !qwenTokenExpired(current.token)
        && (!resetBefore || current.token !== existing.token)) refreshed = current;
    } catch { /* An absent or expired browser session falls back to the saved profile. */ }
    const fromOpenBrowser = Boolean(refreshed);
    if (!refreshed) {
      if (resetBefore) await resetProxy(id);
      refreshed = await refreshProfile(authFile);
    }
    if (!refreshed?.token) throw new Error('Qwen refresh did not return a token');
    change(id, a => {
      Object.assign(a, {
        token: refreshed.token,
        cookies: refreshed.cookies,
        cookieHeader: refreshed.cookieHeader,
        userId: refreshed.userId || a.userId,
        profileDir,
        invalid: false,
        limited: false,
        resetAt: null,
      });
    });
    if (!fromOpenBrowser) await resetProxy(id);
    unavailableRecoveryError = null;
    return list().find(a => a.id === id);
  }
  async function recoverUnavailable() {
    if (unavailableRecoveryJob) return unavailableRecoveryJob;
    unavailableRecoveryJob = recoverUnavailableSession().finally(() => { unavailableRecoveryJob = null; });
    return unavailableRecoveryJob;
  }
  async function recoverUnavailableSession() {
    const accounts = list();
    const expired = accounts.some(account => !account.disabled && qwenTokenExpired(account.token));
    if (Date.now() - lastUnavailableRecovery < 60_000) {
      if (unavailableRecoveryError) throw unavailableRecoveryError;
      return { expired };
    }
    lastUnavailableRecovery = Date.now();
    unavailableRecoveryError = null;
    for (const account of accounts) {
      if ((!account.invalid && !qwenTokenExpired(account.token)) || account.disabled || !account.profileDir) continue;
      try { await refreshAccount(account.id); }
      catch (error) {
        if (error.code === 'QWEN_SESSION_REFRESH_UNAVAILABLE') {
          unavailableRecoveryError = error;
          throw error;
        }
        // A confirmed unusable profile may still need manual sign-in.
      }
    }
    return { expired };
  }
  async function snapshot() {
    const busy = pool ? await pool.snapshot('qwen') : [];
    const accounts = list();
    const roles = accountRoles(accounts);
    return {
      autoSwitch: autoSwitch(), login: getBrowserLoginProgress({ ...loginState }),
      accounts: accounts.map((a, index) => ({
        id: a.id, label: a.label || 'Аккаунт ' + (index + 1), primary: roles[index].role === 'primary',
        role: roles[index].role, duplicateOf: roles[index].duplicateOf,
        status: a.id === loginAccountId ? 'busy' : roles[index].role === 'duplicate' ? 'duplicate'
          : a.disabled ? 'disabled'
          : a.invalid || !a.token || qwenTokenExpired(a.token) ? 'invalid'
          : a.limited || (a.resetAt && new Date(a.resetAt).getTime() > Date.now()) ? 'limited'
            : busy.some(b => b.id === a.id && b.busy) ? 'busy' : 'ready',
        resetAt: a.resetAt || null,
      })),
    };
  }
  async function action(body) {
    if (body.action === 'autoSwitch' && typeof body.enabled === 'boolean') {
      fs.mkdirSync(path.dirname(preferencesFile()), { recursive: true });
      writeAtomicJsonSync(preferencesFile(), { autoSwitch: body.enabled });
    } else if (body.action === 'rename' && typeof body.label === 'string') {
      const label = body.label.trim().slice(0, 100);
      if (!label) throw new Error('Введите название аккаунта');
      change(body.id, a => { a.label = label; });
    } else if (body.action === 'disable' && typeof body.disabled === 'boolean') {
      change(body.id, a => { a.disabled = body.disabled; });
    } else if (body.action === 'primary') {
      change(body.id, (a, accounts) => {
        if (accountRoles(accounts)[accounts.indexOf(a)].role === 'duplicate') throw new Error('Cannot make duplicate Qwen profile primary');
        for (const entry of accounts) entry.primary = entry.id === a.id;
      });
    } else if (body.action === 'retry') {
      // Explicit user retry, not a claim that the upstream quota has reset.
      change(body.id, a => { a.limited = false; a.resetAt = null; });
    } else if (body.action === 'login') {
      if (loginJob) throw new Error('Вход уже выполняется');
      const existing = body.id ? list().find(a => a.id === body.id) : null;
      if (body.id && !existing) throw new Error('Аккаунт не найден');
      if (!existing && list().length >= 10) throw new Error('Можно подключить до 10 аккаунтов Qwen');
      if (existing && pool && (await pool.snapshot('qwen')).some(a => a.id === existing.id && a.busy)) throw new Error('Сначала дождитесь завершения запроса аккаунта');
      const id = existing?.id || 'acc_' + randomUUID();
      const profileDir = existing?.profileDir || getAccountProfileDir(id);
      const release = activity.acquire('qwen', id);
      loginState = { state: 'running' };
      loginAccountId = id;
      loginJob = (async () => {
        let progressOpen = true;
        try {
          let result = null;
          if (existing && body.trySilent === true) {
            try { result = await refreshAccount(existing); } catch { /* Open login only if the saved session could not renew. */ }
          }
          if (!result) {
            await prepareLogin(id);
            result = await login(path.join(profileDir, 'auth.json'), { profileDir, clearSession: false, onProgress: progress => {
              if (progressOpen) loginState = { state: 'running', phase: progress.phase, message: progress.message };
            } });
          } else {
            // Reconnect owns no active account lease. Persist the captured auth
            // before closing the old verification window and replacing its proxy.
            await prepareLogin(id);
          }
          if (!result?.token) throw new Error('No token');
          const accounts = list();
          if (existing && qwenIdentity(existing) && qwenIdentity(result) && !isSameQwenIdentity(existing, result)) throw new Error('Wrong account');
          if ((!existing || !isSameQwenIdentity(existing, result))
            && accounts.some(a => a.id !== id && (isSameQwenIdentity(a, result) || a.token === result.token))) throw new Error('Duplicate account');
          const account = accounts.find(a => a.id === id) || { id, primary: accounts.length === 0 };
          Object.assign(account, { token: result.token, cookies: result.cookies, cookieHeader: result.cookieHeader,
            userId: result.userId, profileDir, invalid: false, limited: false, resetAt: null });
          if (!accounts.includes(account)) {
            if (accounts.length >= 10) throw new Error('Можно подключить до 10 аккаунтов Qwen');
            accounts.push(account);
          }
          saveAccounts(accounts);
          unavailableRecoveryError = null;
          loginState = { state: 'done' };
        } catch (error) {
          const reason = String(error?.message || '');
          const message = error.userMessage || (/Qwen login timeout/i.test(reason) ? 'Вход Qwen не завершён за 300 секунд: JWT не появился в браузерной сессии.'
            : /Qwen login window was closed/i.test(reason) ? 'Окно входа Qwen закрылось до завершения авторизации.'
            : /Wrong account/i.test(reason) ? 'Для переподключения нужно войти в прежний аккаунт Qwen.'
            : /Duplicate account/i.test(reason) ? 'Этот Qwen-пользователь уже подключён в другом профиле. Для мультиаккаунта войдите под другим пользователем Qwen.'
            : /No token/i.test(reason) ? 'Qwen не выдал токен после входа.'
            : /NS_ERROR_NET_TIMEOUT|NS_BINDING_ABORTED|net::ERR|page.goto.*Timeout/i.test(reason) ? 'Не удалось загрузить Qwen из-за сетевой ошибки. Сохранённый аккаунт и задача не удалены.'
            : 'Не удалось открыть окно Qwen или сохранить браузерную сессию. Попробуйте подключить аккаунт снова.');
          loginState = { state: 'failed', error: message, code: error.code };
        } finally { progressOpen = false; release(); loginJob = null; loginAccountId = null; }
      })();
    } else throw new Error('Неизвестное действие');
    return snapshot();
  }
  return { list, routingAccounts, snapshot, action, autoSwitch, waitForLogin: () => loginJob, isLoggingIn: id => id === loginAccountId,
    refreshAccount, recoverUnavailable,
    markLimited: id => change(id, a => { a.limited = true; a.resetAt = null; }),
    markInvalid: id => change(id, a => { a.invalid = true; }),
  };
}
