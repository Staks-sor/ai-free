import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function check(label, fn) {
  try {
    fn();
    console.log(`✓ ${label}`);
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
    console.error(`✗ ${label}: ${error.message}`);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function json(relativePath) {
  return JSON.parse(read(relativePath));
}

function assertSemver(version, product) {
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, `${product} version is not valid semver`);
}

check("desktop, VS Code and JetBrains package versions are synchronized", () => {
  const products = [
    ["desktop", "package.json", "package-lock.json"],
    ["VS Code", "plugin-for-vscode/package.json", "plugin-for-vscode/package-lock.json"],
  ];

  for (const [name, packagePath, lockPath] of products) {
    const pkg = json(packagePath);
    const lock = json(lockPath);
    assertSemver(pkg.version, name);
    assert.equal(lock.name, pkg.name, `${name} lockfile name differs from package.json`);
    assert.equal(lock.version, pkg.version, `${name} lockfile version differs from package.json`);
    assert.equal(lock.packages?.[""]?.version, pkg.version, `${name} lockfile root version differs from package.json`);
  }

  assert.equal(
    json("package.json").version,
    json("plugin-for-vscode/package.json").version,
    "desktop and VS Code versions differ",
  );

  const jetbrainsVersion = read("plugin-for-jetbrains/gradle.properties")
    .match(/^version=(.+)$/m)?.[1]?.trim();
  assertSemver(jetbrainsVersion || "", "JetBrains");
  assert.equal(json("package.json").version, jetbrainsVersion, "desktop and JetBrains versions differ");
});

check("desktop and VS Code model catalogs are synchronized", () => {
  assert.equal(
    read("plugin-for-vscode/src/providers/model-catalog.mjs"),
    read("src/providers/model-catalog.mjs"),
  );
});

check("desktop and VS Code diagnostics are synchronized", () => {
  assert.equal(
    read("plugin-for-vscode/src/window-app/diagnostics.mjs"),
    read("src/window-app/diagnostics.mjs"),
  );
});

check("desktop and VS Code Camoufox runtimes are synchronized", () => {
  assert.equal(
    read("plugin-for-vscode/src/browser/camoufox-runtime.mjs"),
    read("src/browser/camoufox-runtime.mjs"),
  );
  assert.equal(
    read("plugin-for-vscode/src/window-app/in-app-browser.mjs"),
    read("src/window-app/in-app-browser.mjs"),
  );
});

check("desktop and VS Code ChatGPT transports are synchronized", () => {
  for (const relativePath of [
    "providers/chatgpt/browser-proxy.mjs",
    "providers/chatgpt/client.mjs",
    "providers/chatgpt/agent-adapter.mjs",
    "providers/chatgpt/cloudflare-challenge.mjs",
  ]) {
    assert.equal(
      read(`plugin-for-vscode/src/${relativePath}`),
      read(`src/${relativePath}`),
      `${relativePath} differs`,
    );
  }
});

check("desktop and VS Code Qwen transports are synchronized", () => {
  for (const relativePath of [
    "providers/qwen/client.mjs",
    "providers/qwen/browser-proxy.mjs",
    "providers/qwen/stream-timeouts.mjs",
  ]) {
    assert.equal(
      read(`plugin-for-vscode/src/${relativePath}`),
      read(`src/${relativePath}`),
      `${relativePath} differs`,
    );
  }
});

check("desktop and VS Code Qwen model sync is synchronized", () => {
  assert.equal(
    read("plugin-for-vscode/src/providers/qwen/model-sync.mjs"),
    read("src/providers/qwen/model-sync.mjs"),
  );
});

check("desktop and VS Code Qwen agent adapters are synchronized", () => {
  assert.equal(
    read("plugin-for-vscode/src/providers/qwen/agent-adapter.mjs"),
    read("src/providers/qwen/agent-adapter.mjs"),
  );
});

check("desktop and VS Code code-agent recovery prompts are synchronized", () => {
  assert.equal(
    read("plugin-for-vscode/src/code-agent/loop-helpers.mjs"),
    read("src/code-agent/loop-helpers.mjs"),
  );
});

check("desktop and VS Code code-agent loops are synchronized", () => {
  assert.equal(
    read("plugin-for-vscode/src/code-agent/run.mjs"),
    read("src/code-agent/run.mjs"),
  );
});

check("desktop and VS Code STT and memory runtimes are synchronized", () => {
  for (const relativePath of [
    "src/stt/service.mjs",
    "src/memory/db.mjs",
    "src/memory/graph/store.mjs",
    "src/memory/store.mjs",
  ]) {
    assert.equal(
      read(`plugin-for-vscode/${relativePath}`),
      read(relativePath),
      `${relativePath} differs between desktop and VS Code`,
    );
  }
});

check("Git does not track generated VSIX or operating-system metadata", () => {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || "git ls-files failed");
  const forbidden = result.stdout
    .split("\0")
    .filter(Boolean)
    .filter((file) => file.endsWith(".vsix") || path.basename(file) === ".DS_Store");
  assert.deepEqual(forbidden, [], `tracked generated files: ${forbidden.join(", ")}`);
});

if (failures.length > 0) {
  console.error(`\nCI invariant checks failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("\nAll CI invariant checks passed.");
