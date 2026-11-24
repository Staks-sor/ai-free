import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getChatGPTBrowserIdleCloseDelay } from "../src/providers/chatgpt/browser-proxy.mjs";

describe("ChatGPT long-lived browser session", () => {
  it("keeps the browser alive by default and supports an explicit idle timeout", () => {
    assert.equal(getChatGPTBrowserIdleCloseDelay({}), null);
    assert.equal(getChatGPTBrowserIdleCloseDelay({ CHATGPT_BROWSER_IDLE_MS: "60000" }), 60_000);
    assert.equal(getChatGPTBrowserIdleCloseDelay({ CHATGPT_BROWSER_IDLE_MS: "100" }), 5_000);
  });

  it("uses the persistent in-app session for provider login instead of external Chrome", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../src/window-app/server.mjs", import.meta.url), "utf8"),
    );
    const loginRoute = source.slice(
      source.indexOf("const providerLoginMatch"),
      source.indexOf("providerLoginStates.set", source.indexOf("const providerLoginMatch")),
    );
    assert.match(loginRoute, /await provider\.login\(\{\}\)/);
    assert.doesNotMatch(loginRoute, /forceExternal:\s*true/);
  });


  it("periodically persists refreshed cookies even while cached auth is usable", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../src/providers/chatgpt/browser-proxy.mjs", import.meta.url), "utf8"),
    );
    const pollBody = source.slice(source.indexOf("const poll = async () =>"), source.indexOf("poll();", source.indexOf("const poll = async () =>")));
    assert.match(pollBody, /await tryPersist\(\)\.catch/);
    assert.doesNotMatch(pollBody, /if \(!isChatGPTAuthUsable\(authState\.data\)\)/);
  });

  it("does not block ordinary chat before the first streamed response on an auth sync", async () => {
    const fs = await import("node:fs/promises");
    for (const file of ["../src/window-app/server.mjs", "../plugin-for-vscode/src/window-app/server.mjs"]) {
      const source = await fs.readFile(new URL(file, import.meta.url), "utf8");
      assert.doesNotMatch(source, /await ensureChatGPTSessionReady\(\);\s*const chatGPTClient = await getOrCreateChatGPTClient\(\);\s*const modelInfo = findProviderModel\("chatgpt", conversation\.model\)/);
      const providerRoute = source.slice(source.indexOf('url.pathname === "/api/providers"'), source.indexOf('url.pathname === "/api/model-catalog"'));
      assert.doesNotMatch(providerRoute, /await refreshChatGPTAuthFromOpenBrowser\(\)/);
    }
  });

  it("points a failed login to the current Browser button", async () => {
    const fs = await import("node:fs/promises");
    for (const file of ["../src/providers/chatgpt/browser-proxy.mjs", "../plugin-for-vscode/src/providers/chatgpt/browser-proxy.mjs"]) {
      const source = await fs.readFile(new URL(file, import.meta.url), "utf8");
      const line = source.split("\n").find((value) => value.includes("вход не завершён"));
      assert.match(line, /кнопку «Браузер»/);
      assert.doesNotMatch(line, /🧠/);
    }
  });
});


describe("ChatGPT in-app quick login", () => {
  it("starts the embedded login flow from the provider authorization POST", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../src/window-app/server.mjs", import.meta.url), "utf8"),
    );
    const loginRoute = source.slice(
      source.indexOf("const providerLoginMatch"),
      source.indexOf("// Загрузка файла", source.indexOf("const providerLoginMatch")),
    );
    assert.match(loginRoute, /providerId === "chatgpt"/);
    assert.match(loginRoute, /warmChatGPTInAppBrowser\(\)/);
    assert.match(loginRoute, /embedLogin:\s*embeddedChatGPTLogin/);
  });

  it("keeps the embedded browser visible while starting or resuming login", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../src/window-app/chatgpt-live-panel.mjs", import.meta.url), "utf8"),
    );
    const start = source.indexOf("async function startReliableLogin");
    const end = source.indexOf("async function resetLiveSession", start);
    const body = source.slice(start, end);
    assert.match(body, /restartBrowserPanel\(\)/);
    assert.match(body, /syncSession\(\)/);
    assert.doesNotMatch(body, /live\.removeAttribute\(\"src\"\)/);
    assert.doesNotMatch(body, /api\/providers\/chatgpt\/login/);
  });
});
