import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AntigravityClient, parseAntigravityModels } from '../src/providers/antigravity/client.mjs';
import { getProvider } from '../src/providers/registry.mjs';
import { getProviderCatalog } from '../src/providers/model-catalog.mjs';
import { resolveAntigravityExecutable } from '../src/providers/antigravity/runtime.mjs';

test('Antigravity is separate from Google AI Mode and does not require an API key', () => {
  assert.equal(getProvider('googleai').id, 'googleai');
  assert.equal(getProvider('antigravity').id, 'antigravity');
  assert.equal(getProviderCatalog('antigravity').defaultModel, 'gemini-3.8-flash-medium');
});

test('Antigravity model list is discovered from CLI, not treated as a fixed catalog', () => {
  assert.deepEqual(parseAntigravityModels('gemini-3.8-flash-high  Gemini 3.8 Flash (High)\ngemini-3.8-flash-medium  Gemini 3.8 Flash (Medium)\n'), [
    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
    { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
  ]);
});

test('GUI discovers the official user-local CLI without depending on shell PATH', () => {
  assert.equal(resolveAntigravityExecutable({ homedir: '/test-user', existsSync: (file) => file === '/test-user/.local/bin/agy' }), '/test-user/.local/bin/agy');
});

test('Antigravity uses one official CLI run and preserves its conversation ID', async () => {
  const calls = [];
  const client = new AntigravityClient({
    executable: 'agy',
    run: async (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: [
        JSON.stringify({ event: 'init', conversation_id: 'session-1' }),
        JSON.stringify({ event: 'step_update', step_update: { step_type: 'agent_response', text_delta: 'Привет' } }),
        JSON.stringify({ event: 'result', result: { status: 'SUCCESS', conversation_id: 'session-1', response: 'Привет!' } }),
      ].join('\n'), stderr: '' };
    },
  });
  const result = await client.complete({ prompt: 'привет', model: 'gemini-3.8-flash-medium', sessionId: 'previous', cwd: '/tmp/synvox-test' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['-p', 'привет', '--output-format', 'stream-json', '--sandbox', '--model', 'gemini-3.8-flash-medium', '--conversation', 'previous']);
  assert.equal(result.sessionId, 'session-1');
  assert.equal(result.text, 'Привет!');
});

test('Antigravity never retries an uncertain or failed CLI turn', async () => {
  let attempts = 0;
  const client = new AntigravityClient({ run: async () => {
    attempts += 1;
    return { status: 1, stdout: JSON.stringify({ event: 'result', result: { status: 'ERROR', error: 'authentication required' } }), stderr: '' };
  } });
  await assert.rejects(client.complete({ prompt: 'task' }), /authentication required/);
  assert.equal(attempts, 1);
});
