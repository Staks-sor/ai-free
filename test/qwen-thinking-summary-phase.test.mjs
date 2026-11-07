import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";

import { extractTextRecursively } from "../src/providers/qwen/client.mjs";

// Инцидент 29.10 11:24: Qwen с thinking_enabled=true шлёт фазу
// "thinking_summary" (thinking_format:"summary" в payload) с текстом в
// delta.extra.summary_title.content / summary_thought.content. Раньше
// extractTextRecursively знал только phase:"think" → саммари терялись,
// reasoning-канал оставался пустым. Внутри thinking-фазы бэкенд гоняет
// свои тулы (web_search, web_extractor) — их события тоже не ответ.

// Реальное SSE-событие из telemetry/run-2026-10-29T11-24-26 (обрезано).
const LIVE_SUMMARY_EVENT = {
  choices: [{
    delta: {
      role: "assistant",
      content: "",
      phase: "thinking_summary",
      extra: {
        summary_title: { content: ["Analyzing the user's request to install a specific skill from a provided repository"] },
        summary_thought: { content: ["I am examining the GitHub link\nI intend to determine the appropriate method"] },
      },
    },
  }],
  response_id: "3f2a21f7",
};

const LIVE_ANSWER_EVENT = {
  choices: [{ delta: { role: "assistant", content: "Tool web_extract does not exists.", phase: "answer" } }],
  response_id: "3f2a21f7",
};

describe("thinking_summary phase streams as reasoning", () => {
  it("classifies thinking_summary (with extra.summary_*) as thinking", () => {
    const found = extractTextRecursively(LIVE_SUMMARY_EVENT);
    assert.equal(found.isThinking, true, "thinking_summary must be thinking");
    assert.ok(found.text.includes("Analyzing the user's request"), "title text extracted");
    assert.ok(found.text.includes("I am examining the GitHub link"), "thought text extracted");
  });

  it("answer phase is not thinking even after thinking events", () => {
    extractTextRecursively(LIVE_SUMMARY_EVENT);
    const found = extractTextRecursively(LIVE_ANSWER_EVENT);
    assert.equal(found.isThinking, false, "answer phase is visible content");
    assert.equal(found.text, "Tool web_extract does not exists.");
  });

  it("live SSE tail from 29.10 telemetry yields reasoning chars", () => {
    const dir = "telemetry/run-2026-10-29T11-24-26-050Z-acc_1790702167522";
    if (!fs.existsSync(dir)) return; // telemetry is local-only
    let thinkingChars = 0;
    for (const f of fs.readdirSync(dir).filter((x) => x.startsWith("events"))) {
      const lines = fs.readFileSync(`${dir}/${f}`, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        const body = ev.data?.body;
        if (typeof body !== "string" || !(ev.data?.url || "").includes("completions")) continue;
        for (const block of body.split("\n\n")) {
          const m = block.match(/^data: (.*)$/s);
          if (!m) continue;
          try {
            const found = extractTextRecursively(JSON.parse(m[1]));
            if (found.isThinking) thinkingChars += found.text.length;
          } catch {}
        }
      }
    }
    assert.ok(thinkingChars > 0, `live telemetry must yield reasoning chars, got ${thinkingChars}`);
  });
});
