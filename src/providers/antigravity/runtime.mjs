import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let cached = null;
let checkedAt = 0;

export function resolveAntigravityExecutable({ env = process.env, homedir = os.homedir(), existsSync = fs.existsSync, platform = process.platform } = {}) {
  const explicit = String(env.SYNVOX_ANTIGRAVITY_CLI_PATH || '').trim();
  if (explicit) return explicit;
  const local = platform === 'win32'
    ? path.join(homedir, 'AppData', 'Local', 'agy', 'bin', 'agy.exe')
    : path.join(homedir, '.local', 'bin', 'agy');
  return existsSync(local) ? local : 'agy';
}

export function getAntigravityStatus({ run = spawnSync, now = Date.now, cache = true } = {}) {
  if (cache && cached && now() - checkedAt < 60_000) return cached;
  const executable = resolveAntigravityExecutable();
  const version = run(executable, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
  if (version.error || version.status !== 0) {
    cached = { installed: false, authenticated: false, version: null, message: 'Установите Antigravity CLI (agy) и войдите в Google-аккаунт в терминале.' };
  } else {
    const models = run(executable, ['models'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    cached = {
      installed: true,
      authenticated: models.status === 0 && /gemini-/i.test(models.stdout || ''),
      version: String(version.stdout || version.stderr || '').trim() || null,
      message: models.status === 0 ? '' : 'Откройте терминал, запустите agy и войдите в Google-аккаунт.',
    };
  }
  checkedAt = now();
  return cached;
}
