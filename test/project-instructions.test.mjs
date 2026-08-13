import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { assembleAgentContext } from "../src/agent-orchestrator/context-assembler.mjs";
import { loadProjectInstructions } from "../src/agent-orchestrator/project-instructions.mjs";
import { createCodeSystemPrompt } from "../src/code-agent/prompt.mjs";
import { createNativeCodeSystemPrompt } from "../src/code-agent/native-tools.mjs";

const tempDirectories = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch (err) { if (err.code !== 'EPERM' && err.code !== 'EBUSY') throw err; }
  }
});

describe("project AGENTS.md instructions", () => {
  it("loads root and nested instructions in scope order and ignores dependencies", () => {
    const root = makeWorkspace();
    write(root, "AGENTS.md", "Use ESM.");
    write(root, "src/AGENTS.md", "Use node:test in src.");
    write(root, "src/api/AGENTS.md", "Validate API input.");
    write(root, "node_modules/pkg/AGENTS.md", "Ignore me.");

    const result = loadProjectInstructions(root);

    assert.deepEqual(result.files.map((file) => file.path), [
      "AGENTS.md",
      "src/AGENTS.md",
      "src/api/AGENTS.md",
    ]);
    assert.equal(result.files[0].scope, "workspace root");
    assert.equal(result.files[1].scope, "src/**");
    assert.match(result.context, /Use ESM/);
    assert.doesNotMatch(result.context, /Ignore me/);
  });

  it("injects current project instructions into native and text code agents", () => {
    const root = makeWorkspace();
    write(root, "AGENTS.md", "Always run the focused tests.");
    const context = assembleAgentContext({ task: "fix it", workspaceRoot: root, memoryEnabled: false });

    assert.equal(context.projectInstructionsCount, 1);
    assert.match(context.projectInstructionsContext, /Always run the focused tests/);

    const textPrompt = createCodeSystemPrompt(root, "fix it", "", {
      projectInstructionsContext: context.projectInstructionsContext,
    });
    const nativePrompt = createNativeCodeSystemPrompt(root, {
      projectInstructionsContext: context.projectInstructionsContext,
    });
    assert.match(textPrompt, /PROJECT INSTRUCTIONS \(AGENTS\.md\)/);
    assert.match(textPrompt, /Always run the focused tests/);
    assert.match(nativePrompt, /Project instructions \(AGENTS\.md/);
    assert.match(nativePrompt, /Always run the focused tests/);
  });
});

function makeWorkspace() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-agents-"));
  tempDirectories.push(directory);
  return directory;
}

function write(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}
