// Тесты state-логики: settings round-trip, conversations helpers, window-state нормализация.

import { afterEach, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  conversationList,
  makeConversationTitle,
  shouldAutoTitle,
} from "../src/state/conversations.mjs";

describe("makeConversationTitle", () => {
  it("uses first prompt as title", () => {
    assert.equal(makeConversationTitle("Привет, как дела?"), "Привет, как дела");
  });

  it("strips /code prefix", () => {
    assert.equal(makeConversationTitle("/code создай файл x"), "создай файл x");
  });

  it("collapses whitespace", () => {
    assert.equal(makeConversationTitle("a   b    c"), "a b c");
  });

  it("returns 'New chat' for empty/whitespace", () => {
    assert.equal(makeConversationTitle(""), "New chat");
    assert.equal(makeConversationTitle("   "), "New chat");
    assert.equal(makeConversationTitle(null), "New chat");
  });

  it("truncates to 64 chars with ellipsis", () => {
    const long = "слово ".repeat(50);
    const result = makeConversationTitle(long);
    assert.ok(result.endsWith("..."));
    assert.ok(result.length <= 64 + 3);
  });

  it("doesnt add ellipsis if fits exactly", () => {
    const short = "короткий";
    assert.equal(makeConversationTitle(short), "короткий");
  });
});

describe("shouldAutoTitle", () => {
  it("returns true for default New chat title", () => {
    assert.equal(shouldAutoTitle({ title: "New chat" }), true);
    assert.equal(shouldAutoTitle({ title: "" }), true);
    assert.equal(shouldAutoTitle({}), true);
  });

  it("respects explicit autoTitle=false", () => {
    assert.equal(shouldAutoTitle({ title: "New chat", autoTitle: false }), false);
  });

  it("returns false for user-set title", () => {
    assert.equal(shouldAutoTitle({ title: "My custom name" }), false);
  });
});

describe("conversationList", () => {
  it("maps conversations to summary objects", () => {
    const state = {
      conversations: [
        {
          id: "a",
          title: "T1",
          workspace: "/tmp/p1",
          updatedAt: "2026-01-01T00:00:00Z",
          messages: [{ role: "user", content: "hi" }],
        },
      ],
    };
    const list = conversationList(state);
    assert.deepEqual(list, [
      {
        id: "a",
        title: "T1",
        workspace: "/tmp/p1",
        mode: "fast",
        provider: "deepseek",
        model: "",
        roleId: "assistant",
        pipelineMode: false,
        coderMode: false,
        hardwareMode: false,
        updatedAt: "2026-01-01T00:00:00Z",
        messageCount: 1,
      },
    ]);
  });

  it("preserves explicit mode field if set", () => {
    const state = {
      conversations: [
        {
          id: "b",
          title: "T2",
          workspace: "/tmp/p2",
          mode: "expert",
          updatedAt: "2026-01-02T00:00:00Z",
          messages: [],
        },
      ],
    };
    const list = conversationList(state);
    assert.equal(list[0].mode, "expert");
  });

  it("counts messages correctly", () => {
    const state = {
      conversations: [
        { id: "x", messages: [1, 2, 3, 4] },
        { id: "y", messages: [] },
      ],
    };
    const list = conversationList(state);
    assert.equal(list[0].messageCount, 4);
    assert.equal(list[1].messageCount, 0);
  });
});

// --- Settings round-trip с временным AUTH_DIR. ---
// Меняем переменную окружения до импорта модуля? Нельзя — config.mjs уже загружен.
// Поэтому проверяем только loadSettings() поведение fallback, плюс тестируем
// напрямую COMMAND_CATALOG целостность.

import { COMMAND_CATALOG, loadSettings } from "../src/state/settings.mjs";
import { getProviderIds } from "../src/providers/model-catalog.mjs";
import { mergeWindowStates, normalizeWindowState } from "../src/state/window-state.mjs";

