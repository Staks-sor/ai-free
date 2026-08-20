import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

function read(projectFile) {
  return fs.readFileSync(new URL(`../${projectFile}`, import.meta.url), "utf8");
}

function assertEnvLoadedBeforeDynamicImport(source, importPath) {
  const envCall = source.indexOf("loadDotEnv(");
  const appImport = source.indexOf(`await import(\"${importPath}\")`);

  assert.notEqual(envCall, -1, "entry point must load .env");
  assert.notEqual(appImport, -1, `entry point must dynamically import ${importPath}`);
  assert.ok(envCall < appImport, ".env must load before the provider module graph");
}

describe("environment bootstrap ordering", () => {
  it("loads desktop .env before importing the application", () => {
    assertEnvLoadedBeforeDynamicImport(read("bin/deepseek.mjs"), "../src/cli/run.mjs");
  });

  it("loads VS Code .env before importing the application", () => {
    assertEnvLoadedBeforeDynamicImport(read("plugin-for-vscode/bin/deepseek.mjs"), "../src/cli/run.mjs");
  });

  it("loads API .env before importing the provider handler", () => {
    assertEnvLoadedBeforeDynamicImport(read("api/server.mjs"), "./openai-handler.mjs");
  });
});
