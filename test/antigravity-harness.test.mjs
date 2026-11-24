import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AntigravityClient } from '../src/providers/antigravity/client.mjs';
import { createConversationHarnessRunner } from '../src/harness/conversation-runner.mjs';
import { runCodeTask } from '../src/code-agent/run.mjs';
import { getHarnessTaskView } from '../src/harness/task-view.mjs';

test('Antigravity uses Harness checkpoints, plan, workspace tools and verification', async () => {
  const { createAntigravityAgentAdapter } = await import('../src/providers/antigravity/agent-adapter.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-antigravity-harness-'));
  const conversation = { id: 'agy-fixture', provider: 'antigravity', model: 'fixture', workspace: root };
  const calls = [
    { tool: 'update_plan', steps: [{ id: 'write', title: 'Write config', status: 'in_progress' }] },
    { tool: 'write_file', path: 'package.json', content: '{}' },
    { tool: 'finish', message: 'too early' },
    { tool: 'verify_task', checks: [{ cmd: 'node', args: ['-e', 'process.exit(0)'] }] },
    { tool: 'update_plan', steps: [{ id: 'write', title: 'Write config', status: 'completed' }] },
    { tool: 'finish', message: 'done' },
  ];
  let index = 0, isolatedCwd; const events = [];
  const adapter = createAntigravityAgentAdapter({ async complete(request) {
    isolatedCwd = request.cwd; assert.notEqual(request.cwd, root); assert.equal(request.agent, 'synvox-workspace');
    const definition = fs.readFileSync(path.join(request.cwd, '.agents/agents/synvox-workspace.md'), 'utf8');
    assert.match(definition, /tools: \[\]/); assert.match(definition, /commandExecutionPolicy: off/);
    assert.match(request.prompt, /SYNVOX workspace tools/);
    return { sessionId: 'upstream', text: JSON.stringify(calls[index++]) };
  } }, { onConversationId: id => { conversation.codeSessionId = id; } });
  try {
    const run = createConversationHarnessRunner({ runAgent: runCodeTask, persist: async event => events.push(event.type) });
    const result = await run(conversation, adapter, {}, root, 'Create config', null, { memoryEnabled: false });
    assert.notEqual(result.failed, true); assert.equal(index, calls.length);
    assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), '{}');
    const view = getHarnessTaskView(conversation); assert.equal(view.status, 'completed'); assert.equal(view.verification, 'passed');
    assert.equal(view.plan[0].status, 'completed'); assert.equal(conversation.codeSessionId, 'upstream');
    assert.ok(events.includes('checkpoint_saved')); assert.ok(events.includes('task_finished'));
  } finally { adapter.close(); fs.rmSync(root, { recursive: true, force: true }); }
  assert.equal(fs.existsSync(isolatedCwd), false);
});

test('Antigravity agent client selects the restricted custom agent and rejects native tools', async () => {
  let args;
  const client = new AntigravityClient({ run: async (_command, input) => {
    args = input;
    return { status: 0, stdout: [JSON.stringify({ event: 'step_update', step_update: { step_type: 'tool', tool_name: 'write_to_file' } }),
      JSON.stringify({ event: 'result', result: { status: 'SUCCESS', conversation_id: 'started', response: 'done' } })].join('\n'), stderr: '' };
  } });
  await assert.rejects(client.complete({ prompt: 'task', agent: 'synvox-workspace' }),
    error => error.code === 'ANTIGRAVITY_UNEXPECTED_TOOL' && error.sessionId === 'started');
  assert.deepEqual(args.slice(-2), ['--agent', 'synvox-workspace']);
});

test('the Antigravity code route uses the shared Harness and preserves ordinary chat isolation', () => {
  const source = fs.readFileSync(new URL('../src/window-app/server.mjs', import.meta.url), 'utf8');
  const start = source.indexOf("if (convProvider === 'antigravity')");
  const route = source.slice(start, source.indexOf('if (convProvider === "codex")', start));
  assert.match(route, /runConversationAgentTask\(/);
  assert.match(route, /createAntigravityAgentAdapter\(/);
  assert.doesNotMatch(route, /agentMode: true/);
  assert.match(route, /cwd: antigravityChatDir/);
});
