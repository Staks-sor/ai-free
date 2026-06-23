import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { renderWindowHtml } from "../src/window-app/ui-html.mjs";

describe("ui-html inline script", () => {
  it("generates syntactically valid browser script", () => {
    const html = renderWindowHtml({ language: "ru" });
    const match = html.match(/<script>([\s\S]*)<\/script>/);
    assert.ok(match, "expected inline script block");
    const dir = mkdtempSync(join(tmpdir(), "ai-free-ui-"));
    const file = join(dir, "ui-script.js");
    writeFileSync(file, match[1]);
    assert.doesNotThrow(() => {
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    });
  });

  it("does not nest the chat delete button inside another button", () => {
    const html = renderWindowHtml({ language: "ru" });
    const match = html.match(/<script>([\s\S]*)<\/script>/);
    assert.ok(match, "expected inline script block");
    assert.match(match[1], /const button = document\.createElement\("div"\);/);
    assert.doesNotMatch(
      match[1],
      /const button = document\.createElement\("button"\);[\s\S]{0,500}class="chatDelete"/,
    );
  });

  it("uses an in-app modal to confirm chat deletion", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(html, /id="deleteChatOverlay"/);
    assert.match(html, /id="deleteChatConfirm"/);
    assert.match(html, /id="deleteChatCancel"/);
    assert.match(html, /await confirmChatDeletion\(conversation\)/);
    assert.doesNotMatch(html, /confirm\(t\("chat\.deleteConfirm"\)\)/);
  });

  it("shows Coder and ESP controls for ChatGPT conversations", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.doesNotMatch(html, /if \(prov === "chatgpt"\) \{\s*coderToggleEl\.classList\.add\("hidden"\)/);
    assert.match(html, /Coder\/ESP работают для всех провайдеров/);
    assert.doesNotMatch(
      html,
      /activeConversation\.coderMode === true && \(activeConversation\.provider \|\| "deepseek"\) !== "chatgpt"/,
    );
  });

  it("progressively fills Coder and ESP background messages", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(html, /const progressiveTextState = new Map\(\)/);
    assert.match(html, /typeProgressiveText\(textEl, message\.content \|\| "…"/);
    assert.match(html, /renderConversation\(activeConversation, \{ animateLastAssistant: true \}\)/);
  });

  it("does not force chat scroll while the user is reading older messages", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(html, /let chatAutoFollow = true/);
    assert.match(html, /chatAutoFollow = isMessagesNearBottom\(\)/);
    assert.match(html, /if \(!chatAutoFollow\) return/);
    assert.match(html, /messages\.scrollTop = previousScrollTop/);
  });

  it("adds clipboard images through the normal attachment flow", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(html, /messageInput\.addEventListener\("paste"/);
    assert.match(html, /item\.kind === "file" && item\.type\.startsWith\("image\/"\)/);
    assert.match(html, /await addAttachmentFiles\(imageFiles, \{ fromClipboard: true \}\)/);
    assert.match(html, /event\.preventDefault\(\)/);
  });
});
