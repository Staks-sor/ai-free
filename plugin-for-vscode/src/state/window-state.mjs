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
  const legacy1 = getLegacyPerWorkspaceStateFile(workspaceRoot);
  const legacy2 = getLegacyInWorkspaceStateFile(workspaceRoot);

  // Migration: глобального нет → копируем из любой старой версии.
  if (!fs.existsSync(file)) {
    if (fs.existsSync(legacy1)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.copyFileSync(legacy1, file);
    } else if (fs.existsSync(legacy2)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.copyFileSync(legacy2, file);
    }
  }

  for (const candidate of [file, getStateBackupFile(), legacy1, legacy2]) {
    if (!fs.existsSync(candidate)) continue;
    const state = readStateFile(candidate);
    if (state) return state;
  }

  return createEmptyState(workspaceRoot);
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
