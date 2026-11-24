import { spawn } from 'node:child_process';
import { getCodexExecutable } from './runtime.mjs';
import { createPrivateImageFiles, removePrivateImageFiles } from './image-files.mjs';
const MAX_OUTPUT_CHARS = 4 * 1024 * 1024;

function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new DOMException('Остановлено пользователем.', 'AbortError'));
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}

const CHAT_DEVELOPER_INSTRUCTIONS = [
  'You are a chat assistant inside SYNVOX.',
  'Answer conversationally.',
  'Do not inspect files, run commands, modify files, use tools, or act as a coding agent.',
].join(' ');

const AGENT_DEVELOPER_INSTRUCTIONS = [
  'You are an agent inside SYNVOX. Use only the SYNVOX workspace tools described in the user message.',
  'Return exactly one requested tool action per turn. Do not call Codex built-in tools.',
].join(' ');

const APP_SERVER_DISABLED_FEATURES = [
  'shell_tool',
  'unified_exec',
  'code_mode_host',
  'multi_agent',
  'browser_use',
  'computer_use',
];

function makeCodexError(message, fallbackCode = 'CODEX_APP_SERVER_FAILED') {
  const text = String(message || 'Codex app-server failed').trim();
  const error = new Error(text);
  if (/usage limit|rate limit|credits|try again at/i.test(text)) {
    error.code = 'CODEX_QUOTA_EXHAUSTED';
  } else if (/login|auth|sign.?in|unauthorized|not signed in/i.test(text)) {
    error.code = 'CODEX_AUTH_REQUIRED';
  } else {
    error.code = fallbackCode;
  }
  return error;
}

function turnKey(threadId, turnId) {
  return `${threadId}:${turnId}`;
}

function assistantTextFromTurn(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.type === 'agentMessage' && typeof item.text === 'string' && item.text.trim()) {
      return item.text;
    }
  }
  return '';
}

export class CodexAppServerRpc {
  constructor({
    executable = getCodexExecutable(),
    spawnProcess = spawn,
    cwd = process.cwd(),
    env = process.env,
    requestTimeoutMs = 30_000,
  } = {}) {
    this.executable = executable;
    this.spawnProcess = spawnProcess;
    this.cwd = cwd;
    this.env = env;
    this.requestTimeoutMs = requestTimeoutMs;
    this.child = null;
    this.started = false;
    this.startPromise = null;
    this.nextId = 1;
    this.pending = new Map();
    this.turnBuffers = new Map();
    this.turnWaiters = new Map();
    this.stdoutBuffer = '';
    this.stderr = '';
  }

