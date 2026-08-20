import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { repairTruncatedToolCallJson } from "../api/tool-calls.mjs";
import { isQwenSessionExpiredText } from "../src/providers/qwen/session-errors.mjs";
import { resolveQwenStreamTimeouts } from "../src/providers/qwen/stream-timeouts.mjs";

// Exact truncated JSON from live logs 2026-08-20: model hit its output-token
// limit mid tool_calls block; stream ended cleanly (stream_done, 260s) but the
// array was never closed → "Error parsing tool calls ... position 775".
const TRUNCATED_FROM_LOG =
  '[\n  {\n    "name": "memory",\n    "arguments": {\n      "target": "memory",\n      "operations": [\n        {\n          "action": "add",\n          "content": "§\\nTOOL CAPABILITIES: Never make categorical claims.\\n§\\nSANDBOX ISOLATION: cloud sandbox cannot reach local tools."\n        }\n      ]';

describe("repairTruncatedToolCallJson", () => {
  it("closes unbalanced brackets from the live truncated sample", () => {
    const repaired = repairTruncatedToolCallJson(TRUNCATED_FROM_LOG);
    const calls = JSON.parse(repaired);
    assert.equal(Array.isArray(calls), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "memory");
    assert.equal(calls[0].arguments.target, "memory");
    assert.equal(calls[0].arguments.operations.length, 1);
    assert.equal(calls[0].arguments.operations[0].action, "add");
  });

  it("closes an unterminated string mid-value", () => {
    const repaired = repairTruncatedToolCallJson(
      '[{"name": "terminal", "arguments": {"command": "echo hel',
    );
    const calls = JSON.parse(repaired);
    assert.equal(calls[0].name, "terminal");
    // The visible part of the string survives.
    assert.match(calls[0].arguments.command, /echo hel/);
  });

  it("strips a dangling trailing comma before closing", () => {
    const repaired = repairTruncatedToolCallJson('[{"name": "a", "arguments": {},');
    assert.deepEqual(JSON.parse(repaired), [{ name: "a", arguments: {} }]);
  });

  it("drops a dangling escape at end of unterminated string", () => {
    const repaired = repairTruncatedToolCallJson('[{"name": "a", "arguments": {"x": "va\\');
    assert.deepEqual(JSON.parse(repaired), [{ name: "a", arguments: { x: "va" } }]);
  });

  it("returns valid json unchanged when already balanced", () => {
    const good = '[{"name": "a", "arguments": {"x": "y"}}]';
    assert.equal(repairTruncatedToolCallJson(good), good);
  });
});

describe("isQwenSessionExpiredText (false-positive guard)", () => {
  it("does NOT flag long technical prose that merely mentions 401 Unauthorized", () => {
    const prose =
      "Если ссылки отдают 401 Unauthorized или 403 Forbidden, значит сервер требует сессию. " +
      "Tool read_file does not exists. Нет, напрямую воспользоваться твоим локальным ZAP API (порт 8282) " +
      "я не могу. Моя песочница работает в облаке и имеет строгую сетевую изоляцию — 127.0.0.1 для меня " +
      "это сам контейнер, а не твой компьютер. Чтобы я мог дергать твой ZAP, его нужно было бы пробросить.";
    assert.equal(isQwenSessionExpiredText(prose), false);
  });

  it("still flags short real auth errors", () => {
    assert.equal(isQwenSessionExpiredText("bad_request: invalid token"), true);
    assert.equal(isQwenSessionExpiredText("unauthorized"), true);
    assert.equal(isQwenSessionExpiredText("token expired, please sign in"), true);
  });

  it("still flags login-page HTML regardless of length", () => {
    const html = "<!doctype html><html><body>" + "x".repeat(600) + " please login to continue</body></html>";
    assert.equal(isQwenSessionExpiredText(html), true);
  });

  it("still flags the explicit ru marker", () => {
    assert.equal(isQwenSessionExpiredText("Сессия Qwen устарела".padEnd(500, ".")), true);
  });
});

describe("first-content timeout default", () => {
  it("covers observed degraded TTFT (up to ~190s): default 240s", () => {
    const t = resolveQwenStreamTimeouts({});
    assert.equal(t.firstContentMs, 240_000);
    assert.ok(t.fetchMs > t.firstContentMs, "fetch cap must exceed first-content timeout");
  });

  it("keeps env override", () => {
    assert.equal(resolveQwenStreamTimeouts({ QWEN_STREAM_FIRST_CONTENT_TIMEOUT_MS: "60000" }).firstContentMs, 60_000);
  });
});
