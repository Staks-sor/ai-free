import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { shouldAutoRunCodeTask } from "../src/window-app/server.mjs";

describe("shouldAutoRunCodeTask", () => {
  it("routes direct project work to the code agent", () => {
    assert.equal(shouldAutoRunCodeTask("встраивай memory в loop"), true);
    assert.equal(shouldAutoRunCodeTask("исправь интерфейс чата"), true);
    assert.equal(shouldAutoRunCodeTask("add Anthropic API settings"), true);
    assert.equal(shouldAutoRunCodeTask("создай файл notes.txt"), true);
  });

  it("keeps informational prompts in normal chat", () => {
    assert.equal(shouldAutoRunCodeTask("почему он пишет про Linux контейнер?"), false);
    assert.equal(shouldAutoRunCodeTask("объясни что такое JSON"), false);
    assert.equal(shouldAutoRunCodeTask("how does memory work?"), false);
  });

  it("does not treat generic creative requests as local code tasks", () => {
    assert.equal(shouldAutoRunCodeTask("сделай картинку города"), false);
    assert.equal(shouldAutoRunCodeTask("create a poem"), false);
  });
});
