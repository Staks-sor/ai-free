import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGitHubRemote } from "../src/code-agent/github-tools.mjs";

describe("github tools", () => {
  it("parses HTTPS and SSH GitHub remotes", () => {
    assert.deepEqual(parseGitHubRemote("https://github.com/Staks-sor/ai-free.git"), {
      owner: "Staks-sor", repo: "ai-free", slug: "Staks-sor/ai-free",
    });
    assert.equal(parseGitHubRemote("git@github.com:Staks-sor/ai-free.git")?.slug, "Staks-sor/ai-free");
    assert.equal(parseGitHubRemote("https://gitlab.com/a/b.git"), null);
  });
});
