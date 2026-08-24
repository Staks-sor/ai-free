import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createThinkTagFilter, stripThinkBlocks } from "../api/think-filter.mjs";
import { parseModelToolCalls } from "../api/tool-calls.mjs";

// Сэмпл из живого лога 2026-08-21: деградировавший Qwen шлёт reasoning
// ЛИТЕРАЛЬНЫМ текстом с <think>-тегами. Внутри reasoning — черновики
// tool-call JSON, которые парсер выдёргивал как реальные вызовы
// ("Tool terminal does not exists" каскад в Hermes).

const THINK_DRAFT = `Wait, search_files with target='files' and pattern='*' might be better, but execute_code gives me exactly what I want.
I'll also grep for "account" and "session" in FreeQwenApi.
{"name": "terminal", "arguments": {"command": "grep -rn account D:\\freeqwenapi"}}
Let's just use execute_code to read some key files.
Thinking completed`;

const REAL_CALL = '[\n  {\n    "name": "terminal",\n    "arguments": { "command": "echo hi" }\n  }\n]';

describe("stripThinkBlocks", () => {
  it("вырезает <think>-блок с черновиками tool-call JSON", () => {
    const text = `Проверяю.\n<think>\n${THINK_DRAFT}\n</think>\nГотово, вот ответ.`;
    const clean = stripThinkBlocks(text);
    assert.equal(clean.includes("Wait, search_files"), false);
    assert.equal(clean.includes('"name": "terminal"'), false);
    assert.equal(clean.includes("Thinking completed"), false);
    assert.equal(clean.includes("Проверяю."), true);
    assert.equal(clean.includes("Готово, вот ответ."), true);
  });

  it("незакрытый <think> до конца текста = весь хвост это reasoning", () => {
    const clean = stripThinkBlocks(`Ответ.\n<think>\n${THINK_DRAFT}`);
    assert.equal(clean.trim(), "Ответ.");
  });

  it("строка-сепаратор 'Thinking completed' вырезается и без тегов", () => {
    const clean = stripThinkBlocks("До.\nThinking completed\nПосле.");
    assert.equal(clean.includes("Thinking completed"), false);
    assert.equal(clean.includes("До."), true);
    assert.equal(clean.includes("После."), true);
  });

  it("текст без тегов не трогается", () => {
    const text = "Обычный ответ. 1 < 2. </closing> тоже обычный.";
    assert.equal(stripThinkBlocks(text), text);
  });

  it("parseModelToolCalls не выдёргивает черновики из think-блока", () => {
    const text = `<think>\n${THINK_DRAFT}\n</think>\nВот итог:\n\n\`\`\`tool_calls\n${REAL_CALL}\n\`\`\`\n`;
    const { calls } = parseModelToolCalls(text);
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse(calls[0].arguments).command, "echo hi");
  });
});

describe("createThinkTagFilter (стриминг)", () => {
  it("подавляет reasoning-дельты и пропускает чистый текст", () => {
    const emitted = [];
    const f = createThinkTagFilter({ onText: (t) => emitted.push(t) });
    f.push("До. ");
    f.push("<think>\n");
    f.push(THINK_DRAFT);
    f.push("\n</think>\n");
    f.push("После.");
    f.flush();
    const joined = emitted.join("");
    assert.equal(joined.includes("Wait, search_files"), false);
    assert.equal(joined.includes("До. "), true);
    assert.equal(joined.includes("После."), true);
  });

  it("тег, разрезанный по чанкам, не протекает", () => {
    const emitted = [];
    const f = createThinkTagFilter({ onText: (t) => emitted.push(t) });
    f.push("текст <th");
    f.push("ink> черновик ");
    f.push("</th");
    f.push("ink> хвост");
    f.flush();
    const joined = emitted.join("");
    assert.equal(joined.includes("черновик"), false);
    assert.equal(joined.includes("<think>"), false);
    assert.equal(joined.includes("текст "), true);
    assert.equal(joined.includes(" хвост"), true);
  });

  it("незакрытый <think> до конца стрима: хвост подавлен, flush молчит", () => {
    const emitted = [];
    const f = createThinkTagFilter({ onText: (t) => emitted.push(t) });
    f.push("видимый ");
    f.push("<think> набросок без закрытия");
    f.flush();
    assert.equal(emitted.join(""), "видимый ");
  });

  it("частичный префикс тега в конце стрима эмитится как текст", () => {
    const emitted = [];
    const f = createThinkTagFilter({ onText: (t) => emitted.push(t) });
    f.push("меньше <thi");
    f.flush();
    assert.equal(emitted.join(""), "меньше <thi");
  });
});

describe("stray </think> (деградация: закрывающий без открывающего)", () => {
  it("stripThinkBlocks вырезает осиротевшие </think> из ответа", () => {
    const text = "Короткий ответ 1\n</think>\nЕщё текст\n</think>\nфинал";
    const clean = stripThinkBlocks(text);
    assert.equal(clean.includes("</think>"), false);
    assert.equal(clean.includes("Короткий ответ 1"), true);
    assert.equal(clean.includes("финал"), true);
  });

  it("стриминг: голый </think> по чанкам не протекает", () => {
    const emitted = [];
    const f = createThinkTagFilter({ onText: (t) => emitted.push(t) });
    f.push("ответ раз\n</th");
    f.push("ink>\nответ два\n</think>\nфинал");
    f.flush();
    const joined = emitted.join("");
    assert.equal(joined.includes("</think>"), false);
    assert.equal(joined.includes("ответ раз"), true);
    assert.equal(joined.includes("ответ два"), true);
    assert.equal(joined.includes("финал"), true);
  });

  it("interleaved: think/answer/think/answer многократно, всё чисто", () => {
    const text = "<think>черновик 1 с JSON {\"name\":\"terminal\"}</think>короткий 1"
      + "<think>черновик 2 {\"name\":\"execute_code\"}</think>короткий 2"
      + "<think>черновик 3</think>финальный ответ";
    const clean = stripThinkBlocks(text);
    assert.equal(clean, "короткий 1короткий 2финальный ответ");
  });

  it("стриминг interleaved: три фазы думанья, ответы сохраняются", () => {
    const emitted = [];
    const f = createThinkTagFilter({ onText: (t) => emitted.push(t) });
    f.push("<think>думает 1");
    f.push("</think>resp1<think>думает 2</think>");
    f.push("resp2<think>думает 3</think>");
    f.push("FINAL");
    f.flush();
    assert.equal(emitted.join(""), "resp1resp2FINAL");
  });
});
