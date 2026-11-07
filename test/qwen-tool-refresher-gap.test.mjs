import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// САНДБОКС ПУЛА (инцидент 30.09): ТОЛЬКО через настоящую QWEN_ACCOUNTS_FILE
// во временном файле. Никогда не трогаем реальный ~/.qwen-cli/accounts.json.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-refresher-"));
process.env.QWEN_ACCOUNTS_FILE = path.join(tmpDir, "accounts.json");
fs.writeFileSync(
  process.env.QWEN_ACCOUNTS_FILE,
  JSON.stringify([
    { id: "acc_a", label: "a@t.ru", token: "tok-a", cookies: [], invalid: false, resetAt: null },
  ]),
);
delete process.env.QWEN_TOOL_REFRESHER_DEPTH; // чистый дефолт для теста

const { buildPromptFromChatBody } = await import("../api/openai-handler.mjs");

const tools = [
  { type: "function", function: { name: "skill_view", description: "load skill", parameters: {} } },
  { type: "function", function: { name: "terminal", description: "run cmd", parameters: {} } },
];

function makeBody({ systemLen, messageCount }) {
  const system = "[SYSTEM]:\n" + "доменный контекст пожарной безопасности. ".repeat(systemLen);
  const messages = [{ role: "system", content: system }];
  for (let i = 1; i < messageCount; i += 1) {
    messages.push({ role: i % 2 ? "user" : "assistant", content: `msg ${i} `.repeat(50) });
  }
  messages.push({ role: "user", content: "Помоги разобраться с п. 6.3.7 СП 4.13130.2013" });
  return { messages, tools };
}

// Инцидент TG 03.10 00:01: свежая сессия (depth 2-3 после /new), но system-
// блок раздут до десятков кб — 35 тулов в голове промпта, между ними и
// вопросом 33к символов, attention теряет инструменты, модель отвечает
// прозой «инструменты не отзываются». Depth-триггер (40) не срабатывает —
// нужен ЛИБО depth, ЛИБО расстояние от конца списка тулов до хвоста.
describe("buildPromptFromChatBody: toolRefresher по расстоянию", () => {
  it("короткий промпт — рефрешера нет", () => {
    const prompt = buildPromptFromChatBody(makeBody({ systemLen: 5, messageCount: 2 }), "qwen3.8-max", { provider: "qwen", model: "qwen3-max" });
    assert.ok(!prompt.includes("[TOOLS ARE AVAILABLE"));
  });

  it("свежая сессия + раздутый system → рефрешер в хвосте с именами тулов", () => {
    const prompt = buildPromptFromChatBody(makeBody({ systemLen: 2000, messageCount: 3 }), "qwen3.8-max", { provider: "qwen", model: "qwen3-max" });
    assert.ok(prompt.includes("[TOOLS ARE AVAILABLE"), "рефрешер должен появиться при раздутом промпте");
    assert.match(prompt, /skill_view, terminal/);
    // рефрешер ближе к концу, чем [END TOOL INSTRUCTIONS]
    const refresherPos = prompt.lastIndexOf("[TOOLS ARE AVAILABLE");
    const endToolsPos = prompt.lastIndexOf("[END TOOL INSTRUCTIONS]");
    assert.ok(refresherPos > endToolsPos, "рефрешер должен быть в хвосте");
  });

  it("QWEN_TOOL_REFRESHER_MIN_GAP=0 выключает gap-триггер", () => {
    process.env.QWEN_TOOL_REFRESHER_MIN_GAP = "0";
    try {
      const prompt = buildPromptFromChatBody(makeBody({ systemLen: 2000, messageCount: 3 }), "qwen3.8-max", { provider: "qwen", model: "qwen3-max" });
      assert.ok(!prompt.includes("[TOOLS ARE AVAILABLE"));
    } finally {
      delete process.env.QWEN_TOOL_REFRESHER_MIN_GAP;
    }
  });
});
