import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeWorkspaceTool, prepareBrowserToolCall } from '../src/code-agent/executor.mjs';
import { createCodeSystemPrompt } from '../src/code-agent/prompt.mjs';
import { createNativeCodeSystemPrompt, NATIVE_CODE_TOOLS } from '../src/code-agent/native-tools.mjs';
import { buildExternalAgentPrompt } from '../src/code-agent/external-agent-prompt.mjs';
import { createCompactTaskPrompt } from '../src/code-agent/compact-prompt.mjs';
import { computerAccessPrompt } from '../src/code-agent/access-policy.mjs';

const computer = { accessMode: 'computer' };
test('agent shell instructions match Windows cmd and Unix sh in both access modes', () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  try {
    for (const platform of ['win32', 'linux', 'darwin']) {
      Object.defineProperty(process, 'platform', { ...descriptor, value: platform });
      for (const accessMode of ['project', 'computer']) {
        const prompt = computerAccessPrompt({ accessMode });
        assert.match(prompt, platform === 'win32' ? /run_shell uses cmd\.exe/ : /run_shell uses POSIX sh/);
        if (platform === 'win32') assert.match(prompt, /do not assume Bash/);
      }
    }
  } finally { Object.defineProperty(process, 'platform', descriptor); }
});
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-computer-access-'));
  const project = path.join(dir, 'project');
  fs.mkdirSync(project);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, project, outside: path.join(dir, 'outside.txt') };
}

test('computer access runs arbitrary executable paths with arguments outside the project; project still blocks them', async t => {
  const { project, outside } = fixture(t);
  fs.writeFileSync(outside, 'outside-project-ok');
  const call = { tool: 'run_command', cmd: process.execPath, args: ['-e', "process.stdout.write(require('node:fs').readFileSync(process.argv[1],'utf8'))", outside] };
  await assert.rejects(executeWorkspaceTool(project, call), /не разрешена/);
  const result = await executeWorkspaceTool(project, call, computer);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'outside-project-ok');
  const verified = await executeWorkspaceTool(project, { tool: 'verify_task', checks: [{ cmd: call.cmd, args: call.args }] }, computer);
  assert.equal(verified.verification, 'passed');
});

test('computer mode reads, writes, lists and deletes outside the project and can be revoked', async t => {
  const { project, outside } = fixture(t);
  const write = { tool: 'write_file', path: outside, content: 'full access' };
  await assert.rejects(executeWorkspaceTool(project, write), /escapes workspace/);
  assert.equal((await executeWorkspaceTool(project, write, computer)).ok, true);
  assert.equal((await executeWorkspaceTool(project, { tool: 'read_file', path: outside }, computer)).content, 'full access');
  assert.ok((await executeWorkspaceTool(project, { tool: 'list_files', path: outside }, computer)).entries.some(entry => entry.endsWith('outside.txt')));
  await assert.rejects(executeWorkspaceTool(project, { tool: 'read_file', path: outside }, { accessMode: 'project' }), /escapes workspace/);
  assert.equal((await executeWorkspaceTool(project, { tool: 'delete_file', path: outside }, computer)).deleted, true);
  assert.equal(fs.existsSync(outside), false);
});

test('read_image validates bytes and follows the selected project or computer path policy', async t => {
  const { project, dir } = fixture(t);
  const outside = path.join(dir, 'screen.png');
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  fs.writeFileSync(outside, png);
  await assert.rejects(executeWorkspaceTool(project, { tool: 'read_image', path: outside }), /escapes workspace/);
  const result = await executeWorkspaceTool(project, { tool: 'read_image', path: outside }, computer);
  assert.equal(result.screenshot.mime, 'image/png');
  assert.equal(result.screenshot.base64, png.toString('base64'));
  fs.writeFileSync(path.join(project, 'invalid.png'), 'not an image');
  await assert.rejects(executeWorkspaceTool(project, { tool: 'read_image', path: 'invalid.png' }), /supported image/i);
});

test('executor asks browser snapshots for base64 while leaving other browser calls unchanged', () => {
  assert.deepEqual(prepareBrowserToolCall({ tool: 'browser_snapshot', includeScreenshot: false }), {
    tool: 'browser_snapshot', includeScreenshot: false, includeScreenshotBase64: true,
  });
  const navigate = { tool: 'browser_navigate', url: 'https://example.com' };
  assert.equal(prepareBrowserToolCall(navigate), navigate);
});