describe("COMMAND_CATALOG integrity", () => {
  it("has at least the legacy 7 base commands enabled by default", () => {
    const expected = ["node", "npm", "python3", "python", "ls", "cat", "pwd"];
    for (const name of expected) {
      assert.ok(COMMAND_CATALOG[name], `Missing command: ${name}`);
      assert.equal(COMMAND_CATALOG[name].enabledByDefault, true, `${name} should be on by default`);
    }
  });

  it("has 'risk' field on every entry, one of low/medium/high", () => {
    for (const [name, meta] of Object.entries(COMMAND_CATALOG)) {
      assert.ok(["low", "medium", "high"].includes(meta.risk), `${name}: bad risk ${meta.risk}`);
    }
  });

  it("has description on every entry", () => {
    for (const [name, meta] of Object.entries(COMMAND_CATALOG)) {
      assert.ok(meta.description && meta.description.length > 0, `${name}: missing description`);
    }
  });

  it("dangerous commands have validateArgs hook", () => {
    assert.ok(typeof COMMAND_CATALOG.rm.validateArgs === "function");
    assert.ok(typeof COMMAND_CATALOG.rmdir.validateArgs === "function");
    assert.ok(typeof COMMAND_CATALOG.git.validateArgs === "function");
    assert.ok(typeof COMMAND_CATALOG.find.validateArgs === "function");
    assert.ok(typeof COMMAND_CATALOG.chmod.validateArgs === "function");
  });
});

describe("loadSettings fallback", () => {
  it("returns object with allowedCommands array when no settings file exists", () => {
    // Не пишем settings.json. loadSettings вернёт default из enabledByDefault.
    const result = loadSettings();
    assert.ok(Array.isArray(result.allowedCommands));
    assert.ok(result.allowedCommands.length > 0);
    // Должны быть base-команды.
    assert.ok(result.allowedCommands.includes("node"));
    for (const providerId of getProviderIds()) {
      assert.equal(typeof result.openAICompat.apiKeys[providerId], "string");
    }
    assert.equal(result.commandPermissions.allowPythonModuleAndEval, false);
  });
});

describe("mergeWindowStates", () => {
  it("merges legacy workspace conversations into the primary global state", () => {
    const primary = {
      version: 2,
      workspaceRoot: "/tmp/main",
      activeConversationId: "a",
      conversations: [
        { id: "a", title: "main", updatedAt: "2026-01-02T00:00:00Z", messages: [] },
      ],
    };
    const legacy = {
      version: 2,
      workspaceRoot: "/tmp/legacy",
      activeConversationId: "b",
      conversations: [
        { id: "b", title: "legacy", updatedAt: "2026-01-01T00:00:00Z", messages: [] },
      ],
    };
    const merged = mergeWindowStates(primary, [legacy], "/tmp/main");
    assert.equal(merged.conversations.length, 2);
    assert.deepEqual(merged.conversations.map((item) => item.id), ["a", "b"]);
    assert.equal(merged.activeConversationId, "a");
  });

  it("does not resurrect conversations deleted from the primary global state", () => {
    const primary = {
      version: 2,
      workspaceRoot: "/tmp/main",
      activeConversationId: null,
      deletedConversationIds: ["old"],
      conversations: [],
    };
    const legacy = {
      version: 2,
      workspaceRoot: "/tmp/legacy",
      activeConversationId: "old",
      conversations: [
        { id: "old", title: "old chat", updatedAt: "2026-01-03T00:00:00Z", messages: [] },
      ],
    };
    const merged = mergeWindowStates(primary, [legacy], "/tmp/main");
    assert.deepEqual(merged.conversations, []);
    assert.deepEqual(merged.deletedConversationIds, ["old"]);
    assert.equal(merged.activeConversationId, null);
  });
});

describe("normalizeWindowState", () => {
  it("removes deleted conversations from active state and pipeline edges", () => {
    const normalized = normalizeWindowState({
      version: 2,
      workspaceRoot: "/tmp/main",
      activeConversationId: "deleted",
      activeByWorkspace: {
        "/tmp/main": "deleted",
        "/tmp/other": "kept",
      },
      deletedConversationIds: ["deleted"],
      conversations: [
        { id: "deleted", title: "deleted", updatedAt: "2026-01-02T00:00:00Z", messages: [] },
        { id: "kept", title: "kept", updatedAt: "2026-01-01T00:00:00Z", messages: [] },
      ],
      pipeline: {
        edges: [
          { from: "kept", to: "deleted" },
          { from: "deleted", to: "kept" },
        ],
      },
    }, "/tmp/main");

    assert.deepEqual(normalized.conversations.map((conversation) => conversation.id), ["kept"]);
    assert.equal(normalized.activeConversationId, "kept");
    assert.deepEqual(normalized.activeByWorkspace, { "/tmp/other": "kept" });
    assert.deepEqual(normalized.pipeline.edges, []);
  });
});
