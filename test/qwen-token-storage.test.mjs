import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseQwenTokenState, QWEN_TOKEN_SNIPPET_SRC } from "../src/providers/qwen/token-storage.mjs";

// 2026-09-30 ~15:42 UTC: Qwen выкатил cookie_gate policy_version:2 — JWT переехал
// из localStorage["token"] в localStorage["qwen_access_token_state"] (JSON с
// полем token). Старый ключ больше не пишется. Всё, что читало "token",
// ослепло: SPA минтит свежий JWT, а транспорт видит только протухший fallback
// → вечный 401 после часа жизни слотового токена.
describe("parseQwenTokenState: новый формат qwen_access_token_state", () => {
  it("валидный JSON с token → извлекает JWT", () => {
    const raw = JSON.stringify({ version: 1, stateId: "abc", token: "AAA.BBB.CCC" });
    assert.equal(parseQwenTokenState(raw), "AAA.BBB.CCC");
  });

  it("мусор/не-JSON → null", () => {
    assert.equal(parseQwenTokenState("не json"), null);
    assert.equal(parseQwenTokenState(null), null);
    assert.equal(parseQwenTokenState(""), null);
  });

  it("JSON без token → null", () => {
    assert.equal(parseQwenTokenState(JSON.stringify({ version: 1 })), null);
  });

  it("in-page сниппет: новый ключ приоритетнее, fallback на старый", () => {
    assert.ok(QWEN_TOKEN_SNIPPET_SRC.includes("qwen_access_token_state"));
    assert.ok(QWEN_TOKEN_SNIPPET_SRC.includes('getItem("token")'));
    // сниппет — самодостаточное выражение для page.evaluate
    assert.ok(QWEN_TOKEN_SNIPPET_SRC.startsWith("(") && QWEN_TOKEN_SNIPPET_SRC.endsWith(")"));
  });
});
