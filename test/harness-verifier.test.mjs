import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyTask } from '../src/harness/verifier.mjs';
import { createConversationHarnessRunner } from '../src/harness/conversation-runner.mjs';

test('verifier executes a bounded list sequentially and records actual exit outcomes', async () => {
  const seen = [];
  const result = await verifyTask([{ name: 'test', cmd: 'node', args: ['--test'] }, { name: 'build', cmd: 'npm', args: ['run', 'build'] }], async call => {
    seen.push(call); return { ok: seen.length === 1, status: seen.length === 1 ? 0 : 1, stdout: 'x'.repeat(9000), stderr: 'broken' };
  });
  assert.equal(result.verification, 'failed');
  assert.deepEqual(seen.map(call => call.cmd), ['node', 'npm']);
  assert.ok(result.checks.every(check => check.stdout.length <= 2000));
  assert.equal(result.checks[1].status, 1);
  await assert.rejects(verifyTask([], async () => {}), /1.*5/);
  await assert.rejects(verifyTask(Array(6).fill({ cmd: 'node', args: [] }), async () => {}), /1.*5/);
  await assert.rejects(verifyTask([{ cmd: 'node', args: 'shell string' }], async () => {}), /args/);
});

test('harness preserves verifier outcomes, invalidates them after edits, and reports failed checks', async () => {
  for (const outcome of ['passed', 'failed', 'edited']) {
    const conversation = { provider: 'deepseek' };
    const run = createConversationHarnessRunner({ persist() {}, runAgent: async (_c, _b, _w, _g, _p, options) => {
      options.onTool({ tool: 'verify_task' }, { ok: outcome !== 'failed', verification: outcome === 'failed' ? 'failed' : 'passed', checks: [{ name: 'test', status: outcome === 'failed' ? 1 : 0 }] });
      if (outcome === 'edited') options.onTool({ tool: 'write_file' }, { ok: true });
      return { message: 'Done', toolLogs: [] };
    } });
    const result = await run(conversation, {}, {}, '/workspace', 'fix');
    assert.equal(conversation.harnessTask.verification, outcome === 'edited' ? 'not_run' : outcome);
    if (outcome === 'failed') {
      assert.equal(conversation.harnessTask.status, 'failed');
      assert.equal(result.failed, true);
      assert.equal(conversation.harnessTask.events.find(event => event.type === 'tool_finished').data.ok, false);
      assert.match(result.message, /провер/i);
    }
  }
});

test('verification commands retain owner approval guards', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { executeWorkspaceTool } = await import('../src/code-agent/executor.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-verify-policy-'));
  try {
    await assert.rejects(executeWorkspaceTool(root, { tool: 'verify_task', checks: [{ cmd: 'git', args: ['reset', '--hard'] }] }), error => error.permissionRequest?.permissionKey === 'allowDestructiveActions');
    const result = await executeWorkspaceTool(root, { tool: 'verify_task', checks: [{ cmd: 'node', args: ['--version'] }] });
    assert.equal(result.verification, 'passed');
    assert.equal(result.checks[0].status, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('verification logs expose check outcomes without dumping full command output', async () => {
  const { formatToolLog } = await import('../src/code-agent/tool-log.mjs');
  const log = formatToolLog({ tool: 'verify_task' }, { verification: 'failed', checks: [{ name: 'focused', status: 1, ok: false, stdout: 'private verbose output' }] });
  assert.match(log, /verification: failed/);
  assert.match(log, /focused.*1/);
  assert.doesNotMatch(log, /private verbose/);
});
