import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function validJson(text) { try { JSON.parse(text); return true; } catch { return false; } }
function temporary(file) { return `${file}.${process.pid}.${randomUUID()}.tmp`; }

function replaceSync(file, text) {
  const temp = temporary(file);
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temp, { force: true });
  }
}

// Keep the synchronous API for migration and existing non-window consumers.
export function writeAtomicJsonSync(file, value, { backupFile } = {}) {
  const text = JSON.stringify(value);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (backupFile && fs.existsSync(file)) {
    const previous = fs.readFileSync(file, 'utf8');
    if (validJson(previous)) replaceSync(backupFile, previous);
  }
  replaceSync(file, text);
}

async function replace(file, text) {
  const temp = temporary(file);
  let handle;
  try {
    handle = await fs.promises.open(temp, 'wx', 0o600);
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    await fs.promises.rename(temp, file);
  } finally {
    if (handle) await handle.close();
    await fs.promises.rm(temp, { force: true });
  }
}

export async function writeAtomicJson(file, value, { backupFile } = {}) {
  const text = JSON.stringify(value);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  if (backupFile) {
    let previous;
    try { previous = await fs.promises.readFile(file, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous && validJson(previous)) await replace(backupFile, previous);
  }
  await replace(file, text);
}

// One writer per window backend. Scheduled snapshots are prepared only when a
// write starts; critical checkpoints explicitly await flush(). No idle polling.
export function createJsonStateWriter(file, { backupFile, delayMs = 100,
  prepare = value => value, write = writeAtomicJson, onError = () => {} } = {}) {
  let latest, pending = false, timer, inFlight;
  function schedule(value) {
    latest = value; pending = true;
    if (!timer && !inFlight) {
      timer = setTimeout(() => { timer = null; flush().catch(onError); }, delayMs);
      timer.unref();
    }
  }
  async function flush() {
    clearTimeout(timer); timer = null;
    if (inFlight) { await inFlight; return flush(); }
    if (!pending) return;
    pending = false;
    const value = latest;
    inFlight = Promise.resolve().then(() => write(file, prepare(value), { backupFile }));
    try { await inFlight; }
    catch (error) { pending = true; throw error; }
    finally { inFlight = null; }
    if (pending) return flush();
  }
  return { schedule, flush };
}
