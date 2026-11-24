import { spawn, spawnSync } from 'node:child_process';
import { getCodexExecutable, resolveCodexRuntime } from './runtime.mjs';


export function getCodexAuthStatus({ executable = null, spawnSyncImpl = spawnSync } = {}) {
  const runtime = executable
    ? { executable, source: 'explicit', installed: null }
    : resolveCodexRuntime();
  const resolvedExecutable = runtime.executable || getCodexExecutable();
  const version = spawnSyncImpl(resolvedExecutable, ['--version'], { encoding: 'utf8', windowsHide: true });
  if (version.error?.code === 'ENOENT') {
    return { installed: false, authenticated: false, executable: resolvedExecutable, runtimeSource: runtime.source, version: null, message: 'Codex CLI не установлен.' };
  }
  if (version.status !== 0) {
    return { installed: false, authenticated: false, executable: resolvedExecutable, runtimeSource: runtime.source, version: null, message: String(version.stderr || '').trim() || 'Codex CLI недоступен.' };
  }

  const status = spawnSyncImpl(resolvedExecutable, ['login', 'status'], { encoding: 'utf8', windowsHide: true });
  const output = `${status.stdout || ''}\n${status.stderr || ''}`.trim();
  const authenticated = status.status === 0 && /logged in|chatgpt|authenticated/i.test(output);
  return {
    installed: true,
    authenticated,
    executable: resolvedExecutable,
    runtimeSource: runtime.source,
    version: String(version.stdout || version.stderr || '').trim() || null,
    message: output,
  };
}

export function isCodexAuthenticated(options = {}) {
  return getCodexAuthStatus(options).authenticated;
}

export function loginCodex({ executable = getCodexExecutable(), spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(executable, ['login'], {
        shell: false,
        stdio: 'inherit',
        windowsHide: false,
      });
    } catch (error) {
      reject(error);
      return;
    }
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Codex login exited with status ${code ?? 'unknown'}`));
    });
  });
}
