import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { normalizeWindowState } from '../src/state/window-state.mjs';
import { conversationList } from '../src/state/conversations.mjs';
import { buildAgentTaskOptions } from '../src/window-app/agent-task.mjs';
import { renderWindowHtml } from '../src/window-app/ui-html.mjs';
import { readFileSync } from 'node:fs';

const source = new URL('../src/window-app/server.mjs', import.meta.url);
const segment = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));

test('access mode defaults legacy chats to project and passes the persisted mode into provider task options', () => {
  const state = normalizeWindowState({ conversations: [
    { id: 'old', provider: 'qwen', workspace: '/project', messages: [] },
    { id: 'computer', provider: 'deepseek', workspace: '/project', accessMode: 'computer', messages: [] },
  ] }, '/project');
  assert.equal(conversationList(state)[0].accessMode, 'project');
  assert.equal(conversationList(state)[1].accessMode, 'computer');
  assert.equal(buildAgentTaskOptions(state.conversations[0], {}, { agentInput: {} }).accessMode, 'project');
  assert.equal(buildAgentTaskOptions(state.conversations[1], {}, { agentInput: {} }).accessMode, 'computer');
});

test('conversation PATCH validates access mode and blocks changing it while the task is running', async () => {
  const text = readFileSync(source, 'utf8');
  const route = segment(text, 'if (req.method === "PATCH" && conversationMatch)', 'const installMatch');
  const conversation = { id: 'A', accessMode: 'project', interactionMode: 'execute' };
  const call = async body => {
    const context = vm.createContext({ req: { method: 'PATCH' }, res: {}, conversationMatch: ['', 'A'],
      state: { conversations: [conversation] }, workspaceRoot: '/tmp', readJsonBody: async () => body,
      isRunning: () => false, qwenActiveRequests: new Map(), saveWindowState() {}, sendJson: (_res, body, status = 200) => ({ body, status }),
      normalizeRoleId: value => value, normalizePipelineAgents: value => value });
    return vm.runInContext(`(async () => { ${route} })()`, context);
  };
  const runningCall = async body => {
    const context = vm.createContext({ req: { method: 'PATCH' }, res: {}, conversationMatch: ['', 'A'],
      state: { conversations: [conversation] }, workspaceRoot: '/tmp', readJsonBody: async () => body,
      isRunning: () => true, qwenActiveRequests: new Map(), saveWindowState() {}, sendJson: (_res, body, status = 200) => ({ body, status }),
      normalizeRoleId: value => value, normalizePipelineAgents: value => value });
    return vm.runInContext(`(async () => { ${route} })()`, context);
  };
  assert.equal((await runningCall({ accessMode: 'computer' })).status, 409);
  assert.equal(conversation.accessMode, 'project');
  assert.equal((await call({ accessMode: 'computer' })).status, 200);
  assert.equal(conversation.accessMode, 'computer');
  await call({ accessMode: 'anything-else' });
  assert.equal(conversation.accessMode, 'computer');
  const createRoute = segment(text, 'const conversation = {', 'state.conversations.unshift(conversation)');
  assert.match(createRoute, /accessMode:\s*"project"/);
});

test('composer exposes Project and Computer modes and reflects the active chat mode', () => {
  const html = renderWindowHtml({ language: 'ru' });
  assert.match(html, /id="accessModePicker"/);
  assert.match(html, /Проект/);
  assert.match(html, /Компьютер/);
  assert.match(html, /вне проекта|outside the project/i);
  assert.match(html, /с учётом разрешений операционной системы|subject to operating system permissions/i);
  const script = readFileSync(new URL('../src/window-app/workspace-ui-script.mjs', import.meta.url), 'utf8');
  assert.match(script, /accessModePicker/);
  assert.match(script, /patchConversation\(\{accessMode:/);
});
