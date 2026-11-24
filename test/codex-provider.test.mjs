import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { getProviderCatalog, uiModelCatalog } from '../src/providers/model-catalog.mjs';
import { detectCodexCli, CodexCliClient, runCodexCli } from '../src/providers/codex/client.mjs';
import { installCodexRuntime, resolveCodexRuntime } from '../src/providers/codex/runtime.mjs';

test('Codex CLI is a ChatGPT mode while keeping its backend provider separate', () => {
  const chatgpt = getProviderCatalog('chatgpt');
  const codex = getProviderCatalog('codex');

  assert.ok(chatgpt, 'existing ChatGPT provider must remain available');
  assert.equal(chatgpt.id, 'chatgpt');
  assert.deepEqual(chatgpt.modes.map((mode) => mode.id), ['default', 'codex']);
  const codexMode = chatgpt.modes.find((mode) => mode.id === 'codex');
  assert.equal(codexMode.title, 'Codex CLI');
  assert.equal(codexMode.provider, 'codex');
  assert.equal(codexMode.model, 'codex');

  assert.ok(codex, 'Codex backend provider must remain registered');
  assert.equal(codex.hiddenInProviderPicker, true);
  assert.equal(uiModelCatalog().providers.codex.hiddenInProviderPicker, true);
});

test('Codex capability detection reports a missing CLI without throwing', async () => {
  const result = await detectCodexCli({
    executable: 'codex',
    run: async () => { const error = new Error('not found'); error.code = 'ENOENT'; throw error; },
  });

  assert.deepEqual(result, {
    installed: false,
    authenticated: false,
    executable: 'codex',
    version: null,
  });
});

test('Codex client launches the CLI as an argv process and returns assistant text', async () => {
  const calls = [];
  const client = new CodexCliClient({
    executable: 'codex',
    run: async (command, args, options) => {
      calls.push({ command, args, options });
      return {
        status: 0,
        stdout: [
          JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
          JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Готово' } }),
          JSON.stringify({ type: 'turn.completed' }),
        ].join('\n'),
        stderr: '',
      };
    },
  });

  const result = await client.complete({ prompt: 'Привет', chatCwd: '/tmp/synvox-codex-chat' });

  assert.equal(result.text, 'Готово');
  assert.equal(result.sessionId, 'thread-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'codex');
  assert.ok(calls[0].args.includes('exec'));
  assert.ok(calls[0].args.includes('--json'));
  assert.ok(calls[0].args.includes('--sandbox'));
  assert.ok(calls[0].args.includes('read-only'));
  assert.ok(calls[0].args.includes('--ignore-rules'));
  assert.ok(calls[0].args.includes('--skip-git-repo-check'));
  assert.ok(calls[0].args.includes('-'));
  assert.equal(calls[0].options.cwd, '/tmp/synvox-codex-chat');
  assert.equal(calls[0].options.input, 'Привет');
});

test('Codex CLI attaches desktop images through private temporary files and removes them after the turn', async () => {
  let imageFiles = [];
  const client = new CodexCliClient({
    executable: 'codex',
    run: async (_command, args) => {
      const imageFlag = args.indexOf('-i');
      imageFiles = args.slice(imageFlag + 1, imageFlag + 2);
      assert.equal(imageFiles.length, 1);
      assert.equal(readFileSync(imageFiles[0]).toString('base64'), 'cGl4ZWxz');
      if (process.platform !== 'win32') assert.equal(statSync(imageFiles[0]).mode & 0o777, 0o600);
      return { status: 0, stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'seen' } }), stderr: '' };
    },
  });

  await client.complete({
    prompt: 'Describe this screenshot',
    images: [{ name: 'desktop.png', mimeType: 'image/png', dataBase64: 'cGl4ZWxz' }],
  });

  assert.equal(client.supportsImageAttachments, true);
  assert.ok(imageFiles[0].endsWith('.png'));
  assert.equal(existsSync(imageFiles[0]), false);
});

