import test from 'node:test';
import assert from 'node:assert/strict';
import { harvestQwenCheckpoint } from '../src/providers/qwen/harvest.mjs';

function history(messages, { currentId = 'assistant-1', newestId = currentId, hasMoreNewer = false } = {}) {
  const nodes = Object.fromEntries(messages.map(message => [message.id, message]));
  return { ok: true, json: { success: true, data: { chat: {
    history: { currentId, messages: nodes, pagination: { newest_id: newestId, has_more_newer: hasMoreNewer } },
  } } } };
}

const checkpoint = { prompt: 'first prompt', parentMessageId: null };
const rootUser = { id: 'user-1', role: 'user', content: 'first prompt', childrenIds: ['assistant-1'] };
const completedAnswer = { id: 'assistant-1', role: 'assistant', parentId: 'user-1', content: 'saved answer', done: true };

test('recovers a unique completed response for a root user turn with no parent', async () => {
  let reads = 0;
  const result = await harvestQwenCheckpoint({ chatId: 'chat', checkpoint,
    fetcher: async () => { reads += 1; return history([rootUser, completedAnswer]); } });
  assert.equal(reads, 1);
  assert.deepEqual(result, { text: 'saved answer', lastMessageId: 'assistant-1' });
});

test('rejects ambiguous duplicate root user prompts', async () => {
  const result = await harvestQwenCheckpoint({ chatId: 'chat', checkpoint,
    fetcher: async () => history([rootUser, { ...rootUser, id: 'user-2' }, completedAnswer]) });
  assert.equal(result, null);
});

test('rejects multiple assistant children even if one is complete', async () => {
  const result = await harvestQwenCheckpoint({ chatId: 'chat', checkpoint,
    fetcher: async () => history([rootUser, completedAnswer,
      { id: 'assistant-2', role: 'assistant', parentId: 'user-1', content: 'another answer', done: true }]) });
  assert.equal(result, null);
});

test('empty root history never proves not_sent or authorizes a resend', async () => {
  let reads = 0;
  const result = await harvestQwenCheckpoint({ chatId: 'chat', checkpoint: {
    ...checkpoint, originalTransportClosed: true,
    recoveryNotBefore: new Date(Date.now() - 600_000).toISOString(),
  }, fetcher: async () => {
    reads += 1;
    return history([], { currentId: null, newestId: null });
  } });
  assert.equal(reads, 1);
  assert.equal(result, null);
});

test('continues matching a non-root user turn to its unique completed answer', async () => {
  const result = await harvestQwenCheckpoint({ chatId: 'chat',
    checkpoint: { prompt: 'next prompt', parentMessageId: 'previous' },
    fetcher: async () => history([
      { id: 'previous', role: 'assistant', content: 'previous answer', done: true },
      { id: 'user-2', role: 'user', content: 'next prompt', parentId: 'previous' },
      { ...completedAnswer, id: 'assistant-2', parentId: 'user-2' },
    ], { currentId: 'assistant-2' }) });
  assert.deepEqual(result, { text: 'saved answer', lastMessageId: 'assistant-2' });
});

test('image recovery accepts only the current branch user node with exactly matching provider file ids', async () => {
  const imageCheckpoint = { prompt: 'inspect image', parentMessageId: 'previous', imageCount: 1, expectedImageFileIds: ['file-1'] };
  const matchingUser = { id: 'user-image', role: 'user', content: 'inspect image', parentId: 'previous', files: [{ file: { id: 'file-1' } }] };
  const answer = { id: 'answer-image', role: 'assistant', parentId: 'user-image', content: 'saved answer', done: true };
  const matching = await harvestQwenCheckpoint({ chatId: 'chat', checkpoint: imageCheckpoint,
    fetcher: async () => history([{ id: 'previous', role: 'assistant', content: 'previous', done: true }, matchingUser, answer], { currentId: 'answer-image' }) });
  assert.deepEqual(matching, { text: 'saved answer', lastMessageId: 'answer-image' });

  const mismatch = await harvestQwenCheckpoint({ chatId: 'chat', checkpoint: imageCheckpoint,
    fetcher: async () => history([{ id: 'previous', role: 'assistant', content: 'previous', done: true }, { ...matchingUser, files: [{ id: 'other-file' }] }, answer]) });
  assert.equal(mismatch, null);
});

test('image recovery without confirmed provider file ids never attests an absent turn', async () => {
  const result = await harvestQwenCheckpoint({ chatId: 'chat', checkpoint: {
    prompt: 'inspect image', parentMessageId: 'parent', imageCount: 1, expectedImageFileIds: [],
    originalTransportClosed: true, recoveryNotBefore: new Date(Date.now() - 600_000).toISOString(),
  }, fetcher: async () => history([{ id: 'parent', role: 'assistant', content: 'previous', done: true, childrenIds: [] }], { currentId: 'parent' }) });
  assert.equal(result, null);
});

test('image recovery ignores native URL references while requiring exact uploaded image ids', async () => {
  const checkpoint = { prompt: 'inspect image https://example.org/reference', parentMessageId: null, imageCount: 1, expectedImageFileIds: ['image-a'] };
  const urlReference = { type: 'file', file_class: 'url', file_type: null, url: 'https://example.org/reference' };
  const user = { id: 'user-image', role: 'user', content: checkpoint.prompt,
    files: [{ file: { id: 'image-a' } }, urlReference] };
  const answer = { id: 'answer-image', role: 'assistant', parentId: user.id, content: 'saved answer', done: true };
  const result = await harvestQwenCheckpoint({ chatId: 'chat', checkpoint,
    fetcher: async () => history([user, answer], { currentId: answer.id }) });
  assert.deepEqual(result, { text: 'saved answer', lastMessageId: answer.id });
  const missing = await harvestQwenCheckpoint({ chatId: 'chat', checkpoint,
    fetcher: async () => history([{ ...user, files: [urlReference] }, answer], { currentId: answer.id }) });
  assert.equal(missing, null);
});
