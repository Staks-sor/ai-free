import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';

const clone = value => JSON.parse(JSON.stringify(value));
const conflict = key => Object.assign(new Error(`Состояние ${key} изменено другим окном. Перезапустите это окно перед продолжением.`), { code: 'STATE_CONFLICT' });

export function mergeStateChanges(base, local, remote) {
  const result = clone(remote);
  const before = new Map((base.conversations || []).map(c => [c.id, c]));
  const after = new Map((local.conversations || []).map(c => [c.id, c]));
  const current = new Map((remote.conversations || []).map(c => [c.id, c]));
  const deleted = new Set([...(remote.deletedConversationIds || []), ...(local.deletedConversationIds || [])]);
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (equal(before.get(id), after.get(id))) continue;
    if (!equal(current.get(id), before.get(id)) && !equal(current.get(id), after.get(id))) throw conflict(`чата ${id}`);
    if (after.has(id)) {
      if (deleted.has(id)) throw conflict(`удалённого чата ${id}`);
      current.set(id, after.get(id));
    } else { current.delete(id); deleted.add(id); }
  }
  result.conversations = [...current.values()].filter(c => !deleted.has(c.id));
  result.deletedConversationIds = [...deleted].slice(-5000);
  result.activeByWorkspace = { ...(remote.activeByWorkspace || {}) };
  for (const key of new Set([...Object.keys(base.activeByWorkspace || {}), ...Object.keys(local.activeByWorkspace || {})])) {
    if (!equal(base.activeByWorkspace?.[key], local.activeByWorkspace?.[key])) {
      if (local.activeByWorkspace?.[key]) result.activeByWorkspace[key] = local.activeByWorkspace[key];
      else delete result.activeByWorkspace[key];
    }
  }
  for (const key of ['pipeline']) {
    if (equal(base[key], local[key])) continue;
    if (!equal(remote[key], base[key]) && !equal(remote[key], local[key])) throw conflict(key);
    result[key] = local[key];
  }
  for (const key of ['workspaceRoot', 'activeConversationId', 'version']) {
    if (!equal(base[key], local[key])) result[key] = local[key];
  }
  return result;
}

