// Общие чаты: ~/.deepseek-cli/state.json.revisions/. Старый state.json
// и per-workspace файлы остаются источниками миграции.

import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createJsonStateWriter } from "./state-writer.mjs";
import { createWindowStateStore, readWindowStateRevision } from "./window-state-store.mjs";

const stores = new WeakMap();
import { AUTH_DIR, STATE_VERSION } from "../config.mjs";

export function getStateFile() {
  return path.join(AUTH_DIR, "state.json");
}

export function getStateBackupFile() {
  return path.join(AUTH_DIR, "state.backup.json");
}

// Старая per-workspace локация — для одноразовой миграции.
export function getLegacyPerWorkspaceStateFile(workspaceRoot) {
  const workspaceKey = Buffer.from(path.resolve(workspaceRoot)).toString("base64url");
  return path.join(AUTH_DIR, "workspaces", workspaceKey, "state.json");
}

// Совсем старая локация — внутри workspace.
export function getLegacyInWorkspaceStateFile(workspaceRoot) {
  return path.join(workspaceRoot, ".deepseek-cli", "state.json");
}

export function loadWindowState(workspaceRoot) {
  const file = getStateFile();
  const legacyFiles = getLegacyStateFiles(workspaceRoot);

  // Migration: глобального нет → копируем из любой старой версии.
  if (!fs.existsSync(file)) {
    const firstLegacy = legacyFiles.find((candidate) => fs.existsSync(candidate));
    if (firstLegacy) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.copyFileSync(firstLegacy, file);
    }
  }

  const primary = readWindowStateRevision(file)?.state || readFirstStateFile([file, getStateBackupFile(), ...legacyFiles]);
  if (primary) {
    const merged = mergeWindowStates(primary, legacyFiles.map(readStateFile).filter(Boolean), workspaceRoot);
    if (merged.conversations.length > primary.conversations.length) {
      saveWindowState(workspaceRoot, merged);
    }
    stores.set(merged, createWindowStateStore(file, normalizeWindowState(readWindowStateRevision(file)?.state || primary, workspaceRoot), {
      normalize: value => normalizeWindowState(value, workspaceRoot), legacyFiles: [getStateBackupFile(), ...legacyFiles],
    }));
    return merged;
  }

  if ([file, getStateBackupFile(), ...legacyFiles].some(candidate => fs.existsSync(candidate))) {
    throw Object.assign(new Error('История чатов повреждена. Восстановите исправную резервную копию; исходные файлы сохранены.'), { code: 'STATE_CORRUPT' });
  }
  const empty = createEmptyState(workspaceRoot);
  stores.set(empty, createWindowStateStore(file, empty, { normalize: value => normalizeWindowState(value, workspaceRoot) }));
  return empty;
}

export function getLegacyStateFiles(workspaceRoot) {
  const direct = [
    getLegacyPerWorkspaceStateFile(workspaceRoot),
    getLegacyInWorkspaceStateFile(workspaceRoot),
  ];
  const workspacesDir = path.join(AUTH_DIR, "workspaces");
  let allWorkspaceStates = [];
  try {
    allWorkspaceStates = fs.readdirSync(workspacesDir)
      .map((name) => path.join(workspacesDir, name, "state.json"))
      .filter((file) => fs.existsSync(file));
  } catch {
    allWorkspaceStates = [];
  }
  return Array.from(new Set([...direct, ...allWorkspaceStates]));
}

function readFirstStateFile(files) {
  for (const candidate of files) {
    if (!fs.existsSync(candidate)) continue;
    const state = readStateFile(candidate);
    if (state) return state;
  }
  return null;
}

export function mergeWindowStates(primary, states, workspaceRoot) {
  const byId = new Map();
  const deletedConversationIds = normalizeDeletedConversationIds([primary, ...states]);
  for (const state of [primary, ...states]) {
    for (const conversation of state.conversations || []) {
      if (deletedConversationIds.includes(String(conversation.id))) continue;
      const existing = byId.get(conversation.id);
      if (!existing || String(conversation.updatedAt || "") > String(existing.updatedAt || "")) {
        byId.set(conversation.id, conversation);
      }
    }
  }
  const conversations = Array.from(byId.values())
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const activeConversationId = conversations.some((item) => item.id === primary.activeConversationId)
    ? primary.activeConversationId
    : conversations[0]?.id || null;
  return normalizeWindowState({
    ...primary,
    workspaceRoot: primary.workspaceRoot || path.resolve(workspaceRoot),
    activeConversationId,
    activeByWorkspace: primary.activeByWorkspace || {},
    deletedConversationIds,
    conversations,
  }, workspaceRoot);
}