test('Codex agent advertises and forwards images only when its client consumes them', async () => {
  const { createCodexAgentAdapter } = await import('../src/providers/codex/agent-adapter.mjs');
  const image = { name: 'desktop.png', mimeType: 'image/png', dataBase64: 'cGl4ZWxz' };
  let received;
  const adapter = createCodexAgentAdapter({
    supportsImageAttachments: true,
    async complete(request) { received = request.images; return { text: '{}' }; },
  });
  assert.equal(adapter.supportsImageAttachments, true);
  await adapter.complete({ prompt: 'inspect screenshot', images: [image] });
  assert.deepEqual(received, [image]);

  const appServerAdapter = createCodexAgentAdapter({ async complete() { return { text: '{}' }; } });
  assert.equal(appServerAdapter.supportsImageAttachments, false);
});

test('Codex CLI removes temporary images when starting the process fails', async () => {
  let imageFile;
  const client = new CodexCliClient({
    executable: 'codex',
    run: async (_command, args) => {
      imageFile = args[args.indexOf('-i') + 1];
      throw new Error('process start failed');
    },
  });
  await assert.rejects(client.complete({ prompt: 'inspect', images: [{ mimeType: 'image/png', dataBase64: 'cGl4ZWxz' }] }), /process start failed/);
  assert.equal(existsSync(imageFile), false);
});

test('Codex CLI forwards Stop to its run transport and removes private images after it settles', async () => {
  let receivedSignal, imageFile;
  const controller = new AbortController();
  const client = new CodexCliClient({
    executable: 'codex',
    run: async (_command, args, options) => {
      receivedSignal = options.signal;
      imageFile = args[args.indexOf('-i') + 1];
      await new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    },
  });
  const pending = client.complete({ prompt: 'inspect', signal: controller.signal,
    images: [{ mimeType: 'image/png', dataBase64: 'cGl4ZWxz' }] });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(receivedSignal, controller.signal);
  assert.equal(existsSync(imageFile), false);
});

test('owned Codex CLI child is terminated on Stop and settles only after close', async () => {
  const controller = new AbortController();
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  let killed = 0;
  child.kill = () => { killed += 1; setImmediate(() => child.emit('close', null)); return true; };
  const pending = runCodexCli('codex', [], { signal: controller.signal, spawnProcess: () => child });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(killed, 1);
});

test('Codex chat resumes the same CLI session without using a project workspace', async () => {
  const calls = [];
  const client = new CodexCliClient({
    executable: 'codex',
    run: async (command, args, options) => {
      calls.push({ command, args, options });
      return {
        status: 0,
        stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Продолжение' } }),
        stderr: '',
      };
    },
  });

  const result = await client.complete({
    prompt: 'Продолжай',
    sessionId: 'thread-1',
    chatCwd: '/tmp/synvox-codex-chat',
  });

  assert.equal(result.text, 'Продолжение');
  assert.equal(calls[0].args[0], 'exec');
  assert.ok(calls[0].args.includes('--json'));
  assert.ok(calls[0].args.includes('--ignore-rules'));
  assert.ok(calls[0].args.includes('--skip-git-repo-check'));
  const resumeIndex = calls[0].args.indexOf('resume');
  assert.ok(resumeIndex > calls[0].args.indexOf('--json'));
  assert.ok(resumeIndex > calls[0].args.indexOf('--sandbox'));
  assert.ok(resumeIndex > calls[0].args.indexOf('--ignore-user-config'));
  assert.equal(calls[0].args[resumeIndex + 1], 'thread-1');
  assert.equal(calls[0].args.at(-1), '-');
  assert.equal(calls[0].options.cwd, '/tmp/synvox-codex-chat');
  assert.equal(calls[0].options.input, 'Продолжай');
});


test('Codex runtime resolver prefers explicit CODEX_CLI_PATH', () => {
  const result = resolveCodexRuntime({
    env: { CODEX_CLI_PATH: '/custom/codex' },
    existsSync: (file) => file === '/custom/codex',
    cwd: '/app',
    platform: 'darwin',
  });
  assert.deepEqual(result, { executable: '/custom/codex', source: 'env', installed: true });
});

test('Codex runtime resolver uses bundled binary before PATH fallback', () => {
  const result = resolveCodexRuntime({
    env: {},
    existsSync: (file) => file === '/app/node_modules/.bin/codex',
    cwd: '/app',
    platform: 'darwin',
  });
  assert.deepEqual(result, { executable: '/app/node_modules/.bin/codex', source: 'bundled', installed: true });
});

test('Codex runtime resolver falls back to codex on PATH when no local binary exists', () => {
  const result = resolveCodexRuntime({
    env: {},
    existsSync: () => false,
    cwd: '/app',
    platform: 'darwin',
  });
  assert.deepEqual(result, { executable: 'codex', source: 'path', installed: null });
});


