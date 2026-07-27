import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { AI_FREE_VERSION, SETTINGS_FILE } from "../config.mjs";
import { loadSettings } from "../state/settings.mjs";
import { getStateFile } from "../state/window-state.mjs";
import { listProviders } from "../providers/registry.mjs";
import { probeRuntimeCommand } from "../updater.mjs";

const execFileAsync = promisify(execFile);
const COMMANDS = ["node", "npm", "git", "python3", "python", "pio", "arduino-cli", "esptool.py"];

export async function collectDiagnostics({ workspaceRoot, state, runningTaskIds = [] } = {}) {
  const settings = loadSettings();
  const [commands, git] = await Promise.all([
    Promise.all(COMMANDS.map(checkCommand)),
    collectGitInfo(workspaceRoot),
  ]);
  const providers = listProviders().map((provider) => {
    const authPath = provider.authFile || "";
    const hasAuth = Boolean(provider.hasAuth?.());
    return {
      id: provider.id,
      name: provider.name,
      status: hasAuth ? "ready" : "needs_login",
      hasAuth,
      authFile: authPath,
      authFileExists: authPath ? fs.existsSync(authPath) : false,
      authFileLabel: authPath ? redactHome(authPath) : "",
      description: provider.description || "",
    };
  });
  const conversations = Array.isArray(state?.conversations) ? state.conversations : [];
  const activeConversation = conversations.find((item) => item.id === state?.activeConversationId) || null;
  const summary = {
    generatedAt: new Date().toISOString(),
    app: {
      name: "AI Free",
      version: AI_FREE_VERSION,
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      release: os.release(),
    },
    workspace: {
      root: workspaceRoot ? path.resolve(workspaceRoot) : "",
      exists: workspaceRoot ? fs.existsSync(path.resolve(workspaceRoot)) : false,
    },
    state: {
      stateFile: getStateFile(),
      stateFileExists: fs.existsSync(getStateFile()),
      settingsFile: SETTINGS_FILE,
      settingsFileExists: fs.existsSync(SETTINGS_FILE),
      conversations: conversations.length,
      activeConversationId: state?.activeConversationId || "",
      activeProvider: activeConversation?.provider || "",
      activeModel: activeConversation?.model || "",
      runningTaskIds,
    },
    providers,
    commands,
    git,
    telegram: {
      enabled: settings.telegram?.enabled === true,
      hasBotToken: Boolean(settings.telegram?.botToken),
      hasChatId: Boolean(settings.telegram?.chatId),
    },
  };
  return {
    ...summary,
    report: formatDiagnosticReport(summary),
  };
}

export function formatDiagnosticReport(data) {
  const lines = [];
  lines.push("AI Free diagnostic report");
  lines.push(`Generated: ${data.generatedAt}`);
  lines.push("");
  lines.push("App");
  lines.push(`- Version: ${data.app.version}`);
  lines.push(`- Node: ${data.app.node}`);
  lines.push(`- Platform: ${data.app.platform}`);
  lines.push(`- OS release: ${data.app.release}`);
  lines.push("");
  lines.push("Workspace");
  lines.push(`- Root: ${redactHome(data.workspace.root)}`);
  lines.push(`- Exists: ${yesNo(data.workspace.exists)}`);
  lines.push("");
  lines.push("State");
  lines.push(`- State file: ${redactHome(data.state.stateFile)} (${existsLabel(data.state.stateFileExists)})`);
  lines.push(`- Settings file: ${redactHome(data.state.settingsFile)} (${existsLabel(data.state.settingsFileExists)})`);
  lines.push(`- Conversations: ${data.state.conversations}`);
  lines.push(`- Active provider/model: ${data.state.activeProvider || "-"} / ${data.state.activeModel || "-"}`);
  lines.push(`- Running tasks: ${data.state.runningTaskIds.length ? data.state.runningTaskIds.join(", ") : "-"}`);
  lines.push("");
  lines.push("Providers");
  for (const provider of data.providers) {
    lines.push(`- ${provider.name}: ${provider.status}${provider.authFileLabel ? ` (${provider.authFileLabel})` : ""}`);
  }
  lines.push("");
  lines.push("Commands");
  for (const command of data.commands) {
    lines.push(`- ${command.command}: ${command.ok ? command.version || "ok" : command.error}`);
  }
  lines.push("");
  lines.push("Git");
  lines.push(`- Available: ${yesNo(data.git.available)}`);
  lines.push(`- Branch: ${data.git.branch || "-"}`);
  lines.push(`- Commit: ${data.git.commit || "-"}`);
  lines.push(`- Dirty: ${yesNo(data.git.dirty)}`);
  lines.push("");
  lines.push("Telegram");
  lines.push(`- Enabled: ${yesNo(data.telegram.enabled)}`);
  lines.push(`- Bot token configured: ${yesNo(data.telegram.hasBotToken)}`);
  lines.push(`- Chat ID configured: ${yesNo(data.telegram.hasChatId)}`);
  return lines.join("\n");
}

async function checkCommand(command) {
  return probeRuntimeCommand(command);
}

async function collectGitInfo(workspaceRoot) {
  const cwd = path.resolve(workspaceRoot || process.cwd());
  try {
    const [branch, commit, status] = await Promise.all([
      runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd).catch(() => ""),
      runGit(["rev-parse", "--short", "HEAD"], cwd).catch(() => ""),
      runGit(["status", "--porcelain"], cwd).catch(() => ""),
    ]);
    return {
      available: true,
      branch,
      commit,
      dirty: Boolean(status),
    };
  } catch (error) {
    return {
      available: false,
      branch: "",
      commit: "",
      dirty: false,
      error: error.message,
    };
  }
}

async function runGit(args, cwd) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    timeout: 8000,
    maxBuffer: 300_000,
  });
  return String(stdout || "").trim();
}

function redactHome(value) {
  const text = String(value || "");
  const home = os.homedir();
  return home && text.startsWith(home) ? `~${text.slice(home.length)}` : text;
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function existsLabel(value) {
  return value ? "exists" : "missing";
}
