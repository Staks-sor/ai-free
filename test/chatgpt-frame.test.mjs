import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as frame from "../src/window-app/provider-frame-chatgpt.mjs";

describe("rewriteChatGPTFrameBody", () => {
  it("rewrites root-relative asset paths in HTML", () => {
    const html = '<html><head></head><body><link rel="stylesheet" href="/_next/static/css/app.css"></body></html>';
    const out = frame.rewriteChatGPTFrameBodyForTest(html, "text/html").toString("utf8");
    assert.match(out, /<base href="\/provider-frame\/chatgpt\/">/);
    assert.match(out, /href="\/provider-frame\/chatgpt\/_next\/static\/css\/app.css"/);
  });

  it("rewrites root-relative urls in CSS", () => {
    const css = ".x { background: url(/cdn/assets/bg.png); }";
    const out = frame.rewriteChatGPTFrameBodyForTest(css, "text/css").toString("utf8");
    assert.match(out, /url\(\/provider-frame\/chatgpt\/cdn\/assets\/bg.png\)/);
  });
});

describe("ChatGPT frame upstream security", () => {
  it("filters local session cookies from both saved and request cookies", () => {
    const header = frame.buildUpstreamCookieHeaderForTest({
      headers: { cookie: "prefs=client; synvox_session=local; synvox_session_43123=local-port" },
    }, {
      cookies: [
        { name: "__Secure-next-auth.session-token", value: "saved-auth" },
        { name: "synvox_session", value: "saved-local" },
        { name: "synvox_session_43123", value: "saved-local-port" },
      ],
    });
    assert.equal(header, "__Secure-next-auth.session-token=saved-auth; prefs=client");
  });

  it("strips every local session header before HTTP and upgrade forwarding", () => {
    const headers = frame.stripLocalSessionHeadersForTest({
      "x-synvox-session": "local",
      "X-Synvox-Session-Token": "local-token",
      "x-request-id": "keep",
    });
    assert.deepEqual(headers, { "x-request-id": "keep" });
  });

  it("sends no cookies or Authorization on CDN requests even with synthetic auth available", () => {
    const headers = frame.buildChatGPTCDNHeadersForTest({
      headers: {
        cookie: "session=local; synvox_session=local",
        authorization: "Bearer local",
        "x-synvox-session": "local",
      },
    }, "cdn.oaistatic.com", {
      cookies: [{ name: "__Secure-next-auth.session-token", value: "synthetic-auth" }],
      userAgent: "synthetic-auth-user-agent",
    });
    assert.equal(headers.cookie, undefined);
    assert.equal(headers.authorization, undefined);
    assert.equal(headers["x-synvox-session"], undefined);
    assert.equal(headers["user-agent"], undefined);
    assert.equal(headers.host, "cdn.oaistatic.com");
  });

  it("accepts only allowlisted CDN hostnames with a real subdomain boundary", () => {
    for (const host of ["oaistatic.com", "cdn.oaistatic.com", "a.b.oaistatic.com", "files.oaiusercontent.com", "ab.chatgpt.com"]) {
      assert.equal(frame.isAllowedChatGPTCDNHostnameForTest(host), true, host);
    }
    for (const host of ["evil-oaistatic.com", "oaistatic.com.attacker.test", "attacker.test", "127.0.0.1", "cdn..oaistatic.com"]) {
      assert.equal(frame.isAllowedChatGPTCDNHostnameForTest(host), false, host);
    }
  });

  it("does not rewrite attacker-controlled CDN locations", () => {
    assert.equal(
      frame.rewriteChatGPTFrameLocationForTest("https://cdn.oaistatic.com/assets/app.css"),
      "/provider-frame/chatgpt-cdn/cdn.oaistatic.com/assets/app.css",
    );
    assert.equal(
      frame.rewriteChatGPTFrameLocationForTest("https://evil-oaistatic.com/assets/app.css"),
      "https://evil-oaistatic.com/assets/app.css",
    );
  });

  it("rewrites only allowlisted CDN hosts in raw and escaped body URLs", () => {
    const body = 'https://cdn.oaistatic.com/a.js https://evil-oaistatic.com/a.js https:\\/\\/files.oaiusercontent.com\\/b.js';
    const out = frame.rewriteChatGPTFrameBodyForTest(body, "application/javascript").toString("utf8");
    assert.match(out, /\/provider-frame\/chatgpt-cdn\/cdn\.oaistatic\.com\/a\.js/);
    assert.match(out, /https:\/\/evil-oaistatic\.com\/a\.js/);
    assert.match(out, /\/provider-frame\\\/chatgpt-cdn\\\/files\.oaiusercontent\.com\\\/b\.js/);
  });

  it("rejects an untrusted CDN target before auth lookup or network access", () => {
    for (const path of ["/provider-frame/chatgpt-cdn/evil-oaistatic.com", "/provider-frame/chatgpt-cdn/evil-oaistatic.com/a.css"]) {
      assert.equal(frame.resolveChatGPTFrameTargetForTest(path).status, 403);
    }
    assert.deepEqual(
      frame.resolveChatGPTFrameTargetForTest("/provider-frame/chatgpt-cdn/cdn.oaistatic.com/a.css"),
      { hostname: "cdn.oaistatic.com", upstreamPath: "/a.css", isCDN: true },
    );
  });
});
