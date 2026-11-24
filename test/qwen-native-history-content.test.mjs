import assert from 'node:assert/strict';
import test from 'node:test';
import { harvestQwenChatMessage, harvestQwenCheckpoint } from '../src/providers/qwen/harvest.mjs';

const answerPart = content => ({ content, phase: 'answer', status: 'finished', role: 'assistant' });
const thinkingPart = content => ({ content, phase: 'thinking', status: 'finished', role: 'assistant' });

function historyResponse(messages) {
  return { ok: true, status: 200, json: { success: true, data: { chat: { history: {
    currentId: 'answer-id', pagination: { has_more_newer: false, newest_id: 'answer-id' },
    messages: Object.fromEntries(messages.map(message => [message.id, message])),
  } } } } };
}

test('checkpoint recovery reads native content_list answer text for the exact saved prompt and parent', async () => {
  const response = historyResponse([
    { id: 'user-id', role: 'user', content: 'the exact saved prompt', parentId: 'saved-parent', done: true },
    { id: 'answer-id', role: 'assistant', content: '', content_list: [thinkingPart('private reasoning'), answerPart('the saved answer')], parentId: 'user-id', done: true, error: null },
  ]);
  const result = await harvestQwenCheckpoint({ fetcher: async () => response, chatId: 'saved-chat',
    checkpoint: { prompt: 'the exact saved prompt', parentMessageId: 'saved-parent' } });
  assert.deepEqual(result, { text: 'the saved answer', lastMessageId: 'answer-id' });
});

test('message harvest extracts native answer parts and ignores thinking parts', async () => {
  const result = await harvestQwenChatMessage({ chatId: 'saved-chat', responseId: 'answer-id', retries: 0,
    fetcher: async () => [{ id: 'answer-id', role: 'assistant', content: '', content_list: [
      thinkingPart('do not expose this'), answerPart('visible answer'),
    ], done: true }] });
  assert.equal(result.found, true);
  assert.equal(result.text, 'visible answer');
});

test('legacy content remains authoritative when both content and content_list exist', async () => {
  const result = await harvestQwenChatMessage({ chatId: 'saved-chat', responseId: 'answer-id', retries: 0,
    fetcher: async () => [{ id: 'answer-id', role: 'assistant', content: 'legacy answer', content_list: [answerPart('other answer')], done: true }] });
  assert.equal(result.text, 'legacy answer');
});

test('checkpoint recovery rejects incomplete and thinking-only native content', async t => {
  for (const [name, assistant] of [
    ['unfinished answer', { content: '', content_list: [{ ...answerPart('partial answer'), status: 'generating' }], done: false }],
    ['thinking only', { content: '', content_list: [thinkingPart('reasoning only')], done: true }],
  ]) {
    await t.test(name, async () => {
      const response = historyResponse([
        { id: 'user-id', role: 'user', content: 'the exact saved prompt', parentId: 'saved-parent', done: true },
        { id: 'answer-id', role: 'assistant', parentId: 'user-id', ...assistant },
      ]);
      assert.equal(await harvestQwenCheckpoint({ fetcher: async () => response, chatId: 'saved-chat',
        checkpoint: { prompt: 'the exact saved prompt', parentMessageId: 'saved-parent' } }), null);
    });
  }
});

test('checkpoint recovery rejects a completed native node marked with an upstream error', async () => {
  const response = historyResponse([
    { id: 'user-id', role: 'user', content: 'the exact saved prompt', parentId: 'saved-parent', done: true },
    { id: 'answer-id', role: 'assistant', content: '', content_list: [answerPart('partial failed output')],
      parentId: 'user-id', done: true, error: { code: 'internal_error' } },
  ]);
  assert.equal(await harvestQwenCheckpoint({ fetcher: async () => response, chatId: 'saved-chat',
    checkpoint: { prompt: 'the exact saved prompt', parentMessageId: 'saved-parent' } }), null);
});
