import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatSnapshotForPrompt,
  formatSnapshotForToolLog,
  SNAPSHOT_FORMAT,
} from "../src/browser/snapshot-build.mjs";
import { BROWSER_TOOL_NAMES, getBrowserMcpToolDefinitions } from "../src/browser/service.mjs";
import { isToolAllowed } from "../src/skills/permissions.mjs";

describe("browser service", () => {
  it("formats accessibility snapshot for prompts", () => {
    const block = formatSnapshotForPrompt({
      ok: true,
      format: SNAPSHOT_FORMAT,
      url: "https://google.com",
      title: "Google",
      tree: '- button "Accept all" [e1]',
      refs: [{ ref: "e1", role: "button", name: "Accept all" }],
      text: "Search the web",
    });
    assert.match(block, /accessibility-v2/);
    assert.match(block, /\[e1\]/);
    assert.match(block, /Accept all/);
  });

  it("formats snapshot tool log compactly", () => {
    const log = formatSnapshotForToolLog({
      url: "https://example.com",
      title: "Example",
      refs: [{ ref: "e1" }, { ref: "e2" }],
      tree: "- link \"Home\" [e1]",
      screenshot: { path: "/tmp/x.jpg", bytes: 1234 },
    });
    assert.match(log, /refs: 2/);
    assert.match(log, /screenshot:/);
  });

  it("exposes full browser tool set for MCP", () => {
    assert.ok(BROWSER_TOOL_NAMES.includes("browser_scroll"));
    assert.ok(BROWSER_TOOL_NAMES.includes("browser_switch_tab"));
    assert.ok(BROWSER_TOOL_NAMES.includes("browser_reset"));
    const defs = getBrowserMcpToolDefinitions();
    assert.equal(defs.length, BROWSER_TOOL_NAMES.length);
    assert.equal(defs.find((d) => d.name === "browser_click")?.inputSchema?.properties?.ref?.type, "string");
  });

  it("allows new browser tools in restrictive skills", () => {
    const allowed = ["read_file"];
    assert.equal(isToolAllowed("browser_scroll", allowed), true);
    assert.equal(isToolAllowed("browser_wait", allowed), true);
  });
});
