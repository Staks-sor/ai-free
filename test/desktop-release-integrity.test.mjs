import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyDesktopArchiveFiles } from '../scripts/verify-desktop-release.mjs';

test('release verification rejects an archive built before a provider fix', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-release-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'SYNVOX', 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'SYNVOX', 'src', 'provider.mjs'), 'old');
  execFileSync('zip', ['-qr', path.join(dir, 'release.zip'), 'SYNVOX'], { cwd: dir });
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'provider.mjs'), 'new');
  assert.throws(() => verifyDesktopArchiveFiles(dir, path.join(dir, 'release.zip'), ['src/provider.mjs']), /stale/i);
  fs.writeFileSync(path.join(dir, 'src', 'provider.mjs'), 'old');
  assert.doesNotThrow(() => verifyDesktopArchiveFiles(dir, path.join(dir, 'release.zip'), ['src/provider.mjs']));
});
