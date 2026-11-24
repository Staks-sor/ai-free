import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const archive = new URL('../output/desktop-preview/synvox-desktop-preview.zip', import.meta.url);
test('prepared review archive includes setup files and excludes server and runtime data', { skip: !fs.existsSync(archive) && 'Run scripts/build-desktop-preview.mjs first' }, () => {
  const names = execFileSync('unzip', ['-Z1', archive.pathname], { encoding: 'utf8' }).trim().split('\n');
  assert(!names.some(n => /\/node_modules\/|\/services\/|\/\.env|\.sqlite|\.pem$|\.log$|\/test\//.test(n)));
  for (const n of ['package-lock.json', 'INSTALL-RU.md', 'INSTALL-EN.md', 'bin/deepseek.mjs']) assert(names.includes(`SYNVOX/${n}`));
  const pkg = JSON.parse(execFileSync('unzip', ['-p', archive.pathname, 'SYNVOX/package.json']));
  assert.equal(pkg.engines.node, '>=22');
  assert.equal(pkg.scripts.start, 'node ./bin/deepseek.mjs --window');
  assert.equal(pkg.scripts.pretest, undefined);
  const checksum = fs.readFileSync(`${archive.pathname}.sha256`, 'utf8').split(' ')[0];
  assert.equal(createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), checksum);
});
