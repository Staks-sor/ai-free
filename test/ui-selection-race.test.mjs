import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import vm from "node:vm";
import { renderWindowHtml } from "../src/window-app/ui-html.mjs";

const html = renderWindowHtml({ language: "ru" });
const segment = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const tick = () => new Promise(resolve => setImmediate(resolve));

describe("conversation selection races", () => {
  it("does not let a late PATCH response replace the selected conversation", async () => {
    const handler = segment(html, "async function patchActiveConversation(payload)", "modelPickerEl.addEventListener");
    const context = vm.createContext({ activeConversation: { id: "A" }, selectionGeneration: 0, api: () => new Promise(resolve => { context.resolvePatch = resolve; }), renderConversation() {}, renderList() {} });
    vm.runInContext(handler + "\nglobalThis.patchActiveConversation = patchActiveConversation;", context);
    const patch = context.patchActiveConversation({ model: "new-model" });
    context.selectionGeneration = 1;
    context.activeConversation = { id: "B" };
    context.selectionGeneration = 2;
    context.activeConversation = { id: "A", model: "newer-model" };
    context.resolvePatch({ conversation: { id: "A", model: "new-model" } });
    await patch;
    assert.equal(context.activeConversation.model, "newer-model");
  });

  it("does not commit a stale /api/state response after a later selection load", async () => {
    const handler = segment(html, "async function loadState(nextActiveId", "// Polling для отслеживания");
    const stateResolvers = [];
    const conversationResolvers = new Map();
    const context = vm.createContext({ appState: {}, activeConversation: null, selectionGeneration: 0,
      api: url => url === "/api/state" ? new Promise(resolve => stateResolvers.push(resolve))
        : new Promise(resolve => conversationResolvers.set(url.split("/").at(-1), resolve)),
      renderList() {}, renderConversation(value) { context.renderedId = value.id; }, renderNoConversation() {}, ensurePolling() {}, ensureInstallPolling() {},
      pipelinePanel: { classList: { contains: () => true } }, agentBrowserFrame: { dataset: { loaded: "0" } } });
    vm.runInContext(handler, context);
    const loadA = context.loadState("A"); await tick();
    const loadB = context.loadState("B"); await tick();
    stateResolvers[1]({ workspaceRoot: "B-project", conversations: [{ id: "B" }], activeConversationId: "B", runningTaskIds: [] });
    await tick();
    conversationResolvers.get("B")({ conversation: { id: "B", messages: [] } }); await loadB;
    stateResolvers[0]({ workspaceRoot: "A-project", conversations: [{ id: "A" }], activeConversationId: "A", runningTaskIds: [] });
    await loadA;
    assert.equal(context.appState.workspaceRoot, "B-project");
    assert.deepEqual(context.appState.conversations.map(item => item.id), ["B"]);
    assert.equal(context.renderedId, "B");
  });

  it("does not let a late polling conversation response replace a newly selected chat", async () => {
    const pollCode = segment(html, "async function pollTick()", "function renderList()");
    let resolveConversation;
    const context = vm.createContext({ appState: { conversations: [{ id: "A" }], runningTaskIds: ["A"], activeConversationId: "A" },
      activeConversation: { id: "A" }, selectionGeneration: 0,
      api: async url => url === "/api/state" ? { conversations: [{ id: "A" }, { id: "B" }], runningTaskIds: ["A"], activeConversationId: "A" }
        : await new Promise(resolve => { resolveConversation = resolve; }),
      renderList() {}, renderConversation() {}, updateStopButton() {}, markCompletedChats() {}, setStatus() {}, stopPolling() {} });
    vm.runInContext(pollCode, context);
    const poll = context.pollTick(); await tick();
    context.selectionGeneration++;
    context.activeConversation = { id: "B" };
    resolveConversation({ conversation: { id: "A", messages: [] } });
    await poll;
    assert.equal(context.activeConversation.id, "B");
  });

  it("does not let an external-state refresh overwrite a newly selected chat", async () => {
    const syncCode = segment(html, "function conversationSummaryChanged(", "let installPollTimer");
    let resolveConversation;
    const context = vm.createContext({ appState: { conversations: [{ id: "A", updatedAt: "old" }, { id: "B" }], runningTaskIds: [], activeConversationId: "A" },
      activeConversation: { id: "A" }, selectionGeneration: 0, completedChatIds: new Set(), externalStateRefreshing: false, shutdownStarted: false,
      api: async url => url === "/api/state" ? { conversations: [{ id: "A", updatedAt: "new" }, { id: "B" }], runningTaskIds: [], activeConversationId: "B" }
        : await new Promise(resolve => { resolveConversation = resolve; }),
      renderList() {}, renderNoConversation() {}, renderConversation() {}, updateStopButton() {}, ensurePolling() {} });
    vm.runInContext(syncCode, context);
    const refresh = context.refreshExternalState(); await tick();
    context.selectionGeneration++;
    context.activeConversation = { id: "B" };
    resolveConversation({ conversation: { id: "A", messages: [] } });
    await refresh;
    assert.equal(context.activeConversation.id, "B");
  });

  it("does not let a late install poll replace a newly selected chat", async () => {
    const pollCode = segment(html, "async function installPollTick()", "function formatAgentMetaStatus");
    let resolveConversation;
    const context = vm.createContext({ activeConversation: { id: "A" }, selectionGeneration: 0,
      api: async () => await new Promise(resolve => { resolveConversation = resolve; }), stopInstallPolling() {} });
    vm.runInContext(pollCode, context);
    const poll = context.installPollTick(); await tick();
    context.selectionGeneration++;
    context.activeConversation = { id: "B" };
    resolveConversation({ conversation: { id: "A", pendingInstallRequest: { status: "complete" } } });
    await poll;
    assert.equal(context.activeConversation.id, "B");
  });

  it("does not let an older loadState conversation response replace a later selection", async () => {
    const handler = segment(html, "async function loadState(nextActiveId", "// Polling для отслеживания");
    const resolvers = new Map();
    const rendered = [];
    const context = vm.createContext({ appState: {}, activeConversation: null, selectionGeneration: 0,
      api: async url => url === "/api/state" ? { activeConversationId: null, runningTaskIds: [] }
        : await new Promise(resolve => resolvers.set(url.split("/").at(-1), resolve)),
      renderList() {}, renderConversation(value) { rendered.push(value.id); }, renderNoConversation() {}, ensurePolling() {}, ensureInstallPolling() {},
      pipelinePanel: { classList: { contains: () => true } }, agentBrowserFrame: { dataset: { loaded: "0" } } });
    vm.runInContext(handler, context);
    const loadA = context.loadState("A"); await tick();
    const loadB = context.loadState("B"); await tick();
    resolvers.get("B")({ conversation: { id: "B", messages: [] } }); await loadB;
    resolvers.get("A")({ conversation: { id: "A", messages: [] } }); await loadA;
    assert.equal(context.activeConversation.id, "B");
    assert.deepEqual(rendered, ["B"]);
  });

  it("disables the model picker while the selected conversation has a running task", () => {
    const renderer = segment(html, "function renderConversation(conversation", "function setComposerEnabled");
    assert.match(renderer, /modelPickerEl\.disabled\s*=\s*\(appState\.runningTaskIds\s*\|\|\s*\[\]\)\.includes\(conversation\.id\)/);
  });
});

