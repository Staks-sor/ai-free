import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveNpmCommand } from './updater.mjs';

const exec = promisify(execFile);
export const UPDATE_ROOTS = ['bin', 'src', 'api', 'packages', 'package.json'];
const REQUIRED = ['bin/deepseek.mjs', 'src/config.mjs', 'api/models.mjs', 'packages/core/package.json', 'package.json'];

export function validUpdatePath(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(name)) return false;
  const parts = name.split('/');
  return UPDATE_ROOTS.includes(parts[0]) && (parts[0] !== 'package.json' || parts.length === 1)
    && parts.every((p) => p && p !== '.' && p !== '..' && !p.endsWith('.') && !p.startsWith('.')
      && p !== 'node_modules' && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p));
}

async function exists(file) {
  try { return await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function installDependencies(stage) {
  const npm = await resolveNpmCommand();
  if (!npm) throw new Error('Для новых зависимостей требуется npm. Установка не изменена.');
  await exec(npm.command, [...npm.prefixArgs, 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: stage, shell: npm.shell, timeout: 900000, maxBuffer: 2000000,
  });
}

export async function installWebsiteBundle(root, bundle, version, { prepareDependencies = installDependencies, move = fs.rename } = {}) {
  if (!Array.isArray(bundle?.files) || bundle.files.length > 20000) throw new Error('Некорректный пакет обновления.');
  const names = new Set();
  const data = new Map();
  for (const file of bundle.files) {
    if (!validUpdatePath(file.path) || names.has(file.path.toLowerCase()) || typeof file.data !== 'string'
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)) throw new Error('Недопустимый путь или содержимое пакета.');
    names.add(file.path.toLowerCase());
    data.set(file.path, Buffer.from(file.data, 'base64'));
  }
  if (!REQUIRED.every((name) => data.has(name))) throw new Error('Неполный пакет обновления.');
  const next = JSON.parse(data.get('package.json').toString('utf8'));
  if (next.version !== version) throw new Error('Версия пакета не совпадает с подписанным выпуском.');
  const previous = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const deps = (pkg) => JSON.stringify([pkg.dependencies || {}, pkg.optionalDependencies || {}, pkg.workspaces || []]);
  let changeDependencies = deps(previous) !== deps(next);
  for (const [name, bytes] of data) {
    if (!name.startsWith('packages/') || !name.endsWith('/package.json')) continue;
    const oldManifest = await fs.readFile(path.join(root, name), 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '{}';
      throw error;
    });
    if (deps(JSON.parse(oldManifest)) !== deps(JSON.parse(bytes.toString('utf8')))) changeDependencies = true;
  }
  const roots = [...UPDATE_ROOTS, ...(changeDependencies ? ['node_modules', 'package-lock.json'] : [])];
  for (const name of [...roots, '.synvox-updates']) {
    if ((await exists(path.join(root, name)))?.isSymbolicLink()) throw new Error('Установка через символические ссылки не поддерживает автообновление.');
  }
  const backups = path.join(root, '.synvox-updates');
  await fs.mkdir(backups, { recursive: true });
  const transaction = await fs.mkdtemp(path.join(backups, 'release-'));
  const stage = path.join(transaction, 'stage');
  const backup = path.join(transaction, 'backup');
  await fs.mkdir(stage);
  await fs.mkdir(backup);
  for (const [name, bytes] of data) {
    const destination = path.join(stage, name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes, { mode: name.startsWith('bin/') ? 0o755 : 0o644 });
  }
  if (changeDependencies) await prepareDependencies(stage);
  // Journal and backups are retained for recovery after power loss; no user directories are managed.
  const journal = { version, status: 'installing', roots, backupPath: backup };
  await fs.writeFile(path.join(transaction, 'transaction.json'), JSON.stringify(journal, null, 2));
  const changes = [];
  try {
    for (const name of roots) {
      const old = path.join(root, name);
      const saved = path.join(backup, name);
      const fresh = path.join(stage, name);
      const change = { old, saved, backedUp: false, installed: false };
      changes.push(change);
      if (await exists(old)) { await move(old, saved); change.backedUp = true; }
      if (await exists(fresh)) { await move(fresh, old); change.installed = true; }
    }
    journal.status = 'installed';
    await fs.writeFile(path.join(transaction, 'transaction.json'), JSON.stringify(journal, null, 2));
  } catch (error) {
    for (const item of changes.reverse()) {
      if (item.installed) await fs.rm(item.old, { recursive: true, force: true });
      if (item.backedUp) await fs.rename(item.saved, item.old);
    }
    journal.status = 'rolled-back';
    await fs.writeFile(path.join(transaction, 'transaction.json'), JSON.stringify(journal, null, 2));
    throw error;
  }
  return backup;
}
