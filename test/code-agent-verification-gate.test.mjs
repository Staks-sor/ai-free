import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCodeTask } from '../src/code-agent/run.mjs';

const write = { tool: 'write_file', path: 'app.js', content: 'export const value = 1;' };
const finish = { tool: 'finish', message: 'Готово.' };
const verify = (ok) => ({ tool: 'verify_task', checks: [{ cmd: 'node', args: ['-e', `process.exit(${ok ? 0 : 1})`] }] });
async function sequence(calls, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verification-gate-'));
  let index = 0;
  const requests = [], checkpoints = [];
  try {
    for (const [file, content] of Object.entries(extra.initialFiles || {})) fs.writeFileSync(path.join(dir, file), content);
    const result = await runCodeTask({ supportsNativeTools: extra.native === true, async complete(request) {
      requests.push(request);
      const call = calls[Math.min(index++, calls.length - 1)];
      return extra.native ? { toolCall: { id: `call-${index}`, name: call.tool, arguments: Object.fromEntries(Object.entries(call).filter(([key]) => key !== 'tool')) } }
        : { text: typeof call === 'string' ? call : JSON.stringify(call) };
    } }, { sessionId: 'test' }, dir, extra.task || 'исправь app.js', null, {
      requireVerification: true, memoryEnabled: false, noToolTextRetries: 1,
      ...extra, onCheckpoint: state => checkpoints.push(state),
    });
    return { result, requests, checkpoints, count: index };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
for (const native of [false, true]) test(`finish after edit continues to verification (native=${native})`, async () => {
  const { result, requests, count } = await sequence([write, finish, verify(true), finish], { native });
  assert.equal(count, 4);
  assert.notEqual(result.failed, true);
  assert.match(requests[2].prompt, /verify_task/);
  if (native) assert.equal(requests[2].toolResult.toolCallId, 'call-2');
});
test('failed verification continues through repair and passing checks', async () => {
  const { result, count } = await sequence([write, verify(false), finish, { ...write, content: 'export const value = 2;' }, verify(true), finish]);
  assert.equal(count, 6);
  assert.notEqual(result.failed, true);
});
test('new edits invalidate passing verification including text-only finish', async () => {
  const { result, count } = await sequence([write, verify(true), { ...write, content: 'export const value = 3;' }, 'Готово.']);
  assert.equal(result.failed, true);
  assert.match(result.message, /провер/);
  assert.equal(count, 5);
});
test('resume preserves the verification requirement', async () => {
  const { result } = await sequence([finish], { resumeState: { phase: 'ready', requiresCodeVerification: true, codeVerification: 'not_run', hasSuccessfulWorkspaceAction: true } });
  assert.equal(result.failed, true);
});
test('conversation without code edits can finish without commands', async () => {
  const { result, count } = await sequence([finish], { task: 'объясни app.js' });
  assert.notEqual(result.failed, true);
  assert.equal(count, 1);
});

for (const mutation of [
  { tool: 'write_file', path: 'package.json', content: '{}' },
  { tool: 'append_file', path: 'settings.yaml', content: 'key: value' },
  { tool: 'delete_file', path: 'README.md' },
  { tool: 'mkdir', path: 'new-folder' },
  { tool: 'run_command', cmd: 'node', args: ['-e', 'process.exit(0)'] },
  { tool: 'run_command', cmd: 'node', args: ['-e', "require('node:fs').writeFileSync('partial.txt','changed'); process.exit(1)"] },
  { tool: 'run_command', cmd: 'node', timeoutMs: 1000, args: ['-e', "require('node:fs').writeFileSync('partial.txt','changed'); setTimeout(()=>{},10000)"] },
  { tool: 'run_shell', command: 'true' },
]) test(`successful ${mutation.tool} requires verification before finish`, async () => {
  const { result, count, requests } = await sequence([mutation, finish, verify(true), finish], mutation.tool === 'delete_file'
    ? { initialFiles: { 'README.md': 'fixture' }, executionPermissions: { allowDestructiveActions: true } } : {});
  assert.notEqual(result.failed, true);
  assert.equal(count, 4);
  assert.match(requests[2].prompt, /verify_task/);
});

test('read-only workspace tools do not require verification', async () => {
  const { result, count } = await sequence([{ tool: 'list_files', path: '.', maxDepth: 1, maxEntries: 10 }, finish], { task: 'покажи список файлов проекта' });
  assert.notEqual(result.failed, true);
  assert.equal(count, 2);
});

test('conversation Harness requires verification from its code worker', async () => {
  const { createConversationHarnessRunner } = await import('../src/harness/conversation-runner.mjs');
  let workerOptions;
  const runner = createConversationHarnessRunner({ persist: async () => {}, runAgent: async (_client, _base, _workspace, _goal, _parent, options) => {
    workerOptions = options;
    return { message: 'Explanation' };
  } });
  await runner({ id: 'gate', provider: 'deepseek', workspace: '/fixture' }, {}, {}, '/fixture', 'исправь app.js');
  assert.equal(workerOptions.requireVerification, true);
});

test('native verification refusal saves a ready checkpoint and answers the rejected finish call',async()=>{
  const {result,checkpoints}=await sequence([write,finish],{native:true});
  assert.equal(result.failed,true);const latest=checkpoints.at(-1);
  assert.equal(latest.phase,'ready');assert.equal(latest.pendingToolResult.toolCallId,'call-3');
  assert.equal(latest.pendingToolResult.result.ok,false);
});
