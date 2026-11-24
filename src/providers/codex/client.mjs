import { spawn } from 'node:child_process';
import { getCodexExecutable } from './runtime.mjs';
import { createPrivateImageFiles, removePrivateImageFiles } from './image-files.mjs';

export function runCodexCli(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    options.signal?.throwIfAborted();
    const child = (options.spawnProcess || spawn)(command, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '', stderr = '', abortError = null, killTimer = null, settled = false;
    const cleanup = () => {
      options.signal?.removeEventListener('abort', abort);
      if (killTimer) clearTimeout(killTimer);
    };
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => {
      abortError = options.signal.reason instanceof Error ? options.signal.reason
        : new DOMException('Stopped by user.', 'AbortError');
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
      killTimer.unref?.();
    };
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk => { stdout += chunk; });
    child.stderr?.on('data', chunk => { stderr += chunk; });
    child.once('error', error => finish(error));
    child.once('close', status => finish(abortError, { status: status ?? 1, stdout, stderr }));
    if (options.input !== undefined && options.input !== null) child.stdin?.write(String(options.input));
    child.stdin?.end();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}

function parseCodexJsonl(output = '') {
  let sessionId = null;
  let text = '';
  for (const line of String(output).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (!sessionId && (event.thread_id || event.session_id)) {
      sessionId = event.thread_id || event.session_id;
    }
    const item = event.item;
    if (item?.type === 'agent_message' && typeof item.text === 'string') text = item.text;
    if (event.type === 'message' && typeof event.text === 'string') text = event.text;
    if (event.type === 'response.completed' && typeof event.output_text === 'string') text = event.output_text;
  }
  return { sessionId, text };
}

export async function detectCodexCli({ run = runCodexCli, executable = getCodexExecutable() } = {}) {
  try {
    const result = await run(executable, ['--version'], { cwd: process.cwd() });
    if (result.status !== 0) {
      return { installed: false, authenticated: false, executable, version: null };
    }
    const version = String(result.stdout || result.stderr || '').trim() || null;
    return { installed: true, authenticated: true, executable, version };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { installed: false, authenticated: false, executable, version: null };
    }
    throw error;
  }
}

export class CodexCliClient {
  constructor({ run = runCodexCli, executable = getCodexExecutable() } = {}) {
    this.run = run;
    this.executable = executable;
    this.supportsImageAttachments = true;
  }

  async complete({ prompt, sessionId = null, chatCwd = process.cwd(), model = null, images = [], signal = null } = {}) {
    const textPrompt = String(prompt || '').trim();
    if (!textPrompt) throw new Error('Codex prompt is empty');
    signal?.throwIfAborted();

    const imageFiles = createPrivateImageFiles(images);
    const args = ['exec'];
    if (imageFiles.paths.length) args.push('-i', ...imageFiles.paths);
    args.push('--json', '--sandbox', 'read-only', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check');
    args.push('--disable', 'shell_tool');
    args.push('--disable', 'unified_exec');
    args.push('--disable', 'code_mode_host');
    args.push('--disable', 'multi_agent');
    args.push('--disable', 'browser_use');
    args.push('--disable', 'computer_use');
    args.push('-c', 'developer_instructions="You are a chat assistant. Answer conversationally. Do not inspect files, run commands, modify files, use tools, or act as a coding agent."');
    if (model) args.push('--model', String(model));
    if (sessionId) args.push('resume', String(sessionId));
    args.push('-');

    try {
      const result = await this.run(this.executable, args, { cwd: chatCwd, input: textPrompt, signal });
      if (result.status !== 0) {
        const details = String(result.stderr || result.stdout || '').trim();
        const error = new Error(details || `Codex exited with status ${result.status}`);
        if (/usage limit|rate limit|credits|try again at/i.test(details)) {
          error.code = 'CODEX_QUOTA_EXHAUSTED';
        } else if (/login|auth|sign.?in/i.test(details)) {
          error.code = 'CODEX_AUTH_REQUIRED';
        } else {
          error.code = 'CODEX_PROCESS_FAILED';
        }
        error.status = result.status;
        throw error;
      }

      const parsed = parseCodexJsonl(result.stdout);
      return {
        text: parsed.text || String(result.stdout || '').trim(),
        sessionId: parsed.sessionId,
        raw: result.stdout,
      };
    } finally {
      removePrivateImageFiles(imageFiles);
    }
  }
}
