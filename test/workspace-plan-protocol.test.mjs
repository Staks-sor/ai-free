import {test} from 'node:test';import assert from 'node:assert/strict';
import {createCompactTaskPrompt} from '../src/code-agent/compact-prompt.mjs';
import {buildGLMAgentPrompt} from '../src/providers/glm/agent-adapter.mjs';
import {buildGoogleAIAgentPrompt} from '../src/providers/google-ai/agent-adapter.mjs';
for(const [name,build] of [['GLM',buildGLMAgentPrompt],['Google AI',buildGoogleAIAgentPrompt]])test(`${name} preserves the compact task plan protocol`,()=>{const prompt=build(createCompactTaskPrompt('исправь управление и проверь игру'));assert.match(prompt,/update_plan/);assert.match(prompt,/multi-step workspace tasks/);assert.match(prompt,/in_progress/)});
