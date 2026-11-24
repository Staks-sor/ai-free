import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChatGPTAgentAdapter } from '../src/providers/chatgpt/agent-adapter.mjs';

test('ChatGPT coding requests explain the external JSON executor on every turn', async () => {
  const requests = [];
  const adapter = createChatGPTAgentAdapter({ async complete(request) {
    requests.push(request);
    return { text: '{"tool":"finish","message":"done"}', conversationId: 'chat', lastMessageId: 'answer' };
  } }, { model: 'selected-model' });
  const first = 'Inspect the local project.\n{"tool":"read_file","path":"project.gd"}';
  const result = await adapter.complete({ prompt: first });
  await adapter.complete({ prompt: 'Tool result for read_file:\n{"ok":true,"content":"old"}' });
  for (const request of requests) {
    assert.match(request.prompt, /SYNVOX.*external.*JSON/i);
    assert.match(request.prompt, /not.*ChatGPT.*native.*tools/i);
    assert.match(request.prompt, /executes.*locally/i);
  }
  assert.ok(requests[0].prompt.endsWith(first));
  assert.equal(requests[1].conversationId, 'chat');
  assert.equal(requests[0].model, 'selected-model');
  assert.equal(result.lastAssistantMessageId, 'answer');
});

test('ChatGPT attaches later desktop screenshots exactly once', async () => {
  const requests = [];
  const initial = { name: 'initial.png', mimeType: 'image/png', dataBase64: 'AQ==' };
  const desktop = { name: 'desktop.png', mimeType: 'image/png', dataBase64: 'Ag==' };
  const adapter = createChatGPTAgentAdapter({ async complete(request) { requests.push(request); return { text: 'ok' }; } }, { images: [initial] });
  assert.equal(adapter.supportsImageAttachments, true);
  await adapter.complete({ prompt: 'first' });
  await adapter.complete({ prompt: 'desktop', images: [desktop] });
  await adapter.complete({ prompt: 'after' });
  assert.deepEqual(requests.map(request => request.images), [[initial], [desktop], []]);
});
