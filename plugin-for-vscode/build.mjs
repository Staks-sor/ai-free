import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const sharedCoreSource = path.resolve(__dirname, "../packages/core");
const sharedCoreTarget = path.join(__dirname, "packages/core");

fs.rmSync(sharedCoreTarget, { recursive: true, force: true });
fs.cpSync(sharedCoreSource, sharedCoreTarget, { recursive: true });

const requiredPaths = [
  "extension.js",
  "node-runtime.js",
  "package.json",
  "bin/deepseek.mjs",
  "src/cli/run.mjs",
  "src/providers/model-catalog.mjs",
  "src/window-app/server.mjs",
  "src/window-app/diagnostics.mjs",
  "src/window-app/ui-html.mjs",
  "api/models.mjs",
  "api/openai-handler.mjs",
  "packages/core/src/index.mjs",
];

let failed = false;
for (const relPath of requiredPaths) {
  const absPath = path.join(__dirname, relPath);
  if (!fs.existsSync(absPath)) {
    console.error(`missing: ${relPath}`);
    failed = true;
  }
}

if (!failed) {
  try {
    await import("./src/window-app/server.mjs");
  } catch (error) {
    console.error(`server import failed: ${error.message}`);
    failed = true;
  }
}

if (failed) {
  console.error("VS Code extension build check failed.");
  process.exit(1);
}

console.log("VS Code extension build check passed.");
console.log("Package with: npm run package");