function records(files) { return files.filter(name => /^\d{16}\.json$/.test(name)).sort().reverse(); }
function obsolete(name, revision, previous) {
  if (/^\d{16}\.json$/.test(name)) return Number(name.slice(0, 16)) < revision && Number(name.slice(0, 16)) !== previous;
  const pid = Number(name.match(/^(\d+)-[a-f0-9-]{36}\.tmp$/)?.[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH'; }
}
function decode(text) {
  const value = JSON.parse(text);
  if (!value || !Array.isArray(value.conversations)) throw new Error('Invalid window state');
  return value;
}
function parseRecord(name, text) { return { revision: Number(name.slice(0, 16)), state: decode(text) }; }

export function readWindowStateRevision(file) {
  let names;
  try { names = records(fs.readdirSync(`${file}.revisions`)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  for (const name of names) {
    try { return { ...parseRecord(name, fs.readFileSync(path.join(`${file}.revisions`, name), 'utf8')), head: Number(names[0].slice(0, 16)) }; }
    catch (error) { if (error.code && error.code !== 'ENOENT') throw error; }
  }
  if (names.length) throw Object.assign(new Error('Нет исправной версии состояния чатов'), { code: 'STATE_CORRUPT' });
  return null;
}

async function readRevision(file) {
  let names;
  try { names = records(await fs.promises.readdir(`${file}.revisions`)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  for (const name of names) {
    try { return { ...parseRecord(name, await fs.promises.readFile(path.join(`${file}.revisions`, name), 'utf8')), head: Number(names[0].slice(0, 16)) }; }
    catch (error) { if (error.code && error.code !== 'ENOENT') throw error; }
  }
  if (names.length) throw Object.assign(new Error('Нет исправной версии состояния чатов'), { code: 'STATE_CORRUPT' });
  return null;
}

// Immutable numbered files are installed with link(), which never replaces an
// occupied revision. A competing writer retries from disk; no locks or polling.
export function createWindowStateStore(file, initial, { normalize = value => value, legacyFiles = [] } = {}) {
  let base = clone(initial);
  let refreshedHead;
  const directory = `${file}.revisions`;
  function fallback() {
    let corrupt;
    for (const candidate of [file, ...legacyFiles]) {
      try { return decode(fs.readFileSync(candidate, 'utf8')); }
      catch (error) {
        if (error.code === 'ENOENT') continue;
        if (error.code) throw error;
        corrupt = error;
      }
    }
    if (corrupt) throw Object.assign(new Error('История чатов повреждена. Восстановите исправную резервную копию; исходные файлы сохранены.', { cause: corrupt }), { code: 'STATE_CORRUPT' });
    return clone(base);
  }
  const read = () => readWindowStateRevision(file)?.state || fallback();
  function prepare(local, previous) {
    const state = mergeStateChanges(base, local, normalize(previous?.state || fallback()));
    const revision = (previous?.head || 0) + 1;
    return { state, revision, target: path.join(directory, `${String(revision).padStart(16, '0')}.json`),
      temporary: path.join(directory, `${process.pid}-${randomUUID()}.tmp`) };
  }
  function commit(value) {
    const local = clone(value);
    fs.mkdirSync(directory, { recursive: true });
    for (let attempt = 0; attempt < 32; attempt++) {
      const previous = readWindowStateRevision(file), next = prepare(local, previous);
      let fd;
      try {
        fd = fs.openSync(next.temporary, 'wx', 0o600);
        fs.writeFileSync(fd, JSON.stringify(next.state)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
        fs.linkSync(next.temporary, next.target);
        if (readWindowStateRevision(file).head > next.revision) continue;
        base = local;
        for (const name of fs.readdirSync(directory)) {
          if (obsolete(name, next.revision, previous?.revision)) fs.rmSync(path.join(directory, name), { force: true });
        }
        return next.state;
      } catch (error) { if (error.code !== 'EEXIST') throw error; }
      finally { if (fd !== undefined) fs.closeSync(fd); fs.rmSync(next.temporary, { force: true }); }
    }
    throw Object.assign(new Error('Состояние активно меняется; повторите сохранение'), { code: 'STATE_BUSY' });
  }
  async function commitAsync(value) {
    const local = clone(value);
    await fs.promises.mkdir(directory, { recursive: true });
    for (let attempt = 0; attempt < 32; attempt++) {
      const previous = await readRevision(file), next = prepare(local, previous);
      let handle;
      try {
        handle = await fs.promises.open(next.temporary, 'wx', 0o600);
        await handle.writeFile(JSON.stringify(next.state)); await handle.sync(); await handle.close(); handle = null;
        await fs.promises.link(next.temporary, next.target);
        if ((await readRevision(file)).head > next.revision) continue;
        base = local;
        for (const name of await fs.promises.readdir(directory)) {
          if (obsolete(name, next.revision, previous?.revision)) await fs.promises.rm(path.join(directory, name), { force: true });
        }
        return next.state;
      } catch (error) { if (error.code !== 'EEXIST') throw error; }
      finally { if (handle) await handle.close(); await fs.promises.rm(next.temporary, { force: true }); }
    }
    throw Object.assign(new Error('Состояние активно меняется; повторите сохранение'), { code: 'STATE_BUSY' });
  }
  async function refresh(getLocal) {
    let names;
    try { names = records(await fs.promises.readdir(directory)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const head = names[0];
    if (!head || head === refreshedHead) return null;
    const latest = await readRevision(file);
    if (!latest) return null;
    const remote = normalize(latest.state);
    const merged = mergeStateChanges(base, getLocal(), remote);
    base = clone(remote);
    refreshedHead = String(latest.head).padStart(16, '0') + '.json';
    return merged;
  }
  return { read, commit, commitAsync, refresh };
}
