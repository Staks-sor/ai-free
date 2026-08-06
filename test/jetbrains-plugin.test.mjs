import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(root, "plugin-for-jetbrains");

function read(relativePath) {
  return fs.readFileSync(path.join(pluginRoot, relativePath), "utf8");
}

test("JetBrains plugin declares a PyCharm-compatible AI Free tool window", () => {
  const manifest = read("src/main/resources/META-INF/plugin.xml");

  assert.match(manifest, /<id>ru\.stas-sor\.ai-free<\/id>/);
  assert.match(manifest, /<depends>com\.intellij\.modules\.platform<\/depends>/);
  assert.match(manifest, /<toolWindow[^>]+id="AI Free"/);
  assert.match(manifest, /factoryClass="ru\.stassor\.aifree\.ui\.AiFreeToolWindowFactory"/);
});

test("JetBrains plugin embeds the shared UI and handles missing JCEF", () => {
  const source = read("src/main/java/ru/stassor/aifree/ui/AiFreeToolWindowFactory.java");

  assert.match(source, /JBCefApp\.isSupported\(\)/);
  assert.match(source, /JBCefBrowser/);
  assert.match(source, /createUnsupportedBrowserPanel/);
  assert.doesNotMatch(source, /isApplicable|isDoNotActivateOnStart|getAnchor|getIcon|manage\(/);
});

test("backend launcher is loopback-only, workspace-aware and cross-platform", () => {
  const source = read("src/main/kotlin/ru/stassor/aifree/runtime/AiFreeBackendService.kt");
  const nodeResolver = read("src/main/kotlin/ru/stassor/aifree/runtime/NodeRuntimeResolver.kt");

  assert.match(source, /ServerSocket\(0, 0, InetAddress\.getLoopbackAddress\(\)\)/);
  assert.match(source, /"--no-window"/);
  assert.match(source, /"--workspace"/);
  assert.match(source, /AI_FREE_JETBRAINS/);
  assert.match(nodeResolver, /AI_FREE_NODE_PATH/);
  assert.match(nodeResolver, /ProgramFiles/);
  assert.match(nodeResolver, /node\.exe/);
});

test("backend locates its bundled runtime without IntelliJ internal plugin APIs", () => {
  const source = read("src/main/kotlin/ru/stassor/aifree/runtime/AiFreeBackendService.kt");

  assert.doesNotMatch(source, /PluginManagerCore|PluginId/);
  assert.match(source, /PluginRuntimeLocator\.resolve/);
});

test("Gradle package syncs the shared AI Free runtime without generated artifacts", () => {
  const build = read("build.gradle.kts");

  assert.match(build, /val syncAiFreeRuntime/);
  assert.match(build, /from\(rootProject\.projectDir\.resolve\("\.\."\)\)/);
  assert.match(build, /exclude\("plugin-for-vscode\/\*\*"\)/);
  assert.match(build, /exclude\("test\/\*\*"\)/);
  assert.match(build, /exclude\("node_modules\/\.cache\/\*\*"\)/);
  assert.match(build, /dependsOn\(syncAiFreeRuntime\)/);
  assert.match(build, /recommended\(\)/);
  assert.doesNotMatch(build, /ides\s*\{\s*current\(\)/);
});
