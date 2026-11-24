// Run against the exact ZIP that will be published, not just the source tree.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const allowed = new Set(['.mjs', '.js', '.json', '.png', '.svg', '.css', '.html', '.md', '.txt']);

function sourceFiles(dir, prefix = '') {
  return fs.readdirSync(path.join(dir, prefix), { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.') || /^(node_modules|test|tests|__tests__|coverage)$/.test(entry.name)) return [];
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) return sourceFiles(dir, relative);
    return allowed.has(path.extname(entry.name)) && !/\.(test|spec)\./.test(entry.name) ? [relative] : [];
  });
}

export function verifyDesktopArchiveFiles(projectRoot, archive, relativePaths) {
  const entries = new Set(execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).split('\n'));
  for (const relative of relativePaths) {
    const archived = `SYNVOX/${relative.replaceAll(path.sep, '/')}`;
    if (!entries.has(archived)) throw new Error(`Desktop release is stale: missing ${relative}`);
    const current = fs.readFileSync(path.join(projectRoot, relative));
    const packed = execFileSync('unzip', ['-p', archive, archived]);
    if (!current.equals(packed)) throw new Error(`Desktop release is stale: ${relative} differs from source`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const archive = process.argv[2];
  if (!archive) throw new Error('Usage: node scripts/verify-desktop-release.mjs <archive.zip>');
  const files = ['src', 'bin', 'api', 'packages/core'].flatMap(dir => sourceFiles(root, dir));
  verifyDesktopArchiveFiles(root, path.resolve(archive), files);
  console.log(`Verified ${files.length} packaged source files against ${archive}`);
}
