import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const clone = value => structuredClone(value);
const budgetError = (code, message) => Object.assign(new Error(message), { code, delivery: 'unknown' });
const records = directory => fs.readdirSync(directory).filter(n => /^\d{16}\.json$/.test(n)).sort();

// Small numeric budgets only. Immutable revisions avoid a lock owner becoming
// stranded after a crash. Operation IDs make a CAS retry idempotent even when
// another writer has already advanced/pruned the revision we installed.
export function createRequestBudgetStore(root, initial) {
  const memory = new Map();
  const directory = key => path.join(root, createHash('sha256').update(key).digest('hex'));
  function latest(dir, retries = 32) {
    let names;
    try { names = records(dir); }
    catch (error) { if (error.code === 'ENOENT') return { revision: 0, state: clone(initial), operations: [] }; throw error; }
    if (!names.length) return { revision: 0, state: clone(initial), operations: [] };
    const name = names.at(-1);
    let record;
    try { record = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT' && retries > 0) return latest(dir, retries - 1); throw budgetError('REQUEST_BUDGET_CORRUPT', 'Повреждено состояние очереди запросов. Требуется проверка.'); }
    if (record?.version !== 1 || !record.state || !Array.isArray(record.operations)
      || record.operations.length > 256 || !record.operations.every(id => typeof id === 'string')
      || Object.keys(record.state).length !== Object.keys(initial).length
      || !Object.keys(initial).every(key => Number.isFinite(record.state[key]))) {
      throw budgetError('REQUEST_BUDGET_CORRUPT', 'Неверное состояние очереди запросов. Требуется проверка.');
    }
    return { ...record, revision: Number(name.slice(0,16)) };
  }
  function read(key) {
    return root ? latest(directory(key)).state : clone(memory.get(key) || initial);
  }
  function update(key, change) {
    if (!root) {
      const state = read(key); change(state); memory.set(key, clone(state)); return state;
    }
    const dir = directory(key), operation = randomUUID();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 32; attempt++) {
      const previous = latest(dir);
      if (previous.operations.includes(operation)) return previous.state;
      const state = clone(previous.state); change(state);
      if (Object.keys(state).length !== Object.keys(initial).length
        || !Object.keys(initial).every(key => Number.isFinite(state[key]))) {
        throw budgetError('REQUEST_BUDGET_INVALID', 'Не удалось сохранить бюджет запросов.');
      }
      if (Object.keys(initial).every(key => state[key] === previous.state[key])) return state;
      const revision = previous.revision + 1;
      const target = path.join(dir, `${String(revision).padStart(16,'0')}.json`);
      const temporary = path.join(dir, `${process.pid}-${randomUUID()}.tmp`);
      let fd;
      try {
        fd = fs.openSync(temporary, 'wx', 0o600);
        fs.writeFileSync(fd, JSON.stringify({ version: 1, state, operations: [...previous.operations,operation].slice(-256) }));
        fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
        fs.linkSync(temporary,target);
        const current = latest(dir);
        if (!current.operations.includes(operation)) continue; // stale pruned filename reused
        for (const name of fs.readdirSync(dir)) {
          if (/^\d{16}\.json$/.test(name) && Number(name.slice(0,16)) < revision - 1) fs.rmSync(path.join(dir,name),{force:true});
          const pid = Number(name.match(/^(\d+)-[a-f0-9-]{36}\.tmp$/)?.[1]);
          if (pid > 0) {
            try { process.kill(pid,0); }
            catch (error) { if (error.code === 'ESRCH') fs.rmSync(path.join(dir,name),{force:true}); }
          }
        }
        return state;
      } catch (error) { if (error.code !== 'EEXIST') throw error; }
      finally { if (fd !== undefined) fs.closeSync(fd); fs.rmSync(temporary,{force:true}); }
    }
    throw budgetError('REQUEST_BUDGET_BUSY','Состояние очереди запросов активно меняется в другом окне.');
  }
  return { read, update };
}
