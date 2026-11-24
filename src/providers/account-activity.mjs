import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AUTH_DIR } from '../config.mjs';

const providers = new Set(['qwen', 'deepseek', 'glm', 'chatgpt', 'googleai']);
const instance = randomUUID();
const localLeases = new Map();
const memoryRecords = new Map();
const busyError = () => Object.assign(new Error('Аккаунт занят в другом окне SYNVOX. Дождитесь освобождения сессии или закройте другое окно.'),
  { code: 'ACCOUNT_BUSY', delivery: 'not_sent', status: 409 });
const corruptError = () => Object.assign(new Error('Account activity state is corrupt.'), { code: 'ACCOUNT_ACTIVITY_CORRUPT' });
const emptyState = () => ({ owner: null });
const clone = value => structuredClone(value);

export function createAccountActivity({ root = process.env.NODE_TEST_CONTEXT ? null : path.join(AUTH_DIR, 'account-activity') } = {}) {
  const base = root === null ? null : path.resolve(root);

  function identity(provider, id) {
    if (!providers.has(provider) || typeof id !== 'string' || !id || id.length > 256) {
      throw Object.assign(new Error('Invalid account activity key.'), { code: 'ACCOUNT_ACTIVITY_KEY' });
    }
    const hash = createHash('sha256').update(provider).update('\0').update(id).digest('hex');
    return { hash, localKey: `${base || ':memory:'}/${hash}` };
  }

  function validOwner(owner) {
    return owner === null || Boolean(owner && Object.keys(owner).length === 3
      && Number.isSafeInteger(owner.pid) && owner.pid > 0
      && typeof owner.instance === 'string' && /^[a-f0-9-]{36}$/.test(owner.instance)
      && Number.isSafeInteger(owner.count) && owner.count > 0);
  }

  function alive(pid) {
    try { process.kill(pid, 0); return true; }
    catch (error) { return error.code !== 'ESRCH'; }
  }

  function directory(hash) {
    return path.join(base, hash);
  }

  function latest(dir, retries = 32) {
    let names;
    try { names = fs.readdirSync(dir).filter(name => /^\d{16}\.json$/.test(name)).sort(); }
    catch (error) { if (error.code === 'ENOENT') return { revision: 0, state: emptyState() }; throw error; }
    if (!names.length) return { revision: 0, state: emptyState() };
    const name = names.at(-1);
    let record;
    try { record = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT' && retries > 0) return latest(dir, retries - 1);
      throw corruptError();
    }
    const state = record?.state;
    if (record?.version !== 1 || Object.keys(record).length !== 2 || !state
      || Object.keys(state).length !== 1 || !validOwner(state.owner)) throw corruptError();
    return { revision: Number(name.slice(0, 16)), state };
  }

  function prune(dir, revision) {
    for (const name of fs.readdirSync(dir)) {
      if (/^\d{16}\.json$/.test(name) && Number(name.slice(0, 16)) < revision - 1) {
        try { fs.rmSync(path.join(dir, name)); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  }

  function update(key, change) {
    if (base === null) {
      const state = clone(memoryRecords.get(key) || emptyState());
      const attempt = change(state);
      if (attempt.changed) memoryRecords.set(key, clone(state));
      return { state: clone(memoryRecords.get(key) || emptyState()), attempt };
    }

    const dir = directory(key);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (let attemptNumber = 0; attemptNumber < 32; attemptNumber += 1) {
      const previous = latest(dir);
      const state = clone(previous.state);
      const attempt = change(state);
      if (!attempt.changed) return { state: previous.state, attempt };
      const revision = previous.revision + 1;
      const target = path.join(dir, `${String(revision).padStart(16, '0')}.json`);
      const temporary = path.join(dir, `${process.pid}-${randomUUID()}.tmp`);
      let fd;
      try {
        fd = fs.openSync(temporary, 'wx', 0o600);
        fs.writeFileSync(fd, JSON.stringify({ version: 1, state }));
        fs.fsyncSync(fd);
        fs.closeSync(fd); fd = undefined;
        fs.linkSync(temporary, target);
        const current = latest(dir);
        if (attempt.confirm(current.state)) {
          prune(dir, current.revision);
          return { state: current.state, attempt };
        }
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
        fs.rmSync(temporary, { force: true });
      }
    }
    throw Object.assign(new Error('Account activity is changing in another process.'), { code: 'ACCOUNT_ACTIVITY_BUSY', delivery: 'not_sent', status: 409 });
  }

  function acquire(provider, id) {
    const { hash, localKey } = identity(provider, id);
    const local = localLeases.get(localKey);
    const self = { pid: process.pid, instance };
    const result = update(hash, state => {
      const owner = state.owner;
      if (owner && owner.pid === self.pid && owner.instance === self.instance) {
        const count = owner.count + 1;
        state.owner = { ...self, count };
        return { changed: true, count, confirm: current => current.owner?.pid === self.pid && current.owner?.instance === self.instance && current.owner.count >= count };
      }
      if (owner && alive(owner.pid)) throw busyError();
      const count = local ? local.count + 1 : 1;
      state.owner = { ...self, count };
      return { changed: true, count, confirm: current => current.owner?.pid === self.pid && current.owner?.instance === self.instance && current.owner.count >= count };
    });
    const count = result.state.owner?.pid === self.pid && result.state.owner?.instance === self.instance
      ? result.state.owner.count : (local?.count || 0) + 1;
    localLeases.set(localKey, { count });
    let released = false;
    return () => {
      if (released) return;
      const currentLocal = localLeases.get(localKey);
      if (!currentLocal) { released = true; return; }
      const releaseResult = update(hash, state => {
        const owner = state.owner;
        if (!owner || owner.pid !== self.pid || owner.instance !== self.instance) {
          return { changed: false, confirm: () => true };
        }
        const remaining = Math.max(0, owner.count - 1);
        state.owner = remaining ? { ...owner, count: remaining } : null;
        return { changed: true, remaining, confirm: current => remaining
          ? current.owner?.pid === self.pid && current.owner?.instance === self.instance && current.owner.count <= remaining
          : current.owner === null || current.owner.pid !== self.pid || current.owner.instance !== self.instance };
      });
      if (releaseResult.state.owner?.pid === self.pid && releaseResult.state.owner?.instance === self.instance) {
        currentLocal.count = releaseResult.state.owner.count;
      } else {
        localLeases.delete(localKey);
      }
      released = true;
    };
  }

  function isBusy(provider, id, { otherProcessOnly = false } = {}) {
    const { hash } = identity(provider, id);
    const state = base === null ? clone(memoryRecords.get(hash) || emptyState()) : latest(directory(hash)).state;
    return Boolean(state.owner && alive(state.owner.pid)
      && (!otherProcessOnly || state.owner.pid !== process.pid || state.owner.instance !== instance));
  }

  return { acquire, isBusy };
}
