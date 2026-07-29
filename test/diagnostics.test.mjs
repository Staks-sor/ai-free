import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import os from "node:os";
import path from "node:path";

import { formatDiagnosticReport } from "../src/window-app/diagnostics.mjs";

describe("diagnostics report", () => {
  it("formats a redacted support report", () => {
    const homePath = path.join(os.homedir(), "project");
    const report = formatDiagnosticReport({
      generatedAt: "2026-01-01T00:00:00.000Z",
      app: { version: "0.0.0", node: "v20.0.0", platform: "darwin arm64", release: "1" },
      workspace: { root: homePath, exists: true },
      state: {
        stateFile: path.join(os.homedir(), ".deepseek-cli", "state.json"),
        stateFileExists: true,
        settingsFile: path.join(os.homedir(), ".deepseek-cli", "settings.json"),
        settingsFileExists: true,
        conversations: 2,
        activeProvider: "qwen",
        activeModel: "qwen3.7-plus",
        runningTaskIds: [],
      },
      logging: {
        file: path.join(os.homedir(), ".ai-free", "logs", "ai-free.log"),
        exists: true,
      },
      providers: [{ name: "Qwen", status: "ready", authFileLabel: "~/.qwen-cli/auth.json" }],
      commands: [{ command: "node", ok: true, version: "v20.0.0" }],
      git: { available: true, branch: "main", commit: "abc123", dirty: false },
      telegram: { enabled: true, hasBotToken: true, hasChatId: false },
    });

    assert.match(report, /AI Free diagnostic report/);
    assert.match(report, /Workspace/);
    assert.match(report, /Root: ~\/project/);
    assert.doesNotMatch(report, new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(report, /Qwen: ready/);
    assert.match(report, /Log file: ~\/\.ai-free\/logs\/ai-free\.log \(exists\)/);
  });
});
