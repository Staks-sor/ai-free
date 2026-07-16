import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAgentTaskInput } from "../src/code-agent/task-input.mjs";
import { createBrowserSystemPrompt } from "../src/code-agent/browser-prompt.mjs";
import {
  appendBrowserContextToPrompt,
  shouldAutoRunBrowserTask,
  shouldAutoRunBrowserTaskWithSnapshot,
  shouldPreferBrowserOverProviderSearch,
} from "../src/window-app/browser-snapshot.mjs";
import { isToolAllowed } from "../src/skills/permissions.mjs";

describe("browser agent (explicit page work only)", () => {
  it("does not route ordinary internet research to the browser", async () => {
    for (const task of [
      "найди курс доллара",
      "узнай последние новости Мурманска",
      "найди в гугле погоду на завтра",
      "собери информацию о Node.js",
    ]) {
      assert.equal(shouldAutoRunBrowserTask(task), false, task);
      assert.equal(await shouldAutoRunBrowserTaskWithSnapshot(task), false, task);
      assert.equal(await shouldPreferBrowserOverProviderSearch(task), false, task);
    }
  });

  it("routes explicit page parsing and interaction to browser-only agent", () => {
    for (const task of [
      "открой https://example.com и спарси таблицу",
      "нажми кнопку Войти на сайте example.com",
      "в браузере открой страницу и прими cookies",
      "прочитай страницу https://example.com/docs",
    ]) {
      assert.equal(shouldAutoRunBrowserTask(task), true, task);
      const input = resolveAgentTaskInput(task, {
        autoBrowserMode: true,
        autoCodeMode: false,
      });
      assert.equal(input.run, true);
      assert.equal(input.browserOnly, true);
    }
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

  it("hard-blocks browser tools unless browser-only whitelist is active", () => {
    assert.equal(isToolAllowed("browser_navigate", null), false);
    assert.equal(isToolAllowed("browser_snapshot", ["read_file"]), false);
    assert.equal(isToolAllowed("browser_navigate", ["browser_navigate", "finish"]), true);
    assert.equal(isToolAllowed("read_file", null), true);
  });

  it("browser prompt avoids Google search examples", () => {
    const prompt = createBrowserSystemPrompt("спарси страницу с новостями");
    assert.match(prompt, /yandex\.ru\/search/);
    assert.doesNotMatch(prompt, /\{"tool":"browser_navigate","url":"https:\/\/www\.google\.com"/);
    assert.match(prompt, /captcha/i);
  });
});
