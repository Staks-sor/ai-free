import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("desktop and VS Code startup point to provider sign-in without implying DeepSeek is required", () => {
  for (const file of ["src/cli/run.mjs", "plugin-for-vscode/src/cli/run.mjs"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /DeepSeek token missing — окно откроется/);
    assert.match(source, /Новый чат.*Авторизоваться/);
  }
});
