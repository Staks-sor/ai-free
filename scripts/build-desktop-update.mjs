// Run against an explicitly selected, clean release checkout, never the working development tree.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, sign, verify } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { validUpdatePath } from '../src/website-update-install.mjs';

const [sourceArg, outputArg, keyArg] = process.argv.slice(2);
if (!sourceArg || !outputArg || !keyArg) throw new Error('Usage: node scripts/build-desktop-update.mjs CLEAN_CHECKOUT OUTPUT_DIRECTORY PRIVATE_KEY');
const source = path.resolve(sourceArg);
const output = path.resolve(outputArg);
const key = await fs.readFile(path.resolve(keyArg));
const keySource = await fs.readFile(path.join(source, 'src/desktop-transition.mjs'), 'utf8');
const publicKey = keySource.match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/)?.[0];
if (!publicKey) throw new Error('Release checkout has no pinned public key.');
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: source, encoding: 'utf8' }).trim()) {
  throw new Error('Release checkout must be clean. Do not publish unfinished working-tree changes.');
}
const names = execFileSync('git', ['ls-files', '-z', '--', 'src', 'bin', 'api', 'packages', 'package.json'], { cwd: source }).toString().split('\0').filter(Boolean);
const files = [];
for (const name of names) {
  if (!validUpdatePath(name)) throw new Error(`Unsupported release path: ${name}`);
  const file = path.join(source, name);
  if (!(await fs.lstat(file)).isFile()) throw new Error(`Release must not contain symlinks: ${name}`);
  files.push({ path: name, data: (await fs.readFile(file)).toString('base64') });
}
const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Release needs a stable semantic version.');
const raw = Buffer.from(JSON.stringify({ files }));
const bundle = gzipSync(raw);
if (raw.length > 128 * 1024 * 1024 || bundle.length > 32 * 1024 * 1024) throw new Error('Release exceeds updater size limits.');
const filename = `${pkg.version}.json.gz`;
const payload = Buffer.from(JSON.stringify({ version: pkg.version, platforms: ['darwin', 'win32', 'linux'], url: `https://synvox.pro/desktop/releases/${filename}`, sha256: createHash('sha256').update(bundle).digest('hex') }));
const signature = sign(null, payload, key);
if (!verify(null, payload, publicKey, signature)) throw new Error('Signing key does not match the key pinned in the desktop bridge.');
await fs.mkdir(path.join(output, 'releases'), { recursive: true });
await fs.writeFile(path.join(output, 'releases', filename), bundle, { flag: 'wx' });
await fs.writeFile(path.join(output, 'update.json'), JSON.stringify({ schemaVersion: 1, status: 'ready', payload: payload.toString('base64'), signature: signature.toString('base64') }, null, 2), { flag: 'wx' });
console.log(`Prepared signed desktop release ${pkg.version}. Upload releases/${filename} first; publish update.json last.`);
