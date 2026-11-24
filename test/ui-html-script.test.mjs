import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";
import { renderWindowHtml } from "../src/window-app/ui-html.mjs";
import { renderWindowHtml as renderPluginWindowHtml } from "../plugin-for-vscode/src/window-app/ui-html.mjs";

describe("ui-html inline script", () => {
  it("starts provider authorization directly from the New Chat button", () => {
    for (const html of [renderWindowHtml({ language: "ru" }), renderPluginWindowHtml({ language: "ru" })]) {
      const handler = html.match(/async function connectProvider\([\s\S]*?\n    async function installCodexRuntimeFromUi/);
      assert.ok(handler, "provider authorization handler must exist");
      assert.doesNotMatch(handler[0], /\bconfirm\(/, "native confirmation can silently cancel authorization");
      assert.match(handler[0], /fetch\("\/api\/providers\/" \+ id \+ "\/login", \{ method: "POST" \}\)/);
    }
  });
  it("refreshes Qwen models when the model picker is opened", () => {
    for (const html of [renderWindowHtml({ language: "ru" }), renderPluginWindowHtml({ language: "ru" })]) {
      assert.match(html, /modelPickerEl\.addEventListener\("focus",[\s\S]*?refreshModelCatalog\(\{ forceQwen: true \}\)/);
      assert.match(html, /\/api\/model-catalog\?refresh=qwen/);
      assert.match(html, /async function openNewChatModal\(source = null\)\s*\{[\s\S]*?await refreshModelCatalog\(\{ forceQwen: true \}\)/);
      assert.match(html, /if \(!info\.models\.some\(\(item\) => item\.id === currentModel\)\)/);
    }
  });
  it("shows the SYNVOX window title without subscription status", () => {
    for (const html of [renderWindowHtml({ language: "ru" }), renderPluginWindowHtml({ language: "ru" })]) {
      assert.match(html, /<title>SYNVOX v[^<]+<\/title>/);
      assert.match(html, /<strong>SYNVOX<\/strong>/);
      assert.doesNotMatch(html, /id="sidebarSubscription"/);
      assert.doesNotMatch(html, /<title>AI Free v/);
    }
  });

  it("keeps pipeline actions separate from its responsive conversation list", () => {
    for (const html of [renderWindowHtml({ language: "ru" }), renderPluginWindowHtml({ language: "ru" })]) {
      assert.match(html, /\.pipelinePanel\s*\{[\s\S]*?grid-template-rows:\s*auto auto minmax\(0, 1fr\)/);
      assert.match(html, /\.pipelineBody\s*\{[\s\S]*?min-height:\s*0/);
      assert.match(html, /@media \(max-width: 900px\)[\s\S]*?\.pipelineNodeMeta\s*\{[\s\S]*?grid-column:\s*1 \/ -1/);
      assert.match(html, /@media \(max-width: 640px\)[\s\S]*?\.pipelineRow\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
      assert.match(html, /@media \(max-width: 640px\)[\s\S]*?\.pipelinePanel\s*\{[\s\S]*?position:\s*fixed/);
      assert.match(html, /role="dialog"[^>]*aria-labelledby="pipelineTitle"/);
      assert.match(html, /roleSelect\.setAttribute\("aria-label"/);
      assert.match(html, /pipelinePanelBtn\.focus\(\);\s*pipelinePanel\.classList\.add\("hidden"\)/);
    }
  });

  it("configures an agent team inside the active chat", () => {
    for (const html of [renderWindowHtml({ language: "ru" }), renderPluginWindowHtml({ language: "ru" })]) {
      assert.doesNotMatch(html, /id="pipelineMakeLeader"/);
      assert.match(html, /activeConversation\.pipelineAgents/);
      assert.match(html, /body:\s*\{[^}]*pipelineAgents[^}]*pipelineMode:\s*true/);
      const addAgentHandler = html.match(/pipelineAddAgent\.addEventListener\("click"[\s\S]*?\n\s*function renderPipelinePanel/);
      assert.ok(addAgentHandler, "pipeline add-agent handler must exist");
      assert.doesNotMatch(addAgentHandler[0], /api\("\/api\/conversations",\s*\{\s*method:\s*"POST"/);
      assert.doesNotMatch(html, /nextSelect\.setAttribute\("aria-label"/);
      assert.match(html, /providerSelect\.setAttribute\("aria-label",\s*t\("pipeline\.provider"\)/);
      assert.match(html, /modelSelect\.setAttribute\("aria-label",\s*t\("pipeline\.model"\)/);
      assert.match(html, /message\.agentProvider/);
      assert.match(html, /message\.agentModel/);
      assert.match(html, /message\.pipelineCoordinator\s*\?\s*t\("pipeline\.leader"\)/);
    }
  });

  it("organizes agent settings into focused sections without exposing technical memory noise", () => {
    for (const html of [renderWindowHtml({ language: "ru" }), renderPluginWindowHtml({ language: "ru" })]) {
      assert.match(html, /className = "agentSettingsNav"/);
      assert.match(html, /settings\.agentSectionGeneral/);
      assert.match(html, /settings\.agentSectionPlugins/);
      assert.match(html, /settings\.agentSectionSkills/);
      assert.match(html, /settings\.agentSectionMemory/);
      assert.match(html, /role", "tablist"/);
      assert.match(html, /aria-selected/);
      assert.match(html, /function compactMemoryPreview/);
      assert.ok(html.includes('.replace(/<think>[\\s\\S]*?<\\/think>/gi, " ")'));
      assert.match(html, /settings\.memoryCurrentProject/);
      assert.match(html, /settings\.memoryTypeFix/);
      assert.match(html, /className = "settingsTechnicalDetails"/);
      assert.doesNotMatch(html, /descEl\.textContent = \(skill\.description \|\| skill\.id\) \+ " · " \+ t\("settings\.skillCommands"/);
      assert.match(html, /\.agentSettingsSection\.active\s*\{[\s\S]*?display:\s*grid/);
    }
  });

  it("provides documents, alpha notice, privacy information and account deletion access", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(html, /data-panel="documents"|id: "documents"/);
    assert.match(html, /function renderLegalSettings/);
    assert.match(html, /Условия бесплатного использования SYNVOX/);
    assert.match(html, /Политика обработки персональных данных/);
    assert.match(html, /SYNVOX распространяется бесплатно/);
    assert.match(html, /Удалить меня из системы/);
    assert.match(html, /showLegalConsentIfNeeded/);
    assert.match(html, /\/api\/legal\/consents/);
    assert.match(html, /termsAccepted/);
    assert.match(html, /personalDataAccepted/);
    assert.match(html, /alphaAcknowledged/);
  });

  it("clears the completed marker only after the chat opens successfully", async () => {
    for (const html of [renderWindowHtml({ language: "ru" }), renderPluginWindowHtml({ language: "ru" })]) {
      const handler = html.match(/const openConversation = async \(\) => \{[\s\S]*?\n        \};/)?.[0];
      assert.ok(handler);
      const completedChatIds = new Set(["a"]);
      const context = vm.createContext({
        conversation: { id: "a" }, appState: { activeConversationId: "b" }, activeConversation: null, selectionGeneration: 0,
        completedChatIds, api: async () => { throw new Error("network unavailable"); },
        renderList() {}, renderConversation() {},
      });
      vm.runInContext(handler + "\nglobalThis.openConversation = openConversation;", context);
      await assert.rejects(context.openConversation(), /network unavailable/);
      assert.ok(completedChatIds.has("a"));
      context.api = async () => ({ conversation: { id: "a" } });
      await context.openConversation();
      assert.equal(completedChatIds.has("a"), false);
      assert.equal(context.appState.activeConversationId, "a");
    }
  });

  it("detects completed background tasks whichever state poll finishes first", async () => {
    for (const render of [renderWindowHtml, renderPluginWindowHtml]) {
      const html = render({ language: "ru" });
      const syncCode = html.slice(html.indexOf("    function conversationSummaryChanged("), html.indexOf("    let installPollTimer"));
      const pollCode = html.slice(html.indexOf("    async function pollTick()"), html.indexOf("    function renderList()"));
      for (const order of [["refreshExternalState", "pollTick"], ["pollTick", "refreshExternalState"]]) {
        const conversations = [{ id: "a", updatedAt: "1", messageCount: 2 }, { id: "b", updatedAt: "1", messageCount: 0 }];
        const completedChatIds = new Set();
        const context = vm.createContext({
          appState: { conversations, runningTaskIds: ["a"], activeConversationId: "b" },
          activeConversation: null, selectionGeneration: 0, completedChatIds, externalStateRefreshing: false, shutdownStarted: false,
          api: async () => ({ conversations, runningTaskIds: [], activeConversationId: "b" }),
          renderList() {}, updateStopButton() {}, renderConversation() {}, ensurePolling() {}, stopPolling() {},
        });
        vm.runInContext(syncCode + pollCode, context);
        for (const name of order) await context[name]();
        assert.deepEqual([...completedChatIds], ["a"], order.join(" → "));
        // Repeated polls must preserve the unread marker.
        await context.pollTick();
        assert.deepEqual([...completedChatIds], ["a"]);
      }
    }
  });

  it("refreshes background chat summaries and clears an externally deleted active chat", async () => {
    for (const render of [renderWindowHtml, renderPluginWindowHtml]) {
      const html = render({ language: "ru" });
      const syncCode = html.slice(html.indexOf("    function conversationSummaryChanged("), html.indexOf("    let installPollTimer"));
      let listRenders = 0, emptyRenders = 0;
      const context = vm.createContext({
        appState: { conversations: [{ id:"a", title:"A" }, { id:"b", title:"B" }], runningTaskIds:[], activeConversationId:"a" },
        activeConversation: { id:"a" }, selectionGeneration: 0, completedChatIds: new Set(), externalStateRefreshing:false, shutdownStarted:false,
        api: async () => ({ conversations:[{ id:"a", title:"A" }, { id:"b", title:"changed" }], runningTaskIds:[], activeConversationId:"b" }),
        renderList() { listRenders++; }, renderNoConversation() { emptyRenders++; }, updateStopButton() {}, ensurePolling() {},
      });
      vm.runInContext(syncCode, context); await context.refreshExternalState();
      assert.equal(listRenders, 1); assert.equal(context.appState.activeConversationId, "a");
      context.api = async url => { assert.equal(url, "/api/state"); return { conversations:[{ id:"b", title:"changed" }], runningTaskIds:[], activeConversationId:"b" }; };
      await context.refreshExternalState();
      assert.equal(context.activeConversation, null); assert.equal(context.appState.activeConversationId, null);
      assert.equal(emptyRenders, 1);
    }
  });

  it("lets users review the current legal documents and consent in Russian or English", () => {
    for (const html of [renderWindowHtml({ language: "ru" }), renderPluginWindowHtml({ language: "en" })]) {
      assert.match(html, /id = "consentLanguage"/);
      assert.match(html, /https:\/\/synvox\.pro\/documents\//);
      assert.match(html, /https:\/\/synvox\.pro\/en\/documents\//);
      assert.match(html, /I have read the free-use terms/);
      assert.match(html, /CONSENT_LEGAL_VERSION/);
    }
  });

  it("hides optional composer controls until a supported active model is selected", () => {
    for (const html of [renderWindowHtml({ language: "ru" }), renderPluginWindowHtml({ language: "ru" })]) {
      assert.match(html, /id="toggleThinking"[^>]*class="[^"]*hidden/);
      assert.match(html, /id="toggleSearch"[^>]*class="[^"]*hidden/);
      assert.match(html, /supportsThinkingControl/);
      assert.match(html, /supportsSearchControl/);
      assert.match(html, /\.togglePill\.hidden\s*\{\s*display:\s*none/);
    }
  });

  it("keeps API settings concise and moves secondary information into disclosures", () => {
    for (const html of [renderWindowHtml({ language: "ru" }), renderPluginWindowHtml({ language: "ru" })]) {
      assert.match(html, /className = "apiDetails"/);
      assert.match(html, /className = "apiCompatibilityDetails"/);
      assert.match(html, /document\.createElement\("details"\)/);
      assert.match(html, /document\.createElement\("summary"\)/);
      assert.match(html, /summary\.textContent = t\("settings\.apiDetails"\)/);
      assert.match(html, /detailsBody\.appendChild\(note\)/);
      assert.match(html, /compatibilityBody\.append\(grid, note\)/);
      assert.match(html, /@media \(max-width: 640px\)[\s\S]*?\.apiKeyRow\s*\{[\s\S]*?grid-template-areas:/);
    }
  });

  it("groups permissions into a compact overview and collapsible command sections", () => {
    for (const html of [renderWindowHtml({ language: "ru" }), renderPluginWindowHtml({ language: "ru" })]) {
      assert.match(html, /className = "permissionOverview"/);
      assert.match(html, /className = "settingsItem permissionSettingCard"/);
      assert.match(html, /className = "permissionCommandGroup " \+ key/);
      assert.match(html, /className = "permissionCommandSummary"/);
      assert.match(html, /className = "permissionCommandList"/);
      assert.match(html, /enabledCount \+ " \/ " \+ items\.length/);
      assert.match(html, /@media \(max-width: 640px\)[\s\S]*?\.permissionOverview\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
      assert.doesNotMatch(html, /name: "Удаление и опасные локальные действия"/);
    }
  });

  it("uses the original SYNVOX mark in the workspace shell with clear chat surfaces", () => {
    for (const html of [renderWindowHtml({ language: "ru" }), renderPluginWindowHtml({ language: "ru" })]) {
      assert.match(html, /class="workspaceBrand"><img src="\/assets\/synvox-mark\.png"/);
      assert.match(html, /class="workspaceChatPane"/);
      assert.doesNotMatch(html, /class="chatWatermark" aria-hidden="true"/);
    }
  });

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

  it("renders Codex CLI as a ChatGPT mode instead of a separate provider card", () => {
    for (const html of [renderWindowHtml({ language: "ru" }), renderPluginWindowHtml({ language: "ru" })]) {
      assert.match(html, /info\.hiddenInProviderPicker/);
      assert.match(html, /modeDef\?\.provider \|\| newChatSelectedProvider/);
      assert.match(html, /provider:\s*selectedModeProvider/);
    }
  });

  it("exposes Codex install and ChatGPT login actions inside the ChatGPT Codex mode", () => {
    for (const html of [renderWindowHtml({ language: "ru" }), renderPluginWindowHtml({ language: "ru" })]) {
      assert.match(html, /codexModeAction/);
      assert.match(html, /Установить CLI/);
      assert.match(html, /Войти через ChatGPT/);
      assert.match(html, /installCodexRuntimeFromUi/);
      assert.match(html, /connectProvider\("codex"/);
      assert.match(html, /modeProvider === "codex"/);
    }
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

  it("keeps only current static sidebar promos", () => {
    for (const html of [renderWindowHtml({ language: "ru" }), renderPluginWindowHtml({ language: "ru" })]) {
      assert.match(html, /class="workspaceFooterAd"/);
      assert.doesNotMatch(html, /https:\/\/github\.com\/Staks-sor\/ai-free/);
      assert.doesNotMatch(html, /AI Free на GitHub|Поставить звезду|sidebarPromoGithub/);
      assert.match(html, /Разместить рекламу/);
      assert.match(html, /написать @Staks_sor в Telegram/);
      assert.match(html, /https:\/\/t\.me\/Staks_sor/);
      assert.doesNotMatch(html, /mailto:hello@stas-sor\.ru/);
      assert.doesNotMatch(html, /Розыгрыш API-ключа EconomyOS/);
      assert.doesNotMatch(html, /\$200 на 7 дней/);
      assert.doesNotMatch(html, /vibePromoOverlay|vibePromoOpen|announceGiveawayOnStartup/);
      assert.doesNotMatch(html, /playGiveawayAlertSound|giveawaySoundPlayed/);
      assert.doesNotMatch(html, /https:\/\/vibe\.stas-sor\.ru\/raffle\/aifree/);
      assert.doesNotMatch(html, /sidebarPromoShift|sidebarPromoGlint|sidebarPromoMarkPulse/);
      assert.match(html, /\.sidebarPromo\s*\{/);
    }
  });

  it("does not render the removed EconomyOS integration", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.doesNotMatch(html, /EconomyOS|Virtuals|economyos|VIRTUALS_API_KEY/i);
  });

  it("starts the sidebar with the new chat action without a workspace header", () => {
    for (const html of [renderWindowHtml({ language: "ru" }), renderPluginWindowHtml({ language: "ru" })]) {
      assert.doesNotMatch(html, /class="sideHead"|id="refreshBtn"/);
      assert.doesNotMatch(html, /getElementById\("refreshBtn"\)/);
    }
  });

  it("exposes explicit discussion/execution modes and keeps memory separate from the workspace browser", () => {
    for (const html of [renderWindowHtml({ language: "ru" }), renderPluginWindowHtml({ language: "ru" })]) {
      assert.doesNotMatch(html, /id="coderToggle"|coderToggleEl/);
      assert.doesNotMatch(html, /class="agentDrawerTabs"|data-tab="browser"/);
      assert.match(html, /id="agentBrowserBtn"/);
      assert.match(html, /id="agentDrawerSettingsBtn"/);
      assert.match(html, /openAgentDrawer\("browser"\)/);
      assert.match(html, /openSettings\("agent"\)/);
      assert.match(html, /activeConversation\.interactionMode === "discuss"/);
      assert.match(html, /id="workspaceDiscuss"/);
      assert.match(html, /id="workspaceExecute"/);
      assert.doesNotMatch(html, /id="hardwareToggle"|id="pipelineToggle"|id="memoryToggle"|id="autoSkillToggle"/);
    }
  });

  it("replaces the topbar memory shortcut with an accessible guided product tour", () => {
    for (const html of [renderWindowHtml({ language: "ru" }), renderPluginWindowHtml({ language: "ru" })]) {
      assert.match(html, /id="agentDrawerBtn"[^>]*class="[^"]*hidden/);
      assert.match(html, /id="tourBtn"[^>]*>Обучение<\/button>/);
      assert.match(html, /const tourSteps = \[/);
      assert.match(html, /settingsTab: "status"/);
      assert.match(html, /settingsTab: "agent"/);
      assert.match(html, /settingsTab: "api"/);
      assert.match(html, /settingsTab: "permissions"/);
      assert.match(html, /settingsTab: "documents"/);
      assert.match(html, /prepareProductTourStep/);
      assert.match(html, /function startProductTour/);
      assert.match(html, /aria-modal/);
      assert.match(html, /\.tourSpotlight\s*\{/);
      assert.match(html, /prefers-reduced-motion/);
    }
  });

  it("progressively fills Coder and ESP background messages", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(html, /const progressiveTextState = new Map\(\)/);
    assert.match(html, /typeProgressiveText\(textEl, message\.content \|\| "…"/);
    assert.match(html, /renderConversation\(activeConversation, \{ animateLastAssistant: true \}\)/);
  });

  it("reads browser-provider chat responses as an NDJSON stream", () => {
    for (const html of [renderWindowHtml({ language: "ru" }), renderPluginWindowHtml({ language: "ru" })]) {
      assert.match(html, /\["qwen", "chatgpt", "deepseek", "googleai", "glm"\]\.includes\(sendProvider\)/);
      assert.match(html, /await postStreamingMessage\(sentConvId, messageBody, sendProvider, sentConversation\)/);
    }
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

  it("shows truthful model media badges and transcribes attached audio", () => {
    for (const html of [renderWindowHtml({ language: "ru" }), renderPluginWindowHtml({ language: "ru" })]) {
      assert.match(html, /id="modelCapabilities"/);
      assert.match(html, /function resolveActiveMediaCapabilities/);
      assert.match(html, /media\.imageInput/);
      assert.match(html, /media\.imageOutput/);
      assert.match(html, /media\.audioInput/);
      assert.match(html, /badge\.title = label/);
      assert.match(html, /badge\.setAttribute\("aria-label", label\)/);
      assert.match(html, /const isAudio =/);
      assert.match(html, /await transcribeAudioBlob\(file/);
      assert.match(html, /file\.imageUnsupported/);
      assert.doesNotMatch(html, /t\("file\.qwenImageUnsupported"\)/);
    }
  });

  it("shows thinking and search controls only when the selected model can use them", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(html, /function supportsThinkingControl\(provider, model\)/);
    assert.match(html, /provider === "deepseek" \|\| provider === "qwen"/);
    assert.match(html, /function supportsSearchControl\(provider, model\)/);
    assert.match(html, /provider === "deepseek"/);
    assert.match(html, /provider === "qwen" && model\?\.search === true/);
    assert.match(html, /toggleThinking\.classList\.toggle\("hidden", !thinkingSupported\)/);
    assert.match(html, /toggleSearch\.classList\.toggle\("hidden", !searchSupported\)/);
  });

  it("blocks image attachments for every model without an image route", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(html, /imageFiles\.length && !resolveActiveMediaCapabilities\(\)\.imageInput/);
    assert.match(html, /file\.imageUnsupported/);
    assert.doesNotMatch(html, /t\("file\.qwenImageUnsupported"\)/);
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
    const claimIndex = submitHandler.indexOf("chatDrafts.startSend(sentConvId)");
    const providerCheckIndex = submitHandler.indexOf("await refreshAvailableProviders()");

    assert.ok(claimIndex >= 0, "submit handler must claim the composer");
    assert.ok(providerCheckIndex >= 0, "submit handler must check provider availability");
    assert.ok(claimIndex < providerCheckIndex, "composer must be claimed before the first await");
  });

  it("renders a collapsible reasoning accordion when assistant message contains <think>", () => {
    const html = renderWindowHtml({ language: "ru" });
    assert.match(html, /function splitThinkingContent/);
    assert.match(html, /if \(!\/\^\\s\*<think>\/\.test\(text\)\)/);
    assert.match(html, /replace\(\/\^\\s\*Thought Process\\s\*/);
    assert.match(html, /thinkingDetails\.className = "thinkingAccordion"/);
    assert.match(html, /thinkingSummary\.className = "thinkingSummary"/);
    assert.match(html, /thinkingBody\.className = "thinkingBody"/);
  });
});
