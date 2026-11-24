import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveUploadConversation } from '../src/window-app/upload-account-binding.mjs';

test('uploads stay with the DeepSeek conversation identity and session', () => {
  const state = { activeConversationId: 'd', conversations: [
    { id: 'c', provider: 'chatgpt', sessionId: 'other' },
    { id: 'd', provider: 'deepseek', sessionId: 'one', providerAccountId: 'a1' },
    { id: 'e', provider: 'deepseek', sessionId: 'two', providerAccountId: 'a2' },
  ] };
  assert.equal(resolveUploadConversation(state, { conversationId: 'e', chatSessionId: 'two' }).providerAccountId, 'a2');
  assert.equal(resolveUploadConversation(state, { chatSessionId: 'two' }).id, 'e');
  assert.equal(resolveUploadConversation(state, {}).id, 'd');
  for (const body of [{ conversationId: 'c' }, { conversationId: 'missing' },
    { conversationId: 'd', chatSessionId: 'two' }, { chatSessionId: 'unknown' }]) {
    assert.throws(() => resolveUploadConversation(state, body), /чат|сессия/i);
  }
});
