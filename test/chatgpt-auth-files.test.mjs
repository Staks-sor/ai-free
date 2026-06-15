import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { sanitizeCookiesForStorage, pickEssentialChatGPTCookies, estimateCookieHeaderBytes } from "../src/providers/chatgpt/auth-files.mjs";

describe("ChatGPT cookie sanitization", () => {
  it("merges chunked session cookies and drops duplicate base entry", () => {
    const input = [
      {
        name: "__Secure-next-auth.session-token",
        value: "short",
        domain: ".chatgpt.com",
        path: "/",
      },
      {
        name: "__Secure-next-auth.session-token.0",
        value: "part-a",
        domain: ".chatgpt.com",
        path: "/",
      },
      {
        name: "__Secure-next-auth.session-token.1",
        value: "part-b",
        domain: ".chatgpt.com",
        path: "/",
      },
      {
        name: "cf_clearance",
        value: "abc",
        domain: ".chatgpt.com",
        path: "/",
      },
    ];

    const out = sanitizeCookiesForStorage(input);
    const names = out.map((c) => c.name);
    assert.ok(names.includes("cf_clearance"));
    assert.ok(names.includes("__Secure-next-auth.session-token"));
    assert.equal(names.filter((n) => n.startsWith("__Secure-next-auth.session-token")).length, 1);
    const merged = out.find((c) => c.name === "__Secure-next-auth.session-token");
    assert.equal(merged.value, "part-apart-b");
  });

  it("deduplicates identical cookies from repeated sync", () => {
    const cookie = {
      name: "oai-did",
      value: "uuid-123",
      domain: ".chatgpt.com",
      path: "/",
    };
    const out = sanitizeCookiesForStorage([cookie, cookie, cookie]);
    assert.equal(out.length, 1);
  });

  it("keeps only essential cookies for storage", () => {
    const input = [
      { name: "__Secure-next-auth.session-token", value: "tok", domain: ".chatgpt.com", path: "/" },
      { name: "cf_clearance", value: "cf", domain: ".chatgpt.com", path: "/" },
      { name: "_ga", value: "analytics", domain: ".chatgpt.com", path: "/" },
      { name: "random-ab-test", value: "x", domain: ".chatgpt.com", path: "/" },
    ];
    const out = pickEssentialChatGPTCookies(input);
    const names = out.map((c) => c.name);
    assert.ok(names.includes("__Secure-next-auth.session-token"));
    assert.ok(names.includes("cf_clearance"));
    assert.equal(names.includes("_ga"), false);
    assert.equal(estimateCookieHeaderBytes(out) < estimateCookieHeaderBytes(input), true);
  });
});
