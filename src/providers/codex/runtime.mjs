import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const CODEX_NPM_PACKAGE = '@openai/codex@0.155.1';

export function getCodexRuntimeDir({ env = process.env, homedir = os.homedir() } = {}) {
  const explicit = String(env.SYNVOX_CODEX_RUNTIME_DIR || '').trim();
  return explicit || path.join(homedir, '.synvox', 'codex-runtime');
}

export function resolveCodexRuntime({
  env = process.env,
  existsSync = fs.existsSync,
  cwd = process.cwd(),
  homedir = os.homedir(),
  platform = process.platform,
} = {}) {
  const explicit = String(env.CODEX_CLI_PATH || '').trim();
  if (explicit) {
    return {
      executable: explicit,
      source: 'env',
      installed: existsSync(explicit),
    };
  }

  const binaryName = platform === 'win32' ? 'codex.cmd' : 'codex';
  const bundled = path.join(cwd, 'node_modules', '.bin', binaryName);
  if (existsSync(bundled)) {
    return { executable: bundled, source: 'bundled', installed: true };
  }

  const managed = path.join(getCodexRuntimeDir({ env, homedir }), 'node_modules', '.bin', binaryName);
  if (existsSync(managed)) {
    return { executable: managed, source: 'managed', installed: true };
  }

  return { executable: 'codex', source: 'path', installed: null };
}

export function getCodexExecutable(options = {}) {
  return resolveCodexRuntime(options).executable;
}

function runInstaller(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk => { stdout += chunk; });
    child.stderr?.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', status => resolve({ status: status ?? 1, stdout, stderr }));
  });
}

export async function installCodexRuntime({
  env = process.env,
  homedir = os.homedir(),
  platform = process.platform,
  run = runInstaller,
} = {}) {
  const runtimeDir = getCodexRuntimeDir({ env, homedir });
  fs.mkdirSync(runtimeDir, { recursive: true });
  const npm = platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = [
    'install',
    CODEX_NPM_PACKAGE,
    '--no-save',
    '--package-lock=false',
    '--prefix',
    runtimeDir,
  ];
  const result = await run(npm, args, { cwd: runtimeDir, env });
  if (result.status !== 0) {
    const details = String(result.stderr || result.stdout || '').trim();
    throw new Error(details || `Codex runtime install exited with status ${result.status}`);
  }
  return resolveCodexRuntime({ env, homedir, platform });
}
