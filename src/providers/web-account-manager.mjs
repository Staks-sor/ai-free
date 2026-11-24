import { createHash } from 'node:crypto';
import { createAccountRegistry } from './account-registry.mjs';
import { accountActivity, profileActivityId } from './activity-session.mjs';
import { getBrowserLoginProgress } from '../browser/camoufox-runtime.mjs';

const activeCalls = new Map();
const transportMethods = new Set(['complete', 'createSession', 'uploadFile']);
function trackClient(client, key, activity) {
  return new Proxy(client, { get(target, property) {
    const value = Reflect.get(target, property);
    if (typeof value !== 'function') return value;
    if (!transportMethods.has(property)) return value.bind(target);
    return async (...args) => {
      const [provider, id] = key.split(':');
      const release = activity.acquire(provider, id);
      activeCalls.set(key, (activeCalls.get(key) || 0) + 1);
      try { return await value.apply(target, args); }
      finally { const count = activeCalls.get(key) - 1; if (count) activeCalls.set(key, count); else activeCalls.delete(key); release(); }
    };
  } });
}
const hashIdentity = value => value ? createHash('sha256').update(String(value)).digest('hex') : null;
const identityChanged = (source, record, location) => {
  if (!record?.identity) return false;
  const current = hashIdentity(source.identity?.(location));
  return Boolean(current && current !== record.identity);
};
const fail = message => Object.assign(new Error(message), { delivery: 'not_sent' });

