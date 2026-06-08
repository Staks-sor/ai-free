// Глобальный state.json: список всех чатов из всех проектов.
// Лежит в ~/.deepseek-cli/state.json. На старте — одноразовая миграция из
// старых per-workspace локаций.

import fs from "node:fs";
import path from "node:path";
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

  const primary = readFirstStateFile([file, getStateBackupFile(), ...legacyFiles]);
  if (primary) {
    const merged = mergeWindowStates(primary, legacyFiles.map(readStateFile).filter(Boolean), workspaceRoot);
    if (merged.conversations.length > primary.conversations.length) {
      saveWindowState(workspaceRoot, merged);
    }
    return merged;
  }

  return createEmptyState(workspaceRoot);
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
  for (const state of [primary, ...states]) {
    for (const conversation of state.conversations || []) {
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
    conversations,
  }, workspaceRoot);
}

export function saveWindowState(workspaceRoot, state) {
  const file = getStateFile();
  const backupFile = getStateBackupFile();
  const normalized = normalizeWindowState(state, workspaceRoot);

  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, backupFile);
  fs.writeFileSync(file, JSON.stringify(normalized, null, 2), "utf8");
}

export function createEmptyState(workspaceRoot) {
  return {
    version: STATE_VERSION,
    workspaceRoot: path.resolve(workspaceRoot),
    activeConversationId: null,
    activeByWorkspace: {},
    conversations: [],
  };
}

export function readStateFile(file) {
  try {
    return normalizeWindowState(JSON.parse(fs.readFileSync(file, "utf8")), path.dirname(file));
  } catch {
    return null;
  }
}

export function normalizeWindowState(state, workspaceRoot) {
  const conversations = Array.isArray(state?.conversations)
    ? state.conversations.filter((conversation) => conversation && conversation.id)
    : [];
  const activeConversationId = conversations.some((item) => item.id === state?.activeConversationId)
    ? state.activeConversationId
    : conversations[0]?.id || null;

  return {
    version: STATE_VERSION,
    workspaceRoot: state?.workspaceRoot || path.resolve(workspaceRoot),
    activeConversationId,
    activeByWorkspace: state?.activeByWorkspace && typeof state.activeByWorkspace === "object"
      ? state.activeByWorkspace
      : {},
    conversations,
  };
}
