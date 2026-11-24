import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseToolCall } from '../../code-agent/parser.mjs';
import { buildExternalAgentPrompt } from '../../code-agent/external-agent-prompt.mjs';

// Official custom-agent schema: no CLI workspace tools. SYNVOX executes the
// returned action under its own permissions, checkpoints and verification.
const AGENT_DEFINITION = `---
name: synvox-workspace
description: Return one SYNVOX workspace action for the local executor.
tools: []
mainAgent: true
subagent: false
commandExecutionPolicy: off
---
Use only the SYNVOX JSON/XML action protocol in the prompt.
Do not invoke native tools or subagents. Return exactly one action per turn.
`;

export function createAntigravityAgentAdapter(client, { conversationId = null, model = null, onConversationId = null } = {}) {
  let currentConversationId = conversationId, directory;
  const rememberSession = result => {
    if (result.sessionId && result.sessionId !== currentConversationId) {
      currentConversationId = result.sessionId;
      onConversationId?.(currentConversationId);
    }
  };
  return {
    noToolTextRetries: 1,
    parseToolCall,
    getConversationId: () => currentConversationId,
    async complete({ prompt, signal = null }) {
      signal?.throwIfAborted();
      if (!directory) {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-antigravity-agent-'));
        fs.mkdirSync(path.join(directory, '.agents/agents'), { recursive: true });
        fs.writeFileSync(path.join(directory, '.agents/agents/synvox-workspace.md'), AGENT_DEFINITION, { mode: 0o600 });
      }
      try {
        const result = await client.complete({ prompt: buildExternalAgentPrompt(prompt), signal,
          sessionId: currentConversationId, model, cwd: directory, agent: 'synvox-workspace' });
        rememberSession(result);
        return { text: result.text, lastAssistantMessageId: null };
      } catch (error) { rememberSession(error); throw error; }
    },
    close() {
      if (directory) fs.rmSync(directory, { recursive: true, force: true });
      directory = null;
    },
  };
}