export function createWebAccountManager({ registry = createAccountRegistry(), adapters, isBusy = () => false, activity = accountActivity } = {}) {
  const loginJobs = new Map(), loginAccounts = new Map();
  const loginStates = new Map(), clients = new Map(), blocked = new Set();
  function adapter(provider) {
    if (!adapters?.[provider]) throw fail('Провайдер не поддерживается');
    return adapters[provider];
  }
  function read(provider) {
    const source = adapter(provider);
    if (source.hasLegacy()) registry.ensureDefault(provider);
    return registry.read(provider);
  }
  function paths(provider, id) {
    return id === 'default' ? adapter(provider).legacyPaths : registry.paths(provider, id);
  }
  function resolve(provider, conversation = null) {
    const state = read(provider);
    // Old conversations always belong to the legacy identity. New chats persist
    // the selected identity when created; changing the primary cannot move a thread.
    const id = conversation ? conversation.providerAccountId || 'default' : state.selectedId || 'default';
    const record = state.accounts.find(a => a.id === id);
    if (loginAccounts.get(provider)?.id === id) throw fail('Выполняется вход в аккаунт');
    if ((id !== 'default' && !record) || record?.status === 'auth_required' || blocked.has(provider + ':' + id)
      || identityChanged(adapter(provider), record, paths(provider, id))) throw fail('Аккаунт нужно переподключить');
    return { id, paths: paths(provider, id), record };
  }
  async function snapshot(provider) {
    const state = read(provider), source = adapter(provider);
    const login = loginStates.get(provider) || { state: 'idle' };
    return { provider, limit: 10, login: provider === 'deepseek' ? getBrowserLoginProgress(login) : login, accounts: state.accounts.map(a => {
      const location = paths(provider, a.id);
      const invalid = a.status === 'auth_required' || blocked.has(provider + ':' + a.id)
        || identityChanged(source, a, location) || !source.hasAuth(location);
      const busy = (loginAccounts.get(provider)?.id === a.id)
        || isBusy(provider, a.id) || activeCalls.has(provider + ':' + a.id)
        || activity.isBusy(provider, a.id, { otherProcessOnly: true })
        || (location.profileDir && activity.isBusy(provider, profileActivityId(location.profileDir), { otherProcessOnly: true }));
      return { id: a.id, label: a.label, primary: a.id === state.selectedId, role: a.id === state.selectedId ? 'primary' : 'additional',
        connected: !invalid, status: busy ? 'busy' : invalid ? 'invalid' : 'ready' };
    }) };
  }
  async function action(provider, body) {
    const source = adapter(provider); read(provider);
    if (body.action === 'rename') registry.rename(provider, body.id, body.label);
    else if (body.action === 'primary') registry.select(provider, body.id);
    else if (body.action === 'login') {
      if (loginJobs.has(provider)) throw fail('Вход в аккаунт этого провайдера уже выполняется');
      const existing = body.id ? registry.read(provider).accounts.find(a => a.id === body.id) : null;
      if (body.id && !existing) throw fail('Аккаунт не найден');
      if (existing && (isBusy(provider, existing.id) || activeCalls.has(provider + ':' + existing.id))) throw fail('Сначала дождитесь завершения запроса аккаунта');
      const record = existing || registry.add(provider, { label: body.label });
      const location = paths(provider, record.id);
      const preserveOnSetupFailure = Boolean(existing && existing.status !== 'auth_required'
        && !blocked.has(provider + ':' + record.id) && source.hasAuth(location));
      const previousIdentity = record.identity || (record.status === 'auth_required' || blocked.has(provider + ':' + record.id) ? null : hashIdentity(source.identity?.(location)));
      const release = activity.acquire(provider, record.id);
      let releaseProfile;
      try { if (location.profileDir) releaseProfile = activity.acquire(provider, profileActivityId(location.profileDir)); }
      catch (error) { release(); throw error; }
      blocked.add(provider + ':' + record.id);
      loginAccounts.set(provider, { id: record.id }); loginStates.set(provider, { state: 'running' });
      const job = (async () => {
        await Promise.resolve();
        let progressOpen = true;
        try {
          if (previousIdentity && !record.identity) registry.setLogin(provider, record.id, { identity: previousIdentity, invalid: record.status === 'auth_required' });
          await source.close(record.id); clients.delete(provider + ':' + record.id);
          await source.login(location, record.id, progress => {
            if (progressOpen) loginStates.set(provider, { state: 'running', phase: progress.phase, message: progress.message });
          });
          if (!source.hasAuth(location)) throw fail('Не удалось подтвердить сохранение сессии');
          const identity = hashIdentity(source.identity?.(location));
          if (previousIdentity && identity && identity !== previousIdentity) {
            registry.setLogin(provider, record.id, { invalid: true, identity: previousIdentity });
            throw fail('Для переподключения войдите в прежний аккаунт');
          }
          if (identity && registry.read(provider).accounts.some(a => a.id !== record.id && (a.identity || hashIdentity(source.identity?.(paths(provider, a.id)))) === identity)) {
            registry.setLogin(provider, record.id, { invalid: true });
            throw fail('Этот аккаунт уже подключён');
          }
          registry.setLogin(provider, record.id, { identity });
          blocked.delete(provider + ':' + record.id);
          loginStates.set(provider, { state: 'done' });
        } catch (error) {
          let message = error.userMessage || error.message || 'Вход не завершён';
          try {
            if (preserveOnSetupFailure && /^CAMOUFOX_/.test(error.code || '')) blocked.delete(provider + ':' + record.id);
            else registry.setLogin(provider, record.id, { invalid: true });
          }
          catch { message = 'Не удалось сохранить состояние входа. Повторите подключение.'; }
          loginStates.set(provider, { state: 'failed', error: message, code: error.code });
        }
        finally { progressOpen = false; releaseProfile?.(); release(); loginAccounts.delete(provider); loginJobs.delete(provider); }
      })();
      loginJobs.set(provider, job);
    } else throw fail('Неизвестное действие');
    return snapshot(provider);
  }
  async function client(provider, conversation = null) {
    const ref = resolve(provider, conversation), key = provider + ':' + ref.id;
    if (loginAccounts.get(provider)?.id === ref.id) throw fail('Выполняется вход в аккаунт');
    if (!adapter(provider).hasAuth(ref.paths)) throw fail('Аккаунт нужно подключить в настройках');
    if (!clients.has(key)) clients.set(key, Promise.resolve(adapter(provider).buildClient(ref.paths, ref.id)).then(client => trackClient(client, key, activity)));
    try { return await clients.get(key); } catch (error) { clients.delete(key); throw error; }
  }
  return { snapshot, action, client, resolve, hasAuth(provider) {
      try { const ref = resolve(provider); return adapter(provider).hasAuth(ref.paths); } catch { return false; }
    }, selected: provider => read(provider).selectedId || 'default',
    waitForLogin: provider => provider ? loginJobs.get(provider) || null : loginJobs.size ? Promise.all([...loginJobs.values()]) : null,
    isLoggingIn: provider => provider ? loginJobs.has(provider) : loginJobs.size > 0 };
}
