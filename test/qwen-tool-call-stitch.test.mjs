import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  toolCallsBlockState,
  mergeToolCallContinuation,
  buildToolCallContinuationPrompt,
  stitchTruncatedToolCalls,
} from "../src/providers/qwen/tool-call-stitch.mjs";

// Сценарий реального инцидента 2026-10-23: Qwen обрезал вывод на ~1k токенов
// посреди содержимого write_file; ключ path шёл после content и исчез.
const truncatedWriteFile =
  'Замысел: записать README.\n' +
  '```tool_calls\n' +
  '[\n  {\n    "name": "write_file",\n    "arguments": {\n' +
  '      "content": "# Сборка FDS E+ (FDSE) для Windows x64\\n\\nИнструкция по компиляции';

const tailRest =
  ' релизной и отладочной версий",\n      "path": "E:/tmp/README.md"\n    }\n  }\n]\n```';

describe("toolCallsBlockState", () => {
  it("reports no block for plain prose", () => {
    const state = toolCallsBlockState("Просто ответ без инструментов");
    assert.deepEqual(state, { present: false, complete: true });
  });

  it("reports complete for a closed fence", () => {
    const state = toolCallsBlockState('```tool_calls\n[{"name":"x","arguments":{}}]\n```');
    assert.equal(state.present, true);
    assert.equal(state.complete, true);
  });

  it("detects an unclosed tool_calls fence (output-limit truncation)", () => {
    const state = toolCallsBlockState(truncatedWriteFile);
    assert.equal(state.present, true);
    assert.equal(state.complete, false);
  });
});

describe("mergeToolCallContinuation", () => {
  it("appends an exact continuation verbatim", () => {
    const merged = mergeToolCallContinuation("abc[{\"na", "me\":\"x\"}]```");
    assert.equal(merged.merged, 'abc[{"name":"x"}]```');
    assert.equal(merged.appended, 'me":"x"}]```');
  });

  it("dedupes an overlap when the model re-emits the tail", () => {
    const previous = '...content": "AAA BBB CCC';
    const continuation = 'BBB CCC и дальше хвост JSON"}]```'; // повтор хвоста previous
    const merged = mergeToolCallContinuation(previous, continuation);
    assert.equal(merged.merged, '...content": "AAA BBB CCC и дальше хвост JSON"}]```');
  });

  it("strips the <<<CONT>>> marker and prose before it", () => {
    const previous = '...content": "AAA';
    const continuation = 'Продолжаю с места обрыва:\n<<<CONT>>> BBB CCC"}]```';
    const merged = mergeToolCallContinuation(previous, continuation);
    assert.equal(merged.merged, '...content": "AAA BBB CCC"}]```');
  });

  it("strips a restarted fence header when the model re-opens tool_calls", () => {
    const previous = 'замысел\n```tool_calls\n[{"name":"write_file","arguments":{"content":"AAA BB';
    const continuation = 'BB CCC"}]```';
    const merged = mergeToolCallContinuation(previous, continuation);
    assert.ok(merged.merged.startsWith("замысел\n```tool_calls\n"));
    assert.ok(merged.merged.endsWith('BB CCC"}]```'));
  });
});

describe("buildToolCallContinuationPrompt", () => {
  it("includes the tail marker and strict continuation rules", () => {
    const prompt = buildToolCallContinuationPrompt(truncatedWriteFile, 0);
    assert.match(prompt, /output token limit/i);
    assert.match(prompt, /<<<CONT>>>/);
    assert.match(prompt, /Инструкция по компиляции/); // хвост обрыва включён
    assert.match(prompt, /do NOT restart/i);
  });
});

describe("stitchTruncatedToolCalls (injectable sendTurn)", () => {
  it("stitches multiple truncated rounds into one complete block and streams append-only deltas", async () => {
    // Раунд 1: модель продолжила, но снова упёрлась в лимит.
    // Раунд 2: продолжение закрывает JSON и fence.
    const rounds = [
      { text: ' релизной версии солвера",\n      "path"' }, // снова обрыв
      { text: ': "E:/tmp/README.md"\n    }\n  }\n]\n```' },  // финал
    ];
    const prompts = [];
    const deltas = [];
    const result = await stitchTruncatedToolCalls({
      text: truncatedWriteFile,
      sendTurn: async ({ prompt }) => {
        prompts.push(prompt);
        return rounds[prompts.length - 1];
      },
      onText: (t) => deltas.push(t),
      maxTurns: 4,
    });

    assert.equal(result.complete, true);
    assert.equal(result.stitched, true);
    assert.equal(prompts.length, 2);
    // Финальный текст = исходный + ровно добавленные дельты (append-only).
    assert.equal(result.text, truncatedWriteFile + rounds[0].text + rounds[1].text);
    assert.equal(deltas.join(""), rounds[0].text + rounds[1].text);
    // Блок парсится и содержит path.
    assert.match(result.text, /"path": "E:\/tmp\/README\.md"/);
  });

  it("sends corrective feedback when a round closes the fence with invalid JSON", async () => {
    const calls = [];
    await stitchTruncatedToolCalls({
      text: truncatedWriteFile,
      sendTurn: async ({ prompt, mode }) => {
        calls.push(mode);
        if (calls.length === 1) {
          // fence закрыт, но JSON битый (потеряна кавычка у key) — нужен fix-раунд
          return { text: ' релизной версии",\n      "path: E:/tmp/README.md"\n    }\n  }\n]\n```' };
        }
        // fix-раунд: валидное закрытие JSON + fence от точки отката
        return { text: '\n      "path": "E:/tmp/README.md"\n    }\n  }\n]\n```' };
      },
      maxTurns: 4,
    });
    assert.deepEqual(calls, ["continue", "fix"]);
  });

  it("gives up after maxTurns and reports incomplete", async () => {
    let called = 0;
    const result = await stitchTruncatedToolCalls({
      text: truncatedWriteFile,
      sendTurn: async () => {
        called += 1;
        return { text: " ещё немного" };
      },
      maxTurns: 2,
    });
    assert.equal(called, 2);
    assert.equal(result.complete, false);
  });

  it("returns immediately when the block is already complete", async () => {
    const result = await stitchTruncatedToolCalls({
      text: '```tool_calls\n[{"name":"x","arguments":{"a":1}}]\n```',
      sendTurn: async () => {
        throw new Error("must not be called");
      },
    });
    assert.equal(result.complete, true);
    assert.equal(result.stitched, false);
  });
});
