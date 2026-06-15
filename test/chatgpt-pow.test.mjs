import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { getConfig, generateAnswer, getRequirementsToken } from "../src/providers/chatgpt/pow.mjs";

describe("ChatGPT Proof-of-Work solver", () => {
  it("generates a config array successfully", () => {
    const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
    const config = getConfig(userAgent, "prod-test-dpl");
    
    assert.ok(Array.isArray(config));
    assert.equal(config[4], userAgent);
    assert.equal(config[6], "prod-test-dpl");
  });

  it("solves weak difficulty PoW challenge", () => {
    const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
    const config = getConfig(userAgent, "prod-test-dpl");
    const seed = "0.123456789";
    const difficulty = "0fffff"; // очень легкая сложность

    const result = generateAnswer(seed, difficulty, config);
    assert.ok(result.solved);
    assert.ok(typeof result.answer === "string");
    assert.ok(result.answer.length > 0);
  });

  it("generates a requirements token", () => {
    const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
    const config = getConfig(userAgent, "prod-test-dpl");
    
    const reqToken = getRequirementsToken(config);
    assert.ok(reqToken.startsWith("gAAAAAC"));
  });
});
