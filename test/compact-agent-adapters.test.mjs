import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGLMAgentPrompt } from '../src/providers/glm/agent-adapter.mjs';
import { buildGoogleAIAgentPrompt } from '../src/providers/google-ai/agent-adapter.mjs';
import { createCodexAgentAdapter } from '../src/providers/codex/agent-adapter.mjs';

const payload = JSON.stringify({
  type: 'task',
  task: 'Update the project and verify it',
  instructions: 'ROLE_AND_HANDOFF_INSTRUCTIONS',
  planGuidance: 'COMPACT_PLAN_GUIDANCE',
  verificationGuidance: 'COMPACT_VERIFICATION_GUIDANCE',
});

test('GLM preserves compact role, plan, and verification instructions', () => {
  const prompt = buildGLMAgentPrompt(payload);
  for (const marker of ['ROLE_AND_HANDOFF_INSTRUCTIONS', 'COMPACT_PLAN_GUIDANCE', 'COMPACT_VERIFICATION_GUIDANCE']) {
    assert.ok(prompt.includes(marker), `missing ${marker}`);
  }
});

test('Google AI preserves compact role, plan, and verification instructions', () => {
  const prompt = buildGoogleAIAgentPrompt(payload);
  for (const marker of ['ROLE_AND_HANDOFF_INSTRUCTIONS', 'COMPACT_PLAN_GUIDANCE', 'COMPACT_VERIFICATION_GUIDANCE']) {
    assert.ok(prompt.includes(marker), `missing ${marker}`);
  }
});

test('Codex preserves compact instructions and advertises existing plan, verification, and skills tools', async () => {
  let prompt = '';
  const adapter = createCodexAgentAdapter({ complete: async request => {
    prompt = request.prompt;
    return { text: '{"tool":"finish","message":"done"}' };
  } });
  await adapter.complete({ prompt: payload });
  for (const marker of ['ROLE_AND_HANDOFF_INSTRUCTIONS', 'COMPACT_PLAN_GUIDANCE', 'COMPACT_VERIFICATION_GUIDANCE']) {
    assert.ok(prompt.includes(marker), `missing ${marker}`);
  }
  for (const tool of ['update_plan', 'verify_task', 'list_skills', 'load_skill', 'read_skill_resource']) {
    assert.ok(prompt.includes(`"tool":"${tool}"`), `missing ${tool} protocol example`);
  }
});
