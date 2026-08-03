import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { renderWindowHtml } from "../src/window-app/ui-html.mjs";
import { renderWindowHtml as renderPluginWindowHtml } from "../plugin-for-vscode/src/window-app/ui-html.mjs";

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

  it("does not nest provider authorization buttons inside provider buttons", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(html, /const btn = document\.createElement\("div"\);\s*btn\.setAttribute\("role", "button"\);/);
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

  it("renders the EconomyOS giveaway banner without an invented purchase link", () => {
    for (const html of [renderWindowHtml({ language: "ru" }), renderPluginWindowHtml({ language: "ru" })]) {
      assert.match(html, /class="sidebarPromos"/);
      assert.match(html, /https:\/\/github\.com\/Staks-sor\/ai-free/);
      assert.match(html, /AI Free на GitHub/);
      assert.match(html, /Разместить рекламу/);
      assert.match(html, /Написать @Staks_sor в Telegram/);
      assert.match(html, /https:\/\/t\.me\/Staks_sor/);
      assert.doesNotMatch(html, /mailto:hello@stas-sor\.ru/);
      assert.match(html, /Розыгрыш API-ключа EconomyOS/);
      assert.match(html, /\$200 на 7 дней/);
      assert.match(html, /ДО 22:00 МСК/);
      assert.match(html, /Внимание: розыгрыш идёт до 22:00 по МСК\. Успей!/);
      assert.match(html, /Итоги на YouTube в 23:00 МСК/);
      assert.match(html, /Один победитель/);
      assert.match(html, /VIBE от 200 ₽\/месяц/);
      assert.match(html, /получите номер участника/i);
      assert.match(html, /Claude Opus, Codex и другие модели EconomyOS/);
      assert.match(html, /id="vibePromoOverlay"/);
      assert.match(html, /function announceGiveawayOnStartup\(\)/);
      assert.match(html, /setTimeout\(announceGiveawayOnStartup, 250\)/);
      assert.match(html, /window\.AudioContext \|\| window\.webkitAudioContext/);
      assert.match(html, /document\.addEventListener\("pointerdown", retrySound, \{ once: true \}\)/);
      assert.match(html, /https:\/\/vibe\.stas-sor\.ru\/raffle\/aifree/);
      assert.match(html, />Участвовать<\/a>/);
      assert.doesNotMatch(html, /Ссылка для участия появится здесь/);
      assert.match(html, /https:\/\/www\.youtube\.com\/@%D0%91%D1%83%D0%B4%D0%BD%D0%B8%D0%BF%D1%80%D0%BE%D0%B3/);
      assert.match(html, />YouTube-канал<\/a>/);
      assert.doesNotMatch(html, /https:\/\/t\.me\/payments_meBot/);
      assert.doesNotMatch(html, /vibePromoToast/);
      assert.match(html, /sidebarPromoShift/);
      assert.match(html, /sidebarPromoGlint/);
      assert.match(html, /sidebarPromoMarkPulse/);
      assert.match(html, /\.sidebarPromo\s*\{/);
      assert.match(html, /\.vibePromoPanel \{ width: min\(680px, 94vw\); max-width: 680px; \}/);
      assert.match(html, /\.vibePromoBody \{ display: grid; gap: 20px; padding: 24px 26px 26px; \}/);
      assert.match(html, /\.giveawayPrizeCard strong \{ color: var\(--giveaway-accent\); font-size: 30px;/);
    }
  });

  it("renders the EconomyOS BYOK integration without embedding a shared key", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(html, /EconomyOS by Virtuals/);
    assert.match(html, /https:\/\/compute\.virtuals\.io\/v1/);
    assert.match(html, /https:\/\/app\.virtuals\.io\/acp\/agents/);
    assert.match(html, /\/api\/settings\/economyos/);
    assert.match(html, /input\.type = "password"/);
    assert.doesNotMatch(html, /VIRTUALS_API_KEY\s*=/);
  });

  it("opens EconomyOS API settings from the new-chat authorization button", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(html, /if \(id === "economyos"\) \{\s*closeNewChatModal\(\);\s*await openSettings\("api"\);/);
    assert.doesNotMatch(html, /\bcloseNewChat\(\)/);
  });

  it("reads EconomyOS replies through the NDJSON streaming path", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(html, /\["qwen", "chatgpt", "deepseek", "economyos"\]\.includes\(sendProvider\)/);
  });

  it("sends EconomyOS images inline instead of uploading them through DeepSeek", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(html, /sendProvider === "chatgpt" \|\| sendProvider === "economyos"/);
    assert.match(html, /displayImages: inlineImages\.length \? \[\] : imageFiles\.map/);
    assert.match(html, /images: imageFiles\.map\(\(image\) => "data:" \+ image\.mimeType/);
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

  it("removes a stale permission overlay when the active chat has no pending request", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(
      html,
      /function renderPermissionRequest\(conversation\) \{\s*const existing = document\.getElementById\("permissionRequestOverlay"\);\s*if \(existing\) existing\.remove\(\);\s*const request = conversation\.pendingPermissionRequest;/,
    );
  });

  it("answers a permission request in the chat that owns it", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(html, /answerPermissionRequest\("approve", overlay, conversation\.id\)/);
    assert.match(html, /async function answerPermissionRequest\(action, overlay, conversationId\)/);
    assert.match(html, /"\/permission-request\/" \+ action/);
    assert.doesNotMatch(
      html,
      /api\("\/api\/conversations\/" \+ activeConversation\.id \+ "\/permission-request\/"/,
    );
  });

  it("claims the composer before the first asynchronous provider check", () => {
    const html = renderWindowHtml({ language: "ru" });
    const submitStart = html.indexOf('document.getElementById("composer").addEventListener("submit"');
    const submitEnd = html.indexOf('messageInput.addEventListener("keydown"', submitStart);
    const submitHandler = html.slice(submitStart, submitEnd);
    const claimIndex = submitHandler.indexOf("sending = true");
    const providerCheckIndex = submitHandler.indexOf("await refreshAvailableProviders()");

    assert.ok(claimIndex >= 0, "submit handler must claim the composer");
    assert.ok(providerCheckIndex >= 0, "submit handler must check provider availability");
    assert.ok(claimIndex < providerCheckIndex, "composer must be claimed before the first await");
  });
});
