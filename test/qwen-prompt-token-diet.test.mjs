import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { formatCompactTools } from "../api/tool-calls.mjs";
import { buildPromptFromChatBody } from "../api/openai-handler.mjs";
import { splitPromptForFileUpload } from "../src/providers/qwen/context-file.mjs";

// 2026-08-21, поле-репорт: промпт ai-free раздут тул-схемами. Полные
// descriptions тулов (десятки КБ) дублируют прозу системного промпта Hermes,
// который и так уезжает в context.txt. Для списка «Available tools» нужны
// только имя + краткое описание + required-поля, без простыней описаний
// и без полного JSON-дерева parameters.

const VERBOSE_TOOLS = [
  {
    type: "function",
    function: {
      name: "cronjob",
      description: "Manage scheduled cron jobs with a single compressed tool. " +
        "Use action='create' to schedule a new job from a prompt or one or more skills. ".repeat(30),
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "One of: create, list, update, pause, resume, remove, run. " + "Details ".repeat(50) },
          job_id: { type: "string", description: "Required for update/pause/resume/remove/run. " + "Details ".repeat(50) },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for information.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, limit: { type: "integer", default: 5 } },
        required: ["query"],
      },
    },
  },
];

describe("formatCompactTools token diet", () => {
  it("truncates long tool descriptions to a short cap", () => {
    const out = formatCompactTools(VERBOSE_TOOLS);
    const parsed = JSON.parse(out);
    for (const t of parsed) {
      assert.ok(t.function.description.length <= 220, `description too long: ${t.function.description.length}`);
    }
    // Имя и смысл сохранены
    assert.equal(parsed[0].function.name, "cronjob");
    assert.match(parsed[0].function.description, /cron/i);
  });

  it("keeps names, types and required arrays; drops verbose property descriptions", () => {
    const out = formatCompactTools(VERBOSE_TOOLS);
    const parsed = JSON.parse(out);
    const params = parsed[0].function.parameters;
    // required сохранён
    assert.deepEqual(params.required, ["action"]);
    // типы параметров сохранены
    assert.equal(params.properties.action.type, "string");
    assert.equal(params.properties.job_id.type, "string");
    // многословные описания свойств срезаны (<=120)
    assert.ok(params.properties.action.description.length <= 120);
    assert.ok(params.properties.job_id.description.length <= 120);
    // default сохраняется (модели часто нужны дефолты)
    const search = parsed.find(t => t.function.name === "web_search");
    assert.equal(search.function.parameters.properties.limit.default, 5);
  });

  it("shrinks the tool block dramatically vs raw JSON", () => {
    const raw = JSON.stringify(VERBOSE_TOOLS);
    const compact = formatCompactTools(VERBOSE_TOOLS);
    assert.ok(compact.length < raw.length / 2, `compact=${compact.length}, raw=${raw.length}`);
  });
});

describe("context file note directive", () => {
  it("instructs the model to internalize the attached context before answering", () => {
    // Генерируем промпт длиннее порога файла, чтобы сработал сплит
    const longHistory = Array.from({ length: 60 }, (_, i) =>
      `[USER]: сообщение номер ${i} `.repeat(20)).join("\n\n---\n\n");
    const prompt = "[SYSTEM]: you are hermes\n\n---\n\n" + longHistory + "\n\n---\n\n[USER]: продолжай работу";

    const split = splitPromptForFileUpload(prompt, { inlineChars: 4000, fileMinChars: 1000 });
    assert.ok(split, "split expected");
    assert.match(split.inline, /\[CONTEXT FILE\]/);
    // Директива: не просто «история диалога», а прочитать-уяснить-продолжить
    assert.match(split.inline, /уясни|изложи|осознай|internalize/i);
    assert.match(split.inline, /продолжи|continue/i);
  });
});
