import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceChatGPTFallbackObservation,
  installChatGPTDomObserver,
  getChatGPTObservationDecision,
} from "../src/providers/chatgpt/browser-proxy.mjs";

describe("ChatGPT smart DOM observer", () => {
  it("installs a MutationObserver instead of a DOM polling interval", async () => {
    let installerSource = "";
    const page = {
      async evaluate(installer) {
        installerSource = String(installer);
        return true;
      },
    };

    await installChatGPTDomObserver(page);

    assert.match(installerSource, /MutationObserver/);
    assert.doesNotMatch(installerSource, /setInterval/);
  });

  it("finishes after the observed stop control disappears with a stable answer", () => {
    assert.deepEqual(getChatGPTObservationDecision({
      responseChanged: true,
      text: "Готовый ответ",
      generating: false,
      sawGenerating: true,
      readyForNextPrompt: false,
      quietForMs: 900,
      quietThresholdMs: 750,
    }), { done: true, reason: "generation-stopped" });
  });

  it("keeps observing while ChatGPT is generating even if text pauses", () => {
    assert.deepEqual(getChatGPTObservationDecision({
      responseChanged: true,
      text: "Промежуточный ответ",
      generating: true,
      sawGenerating: true,
      readyForNextPrompt: false,
      quietForMs: 10_000,
      quietThresholdMs: 750,
    }), { done: false, reason: "generating" });
  });

  it("supports ChatGPT variants that never render the stop control", () => {
    assert.deepEqual(getChatGPTObservationDecision({
      responseChanged: true,
      text: "Готовый ответ",
      generating: false,
      sawGenerating: false,
      readyForNextPrompt: true,
      quietForMs: 2_000,
      quietThresholdMs: 1_800,
    }), { done: true, reason: "answer-stable" });
  });

  it("does not finish a long response without a stop control while ChatGPT is still busy", () => {
    assert.deepEqual(getChatGPTObservationDecision({
      responseChanged: true,
      text: "Промежуточный результат",
      generating: false,
      sawGenerating: false,
      readyForNextPrompt: false,
      quietForMs: 30_000,
      quietThresholdMs: 1_800,
    }), { done: false, reason: "waiting" });
  });

  it("preserves the quiet period when the in-page observer is temporarily unavailable", () => {
    const previous = {
      count: 1,
      id: "answer",
      text: "Готово",
      generating: false,
      readyForNextPrompt: true,
      error: "",
      version: 4,
      changedAt: 1_000,
    };

    assert.deepEqual(advanceChatGPTFallbackObservation(previous, {
      count: 1,
      id: "answer",
      text: "Готово",
      generating: false,
      readyForNextPrompt: true,
      error: "",
    }, 5_000), previous);

    assert.deepEqual(advanceChatGPTFallbackObservation(previous, {
      ...previous,
      text: "Готово полностью",
    }, 5_000), {
      ...previous,
      text: "Готово полностью",
      version: 5,
      changedAt: 5_000,
    });
  });
});
