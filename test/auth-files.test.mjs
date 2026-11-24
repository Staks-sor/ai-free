// Тесты pure-функций auth/files.mjs: normalizeToken, isPlaceholderToken, cookieHeaderFromArray.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cookieHeaderFromArray,
  isPlaceholderToken,
  normalizeToken,
  readSavedAuth,
} from "../src/auth/files.mjs";
import { baseHeaders } from "../src/providers/deepseek/headers.mjs";

describe("normalizeToken", () => {
  it("trims plain string token", () => {
    assert.equal(normalizeToken("  abc123  "), "abc123");
  });

  it("returns empty for null/undefined/empty", () => {
    assert.equal(normalizeToken(null), "");
    assert.equal(normalizeToken(undefined), "");
    assert.equal(normalizeToken(""), "");
    assert.equal(normalizeToken("   "), "");
  });

  it("extracts value from JSON-wrapped token", () => {
    const wrapped = '{"value":"abc","__version":"0"}';
    assert.equal(normalizeToken(wrapped), "abc");
  });

  it("trims value inside JSON wrapper", () => {
    const wrapped = '{"value":"  xyz  ","__version":"0"}';
    assert.equal(normalizeToken(wrapped), "xyz");
  });

  it("extracts string from raw JSON string literal", () => {
    assert.equal(normalizeToken('"plain"'), "plain");
  });

  it("falls back to original string if JSON wrapper has no .value", () => {
    const json = '{"foo":"bar"}';
    assert.equal(normalizeToken(json), json);
  });

  it("handles malformed JSON gracefully", () => {
    assert.equal(normalizeToken("{not json"), "{not json");
  });
});

describe("isPlaceholderToken", () => {
  it("treats empty/null as placeholder", () => {
    assert.equal(isPlaceholderToken(""), true);
    assert.equal(isPlaceholderToken(null), true);
    assert.equal(isPlaceholderToken(undefined), true);
  });

  it("flags paste_userToken_here as placeholder", () => {
    assert.equal(isPlaceholderToken("paste_userToken_here"), true);
  });

  it("flags your_token as placeholder", () => {
    assert.equal(isPlaceholderToken("your_token"), true);
    assert.equal(isPlaceholderToken("YOUR_TOKEN"), true);
  });

  it("flags '...' as placeholder", () => {
    assert.equal(isPlaceholderToken("..."), true);
  });

  it("flags too-short tokens as placeholder", () => {
    assert.equal(isPlaceholderToken("abc"), true);
    assert.equal(isPlaceholderToken("1234567"), true);
  });

  it("accepts realistic tokens", () => {
    assert.equal(
      isPlaceholderToken("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.long.realistic"),
      false,
    );
  });
});

describe("cookieHeaderFromArray", () => {
  it("builds Cookie header from array of name/value pairs", () => {
    const result = cookieHeaderFromArray([
      { name: "ds_session_id", value: "abc" },
      { name: "other", value: "xyz" },
    ]);
    assert.equal(result, "ds_session_id=abc; other=xyz");
  });

  it("throws when ds_session_id is missing", () => {
    assert.throws(() => cookieHeaderFromArray([{ name: "other", value: "x" }]));
  });

  it("throws on non-array input", () => {
    assert.throws(() => cookieHeaderFromArray(null));
    assert.throws(() => cookieHeaderFromArray("string"));
    assert.throws(() => cookieHeaderFromArray({ name: "x" }));
  });

  it("filters out entries without name or value", () => {
    const result = cookieHeaderFromArray([
      { name: "ds_session_id", value: "x" },
      { name: "incomplete" },
      { value: "no-name" },
      null,
    ]);
    assert.equal(result, "ds_session_id=x");
  });
});

describe("DeepSeek token-only session", () => {
  it("loads a validated bearer token without requiring ds_session_id", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepseek-safari-auth-"));
    try {
      const file = path.join(dir, "auth.json");
      fs.writeFileSync(file, JSON.stringify({ userToken: "safari-user-token", cookies: [] }));
      const auth = readSavedAuth(file);
      assert.equal(auth.token, "safari-user-token");
      assert.equal(auth.cookieHeader, "");
      assert.equal("Cookie" in baseHeaders(auth.cookieHeader, auth.token), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