test('command and shell cwd are validated by the selected access mode', async t => {
  const { dir, project } = fixture(t);
  const command = { tool: 'run_command', cmd: 'node', args: ['-e', 'process.stdout.write(process.cwd())'], cwd: dir };
  await assert.rejects(executeWorkspaceTool(project, command), /escapes workspace/);
  assert.equal((await executeWorkspaceTool(project, command, computer)).stdout, fs.realpathSync(dir));
  const shell = { tool: 'run_shell', command: 'node -e "process.stdout.write(process.cwd())"', cwd: dir };
  assert.equal((await executeWorkspaceTool(project, shell, computer)).stdout, fs.realpathSync(dir));
});

test('computer mode never bypasses cancellation or accepts an empty executable', async t => {
  const { project } = fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(executeWorkspaceTool(project, { tool: 'run_command', cmd: process.execPath, args: ['--version'] }, { ...computer, signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(executeWorkspaceTool(project, { tool: 'run_command', cmd: '', args: [] }, computer), /non-empty|не задана/);
});

test('text and native prompts reflect computer access and the real operating system', () => {
  const text = createCodeSystemPrompt('/tmp/project', 'work', '', computer);
  const native = createNativeCodeSystemPrompt('/tmp/project', computer);
  for (const prompt of [text, native]) {
    assert.match(prompt, /Computer access/i);
    assert.match(prompt, /absolute paths/i);
    assert.match(prompt, /computer_snapshot/);
    assert.match(prompt, new RegExp(process.platform));
    assert.doesNotMatch(prompt, /Use only relative workspace paths/);
  }
  assert.match(text, /"tool":"read_image","path":"relative\/image\.png"/);
  assert.match(text, /same Project\/Computer path rules as read_file/);
  assert.doesNotMatch(createNativeCodeSystemPrompt('/tmp/project'), /Computer access: enabled/);
  for (const name of ['run_command', 'run_shell']) assert.equal(NATIVE_CODE_TOOLS.find(tool => tool.function.name === name).function.parameters.properties.cwd.type, 'string');
  const readImage = NATIVE_CODE_TOOLS.find(tool => tool.function.name === 'read_image');
  assert.equal(readImage.function.parameters.required.includes('path'), true);
  assert.match(readImage.function.description, /Project.*Computer/i);
  assert.match(buildExternalAgentPrompt(createCompactTaskPrompt('inspect screenshot')), /"tool":"read_image","path":"relative\/image\.png"/);
  assert.match(buildExternalAgentPrompt(createCompactTaskPrompt('inspect screenshot')), /Project paths.*Computer mode/i);
});

test('the real code-agent loop passes computer access through execution and verification', async t => {
  const { runCodeTask } = await import('../src/code-agent/run.mjs');
  const { project } = fixture(t);
  const calls = [
    { tool: 'run_command', cmd: process.execPath, args: ['--version'] },
    { tool: 'verify_task', checks: [{ cmd: process.execPath, args: ['--version'] }] },
    { tool: 'finish', message: 'verified' },
  ];
  let index = 0;
  const requests = [];
  const result = await runCodeTask({ async complete(request) { requests.push(request); return { text: JSON.stringify(calls[Math.min(index++, 2)]) }; } }, {}, project, 'запусти проверку', null, { ...computer, memoryEnabled: false, requireVerification: true });
  assert.notEqual(result.failed, true);
  assert.equal(index, 3);
  assert.ok(requests.every(request => /Computer access: enabled/.test(request.prompt)));
});

for (const native of [false, true]) test(`a completed denied command saves a safe continuation checkpoint (native=${native})`, async t => {
  const { runCodeTask } = await import('../src/code-agent/run.mjs');
  const { project } = fixture(t);
  const checkpoints = [];
  const call = { tool: 'run_command', cmd: 'SYNVOX_NONEXISTENT_BINARY', args: [] };
  const result = await runCodeTask({ supportsNativeTools: native, async complete() {
    return native ? { toolCall: { id: 'denied-call', name: call.tool, arguments: { cmd: call.cmd, args: [] } } } : { text: JSON.stringify(call) };
  } }, {}, project, 'запусти программу', null, { memoryEnabled: false, onCheckpoint: checkpoint => checkpoints.push(checkpoint) });
  assert.equal(result.failed, true);
  assert.equal(checkpoints.at(-1).phase, 'ready');
  if (native) assert.equal(checkpoints.at(-1).pendingToolResult.toolCallId, 'denied-call');
  else assert.match(checkpoints.at(-1).prompt, /SYNVOX_NONEXISTENT_BINARY/);
});
