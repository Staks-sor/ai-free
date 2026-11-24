// Local review archive only. Does not publish or change updater manifests.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(process.argv[2] || path.join(root, 'output/desktop-preview'));
const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'synvox-preview-'));
const target = path.join(staging, 'SYNVOX');
await fs.mkdir(target);
const allowed = new Set(['.mjs', '.js', '.json', '.png', '.svg', '.css', '.html', '.md', '.txt']);
async function copy(source, dest) {
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || /^(node_modules|test|tests|__tests__|coverage)$/.test(entry.name)) continue;
    const from = path.join(source, entry.name), to = path.join(dest, entry.name);
    if (path.relative(root, from) === path.join('api', 'README.md')) continue;
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink: ${from}`);
    if (entry.isDirectory()) { await fs.mkdir(to, { recursive: true }); await copy(from, to); }
    else if ((allowed.has(path.extname(entry.name)) || entry.name === 'merchant-public.pem') && !/\.(test|spec)\./.test(entry.name)) await fs.copyFile(from, to);
  }
}
for (const dir of ['src', 'bin', 'api', 'packages/core']) {
  await fs.mkdir(path.join(target, dir), { recursive: true });
  await copy(path.join(root, dir), path.join(target, dir));
}
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
pkg.scripts = Object.fromEntries(Object.entries(pkg.scripts).filter(([k]) => ['postinstall', 'start', 'window', 'login', 'check'].includes(k)));
pkg.engines.node = '>=22';
await fs.writeFile(path.join(target, 'package.json'), JSON.stringify(pkg, null, 2));
await fs.copyFile(path.join(root, 'LICENSE'), path.join(target, 'LICENSE'));
for (const language of ['RU', 'EN']) {
  await fs.copyFile(path.join(root, `docs/INSTALL-${language}.md`), path.join(target, `INSTALL-${language}.md`));
}
const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
if (JSON.stringify(lock.packages[''].dependencies) !== JSON.stringify(pkg.dependencies)) throw new Error('Dependency lock is out of date.');
lock.version = pkg.version;
lock.packages[''].version = pkg.version;
lock.packages[''].engines = pkg.engines;
await fs.writeFile(path.join(target, 'package-lock.json'), JSON.stringify(lock, null, 2));
await fs.mkdir(output, { recursive: true });
const archive = path.join(output, 'synvox-desktop-preview.zip');
try { await fs.access(archive); throw new Error('Preview already exists; select a new output directory.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
execFileSync('zip', ['-qr', archive, 'SYNVOX'], { cwd: staging });
const hash = createHash('sha256').update(await fs.readFile(archive)).digest('hex');
await fs.writeFile(`${archive}.sha256`, `${hash}  synvox-desktop-preview.zip\n`);
console.log(JSON.stringify({ archive, staging: target, sha256: hash }));