function storeFor(workspaceRoot, state) {
  if (!stores.has(state)) {
    const initial = readWindowStateRevision(getStateFile())?.state || readStateFile(getStateFile()) || createEmptyState(workspaceRoot);
    stores.set(state, createWindowStateStore(getStateFile(), normalizeWindowState(initial, workspaceRoot),
      { normalize: value => normalizeWindowState(value, workspaceRoot), legacyFiles: [getStateBackupFile(), ...getLegacyStateFiles(workspaceRoot)] }));
  }
  return stores.get(state);
}

export function saveWindowState(workspaceRoot, state) {
  return storeFor(workspaceRoot, state).commit(normalizeWindowState(state, workspaceRoot));
}

export function createWindowStateWriter(workspaceRoot, state, { onError } = {}) {
  const store = storeFor(workspaceRoot, state);
  const writer = createJsonStateWriter(getStateFile(), {
    prepare: value => normalizeWindowState(value, workspaceRoot),
    write: (_file, value) => store.commitAsync(value), onError,
  });
  let refreshing;
  async function refreshState() {
    await writer.flush();
    const next = await store.refresh(() => normalizeWindowState(state, workspaceRoot));
    if (!next) return;
    const existing = new Map(state.conversations.map(c => [c.id, c]));
    next.conversations = next.conversations.map(value => {
      const current = existing.get(value.id);
      if (!current) return value;
      for (const key of Object.keys(current)) if (!(key in value)) delete current[key];
      for (const [key, nextValue] of Object.entries(value)) {
        if (!isDeepStrictEqual(current[key], nextValue)) current[key] = nextValue;
      }
      return current;
    });
    // Selection belongs to this window, even when another window saves its own.
    next.activeConversationId = next.conversations.some(c => c.id === state.activeConversationId)
      ? state.activeConversationId : null;
    Object.assign(state, next);
  }
  writer.refresh = () => refreshing ||= refreshState().finally(() => { refreshing = null; });
  return writer;
}

export function createEmptyState(workspaceRoot) {
  return {
    version: STATE_VERSION,
    workspaceRoot: path.resolve(workspaceRoot),
    activeConversationId: null,
    activeByWorkspace: {},
    deletedConversationIds: [],
    conversations: [],
  };
}

export function readStateFile(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || !Array.isArray(value.conversations)) return null;
    return normalizeWindowState(value, path.dirname(file));
  } catch {
    return null;
  }
}

export function normalizeWindowState(state, workspaceRoot) {
  const deletedConversationIds = normalizeDeletedConversationIds([state]);
  const deleted = new Set(deletedConversationIds);
  const conversations = Array.isArray(state?.conversations)
    ? state.conversations
        .filter((conversation) => conversation && conversation.id && !deleted.has(String(conversation.id)))
        .map((conversation) => ({ ...conversation, coderMode: conversation.interactionMode !== "discuss" }))
    : [];
  const activeConversationId = conversations.some((item) => item.id === state?.activeConversationId)
    ? state.activeConversationId
    : conversations[0]?.id || null;
  const activeByWorkspace = normalizeActiveByWorkspace(state?.activeByWorkspace, conversations);

  return {
    version: STATE_VERSION,
    workspaceRoot: state?.workspaceRoot || path.resolve(workspaceRoot),
    activeConversationId,
    activeByWorkspace,
    deletedConversationIds,
    conversations,
    pipeline: normalizePipeline(state?.pipeline, conversations),
  };
}

function normalizeDeletedConversationIds(states) {
  const ids = [];
  const seen = new Set();
  for (const state of states || []) {
    if (!Array.isArray(state?.deletedConversationIds)) continue;
    for (const id of state.deletedConversationIds) {
      const normalized = String(id || "").trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      ids.push(normalized);
    }
  }
  return ids.slice(-5000);
}

function normalizeActiveByWorkspace(activeByWorkspace, conversations) {
  if (!activeByWorkspace || typeof activeByWorkspace !== "object") return {};
  const ids = new Set(conversations.map((conversation) => conversation.id));
  return Object.fromEntries(
    Object.entries(activeByWorkspace)
      .map(([workspace, conversationId]) => [String(workspace), String(conversationId || "")])
      .filter(([workspace, conversationId]) => workspace && ids.has(conversationId)),
  );
}

function normalizePipeline(pipeline, conversations) {
  const ids = new Set(conversations.map((conversation) => conversation.id));
  const edges = Array.isArray(pipeline?.edges)
    ? pipeline.edges
        .map((edge) => ({
          from: String(edge?.from || ""),
          to: String(edge?.to || ""),
        }))
        .filter((edge) => edge.from && edge.to && edge.from !== edge.to && ids.has(edge.from) && ids.has(edge.to))
    : [];
  const deduped = [];
  const seen = new Set();
  for (const edge of edges) {
    const key = `${edge.from}->${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(edge);
  }
  const requestedMain = String(pipeline?.mainAgentId || "");
  return {
    edges: deduped,
    mainAgentId: ids.has(requestedMain) ? requestedMain : null,
    updatedAt: pipeline?.updatedAt || null,
  };
}
