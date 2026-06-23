import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAgentTaskInput } from "../src/code-agent/task-input.mjs";
import { createBrowserSystemPrompt, BROWSER_AGENT_TOOLS } from "../src/code-agent/browser-prompt.mjs";
import { appendBrowserContextToPrompt } from "../src/window-app/browser-snapshot.mjs";

describe("browser agent (Codex-style)", () => {
  it("routes web tasks to browser-only agent, not full code agent", () => {
    const input = resolveAgentTaskInput("найди в гугле курс доллара", {
      autoBrowserMode: true,
      autoCodeMode: false,
    });
    assert.equal(input.run, true);
    assert.equal(input.browserOnly, true);
    assert.equal(input.slash, false);
  });

  it("keeps /code as full code agent even for browser wording", () => {
    const input = resolveAgentTaskInput("/code открой google.com", {
      autoBrowserMode: true,
    });
    assert.equal(input.run, true);
    assert.equal(input.browserOnly, false);
    assert.equal(input.slash, true);
  });

  it("does not inject browser snapshot into regular chat prompts", async () => {
    const out = await appendBrowserContextToPrompt("привет");
    assert.equal(out, "привет");
  });

  it("browser prompt avoids Google search examples", () => {
    const prompt = createBrowserSystemPrompt("найди Мурманск новости сегодня");
    assert.match(prompt, /yandex\.ru\/search/);
    assert.doesNotMatch(prompt, /\{"tool":"browser_navigate","url":"https:\/\/www\.google\.com"/);
    assert.match(prompt, /captcha/i);
  });
});
