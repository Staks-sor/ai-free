import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("plugins codex/claude compatibility", () => {
  let tempRoot;

  before(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-plugins-"));
    process.env.AI_FREE_PLUGINS_DIR = tempRoot;
  });

  after(async () => {
    delete process.env.AI_FREE_PLUGINS_DIR;
    const { clearPluginCache } = await import("../src/plugins/registry.mjs");
    const { clearSkillCache } = await import("../src/skills/registry.mjs");
    clearPluginCache();
    clearSkillCache();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("loads Codex plugin with SKILL.md skills", async () => {
    const { PLUGINS_DIR } = await import("../src/plugins/paths.mjs");
    const pluginRoot = path.join(PLUGINS_DIR, "demo-codex");
    fs.mkdirSync(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
    fs.mkdirSync(path.join(pluginRoot, "skills", "review"), { recursive: true });

    fs.writeFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({
      name: "demo-codex",
      version: "1.0.0",
      description: "Demo Codex plugin",
      skills: "./skills/",
    }));

    fs.writeFileSync(path.join(pluginRoot, "skills", "review", "SKILL.md"), `---
name: review
description: Review code changes and find bugs in pull requests
---
# Review
Check code carefully.
`);

    const { clearPluginCache, loadPlugin } = await import("../src/plugins/registry.mjs");
    clearPluginCache();
    const plugin = loadPlugin(pluginRoot);
    assert.equal(plugin.format, "codex");
    assert.ok(plugin.skills.some((skill) => skill.id === "demo-codex:review"));
  });

  it("loads Claude Code plugin commands and skills", async () => {
    const { PLUGINS_DIR } = await import("../src/plugins/paths.mjs");
    const pluginRoot = path.join(PLUGINS_DIR, "demo-claude");
    fs.mkdirSync(path.join(pluginRoot, ".claude-plugin"), { recursive: true });
    fs.mkdirSync(path.join(pluginRoot, "skills", "lint"), { recursive: true });
    fs.mkdirSync(path.join(pluginRoot, "commands"), { recursive: true });

    fs.writeFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), JSON.stringify({
      name: "demo-claude",
      version: "0.2.0",
      description: "Demo Claude plugin",
      commands: ["./commands"],
    }));

    fs.writeFileSync(path.join(pluginRoot, "skills", "lint", "SKILL.md"), `---
name: lint
description: Run lint checks and fix style issues in the repository
---
Lint the project.
`);

    fs.writeFileSync(path.join(pluginRoot, "commands", "deploy.md"), "# Deploy\nDeploy safely.\n");

    const { clearPluginCache, loadPlugin } = await import("../src/plugins/registry.mjs");
    clearPluginCache();
    const plugin = loadPlugin(pluginRoot);
    assert.equal(plugin.format, "claude");
    assert.ok(plugin.skills.some((skill) => skill.id === "demo-claude:lint"));
    assert.ok(plugin.skills.some((skill) => skill.id === "demo-claude:deploy"));
  });

  it("registry resolves namespaced plugin skills", async () => {
    const { clearPluginCache } = await import("../src/plugins/registry.mjs");
    const { clearSkillCache, loadSkill } = await import("../src/skills/registry.mjs");
    clearPluginCache();
    clearSkillCache();
    const skill = loadSkill("demo-claude:lint");
    assert.match(skill.prompt, /Lint the project/i);
    assert.equal(skill.format, "plugin-skill");
  });
});