test('Codex runtime installer uses an isolated Synvox prefix without changing project dependencies', async () => {
  const calls = [];
  const result = await installCodexRuntime({
    env: { SYNVOX_CODEX_RUNTIME_DIR: '/tmp/synvox-codex-test' },
    homedir: '/home/test',
    platform: 'darwin',
    run: async (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'npm');
  assert.ok(calls[0].args.includes('--no-save'));
  assert.ok(calls[0].args.includes('--package-lock=false'));
  assert.ok(calls[0].args.includes('--prefix'));
  assert.equal(calls[0].options.cwd, '/tmp/synvox-codex-test');
  assert.equal(result.source, 'path');
});


test('desktop and VS Code expose the isolated Codex install endpoint', () => {
  for (const file of ['src/window-app/server.mjs', 'plugin-for-vscode/src/window-app/server.mjs']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /\/api\/providers\/codex\/install/);
    assert.match(source, /installCodexRuntime/);
  }
});


test('Codex chat disables agent tooling and user project config', async () => {
  const calls = [];
  const client = new CodexCliClient({
    executable: 'codex',
    run: async (command, args, options) => {
      calls.push({ command, args, options });
      return {
        status: 0,
        stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Чатовый ответ' } }),
        stderr: '',
      };
    },
  });

  await client.complete({ prompt: 'Привет', chatCwd: '/tmp/synvox-codex-chat' });

  const args = calls[0].args;
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('--ignore-rules'));
  assert.ok(args.includes('--sandbox'));
  assert.ok(args.includes('read-only'));
  const disabled = args.flatMap((arg, index) => arg === '--disable' ? [args[index + 1]] : []);
  assert.ok(disabled.includes('shell_tool'));
  assert.ok(disabled.includes('unified_exec'));
  assert.ok(disabled.includes('code_mode_host'));
  assert.ok(disabled.includes('multi_agent'));
});

test('Codex backend is rejected by pipeline execution because it is chat-only', () => {
  for (const file of ['src/window-app/server.mjs', 'plugin-for-vscode/src/window-app/server.mjs']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /Codex CLI доступен только как обычный чатовый режим/);
  }
});


test('Codex app-server creates a fresh thread and completes a chat turn', async () => {
  const { CodexAppServerClient } = await import('../src/providers/codex/app-server-client.mjs');
  const requests = [];
  const client = new CodexAppServerClient({
    rpc: {
      async start() { requests.push({ method: '$start' }); },
      async request(method, params) {
        requests.push({ method, params });
        if (method === 'thread/start') return { thread: { id: 'thread-new' } };
        if (method === 'turn/start') return { turn: { id: 'turn-1' } };
        throw new Error(`unexpected method ${method}`);
      },
      waitForTurn: async (threadId, turnId) => {
        requests.push({ method: '$wait', threadId, turnId });
        return { text: 'Привет из app-server' };
      },
    },
  });

  const result = await client.complete({
    prompt: 'Привет',
    chatCwd: '/tmp/synvox-codex-chat',
  });

  assert.equal(result.sessionId, 'thread-new');
  assert.equal(result.text, 'Привет из app-server');
  assert.equal(requests[0].method, '$start');
  assert.equal(requests[1].method, 'thread/start');
  assert.equal('runtimeWorkspaceRoots' in requests[1].params, false, 'thread/start must stay on the stable app-server protocol');
  assert.equal(requests[1].params.sandbox, 'read-only');
  assert.equal(requests[1].params.approvalPolicy, 'never');
  assert.equal(requests[2].method, 'turn/start');
  assert.equal(requests[2].params.threadId, 'thread-new');
  assert.equal('runtimeWorkspaceRoots' in requests[2].params, false, 'turn/start must stay on the stable app-server protocol');
  assert.deepEqual(requests[2].params.input, [{ type: 'text', text: 'Привет', text_elements: [] }]);
  assert.equal(requests[3].method, '$wait');
});

