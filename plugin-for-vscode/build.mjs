import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const requiredPaths = [
  "extension.js",
  "package.json",
  "bin/deepseek.mjs",
  "src/cli/run.mjs",
  "src/providers/model-catalog.mjs",
  "src/window-app/server.mjs",
  "src/window-app/ui-html.mjs",
  "api/models.mjs",
  "api/openai-handler.mjs",
];

let failed = false;
for (const relPath of requiredPaths) {
  const absPath = path.join(__dirname, relPath);
  if (!fs.existsSync(absPath)) {
    console.error(`missing: ${relPath}`);
    failed = true;
  }
}

if (failed) {
  console.error("VS Code extension build check failed.");
  process.exit(1);
}

console.log("VS Code extension build check passed.");
console.log("Package with: npm run package");
