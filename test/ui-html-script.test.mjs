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

  it("uses an in-app modal to confirm app updates", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(html, /id="updateConfirmOverlay"/);
    assert.match(html, /id="updateConfirmRun"/);
    assert.match(html, /id="updateConfirmCancel"/);
    assert.match(html, /document\.body\.appendChild\(updateConfirmOverlay\)/);
    assert.match(html, /#updateConfirmOverlay\s*\{\s*z-index: 3000;/);
    assert.match(html, /await confirmAppUpdate\(\)/);
    assert.doesNotMatch(html, /confirm\(t\("update\.confirm"\)\)/);
  });

  it("restarts the desktop app after installing an update from settings", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(html, /installAvailableUpdate\(lastCheck, \{ restart: true \}\)/);
  });

  it("shows an update toast only when an update is available", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(html, /id="updateToast" class="updateToast hidden"/);
    assert.match(html, /id="updateToastDownload"/);
    assert.match(html, /function renderUpdateToast\(data\)/);
    assert.match(html, /updateToast\.classList\.toggle\("hidden", !shouldShow\)/);
    assert.match(html, /checkUpdateToast\(\)\.catch\(\(\) => \{\}\)/);
    assert.match(html, /installAvailableUpdate\(availableUpdateCheck, \{ restart: true \}\)/);
    assert.match(html, /body: \{ restart: options\.restart === true \}/);
  });

  it("renders compact promo links in the desktop sidebar", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(html, /class="sidebarPromos"/);
    assert.match(html, /https:\/\/github\.com\/Staks-sor\/ai-free/);
    assert.match(html, /https:\/\/vibe\.stas-sor\.ru\//);
    assert.match(html, /AI Free на GitHub/);
    assert.match(html, /Здесь может быть ваша реклама/);
    assert.match(html, /VIBE: месяц за 100 ₽/);
    assert.match(html, /−75% по промокоду AIFREE/);
    assert.match(html, /id="vibePromoOverlay"/);
    assert.match(html, />ПРОМОКОД<\/span><code>AIFREE<\/code>/);
    assert.match(html, />Сайт<\/a>/);
    assert.match(html, />Telegram-бот<\/a>/);
    assert.match(html, /https:\/\/t\.me\/payments_meBot/);
    assert.doesNotMatch(html, /vibePromoToast/);
    assert.match(html, /sidebarPromoShift/);
    assert.match(html, /sidebarPromoGlint/);
    assert.match(html, /sidebarPromoMarkPulse/);
    assert.match(html, /\.sidebarPromo\s*\{/);
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

  it("polls external state changes and labels Telegram messages", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(html, /const EXTERNAL_STATE_POLL_MS = 2500/);
    assert.match(html, /setInterval\(refreshExternalState, EXTERNAL_STATE_POLL_MS\)/);
    assert.match(html, /conversationSummaryChanged\(previousActiveSummary, nextActiveSummary\)/);
    assert.match(html, /message\.source === "telegram" \? t\("chat\.you"\) \+ " · Telegram"/);
  });
});