test('Codex agent uses a separate Synvox tool protocol while app-server tools stay disabled', async () => {
  const { CodexAppServerClient } = await import('../src/providers/codex/app-server-client.mjs');
  const { createCodexAgentAdapter } = await import('../src/providers/codex/agent-adapter.mjs');
  const requests = [];
  const client = new CodexAppServerClient({ rpc: {
    async start() {},
    async request(method, params) {
      requests.push({ method, params });
      if (method === 'thread/start') return { thread: { id: 'agent-thread' } };
      if (method === 'turn/start') return { turn: { id: 'agent-turn' } };
      throw new Error(method);
    },
    async waitForTurn() { return { text: '{"tool":"finish","message":"done"}' }; },
  } });
  const adapter = createCodexAgentAdapter(client);
  const result = await adapter.complete({ prompt: 'Inspect this project' });
  assert.equal(adapter.getConversationId(), 'agent-thread');
  assert.equal(adapter.parseToolCall(result.text).tool, 'finish');
  assert.match(requests[0].params.developerInstructions, /SYNVOX workspace tools/);
  assert.equal(requests[0].params.sandbox, 'read-only');
});

test('Codex app-server resumes an existing thread before the next turn', async () => {
  const { CodexAppServerClient } = await import('../src/providers/codex/app-server-client.mjs');
  const methods = [];
  const client = new CodexAppServerClient({
    rpc: {
      async start() { methods.push('$start'); },
      async request(method, params) {
        methods.push(method);
        if (method === 'thread/resume') {
          assert.equal(params.threadId, 'thread-existing');
          assert.equal('runtimeWorkspaceRoots' in params, false, 'thread/resume must stay on the stable app-server protocol');
          return { thread: { id: 'thread-existing' } };
        }
        if (method === 'turn/start') return { turn: { id: 'turn-2' } };
        throw new Error(`unexpected method ${method}`);
      },
      waitForTurn: async () => ({ text: 'Продолжение' }),
    },
  });

  const result = await client.complete({
    prompt: 'Продолжай',
    sessionId: 'thread-existing',
    chatCwd: '/tmp/synvox-codex-chat',
  });

  assert.equal(result.sessionId, 'thread-existing');
  assert.equal(result.text, 'Продолжение');
  assert.deepEqual(methods, ['$start', 'thread/resume', 'turn/start']);
});


test('desktop and VS Code route Codex chat through app-server instead of codex exec', () => {
  for (const file of ['src/window-app/server.mjs', 'plugin-for-vscode/src/window-app/server.mjs']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /providers\/codex\/app-server-client\.mjs/);
    assert.match(source, /new CodexAppServerClient/);
    assert.doesNotMatch(source, /new CodexCliClient\(\)/);
  }
});

test('desktop and VS Code route Codex agent tasks through a separate code session', () => {
  for (const file of ['src/window-app/server.mjs', 'plugin-for-vscode/src/window-app/server.mjs']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /providers\/codex\/agent-adapter\.mjs/);
    assert.match(source, /conversationId: getCodeSessionId\(conversation\)/);
    assert.match(source, /setCodeSessionId\(conversation, adapter\.getConversationId\(\)\)/);
  }
});


test('desktop and VS Code allow creating conversations with the hidden Codex backend', () => {
  for (const file of ['src/window-app/server.mjs', 'plugin-for-vscode/src/window-app/server.mjs']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /new Set\(\["deepseek", "qwen", "chatgpt", "codex", "googleai", "glm", "antigravity"\]\)/);
  }
});


test('Codex app-server preserves a newly-created thread id when the first turn fails', async () => {
  const { CodexAppServerClient } = await import('../src/providers/codex/app-server-client.mjs');
  const client = new CodexAppServerClient({
    rpc: {
      async start() {},
      async request(method) {
        if (method === 'thread/start') return { thread: { id: 'thread-quota' } };
        if (method === 'turn/start') {
          const error = new Error('usage limit');
          error.code = 'CODEX_QUOTA_EXHAUSTED';
          throw error;
        }
        throw new Error(`unexpected method ${method}`);
      },
      waitForTurn: async () => ({ text: '' }),
    },
  });

  await assert.rejects(
    () => client.complete({ prompt: 'Привет' }),
    (error) => error.code === 'CODEX_QUOTA_EXHAUSTED' && error.sessionId === 'thread-quota',
  );
});

test('desktop and VS Code persist the Codex thread id even when a turn fails', () => {
  for (const file of ['src/window-app/server.mjs', 'plugin-for-vscode/src/window-app/server.mjs']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /if \(error\.sessionId\) conversation\.sessionId = error\.sessionId;/);
  }
});
