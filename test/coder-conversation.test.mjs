import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCodeTask } from '../src/code-agent/run.mjs';
import { buildGLMAgentPrompt } from '../src/providers/glm/agent-adapter.mjs';
import { buildGoogleAIAgentPrompt } from '../src/providers/google-ai/agent-adapter.mjs';
import { createNativeCodeSystemPrompt } from '../src/code-agent/native-tools.mjs';

it('lets the agent answer a simple message without workspace operations', async () => {
  let turns = 0;
  const result = await runCodeTask({ async complete(request) {
    turns++;
    assert.match(request.prompt, /For conversational messages.*without calling workspace tools/);
    return { text: 'Привет! Чем помочь?', lastAssistantMessageId: 'greeting' };
  } }, {}, os.tmpdir(), 'привет, что нового?', null, { memoryEnabled: false });
  assert.equal(turns, 1);
  assert.equal(result.message, 'Привет! Чем помочь?');
  assert.deepEqual(result.toolLogs, []);
});

it('lets the same agent choose a real file read for the reported project request', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coder-conversation-'));
  fs.writeFileSync(path.join(root, 'README.md'), 'Local project evidence');
  let turns = 0;
  try {
    const result = await runCodeTask({ async complete(request) {
      turns++;
      if (turns === 1) {
        assert.match(request.prompt, /Choose whether to answer, clarify, or use tools based on the user/);
        return { text: '{"tool":"read_file","path":"README.md"}', lastAssistantMessageId: 'read' };
      }
      assert.match(request.prompt, /Local project evidence/);
      return { text: '{"tool":"finish","message":"В README описан локальный проект."}', lastAssistantMessageId: 'answer' };
    } }, {}, root, 'ты внутри проекта посмотри', null, { memoryEnabled: false });
    assert.equal(turns, 2);
    assert.equal(result.toolLogs.length, 1);
    assert.match(result.message, /README/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it('provides the same conversational choice to native tool agents', () => {
  assert.match(createNativeCodeSystemPrompt('/tmp/project'), /For conversational messages.*without calling workspace tools/);
});

it('lets compact Web agents answer naturally through finish without file tools', () => {
  for (const build of [buildGLMAgentPrompt, buildGoogleAIAgentPrompt]) {
    assert.match(build('привет'), /conversational messages.*finish.*without.*tools/i);
  }
});
