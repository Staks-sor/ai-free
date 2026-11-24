import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAntigravityConversationTurn } from '../src/providers/antigravity/window-adapter.mjs';

test('Antigravity conversation keeps its own upstream session and result', async () => {
  const conversation = { provider: 'antigravity', model: 'gemini-3.8-flash-medium', sessionId: 'old', messages: [] };
  const calls = [];
  await runAntigravityConversationTurn({
    client: { complete: async (input) => { calls.push(input); return { sessionId: 'new', text: 'Готово' }; } },
    conversation, prompt: 'Привет', cwd: '/tmp/chat', onChange: () => {},
  });
  assert.equal(calls[0].sessionId, 'old');
  assert.equal(calls[0].model, 'gemini-3.8-flash-medium');
  assert.equal(conversation.sessionId, 'new');
  assert.equal(conversation.messages.at(-1).content, 'Готово');
});

test('failed native turn preserves a returned session ID without replaying tools', async () => {
  const conversation = { provider: 'antigravity', model: 'gemini-3.8-flash-medium', sessionId: null, messages: [] };
  let attempts = 0;
  await assert.rejects(runAntigravityConversationTurn({
    client: { complete: async () => { attempts += 1; const error = new Error('limit'); error.sessionId = 'started'; throw error; } },
    conversation, prompt: 'Task', cwd: '/tmp/project', onChange: () => {},
  }), /limit/);
  assert.equal(attempts, 1);
  assert.equal(conversation.sessionId, 'started');
  assert.equal(conversation.messages.length, 0);
});