  async start() {
    if (this.started && this.child) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.#startProcess().catch(error => { this.close(); throw error; });
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async #startProcess() {
    const args = ['app-server', '--stdio'];
    for (const feature of APP_SERVER_DISABLED_FEATURES) {
      args.push('--disable', feature);
    }

    const child = this.spawnProcess(this.executable, args, {
      cwd: this.cwd,
      env: this.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.stdoutBuffer = '';
    this.stderr = '';

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk => this.#consumeStdout(chunk));
    child.stderr?.on('data', chunk => { this.stderr = (this.stderr + String(chunk)).slice(-64 * 1024); });
    child.once('error', error => this.#failAll(makeCodexError(error?.message || error)));
    child.once('close', status => {
      const details = this.stderr.trim();
      this.#failAll(makeCodexError(details || `Codex app-server exited with status ${status ?? 1}`));
      this.child = null;
      this.started = false;
    });

    const initialize = await this.request('initialize', {
      clientInfo: { name: 'synvox', title: 'SYNVOX', version: '0.5.2' },
      capabilities: { experimentalApi: false, requestAttestation: false },
    }, { skipStart: true });
    this.notify('initialized');
    this.started = true;
    return initialize;
  }

  #consumeStdout(chunk) {
    this.stdoutBuffer += String(chunk);
    while (true) {
      const newline = this.stdoutBuffer.indexOf('\n');
      if (newline > MAX_OUTPUT_CHARS || (newline < 0 && this.stdoutBuffer.length > MAX_OUTPUT_CHARS)) {
        this.#failAll(makeCodexError('Codex output exceeds the frame limit', 'CODEX_OUTPUT_LIMIT'));
        this.close(); return;
      }
      if (newline < 0) break;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      this.#handleMessage(message);
    }
  }

  #handleMessage(message) {
    if (Object.prototype.hasOwnProperty.call(message, 'id')) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(makeCodexError(message.error.message || JSON.stringify(message.error), 'CODEX_RPC_ERROR'));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    const method = message?.method;
    const params = message?.params || {};
    if (!method) return;

    const threadId = params.threadId;
    const turnId = params.turnId || params.turn?.id;
    if (!threadId || !turnId) return;

    const key = turnKey(threadId, turnId);
    const buffer = this.turnBuffers.get(key) || { delta: '', finalText: '', completed: false, error: null };

    if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
      buffer.delta += params.delta;
    } else if (method === 'item/completed' && params.item?.type === 'agentMessage') {
      if (typeof params.item.text === 'string') buffer.finalText = params.item.text;
    } else if (method === 'turn/completed') {
      buffer.completed = true;
      buffer.finalText = buffer.finalText || assistantTextFromTurn(params.turn) || buffer.delta;
      if (params.turn?.status === 'failed' || params.turn?.error) {
        buffer.error = makeCodexError(params.turn?.error?.message || 'Codex turn failed');
      }
    }

    if (buffer.delta.length > MAX_OUTPUT_CHARS || buffer.finalText.length > MAX_OUTPUT_CHARS) {
      this.#failAll(makeCodexError('Codex output exceeds the turn limit', 'CODEX_OUTPUT_LIMIT'));
      this.close(); return;
    }

    this.turnBuffers.set(key, buffer);
    if (buffer.completed) this.#resolveTurn(key, buffer);
    for (const oldest of this.turnBuffers.keys()) {
      if (this.turnBuffers.size <= 64) break;
      if (!this.turnWaiters.has(oldest)) this.turnBuffers.delete(oldest);
    }
  }

  #resolveTurn(key, buffer) {
    const waiter = this.turnWaiters.get(key);
    if (!waiter) return;
    this.turnWaiters.delete(key);
    this.turnBuffers.delete(key);
    if (buffer.error) waiter.reject(buffer.error);
    else waiter.resolve({ text: buffer.finalText || buffer.delta || '' });
  }

  #failAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const waiter of this.turnWaiters.values()) waiter.reject(error);
    this.turnWaiters.clear();
    this.turnBuffers.clear();
  }

  notify(method, params = undefined) {
    if (!this.child?.stdin) throw makeCodexError('Codex app-server is not running');
    const payload = params === undefined ? { method } : { method, params };
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  async request(method, params = {}, { skipStart = false, signal = null, timeoutMs = this.requestTimeoutMs } = {}) {
    signal?.throwIfAborted();
    if (!skipStart) await abortable(this.start(), signal);
    signal?.throwIfAborted();
    if (!this.child?.stdin) throw makeCodexError('Codex app-server is not running');
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.pending.delete(id); };
      const fail = error => { cleanup(); reject(error); };
      const abort = () => fail(signal.reason || new DOMException('Остановлено пользователем.', 'AbortError'));
      const timer = setTimeout(() => fail(makeCodexError(`Codex ${method} timed out after ${timeoutMs}ms`, 'CODEX_RPC_TIMEOUT')), timeoutMs);
      this.pending.set(id, { resolve: value => { cleanup(); resolve(value); }, reject: fail });
      signal?.addEventListener('abort', abort, { once: true });
      try { this.child.stdin.write(`${JSON.stringify({ method, id, params })}\n`); }
      catch (error) { fail(error); }
    });
  }

  async waitForTurn(threadId, turnId, { timeoutMs = 180_000, signal = null } = {}) {
    const key = turnKey(threadId, turnId);
    signal?.throwIfAborted();
    const existing = this.turnBuffers.get(key);
    if (existing?.completed) {
      this.turnBuffers.delete(key);
      if (existing.error) throw existing.error;
      return { text: existing.finalText || existing.delta || '' };
    }

    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.turnWaiters.delete(key); this.turnBuffers.delete(key); };
      const fail = error => { cleanup(); reject(error); };
      const abort = () => fail(signal.reason || new DOMException('Остановлено пользователем.', 'AbortError'));
      const timer = setTimeout(() => fail(makeCodexError(`Codex turn timed out after ${timeoutMs}ms`, 'CODEX_TURN_TIMEOUT')), timeoutMs);
      timer.unref?.();
      this.turnWaiters.set(key, {
        resolve: value => { cleanup(); resolve(value); },
        reject: fail,
      });
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  close() {
    this.#failAll(makeCodexError('Codex app-server closed', 'CODEX_APP_SERVER_CLOSED'));
    this.stdoutBuffer = '';
    this.child?.kill?.();
    this.child = null;
    this.started = false;
  }
}

