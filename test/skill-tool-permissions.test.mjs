import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { assembleAgentContext } from "../src/agent-orchestrator/context-assembler.mjs";

describe("builtin skill tool permissions", () => {
  it("lets the bug-fix skill create and update workspace structure", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bug-fix-tools-"));
    try {
      const context = assembleAgentContext({
        task: "исправь структуру проекта",
        workspaceRoot: workspace,
        autoSkill: true,
        memoryEnabled: false,
      });

      assert.equal(context.skillId, "bug-fix");
      for (const tool of ["list_files", "read_file", "mkdir", "write_file", "append_file", "run_command", "run_shell"]) {
        assert.ok(context.allowedTools.includes(tool), `${tool} must be allowed by bug-fix`);
      }
    } finally {
      try { fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch (err) { if (err.code !== 'EPERM' && err.code !== 'EBUSY') throw err; }
    }
  });
});
