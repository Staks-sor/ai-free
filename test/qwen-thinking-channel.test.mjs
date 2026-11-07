import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { Writable } from "node:stream";

import { StreamParser, resolveAdaptiveThinking, buildPromptFromChatBody, makeToolFabricationGate } from "../api/openai-handler.mjs";
import { stripToolErrorChips, createToolErrorChipFilter } from "../api/think-filter.mjs";

// ═══════════════════════════════════════════════════════════════
// Эмуляция thinking-канала: Qwen phase:"think" → delta.reasoning_content
// в OpenAI-совместимом SSE, чтобы Hermes рисовал Reasoning-блоки
// (как с GLM-5.3 через z.ai). Инцидент 25.10: client.mjs отдаёт
// onThinking, но handleQwenStream его не слушает, а StreamParser
// не умеет слать reasoning_content — данные выбрасывались.
// ═══════════════════════════════════════════════════════════════

function makeWritableResponse() {
  const res = new Writable({
    write(chunk, _enc, cb) {
      this.chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  res.chunks = [];
  res.setHeader = () => {};
  res.statusCode = 200;
  return res;
}

function collectSse(res) {
  return Buffer.concat(res.chunks)
    .toString("utf8")
    .split("\n\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)));
}

describe("StreamParser reasoning_content channel", () => {
  it("emits reasoning_content deltas and keeps them out of content", async () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("qwen3.8-max", res, { tools: [] });

    parser.onThinking("Разбираю задачу");
    parser.onThinking(": смотрю на файлы");
    parser.onText("Готово");

    await parser.onEnd();

    const events = collectSse(res);
    const reasoning = events
      .map((e) => e.choices[0].delta.reasoning_content)
      .filter(Boolean)
      .join("");
    const content = events
      .map((e) => e.choices[0].delta.content)
      .filter(Boolean)
      .join("");

    assert.equal(reasoning, "Разбираю задачу: смотрю на файлы", "thinking must stream as reasoning_content");
    assert.equal(content, "Готово", "visible text stays in content");
  });

  it("sends the role frame before reasoning when thinking comes first", async () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("qwen3.8-max", res, { tools: [] });

    parser.onThinking("Сначала подумаю");
    await parser.onEnd();

    const events = collectSse(res);
    assert.equal(events[0].choices[0].delta.role, "assistant", "role frame precedes reasoning deltas");
    const reasoning = events.map((e) => e.choices[0].delta.reasoning_content).filter(Boolean).join("");
    assert.equal(reasoning, "Сначала подумаю");
  });

  it("does not leak thinking into the fabrication window or tool detection", async () => {
    const res = makeWritableResponse();
    const tools = [{
      type: "function",
      function: {
        name: "write_file",
        parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
      },
    }];
    const parser = new StreamParser("qwen3.8-max", res, { tools });

    // Черновики tool-call JSON внутри reasoning НЕ должны попасть в
    // toolsBuffer/content-канал (инцидент «Tool X does not exists»).
    parser.onThinking('Замысел: вызвать [{"name": "write_file", "arguments": {"path": "x"}}]');
    parser.onText('```tool_calls\n[{"name": "write_file", "arguments": {"path": "y", "content": "z"}}]\n```');

    await parser.onEnd();

    const events = collectSse(res);
    const args = events.flatMap((e) => e.choices[0].delta.tool_calls || []);
    assert.equal(args.length, 1, "only the real tool call is delivered");
    assert.equal(JSON.parse(args[0].function.arguments).path, "y", "draft from thinking must not override the real call");
  });
});

describe("adaptive thinking default depth 200", () => {
  it("keeps thinking on tool loops deeper than 20 (up to 200 messages)", () => {
    assert.equal(resolveAdaptiveThinking({ thinking: true, toolCount: 34, messageCount: 25, env: {} }), true, "depth 25 keeps thinking now");
    assert.equal(resolveAdaptiveThinking({ thinking: true, toolCount: 34, messageCount: 150, env: {} }), true, "depth 150 keeps thinking");
  });

  it("still moderates extremely deep loops", () => {
    // 29.10: лимит снят полностью; порог возвращается только через env.
    assert.equal(resolveAdaptiveThinking({ thinking: true, toolCount: 34, messageCount: 250, env: { QWEN_ADAPTIVE_THINKING_DEPTH: "200" } }), false, "env threshold still works");
    assert.equal(resolveAdaptiveThinking({ thinking: true, toolCount: 34, messageCount: 250, env: {} }), true, "no default threshold anymore");
  });

  it("env override still wins", () => {
    assert.equal(resolveAdaptiveThinking({ thinking: true, toolCount: 34, messageCount: 250, env: { QWEN_ADAPTIVE_THINKING_DEPTH: "300" } }), true);
    assert.equal(resolveAdaptiveThinking({ thinking: true, toolCount: 34, messageCount: 25, env: { QWEN_ADAPTIVE_THINKING: "off" } }), true);
  });
});

describe("tool instructions: thinking home + delegation rule", () => {
  it("tells the model that mid-task analysis belongs in thinking, not prose", () => {
    const prompt = buildPromptFromChatBody(
      { messages: [{ role: "user", content: "hi" }], tools: [{ type: "function", function: { name: "bash", parameters: { type: "object", properties: {} } } }] },
      "qwen3.8-max",
      { provider: "qwen", model: "qwen3.8-max" },
    );
    assert.match(prompt, /belong in your THINKING channel/i, "thinking is the home for mid-task analysis");
    assert.match(prompt, /think as much as you need/i, "encourages using thinking freely");
  });

  it("encourages delegating parallelizable subtasks when a delegation tool exists", () => {
    const prompt = buildPromptFromChatBody(
      { messages: [{ role: "user", content: "hi" }], tools: [{ type: "function", function: { name: "delegate_task", parameters: { type: "object", properties: {} } } }] },
      "qwen3.8-max",
      { provider: "qwen", model: "qwen3.8-max" },
    );
    assert.match(prompt, /delegate/i, "delegation rule present");
    assert.match(prompt, /independent parallelizable subtasks/i, "scoped to parallelizable work");
    assert.match(prompt, /keep decisions and file writes to yourself/i, "guard against over-delegation");
  });
});

describe("thinking never disabled on deep tool loops", () => {
  it("keeps thinking at any depth when requested (limit removed 29.10)", () => {
    assert.equal(resolveAdaptiveThinking({ thinking: true, toolCount: 34, messageCount: 500, env: {} }), true, "depth 500 keeps thinking");
    assert.equal(resolveAdaptiveThinking({ thinking: true, toolCount: 34, messageCount: 5000, env: {} }), true, "no depth disables thinking");
  });
});

// ═══════════════════════════════════════════════════════════════
// Инцидент 29.10: чипы «Tool X does not exists» идут ПЕРЕД валидным
// tool_calls-блоком (телеметрия 11-24-26: «Tool web_extract does not
// exists.…```tool_calls [...] ```»). Fabrication-гейт матчится на чипы
// в первых 500 символах сырого текста и топит ВЕСЬ ход вместе с рабочим
// вызовом → 3 ретрая → заглушка. Чинится: гейт получает текст ПОСЛЕ
// чипостриги.
// ═══════════════════════════════════════════════════════════════
describe("fabrication gate sees chip-stripped text", () => {
  it("does not fire on backend chips followed by a real tool_calls block", () => {
    // Реальная цепочка: чипострига вырезает чипы, гейт видит чистый текст.
    const gate = makeToolFabricationGate();
    const stripped = stripToolErrorChips("Tool web_extract does not exists.Tool terminal does not exists.```tool_calls\n[]\n```");
    const released = gate.push(stripped);
    const tail = gate.flush();
    assert.equal(gate.fabricated(), false, "chips + valid tool_calls must NOT be fabrication");
    assert.match((released || "") + (tail || ""), /tool_calls/, "valid call text survives");
  });

  it("still fires on genuine fabrication prose", () => {
    const gate = makeToolFabricationGate();
    gate.push(stripToolErrorChips("Извини, но сейчас инструменты недоступны и не работают"));
    assert.equal(gate.fabricated(), true, "real fabrication prose is still detected");
  });

  it("fires on 'tools not responding' phrasing (29.10 11:55 leak)", () => {
    // Инцидент 29.10 11:55: попытка 1 «временно недоступны» поймана, но
    // попытка 2 «система временно не отвечает на запросы» УТЕКЛА в TG —
    // «не отвечает» не было в паттерне.
    const gate = makeToolFabricationGate();
    gate.push(stripToolErrorChips("К сожалению, сейчас возникли технические проблемы с инструментами — система временно не отвечает на запросы для работы с файлами."));
    assert.equal(gate.fabricated(), true, "'не отвечает' must be caught");
  });

  it("quota detection survives chip stripping", () => {
    const gate = makeToolFabricationGate();
    gate.push("Вы достигли дневного лимита");
    assert.equal(gate.kind(), "quota", "quota detection unaffected");
  });

  it("chip storm (4+ backend chips, no tool call) drops the turn as 'storm'", () => {
    // Инцидент 07.11: субагент 29-52 получил 15 чипов «Tool X does not
    // exists» (бэкенд отвергал его попытки звать тулы в thinking-фазе),
    // после чего модель написала ЛОЖНЫЙ отчёт «Задача выполнена».
    // Шторм чипов = модель бьётся в закрытую дверь: ход дропаем и ретраим
    // с наддогом «зови тулы markdown-блоком в ответе, не в thinking».
    const gate = makeToolFabricationGate();
    gate.registerChip();
    gate.registerChip();
    gate.registerChip();
    assert.equal(gate.fabricated(), false, "3 chips tolerated (11:53 case: 2 chips + valid call)");
    gate.registerChip();
    assert.equal(gate.fabricated(), true, "4th chip with no visible tool call = storm");
    assert.equal(gate.kind(), "storm", "storm is a distinct kind for the retry nudge");
  });

  it("chip storm does not fire if a real tool_calls block already passed", () => {
    // 11:53: чипы → проза → валидный tool_calls в том же ходе. Вызов
    // сидит в буфере гейта (ход короче окна) и выходит на flush; чипы
    // до/после блока — косметика, шторм не прилипает.
    const gate = makeToolFabricationGate();
    gate.push("```tool_calls\n[]\n```");
    gate.registerChip();
    gate.registerChip();
    gate.registerChip();
    gate.registerChip();
    assert.equal(gate.fabricated(), false, "chips around a buffered tool_calls block are cosmetic");
    const tail = gate.flush();
    assert.match(tail, /tool_calls/, "valid call is delivered via flush");
  });

  it("chip filter reports stripped chips via onChip", () => {
    let chips = 0;
    const filter = createToolErrorChipFilter({ onText: () => {}, onChip: () => { chips += 1; } });
    filter.push("Tool terminal does not exists.Tool web_extract does not exists.");
    filter.flush();
    assert.equal(chips, 2, "each stripped chip increments the counter");
  });

  it("rule 14: interval reading for large files (grep first, then offset/limit ranges)", () => {
    const prompt = buildPromptFromChatBody(
      { messages: [{ role: "user", content: "hi" }], tools: [
        { type: "function", function: { name: "read_file", parameters: { type: "object", properties: {} } } },
        { type: "function", function: { name: "search_files", parameters: { type: "object", properties: {} } } },
      ] },
      "qwen3.8-max",
      { provider: "qwen", model: "qwen3.8-max" },
    );
    assert.match(prompt, /interval reading/i, "interval reading rule present");
    assert.match(prompt, /offset\/limit/i, "points at read_file offset/limit mechanics");
    assert.match(prompt, /never read (?:an entire |the whole )?large file/i, "forbids swallowing large files whole");
  });
});
