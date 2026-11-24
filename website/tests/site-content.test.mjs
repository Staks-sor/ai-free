import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  benefits,
  downloadPlatforms,
  navigation,
  providers,
  releaseState,
  site,
} from "../src/lib/content/site.js";
import { csr, prerender } from "../src/routes/+layout.js";

test("the marketing site ships as static HTML without client hydration", () => {
  assert.equal(prerender, true);
  assert.equal(csr, false);
});

test("the public site has one product identity and one primary action", () => {
  assert.equal(site.brand, "SYNVOX");
  assert.equal(site.url, "https://synvox.pro");
  assert.equal(site.primaryCta.href, "#download");
  assert.equal(site.primaryCta.label, "Скачать SYNVOX");
  assert.equal(site.paymentLocation, "none");
  assert.ok(site.description.length < 150);
  assert.equal(site.secondaryCta, undefined);
});

test("the product difference is explained in three short human benefits", () => {
  assert.equal(benefits.length, 3);
  assert.deepEqual(
    benefits.map((item) => item.title),
    ["Видит проект", "Может сделать", "Помнит решения"],
  );
  assert.ok(benefits.every((item) => item.title.length < 45));
  assert.ok(benefits.every((item) => item.description.length < 100));
});

test("the page names supported AI services and explains local ownership", () => {
  assert.deepEqual(providers, ["ChatGPT", "Qwen", "DeepSeek", "Google AI", "GLM"]);
  assert.match(site.localPromise, /остаются на вашем устройстве/i);
  assert.match(site.description, /проект/i);
});

test("navigation stays focused on the product and release hub", () => {
  assert.deepEqual(
    navigation.map((item) => item.href),
    ["/#product", "/updates", "/documents"],
  );
});

test("download and release states are explicit before public binaries exist", () => {
  assert.deepEqual(
    downloadPlatforms.map((platform) => platform.name),
    ["macOS", "Windows", "Linux"],
  );
  assert.ok(downloadPlatforms.every((platform) => platform.status === "Node.js 22+"));
  assert.equal(releaseState.status, "alpha");
  assert.match(releaseState.message, /Node.js 22\+/i);
  assert.match(releaseState.message, /распространяется бесплатно/i);
});

test("search and AI crawlers receive explicit public guidance", async () => {
  const [robots, llms] = await Promise.all([
    readFile(new URL("../static/robots.txt", import.meta.url), "utf8"),
    readFile(new URL("../static/llms.txt", import.meta.url), "utf8"),
  ]);

  assert.match(robots, /User-agent: \*/);
  assert.match(robots, /Allow: \//);
  assert.match(robots, /OAI-SearchBot/);
  assert.match(robots, /Sitemap: https:\/\/synvox\.pro\/sitemap\.xml/);
  assert.match(llms, /SYNVOX/);
  assert.match(llms, /VS Code, PyCharm/i);
});