export class CodexAppServerClient {
  constructor({ rpc = null, executable = getCodexExecutable(), chatCwd = process.cwd() } = {}) {
    this.chatCwd = chatCwd;
    this.rpc = rpc || new CodexAppServerRpc({ executable, cwd: chatCwd });
    this.attachedThreads = new Set();
    this.supportsImageAttachments = true;
  }

  #threadParams({ chatCwd, model = null, agentMode = false } = {}) {
    return {
      ...(model ? { model: String(model) } : {}),
      cwd: chatCwd || this.chatCwd,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      developerInstructions: agentMode ? AGENT_DEVELOPER_INSTRUCTIONS : CHAT_DEVELOPER_INSTRUCTIONS,
    };
  }

  async complete({ prompt, sessionId = null, chatCwd = null, model = null, agentMode = false, signal = null, images = [] } = {}) {
    const textPrompt = String(prompt || '').trim();
    if (!textPrompt) throw new Error('Codex prompt is empty');

    const imageFiles = createPrivateImageFiles(images);
    try {
      signal?.throwIfAborted();
      await abortable(this.rpc.start(), signal);
      const threadParams = this.#threadParams({ chatCwd, model, agentMode });
      let threadId = sessionId ? String(sessionId) : null;

      if (!threadId) {
        const started = await this.rpc.request('thread/start', {
          ...threadParams,
          ephemeral: false,
        }, { signal });
        threadId = started?.thread?.id || started?.thread?.sessionId;
        if (!threadId) throw makeCodexError('Codex thread/start did not return a thread id');
        this.attachedThreads.add(threadId);
      } else if (!this.attachedThreads.has(threadId)) {
        const resumed = await this.rpc.request('thread/resume', {
          threadId,
          ...threadParams,
          excludeTurns: true,
        }, { signal });
        threadId = resumed?.thread?.id || threadId;
        this.attachedThreads.add(threadId);
      }

      try {
        signal?.throwIfAborted();
        // Keep the acknowledgement reachable if Stop arrives while submitting,
        // so its turn id can still be interrupted. RPC has a bounded deadline.
        const turn = await this.rpc.request('turn/start', {
          threadId,
          ...(model ? { model: String(model) } : {}),
          input: [
            { type: 'text', text: textPrompt, text_elements: [] },
            ...imageFiles.paths.map(file => ({ type: 'localImage', path: file, detail: 'original' })),
          ],
          cwd: chatCwd || this.chatCwd,
          approvalPolicy: 'never',
        });
      const turnId = turn?.turn?.id;
      if (!turnId) throw makeCodexError('Codex turn/start did not return a turn id');

      let interrupted;
      const interrupt = () => { interrupted ||= this.rpc.request('turn/interrupt', { threadId, turnId }, { timeoutMs: 5000 }).catch(() => {}); };
      signal?.addEventListener('abort', interrupt, { once: true });
      let completed;
      try {
        if (signal?.aborted) interrupt();
        signal?.throwIfAborted();
        completed = await this.rpc.waitForTurn(threadId, turnId, { signal });
        signal?.throwIfAborted();
      } finally {
        signal?.removeEventListener('abort', interrupt);
        if (interrupted) await interrupted;
      }
      return {
        text: String(completed?.text || '').trimEnd(),
        sessionId: threadId,
        turnId,
      };
      } catch (error) {
        if (threadId && error && typeof error === 'object') error.sessionId = threadId;
        throw error;
      }
    } finally {
      removePrivateImageFiles(imageFiles);
    }
  }

  close() {
    this.rpc.close?.();
  }
}
