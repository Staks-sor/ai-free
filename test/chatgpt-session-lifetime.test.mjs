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

  it("checkpoints embedded browser storage while the app remains open", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../src/browser/camoufox-runtime.mjs", import.meta.url), "utf8"),
    );
    assert.match(source, /setInterval\(\(\) => \{/);
    assert.match(source, /context\.storageState\(\{ path: CAMOUFOX_STORAGE_STATE \}\)/);
    assert.match(source, /30_000/);
  });

  it("periodically persists refreshed cookies even while cached auth is usable", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../src/providers/chatgpt/browser-proxy.mjs", import.meta.url), "utf8"),
    );
    const pollBody = source.slice(source.indexOf("const poll = async () =>"), source.indexOf("poll();", source.indexOf("const poll = async () =>")));
    assert.match(pollBody, /await tryPersist\(\)\.catch/);
    assert.doesNotMatch(pollBody, /if \(!isChatGPTAuthUsable\(authState\.data\)\)/);
  });
});


describe("ChatGPT in-app quick login", () => {
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
