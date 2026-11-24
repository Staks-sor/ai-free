import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AUTH_DIR } from '../config.mjs';

const providers = new Set(['qwen', 'deepseek', 'glm', 'chatgpt', 'googleai']);
const fail = (code, message) => Object.assign(new Error(message), { code });
const empty = () => ({ accounts: [], selectedId: null });
const validId = id => id === 'default' || /^acc_[a-f0-9-]{36}$/.test(id);
const label = value => String(value || 'Аккаунт').trim().slice(0, 100) || 'Аккаунт';

// Immutable revisions provide cross-process CAS without a lock stranded by a crash.
// Credentials live separately and never appear in metadata snapshots.
export function createAccountRegistry({ root = path.join(AUTH_DIR, 'accounts') } = {}) {
  function directory(provider) {
    if (!providers.has(provider)) throw fail('ACCOUNT_PROVIDER', 'Неизвестный провайдер.');
    return path.join(root, provider, 'metadata');
  }
  function latest(provider, retries = 32) {
    const dir = directory(provider);
    let names;
    try { names = fs.readdirSync(dir).filter(n => /^\d{16}\.json$/.test(n)).sort(); }
    catch (error) { if (error.code === 'ENOENT') return { revision: 0, state: empty(), operations: [] }; throw error; }
    if (!names.length) return { revision: 0, state: empty(), operations: [] };
    const name = names.at(-1);
    let record;
    try { record = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT' && retries) return latest(provider, retries - 1);
      throw fail('ACCOUNT_STORE_CORRUPT', 'Повреждён список аккаунтов. Требуется проверка.');
    }
    const state = record?.state;
    if (record?.version !== 1 || !Array.isArray(record.operations) || record.operations.length > 256
      || !record.operations.every(id => typeof id === 'string') || !Array.isArray(state?.accounts)
      || state.accounts.length > 10 || new Set(state.accounts.map(a => a.id)).size !== state.accounts.length
      || Object.keys(state).some(key => !['accounts', 'selectedId'].includes(key))
      || !state.accounts.every(a => a && Object.keys(a).every(key => ['id', 'label', 'status', 'identity'].includes(key)) && validId(a.id)
        && typeof a.label === 'string' && a.label.length <= 100 && ['disconnected', 'auth_required'].includes(a.status) && (!a.identity || /^[a-f0-9]{64}$/.test(a.identity)))
      || (state.selectedId !== null && !state.accounts.some(a => a.id === state.selectedId))) {
      throw fail('ACCOUNT_STORE_CORRUPT', 'Неверный список аккаунтов. Требуется проверка.');
    }
    return { ...record, revision: Number(name.slice(0, 16)) };
  }
  function update(provider, change) {
    const dir = directory(provider), operation = randomUUID();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 32; attempt++) {
      const previous = latest(provider);
      if (previous.operations.includes(operation)) return structuredClone(previous.state);
      const state = structuredClone(previous.state); change(state);
      const revision = previous.revision + 1;
      const target = path.join(dir, String(revision).padStart(16, '0') + '.json');
      const temporary = path.join(dir, process.pid + '-' + randomUUID() + '.tmp');
      let fd;
      try {
        fd = fs.openSync(temporary, 'wx', 0o600);
        fs.writeFileSync(fd, JSON.stringify({ version: 1, state, operations: [...previous.operations, operation].slice(-256) }));
        fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
        fs.linkSync(temporary, target);
        if (!latest(provider).operations.includes(operation)) continue;
        for (const name of fs.readdirSync(dir)) {
          if (/^\d{16}\.json$/.test(name) && Number(name.slice(0, 16)) < revision - 1) fs.rmSync(path.join(dir, name), { force: true });
        }
        return structuredClone(state);
      } catch (error) { if (error.code !== 'EEXIST') throw error; }
      finally { if (fd !== undefined) fs.closeSync(fd); fs.rmSync(temporary, { force: true }); }
    }
    throw fail('ACCOUNT_STORE_BUSY', 'Список аккаунтов меняется в другом окне. Повторите действие.');
  }
  const find = (state, id) => {
    const account = state.accounts.find(a => a.id === id);
    if (!account) throw fail('ACCOUNT_NOT_FOUND', 'Аккаунт не найден.');
    return account;
  };
  return {
    read: provider => structuredClone(latest(provider).state),
    add(provider, options = {}) {
      const account = { id: 'acc_' + randomUUID(), label: label(options.label), status: 'disconnected' };
      update(provider, state => {
        if (state.accounts.length >= 10) throw fail('ACCOUNT_LIMIT', 'Можно добавить до 10 аккаунтов на провайдера.');
        state.accounts.push(account);
        state.selectedId ||= account.id;
      });
      return structuredClone(account);
    },
    ensureDefault(provider) {
      if (latest(provider).state.accounts.some(a => a.id === 'default')) return;
      update(provider, state => {
        if (state.accounts.some(a => a.id === 'default')) return;
        if (state.accounts.length >= 10) throw fail('ACCOUNT_LIMIT', 'Можно добавить до 10 аккаунтов на провайдера.');
        state.accounts.unshift({ id: 'default', label: 'Основной', status: 'disconnected' });
        state.selectedId ||= 'default';
      });
    },
    setLogin(provider, id, { identity = null, invalid = false } = {}) {
      if (identity && !/^[a-f0-9]{64}$/.test(identity)) throw fail('ACCOUNT_IDENTITY', 'Неверная идентичность аккаунта.');
      return update(provider, state => {
        const account = find(state, id); account.status = invalid ? 'auth_required' : 'disconnected';
        if (identity) account.identity = identity;
      });
    },
    select(provider, id) { return update(provider, state => { find(state, id); state.selectedId = id; }); },
    rename(provider, id, name) { return update(provider, state => { find(state, id).label = label(name); }); },
    remove(provider, id) {
      return update(provider, state => {
        find(state, id); state.accounts = state.accounts.filter(a => a.id !== id);
        if (state.selectedId === id) state.selectedId = state.accounts[0]?.id || null;
      });
    },
    paths(provider, id) {
      directory(provider);
      if (!validId(id)) throw fail('ACCOUNT_ID', 'Неверный идентификатор аккаунта.');
      const dir = path.join(root, provider, id);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      return { authFile: path.join(dir, 'auth.json'), profileDir: path.join(dir, 'browser-profile'),
        fingerprintStatePath: path.join(dir, 'fingerprint.json'), storageStatePath: path.join(dir, 'storage-state.json') };
    },
  };
}