describe("conversation model PATCH while running", () => {
  it("rejects an actual model change and accepts a same-model no-op", async () => {
    const source = readFileSync(new URL("../src/window-app/server.mjs", import.meta.url), "utf8");
    const route = segment(source, 'if (req.method === "PATCH" && conversationMatch)', "const installMatch");
    const conversation = { id: "A", model: "model-old", interactionMode: "execute", harnessTask: { model: "model-old" } };
    const call = async body => {
      const context = vm.createContext({ req: { method: "PATCH" }, res: {}, conversationMatch: ["", "A"], state: { conversations: [conversation] }, workspaceRoot: "/tmp",
        readJsonBody: async () => body, isRunning: () => true, saveWindowState() {},
        sendJson: (_res, body, status = 200) => ({ body, status }), normalizeRoleId: value => value, normalizePipelineAgents: value => value });
      return vm.runInContext(`(async () => { ${route} })()`, context);
    };
    const changed = await call({ model: "model-new" });
    assert.equal(changed.status, 409);
    assert.equal(conversation.model, "model-old");
    assert.equal(conversation.harnessTask.model, "model-old");
    const unchanged = await call({ model: "model-old" });
    assert.equal(unchanged.status, 200);
    assert.equal(conversation.model, "model-old");
    conversation.interactionMode = "execute";
    const modeChange = await call({ interactionMode: "discuss" });
    assert.equal(modeChange.status, 409);
    assert.equal(conversation.interactionMode, "execute");
  });
});
