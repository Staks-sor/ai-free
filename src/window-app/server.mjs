// HTTP-сервер окна чатов на 127.0.0.1:port. Биндится только на loopback —
// снаружи недоступен. Реализует все REST-эндпойнты, которые рисует фронт.
// На SIGINT/SIGTERM/SIGHUP — graceful shutdown, фронт замечает через heartbeat и закрывается.

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { openAppWindow } from "../browser/launch.mjs";
import { AGENT_ROLES, getAgentRole, normalizeRoleId } from "../agent-runtime/roles.mjs";
import { getCommandExecutionEnv } from "../code-agent/executor.mjs";
import { runAgentTask } from "../agent-orchestrator/index.mjs";
import { CODE_AGENT_PROMPT_VERSION } from "../code-agent/prompt.mjs";
import {
  COMMAND_CATALOG,
  ensureOpenAICompatApiKey,
  loadSettings,
  resolveOpenAICompatApiKey,
  saveSettings,
} from "../state/settings.mjs";
import { conversationList, makeConversationTitle, shouldAutoTitle } from "../state/conversations.mjs";
import { startTask, isRunning, getRunningIds, stopTask } from "./task-runner.mjs";
import { getShutdownStatus, registerShutdownServerCloser, requestAppShutdown } from "../app-shutdown.mjs";
import { getStateFile, loadWindowState, saveWindowState } from "../state/window-state.mjs";
import { LANGUAGES, getLanguageMeta } from "../i18n/index.mjs";
import { getLocalizedAgentRoles } from "../i18n/agent-roles.mjs";
import { getCommandDescription } from "../i18n/command-descriptions.mjs";
import { listBrowseDirectories } from "./browse-fs.mjs";
import {
  beginNdjsonStream,
  endNdjsonStream,
  readJsonBody,
  sendHtml,
  sendJson,
  writeNdjsonLine,
} from "./http.mjs";
import { renderWindowHtml } from "./ui-html.mjs";
import { renderEmbedWorkspaceHtml } from "./embed-workspace.mjs";
import { renderEmbedBrowserHtml } from "./embed-browser.mjs";
import {
  handleChatGPTLiveInput,
  handleChatGPTLiveStream,
  handleChatGPTSyncSession,
  reloadChatGPTLivePage,
  resetChatGPTLiveSession,
  renderEmbedChatGPTLiveHtml,
  setChatGPTPanelViewport,
  warmChatGPTInAppBrowser,
} from "./chatgpt-live-panel.mjs";
import {
  handleAppBrowserLiveInput,
  handleAppBrowserLiveStream,
  handleAppBrowserNavigate,
  handleAppBrowserReset,
  handleAppBrowserSnapshot,
  renderEmbedAppBrowserLiveHtml,
  setAppBrowserLiveViewport,
} from "./app-browser-live.mjs";
import {
  handleChatGPTFrameProxy,
  handleChatGPTFrameUpgrade,
  isChatGPTFramePath,
} from "./provider-frame-chatgpt.mjs";
import {
  AGENT_TASK_EMPTY_HELP,
  buildAgentTaskOptions,
  finalizeCodeTaskMessage,
  resolveConversationAgentTask,
} from "./agent-task.mjs";
import { handleMemoryRoute } from "./routes/memory.mjs";
import { handleSkillsRoute } from "./routes/skills.mjs";
import { handlePluginsRoute } from "./routes/plugins.mjs";
import { createCodeMemorySavedHandler, scheduleChatMemorySave } from "./memory-hooks.mjs";
import { warmMemoryBackend } from "../memory/store.mjs";
import { warmGraphBackend } from "../memory/graph/store.mjs";
import { getVoiceStatus, installSttRuntime, transcribeAudio } from "../stt/service.mjs";
import { checkForUpdate, runUpdate } from "../updater.mjs";
import { handleRequest as handleOpenAICompatRequest } from "../../api/openai-handler.mjs";
import { setOpenAICorsHeaders } from "../../api/server.mjs";
import {
  findProviderModel,
  getProviderCatalog,
  getProviderDefaultModel,
  uiModelCatalog,
} from "../providers/model-catalog.mjs";

export async function runWindowApp({
  client,
  workspaceRoot,
  port,
  modelType,
  thinkingEnabled,
  searchEnabled,
  openWindow = true,
  consoleLog = false,
}) {
  // ChatGPT UI в боковой панели drawer, без отдельного окна Chrome.
  if (process.env.CHATGPT_EMBED_IN_UI == null) {
    process.env.CHATGPT_EMBED_IN_UI = "1";
  }

  {
    const { ensureChatGPTProfileReady, cleanupStaleBrowserProfiles } = await import("../providers/chatgpt/browser-login.mjs");
    const { APP_BROWSER_PROFILE } = await import("./app-browser.mjs");
    const { APP_WINDOW_PROFILE } = await import("./app-window.mjs");
    const { CHATGPT_BROWSER_PROFILE } = await import("../providers/chatgpt/config.mjs");
    const { QWEN_BROWSER_PROFILE } = await import("../providers/qwen/config.mjs");
    await ensureChatGPTProfileReady(CHATGPT_BROWSER_PROFILE);
    cleanupStaleBrowserProfiles([APP_BROWSER_PROFILE, APP_WINDOW_PROFILE, QWEN_BROWSER_PROFILE]);
  }

  const state = loadWindowState(workspaceRoot);

  setImmediate(() => {
    warmMemoryBackend().catch(() => {});
    warmGraphBackend().catch(() => {});
    import("./web-browser.mjs").then((m) => m.warmWebBrowser()).catch(() => {});
  });

  function logConsole(message) {
    if (consoleLog) console.log(message);
  }

  function logConsoleBlock(label, value) {
    if (!consoleLog) return;
    const text = String(value || "").trimEnd();
    console.log(`\n[${label}]`);
    console.log(text || "[empty]");
  }

  // Lazy init Qwen-клиента + авто-relogin (как DeepSeek AuthManager).
  let qwenClient = null;
  let qwenAuthManager = null;
  let chatGPTClient = null;
  const providerLoginJobs = new Map();

  async function getQwenAuthManager() {
    if (!qwenAuthManager) {
      const { getQwenAuthManager: factory } = await import("../providers/qwen/auth-manager.mjs");
      qwenAuthManager = factory({ autoVisible: true });
    }
    return qwenAuthManager;
  }

  async function buildQwenClientFromAuth(auth) {
    const { QwenChatClient } = await import("../providers/qwen/client.mjs");
    return new QwenChatClient({
      token: auth.token,
      cookieHeader: auth.cookieHeader,
      debug: Boolean(process.env.DEEPSEEK_DEBUG_QWEN),
    });
  }

  // Гарантирует валидный auth: тихий refresh из профиля → окно логина.
  async function ensureQwenAuth({ forceVisible = false } = {}) {
    const { QWEN_AUTH_FILE } = await import("../providers/qwen/config.mjs");
    const { readQwenAuth } = await import("../providers/qwen/auth-files.mjs");
    const existing = readQwenAuth(QWEN_AUTH_FILE);
    if (existing?.token && !forceVisible) {
      return existing;
    }
    const manager = await getQwenAuthManager();
    return manager.refresh({ forceVisible: forceVisible || !existing?.token });
  }

  async function getOrCreateQwenClient({ forceRebuild = false } = {}) {
    if (qwenClient && !forceRebuild) return qwenClient;
    const auth = await ensureQwenAuth();
    qwenClient = await buildQwenClientFromAuth(auth);
    return qwenClient;
  }

  async function refreshChatGPTAuthFromOpenBrowser() {
    const { isChatGPTBrowserProxyActive, syncChatGPTAuthFromActiveProxy } = await import("../providers/chatgpt/browser-proxy.mjs");
    if (!isChatGPTBrowserProxyActive()) return;
    try {
      await syncChatGPTAuthFromActiveProxy();
    } catch {}
  }

  async function ensureChatGPTAuth({ forceVisible = false } = {}) {
    const { CHATGPT_AUTH_FILE } = await import("../providers/chatgpt/config.mjs");
    const { readChatGPTAuth, isChatGPTAuthUsable } = await import("../providers/chatgpt/auth-files.mjs");
    const embedUi = process.env.CHATGPT_EMBED_IN_UI === "1";
    const existing = readChatGPTAuth(CHATGPT_AUTH_FILE);
    if (isChatGPTAuthUsable(existing) && !forceVisible) {
      return existing;
    }
    if (!forceVisible) {
      try {
        const { ensureBrowserBinaries } = await import("../browser/ensure-binaries.mjs");
        await ensureBrowserBinaries();
        const { getChatGPTBrowserProxy, syncChatGPTAuthFromActiveProxy } = await import("../providers/chatgpt/browser-proxy.mjs");
        await getChatGPTBrowserProxy();
        const synced = await syncChatGPTAuthFromActiveProxy();
        if (isChatGPTAuthUsable(synced)) return synced;
        const cached = readChatGPTAuth(CHATGPT_AUTH_FILE);
        if (isChatGPTAuthUsable(cached)) return cached;
      } catch (error) {
        if (/Executable doesn't exist|playwright install|patchright install/i.test(String(error?.message || error))) {
          throw new Error("Chromium не установлен. В терминале: npx patchright install chromium");
        }
      }
    }
    if (embedUi) {
      const err = new Error(
        "ChatGPT: войдите через 🧠 → Браузер → ChatGPT. После входа нажмите «Синхронизировать» — drawer можно закрыть.",
      );
      err.needsChatGPTLogin = true;
      throw err;
    }
    const { loginChatGPTAndSave } = await import("../providers/chatgpt/browser-login.mjs");
    await loginChatGPTAndSave(CHATGPT_AUTH_FILE);
    const fresh = readChatGPTAuth(CHATGPT_AUTH_FILE);
    if (!isChatGPTAuthUsable(fresh)) {
      throw new Error("ChatGPT authorization did not return an access token. Войди заново и дождись открытия обычного чата ChatGPT.");
    }
    return fresh;
  }

  async function buildChatGPTClientFromAuth(auth) {
    const { ChatGPTChatClient } = await import("../providers/chatgpt/client.mjs");
    return new ChatGPTChatClient({
      accessToken: auth.accessToken,
      cookies: auth.cookies,
      cookieHeader: auth.cookieHeader,
      userAgent: auth.userAgent,
      debug: Boolean(process.env.DEEPSEEK_DEBUG_CHATGPT),
    });
  }

  async function getOrCreateChatGPTClient({ forceRebuild = false } = {}) {
    if (chatGPTClient && !forceRebuild) return chatGPTClient;
    const auth = await ensureChatGPTAuth();
    chatGPTClient = await buildChatGPTClientFromAuth(auth);
    return chatGPTClient;
  }

  function isChatGPTAuthError(error) {
    const message = String(error?.message || error || "");
    if (/unusual activity/i.test(message)) return false;
    return /access token is missing|HTTP 401|unauthorized|not logged in|сессия истекла|session expired/i.test(message);
  }

  function isChatGPTTransportError(error) {
    const message = String(error?.message || error || "");
    return /Execution context was destroyed|Target page, context or browser has been closed|Target closed|Page closed|Context closed|Browser has been closed|page\.waitForTimeout|Failed to fetch|request is finished/i.test(message);
  }

  async function chatGPTApiCall(fn) {
    let client = await getOrCreateChatGPTClient();
    let transportResetDone = false;
    try {
      return await fn(client);
    } catch (error) {
      if (isChatGPTTransportError(error) && !transportResetDone) {
        console.log(`[chatgpt] browser transport error, resetting proxy: ${error.message}`);
        const { resetChatGPTBrowserProxy } = await import("../providers/chatgpt/browser-proxy.mjs");
        resetChatGPTBrowserProxy();
        chatGPTClient = null;
        client = await getOrCreateChatGPTClient({ forceRebuild: true });
        transportResetDone = true;
        return fn(client);
      }
      if (!isChatGPTAuthError(error)) throw error;
      console.log("[chatgpt] auth error, reloading browser session…");
      const { resetChatGPTBrowserProxy } = await import("../providers/chatgpt/browser-proxy.mjs");
      resetChatGPTBrowserProxy();
      chatGPTClient = null;
      client = await getOrCreateChatGPTClient({ forceRebuild: true });
      try {
        return await fn(client);
      } catch (retryError) {
        if (!isChatGPTAuthError(retryError)) throw retryError;
        console.log("[chatgpt] reload failed, re-auth required…");
        resetChatGPTBrowserProxy();
        chatGPTClient = null;
        if (process.env.CHATGPT_EMBED_IN_UI === "1") {
          throw new Error(
            "ChatGPT: сессия истекла. Откройте 🧠 → «Браузер» и войдите в ChatGPT снова.",
          );
        }
        const fresh = await ensureChatGPTAuth({ forceVisible: true });
        client = await buildChatGPTClientFromAuth(fresh);
        chatGPTClient = client;
        return fn(client);
      }
    }
  }

  // Прогрев веб-сессии перед длительной фоновой задачей (code-agent). Если сессия
  // слетела, chatGPTApiCall сам откроет окно входа и обновит её — иначе агент упал бы
  // с "not logged in" посреди работы, без шанса переавторизоваться.
  async function ensureChatGPTSessionReady() {
    await chatGPTApiCall(async () => {
      const { getChatGPTBrowserProxy } = await import("../providers/chatgpt/browser-proxy.mjs");
      const proxy = await getChatGPTBrowserProxy({ debug: Boolean(process.env.DEEPSEEK_DEBUG_CHATGPT) });
      await proxy.ensureReady();
    });
  }

  function isQwenTransportError(error) {
    const message = String(error?.message || error || "");
    return /Execution context was destroyed|Target page, context or browser has been closed|Target closed|Page closed|Context closed|Failed to fetch|request is finished/i.test(message);
  }

  function formatQwenError(error) {
    const message = String(error?.message || error || "");
    if (error?.isQwenSessionExpired || /сессия qwen устарела/i.test(message)) {
      return message.includes("🔒") ? message : `🔒 Сессия Qwen устарела\n\n${message}`;
    }
    if (/qwen_page_evaluate_timeout/i.test(message)) {
      return (
        "Qwen browser transport timed out while creating/sending the request. " +
        "Это происходит до ответа модели: chat.qwen.ai не отдаёт API JSON для создания чата. " +
        "Обычно причина в web anti-bot/session challenge на стороне Qwen.\n\n" +
        "Попробуй подключить Qwen заново в окне ai-free (кнопка у провайдера)."
      );
    }
    return message;
  }

  // Вызов Qwen API: relogin только при реально протухшей сессии (401/HTML), не при Bad_Request anti-bot.
  async function qwenApiCall(fn, { onRelogin = null } = {}) {
    const { isQwenSessionExpiredError } = await import("../providers/qwen/session-errors.mjs");
    let client = await getOrCreateQwenClient();
    let transportResetDone = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await fn(client);
      } catch (error) {
        if (isQwenTransportError(error) && !transportResetDone) {
          console.log(`[qwen] browser transport error, resetting proxy: ${error.message}`);
          const { resetQwenBrowserProxy } = await import("../providers/qwen/browser-proxy.mjs");
          await resetQwenBrowserProxy();
          qwenClient = null;
          client = await getOrCreateQwenClient({ forceRebuild: true });
          transportResetDone = true;
          continue;
        }
        if (!isQwenSessionExpiredError(error) || attempt >= 2) throw error;
        const status = error.status || error.httpStatus;
        const clearSession = status === 401 || status === 403;
        console.log("[qwen] session expired — opening in-app login window…");
        const manager = await getQwenAuthManager();
        const fresh = await manager.refresh({
          forceVisible: true,
          skipSilent: true,
          clearSession,
          onReloginStart: () => {
            if (typeof onRelogin === "function") onRelogin();
          },
        });
        client = await buildQwenClientFromAuth(fresh);
        qwenClient = client;
      }
    }
    throw new Error("unreachable: qwenApiCall retry budget");
  }

  async function getQwenCatalogOverrideSafe() {
    try {
      const { getQwenLiveCatalogOverride } = await import("../providers/qwen/model-sync.mjs");
      return await getQwenLiveCatalogOverride();
    } catch (error) {
      logConsole(`[qwen] live model catalog failed: ${error.message}`);
      return null;
    }
  }

  async function getUiModelCatalog() {
    const qwen = await getQwenCatalogOverrideSafe();
    return uiModelCatalog(qwen ? { qwen } : {});
  }

  async function resolveProviderModel(provider, requestedModel, mode) {
    if (provider === "qwen") {
      const qwen = await getQwenCatalogOverrideSafe();
      if (qwen?.models?.some((model) => model.id === requestedModel)) return requestedModel;
      return qwen?.defaultModel || getProviderDefaultModel(provider, mode);
    }
    return findProviderModel(provider, requestedModel)
      ? requestedModel
      : getProviderDefaultModel(provider, mode);
  }

  async function runPipelineFromConversation(startConversationId, initialPrompt, requestOptions = {}, signal = null) {
    const edges = state.pipeline?.edges || [];
    const queue = [{ conversationId: startConversationId, input: initialPrompt, sourceTitle: "User", depth: 0 }];
    const visited = new Set();
    const maxSteps = 12;
    let steps = 0;

    while (queue.length && steps < maxSteps) {
      if (signal?.aborted) break;
      const item = queue.shift();
      const conversation = state.conversations.find((candidate) => candidate.id === item.conversationId);
      if (!conversation) continue;
      const visitKey = `${item.conversationId}:${item.depth}`;
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);
      steps += 1;

      let output = "";
      try {
        output = await completePipelineConversation(conversation, item.input, {
          sourceTitle: item.sourceTitle,
          appendUser: item.conversationId !== startConversationId,
          thinking: requestOptions.thinking === true,
          search: requestOptions.search === true,
        });
      } catch (error) {
        output = `⚠️ Pipeline step failed: ${error.message}`;
        conversation.messages.push({
          role: "assistant",
          content: output,
          createdAt: new Date().toISOString(),
          pipelineStatus: "failed",
        });
        conversation.updatedAt = new Date().toISOString();
        saveWindowState(workspaceRoot, state);
      }

      const targets = edges
        .filter((edge) => edge.from === item.conversationId)
        .map((edge) => state.conversations.find((candidate) => candidate.id === edge.to))
        .filter(Boolean);
      for (const target of targets) {
        queue.push({
          conversationId: target.id,
          input: output,
          sourceTitle: conversation.title || getAgentRole(conversation.roleId).label,
          depth: item.depth + 1,
        });
      }
    }

    const startConversation = state.conversations.find((candidate) => candidate.id === startConversationId);
    if (startConversation) {
      startConversation.messages.push({
        role: "assistant",
        content: steps >= maxSteps
          ? `Pipeline stopped after ${maxSteps} steps. Проверь цепочку на циклы.`
          : "Pipeline completed.",
        createdAt: new Date().toISOString(),
        pipelineStatus: steps >= maxSteps ? "stopped" : "done",
      });
      startConversation.updatedAt = new Date().toISOString();
      saveWindowState(workspaceRoot, state);
    }
  }

  async function completePipelineConversation(conversation, input, options = {}) {
    const role = getAgentRole(conversation.roleId);
    const prompt = buildPipelinePrompt(conversation, role, input, options.sourceTitle);
    const now = new Date().toISOString();
    if (options.appendUser) {
      conversation.messages.push({
        role: "user",
        content: `Pipeline input from ${options.sourceTitle || "previous step"}:\n\n${input}`,
        createdAt: now,
        pipelineRun: true,
      });
    }

    const provider = conversation.provider || "deepseek";
    if (provider === "qwen") {
      // Pipeline steps must not inherit the normal chat context. A fresh upstream
      // chat keeps old user turns (for example "видишь плату?") out of the step.
      const chatId = await qwenApiCall((c) =>
        c.createChat({ model: conversation.model || undefined }),
      );
      const isReasoning = findProviderModel("qwen", conversation.model)?.reasoning === true;
      const result = await qwenApiCall((c) =>
        c.complete({
          chatId,
          prompt,
          thinking: isReasoning ? true : options.thinking === true,
          search: options.search === true,
          model: conversation.model || undefined,
        }),
      );
      const text = result.thinkingText
        ? `🧠 ${result.thinkingText.trim()}\n\n---\n\n${result.text.trim()}`
        : result.text.trim();
      const cleanText = extractPipelineResult(text);
      conversation.messages.push({
        role: "assistant",
        content: cleanText || "[empty]",
        createdAt: new Date().toISOString(),
        roleId: role.id,
        pipelineRun: true,
      });
      conversation.updatedAt = new Date().toISOString();
      saveWindowState(workspaceRoot, state);
      return cleanText || "[empty]";
    }

    if (provider === "chatgpt") {
      // Шаг цепочки — в свежем веб-диалоге (conversationId: null), чтобы не тянуть
      // старый контекст чата. ChatGPT сам создаст новый разговор под этот шаг.
      const result = await chatGPTApiCall((c) => c.complete({ prompt, conversationId: null }));
      const cleanText = extractPipelineResult(String(result.text || "").trim());
      conversation.messages.push({
        role: "assistant",
        content: cleanText,
        createdAt: new Date().toISOString(),
        roleId: role.id,
        pipelineRun: true,
      });
      conversation.updatedAt = new Date().toISOString();
      return cleanText;
    }

    if (provider !== "deepseek") {
      throw new Error(`Pipeline provider is not supported: ${provider}`);
    }

    // Pipeline steps run in a fresh upstream session by design. The UI chat still
    // stores the step transcript, but the provider does not see stale turns.
    const pipelineSessionId = await client.createSession();
    const messageMode = modeForConversation(conversation);
    const result = await client.complete({
      sessionId: pipelineSessionId,
      prompt,
      modelType: mapModeToModelType(messageMode, modelType),
      thinkingEnabled: messageMode === "expert" ? true : options.thinking === true,
      searchEnabled: options.search === true,
    });
    const text = extractPipelineResult(result.text.trimEnd());
    conversation.messages.push({
      role: "assistant",
      content: text || "[empty]",
      createdAt: new Date().toISOString(),
      roleId: role.id,
      pipelineRun: true,
    });
    conversation.updatedAt = new Date().toISOString();
    saveWindowState(workspaceRoot, state);
    return text || "[empty]";
  }

  function buildPipelinePrompt(conversation, role, input, sourceTitle) {
    return [
      "Ты выполняешь один шаг агентного pipeline.",
      `Текущая роль: ${role.label}.`,
      `Инструкция роли: ${role.prompt}`,
      "",
      `Чат шага: ${conversation.title || "Untitled"}`,
      `Источник входа: ${sourceTitle || "User"}`,
      "",
      "Правила выполнения:",
      "- Работай только с входом ниже и с инструкцией роли. Игнорируй старый диалог, если он противоречит входу.",
      "- Не пересказывай эти правила и не рассуждай о том, что ты являешься pipeline-шагом.",
      "- Не пиши фразы вроде «я получил запрос», «что конкретно нужно сделать», «уточните».",
      "- Верни готовый результат своей роли, который следующий агент сможет использовать сразу.",
      "- Если вход неполный, сформулируй лучший возможный результат и явно отметь недостающие допущения.",
      "- Не утверждай, что файлы изменены или команды выполнены. В pipeline MVP инструменты не запускаются автоматически.",
      "- Начни ответ строго с строки RESULT:. Перед RESULT: не должно быть ни одного слова.",
      "",
      "Вход:",
      input,
    ].join("\n");
  }

  function extractPipelineResult(text) {
    const raw = String(text || "").trim();
    const match = raw.match(/(?:^|\n)(?:RESULT|РЕЗУЛЬТАТ)\s*:\s*/i);
    if (!match) return raw;
    return raw.slice((match.index || 0) + match[0].length).trim();
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (req.method === "GET" && url.pathname === "/") {
        const settings = loadSettings();
        return sendHtml(res, renderWindowHtml({
          language: settings.ui?.language,
          ui: {
            language: settings.ui?.language || "ru",
            webSearchDefault: settings.ui?.webSearchDefault !== false,
          },
        }));
      }

      if (req.method === "GET" && url.pathname === "/embed/workspace") {
        const root = url.searchParams.get("root") || workspaceRoot || os.homedir();
        return sendHtml(res, renderEmbedWorkspaceHtml({ root, title: "Workspace" }));
      }

      if (req.method === "GET" && url.pathname === "/embed/browser") {
        const root = url.searchParams.get("root") || workspaceRoot || os.homedir();
        return sendHtml(res, renderEmbedBrowserHtml({ root }));
      }

      if (req.method === "GET" && url.pathname === "/embed/chatgpt") {
        return sendHtml(res, renderEmbedBrowserHtml({
          root: workspaceRoot || os.homedir(),
        }));
      }

      if (req.method === "GET" && url.pathname === "/embed/chatgpt-live") {
        return sendHtml(res, renderEmbedChatGPTLiveHtml());
      }

      if (req.method === "GET" && url.pathname === "/embed/web-live") {
        return sendHtml(res, renderEmbedAppBrowserLiveHtml());
      }

      if (req.method === "GET" && url.pathname === "/api/browser/live-stream") {
        return handleAppBrowserLiveStream(req, res);
      }

      if (req.method === "POST" && url.pathname === "/api/browser/live-input") {
        try {
          const body = await readJsonBody(req, 64_000);
          const result = await handleAppBrowserLiveInput(body);
          return sendJson(res, result);
        } catch (error) {
          return sendJson(res, { error: error.message }, 500);
        }
      }

      if (req.method === "POST" && url.pathname === "/api/browser/live-viewport") {
        try {
          const body = await readJsonBody(req, 4096);
          const result = await setAppBrowserLiveViewport(body);
          return sendJson(res, result);
        } catch (error) {
          return sendJson(res, { error: error.message }, 500);
        }
      }

      if (req.method === "POST" && url.pathname === "/api/browser/navigate") {
        try {
          const body = await readJsonBody(req, 16_000);
          const result = await handleAppBrowserNavigate(body);
          return sendJson(res, result);
        } catch (error) {
          return sendJson(res, { error: error.message }, 500);
        }
      }

      if (req.method === "GET" && url.pathname === "/api/browser/snapshot") {
        try {
          const result = await handleAppBrowserSnapshot();
          return sendJson(res, result);
        } catch (error) {
          return sendJson(res, { error: error.message }, 500);
        }
      }

      if (req.method === "POST" && url.pathname === "/api/browser/reset") {
        try {
          const result = await handleAppBrowserReset();
          return sendJson(res, result);
        } catch (error) {
          return sendJson(res, { error: error.message }, 500);
        }
      }

      if (req.method === "POST" && url.pathname === "/api/browser/warm") {
        try {
          const { warmAppBrowser } = await import("./app-browser.mjs");
          const result = await warmAppBrowser();
          return sendJson(res, result);
        } catch (error) {
          return sendJson(res, { error: error.message }, 500);
        }
      }

      if (req.method === "POST" && url.pathname === "/api/chatgpt/warm") {
        try {
          const result = await warmChatGPTInAppBrowser();
          return sendJson(res, result);
        } catch (error) {
          return sendJson(res, { error: error.message }, 500);
        }
      }

      if (req.method === "GET" && url.pathname === "/api/chatgpt/live-stream") {
        return handleChatGPTLiveStream(req, res);
      }

      if (req.method === "POST" && url.pathname === "/api/chatgpt/live-input") {
        try {
          const body = await readJsonBody(req, 64_000);
          const result = await handleChatGPTLiveInput(body);
          return sendJson(res, result);
        } catch (error) {
          return sendJson(res, { error: error.message }, 500);
        }
      }

      if (req.method === "POST" && url.pathname === "/api/chatgpt/live-viewport") {
        try {
          const body = await readJsonBody(req, 4096);
          const result = await setChatGPTPanelViewport(body);
          return sendJson(res, result);
        } catch (error) {
          return sendJson(res, { error: error.message }, 500);
        }
      }

      if (req.method === "POST" && url.pathname === "/api/chatgpt/sync-session") {
        try {
          const result = await handleChatGPTSyncSession();
          if (result.hasAuth) chatGPTClient = null;
          return sendJson(res, result);
        } catch (error) {
          return sendJson(res, { error: error.message }, 500);
        }
      }

      if (req.method === "POST" && url.pathname === "/api/chatgpt/reload-live") {
        try {
          const result = await reloadChatGPTLivePage();
          return sendJson(res, result);
        } catch (error) {
          return sendJson(res, { error: error.message }, 500);
        }
      }

      if (req.method === "POST" && url.pathname === "/api/chatgpt/reset-live") {
        try {
          const result = await resetChatGPTLiveSession();
          chatGPTClient = null;
          return sendJson(res, result);
        } catch (error) {
          return sendJson(res, { error: error.message }, 500);
        }
      }

      // Устарело: больше не открываем внешний Chrome (конфликт профиля).
      if (req.method === "POST" && url.pathname === "/api/chatgpt/visible-login") {
        return sendJson(res, {
          error: "Внешний Chrome отключён. Используйте 🧠 → Браузер → ChatGPT или npm run login-chatgpt",
        }, 400);
      }

      // Старые абсолютные пути ChatGPT SPA без префикса прокси → редирект.
      if (
        req.method === "GET"
        && (
          url.pathname.startsWith("/_next/")
          || url.pathname.startsWith("/backend-api/")
          || url.pathname.startsWith("/cdn/")
        )
      ) {
        res.writeHead(302, { Location: `/provider-frame/chatgpt${url.pathname}${url.search}` });
        res.end();
        return;
      }

      if (isChatGPTFramePath(url.pathname)) {
        return handleChatGPTFrameProxy(req, res, url);
      }

      // OpenAI-compatible API is also available on the window server:
      // http://127.0.0.1:<window-port>/v1/...
      if (url.pathname.startsWith("/v1/")) {
        logConsole(`[api] ${req.method} ${url.pathname}`);
        setOpenAICorsHeaders(res);
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          return res.end();
        }
        const apiAuth = resolveOpenAICompatApiKey(req);
        if (!apiAuth.ok) {
          return sendJson(res, {
            error: { message: "Invalid OpenAI-compatible API key", type: "authentication_error" },
          }, 401);
        }
        req.openAICompatProvider = apiAuth.provider;
        return handleOpenAICompatRequest(req, res);
      }

      // Lifeline для фронта. Если этот endpoint не отвечает 3 раза подряд → окно закрывается.
      if (req.method === "GET" && url.pathname === "/api/heartbeat") {
        const shutdown = getShutdownStatus();
        if (shutdown.active) {
          return sendJson(res, {
            ok: true,
            shuttingDown: true,
            phase: shutdown.phase,
          });
        }
        return sendJson(res, { ok: true, ts: Date.now() });
      }

      if (req.method === "POST" && url.pathname === "/api/shutdown") {
        if (!getShutdownStatus().active) {
          requestAppShutdown({ source: "ui" }).finally(() => {
            setTimeout(() => process.exit(0), 200).unref();
          });
        }
        return sendJson(res, { ok: true, ...getShutdownStatus() });
      }

      // Список провайдеров + статус auth. UI рисует picker по этому ответу.
      if (req.method === "GET" && url.pathname === "/api/providers") {
        await refreshChatGPTAuthFromOpenBrowser();
        const { listProviders } = await import("../providers/registry.mjs");
        const providers = listProviders().map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          hasAuth: p.hasAuth(),
        }));
        return sendJson(res, { providers });
      }

      if (req.method === "GET" && url.pathname === "/api/model-catalog") {
        return sendJson(res, await getUiModelCatalog());
      }

      if (req.method === "GET" && url.pathname === "/api/agent-roles") {
        const current = loadSettings();
        return sendJson(res, { roles: getLocalizedAgentRoles(current.ui?.language) });
      }

      // Подключить провайдера из UI (открывает окно логина в фоне).
      const providerLoginMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/login$/);
      if (req.method === "POST" && providerLoginMatch) {
        const providerId = providerLoginMatch[1];
        const { getProvider } = await import("../providers/registry.mjs");
        const provider = getProvider(providerId);
        if (!provider) {
          return sendJson(res, { error: `Unknown provider: ${providerId}` }, 404);
        }
        try {
          if (providerId === "chatgpt" && process.env.CHATGPT_EMBED_IN_UI === "1") {
            const { resetChatGPTBrowserProxy } = await import("../providers/chatgpt/browser-proxy.mjs");
            resetChatGPTBrowserProxy();
            chatGPTClient = null;
            return sendJson(res, {
              ok: true,
              embedLogin: true,
              hasAuth: provider.hasAuth(),
            });
          }
          if (providerLoginJobs.has(providerId)) {
            return sendJson(res, {
              ok: true,
              loginStarted: true,
              alreadyRunning: true,
              hasAuth: provider.hasAuth(),
            });
          }
          const loginJob = (async () => {
            await provider.login();
            if (providerId === "qwen") {
              const { resetQwenBrowserProxy } = await import("../providers/qwen/browser-proxy.mjs");
              await resetQwenBrowserProxy();
              qwenClient = null;
            }
            if (providerId === "chatgpt") {
              chatGPTClient = null;
            }
          })();
          providerLoginJobs.set(providerId, loginJob);
          loginJob
            .catch((error) => {
              console.error(`[provider-login] ${providerId} failed:`, error);
            })
            .finally(() => {
              providerLoginJobs.delete(providerId);
            });
          return sendJson(res, { ok: true, loginStarted: true, hasAuth: provider.hasAuth() });
        } catch (error) {
          return sendJson(res, { error: error.message }, 500);
        }
      }

      // Загрузка файла (картинки) на DeepSeek через наш прокси.
      // Фронт шлёт base64 (картинки бывают мегабайты — лимит 30 МБ).
      // Возвращаем file_id, который потом юзается в ref_file_ids массиве completion.
      if (req.method === "POST" && url.pathname === "/api/upload") {
        const body = await readJsonBody(req, 30_000_000);
        if (!body.dataBase64 || !body.name) {
          return sendJson(res, { error: "Поля name + dataBase64 обязательны." }, 400);
        }
        try {
          const mime = String(body.mimeType || "application/octet-stream").toLowerCase();
          if (mime === "image/svg+xml" || mime.includes("svg")) {
            return sendJson(
              res,
              { error: "SVG не поддерживается для распознавания. Используй PNG или JPG." },
              400,
            );
          }
          const allowedVisionMime = /^image\/(jpeg|jpg|png|gif|webp|bmp)$/;
          if (!allowedVisionMime.test(mime)) {
            return sendJson(
              res,
              { error: `Формат ${mime} не поддерживается. Нужен PNG, JPEG, GIF или WebP.` },
              400,
            );
          }
          const buffer = Buffer.from(body.dataBase64, "base64");
          const chatSessionId = body.chatSessionId || body.sessionId || null;
          const fileId = await client.uploadFile(
            buffer,
            String(body.mimeType || "application/octet-stream"),
            String(body.name),
            { chatSessionId },
          );
          console.log(`[upload] ${body.name} (${buffer.length}b) -> file_id=${fileId}`);
          return sendJson(res, { fileId });
        } catch (error) {
          console.error(`[upload] FAILED for ${body.name}: ${error.message}`);
          return sendJson(res, { error: error.message }, 500);
        }
      }

      if (req.method === "GET" && url.pathname === "/api/voice/status") {
        return sendJson(res, getVoiceStatus());
      }

      if (req.method === "POST" && url.pathname === "/api/voice/install") {
        try {
          const status = await installSttRuntime({
            onLog: (message) => logConsole(`[voice] ${message}`),
          });
          return sendJson(res, status);
        } catch (error) {
          return sendJson(res, { error: error.message, status: getVoiceStatus() }, 500);
        }
      }

      if (req.method === "POST" && url.pathname === "/api/voice/transcribe") {
        const body = await readJsonBody(req, 42_000_000);
        try {
          const result = await transcribeAudio({
            dataBase64: body.dataBase64,
            mimeType: body.mimeType,
            language: body.language || "auto",
          });
          return sendJson(res, result);
        } catch (error) {
          return sendJson(
            res,
            {
              error: error.message,
              code: error.code || "stt_failed",
              status: error.status || getVoiceStatus(),
            },
            error.code === "stt_helper_missing" ? 409 : 500,
          );
        }
      }

      if (req.method === "GET" && url.pathname === "/api/state") {
        return sendJson(res, {
          workspaceRoot,
          stateFile: getStateFile(),
          activeConversationId: state.activeConversationId,
          conversations: conversationList(state),
          pipeline: state.pipeline || { edges: [] },
          runningTaskIds: getRunningIds(),
        });
      }

      if (req.method === "PATCH" && url.pathname === "/api/pipeline") {
        const body = await readJsonBody(req);
        state.pipeline = normalizePipelinePatch(body, state.conversations);
        saveWindowState(workspaceRoot, state);
        return sendJson(res, { pipeline: state.pipeline });
      }

      // ===== Файловый браузер для модалки «Новый чат» =====

      if (req.method === "POST" && url.pathname === "/api/browse/mkdir") {
        const body = await readJsonBody(req);
        const parentRaw = String(body.parent || "").trim();
        const name = String(body.name || "").trim();
        if (!parentRaw) return sendJson(res, { error: "parent обязателен" }, 400);
        if (!name) return sendJson(res, { error: "Имя папки не может быть пустым." }, 400);
        if (name.includes("/") || name.includes("\\") || name === "." || name === ".." || name.startsWith("..")) {
          return sendJson(res, { error: "Имя не может содержать /, \\, или быть '.', '..'." }, 400);
        }
        const parent = path.resolve(parentRaw);
        const target = path.join(parent, name);
        const safeRoots = [os.homedir(), path.resolve(workspaceRoot), path.join(os.homedir(), "Documents")];
        const isUnderSafe = safeRoots.some((r) => target === r || target.startsWith(r + path.sep));
        if (!isUnderSafe) {
          return sendJson(res, { error: `Создание разрешено только под ${os.homedir()}/.` }, 400);
        }
        if (fs.existsSync(target)) {
          return sendJson(res, { error: `Папка уже существует: ${target}` }, 409);
        }
        try {
          fs.mkdirSync(target, { recursive: false });
        } catch (error) {
          return sendJson(res, { error: `Не удалось создать: ${error.message}` }, 500);
        }
        return sendJson(res, { path: target });
      }

      if (req.method === "GET" && url.pathname === "/api/browse") {
        const requested = url.searchParams.get("path");
        const showHidden = url.searchParams.get("hidden") === "1";
        let resolved;
        try {
          let p = (requested || os.homedir()).trim();
          if (p.startsWith("~/") || p === "~") p = path.join(os.homedir(), p.slice(1));
          resolved = path.resolve(p);
        } catch {
          return sendJson(res, { error: "Невалидный путь" }, 400);
        }
        try {
          const listing = listBrowseDirectories(resolved, { showHidden });
          return sendJson(res, {
            ...listing,
            home: os.homedir(),
            defaultWorkspace: path.resolve(workspaceRoot),
          });
        } catch (error) {
          const code = error.code;
          if (code === "ENOENT") return sendJson(res, { error: error.message }, 404);
          if (code === "ENOTDIR") return sendJson(res, { error: error.message }, 400);
          if (code === "EACCES") return sendJson(res, { error: error.message }, 403);
          return sendJson(res, { error: error.message || "Ошибка чтения папки" }, 500);
        }
      }

      // ===== Проекты (workspace'ы из чатов) =====

      if (req.method === "GET" && url.pathname === "/api/projects") {
        const seen = new Set();
        const projects = [];
        for (const c of state.conversations) {
          const w = String(c.workspace || workspaceRoot);
          if (seen.has(w)) continue;
          seen.add(w);
          projects.push({
            path: w,
            name: path.basename(w) || w,
            exists: fs.existsSync(w),
          });
        }
        if (!seen.has(workspaceRoot)) {
          projects.unshift({
            path: workspaceRoot,
            name: path.basename(workspaceRoot) || workspaceRoot,
            exists: fs.existsSync(workspaceRoot),
            isDefault: true,
          });
        }
        return sendJson(res, { projects, defaultWorkspace: workspaceRoot, home: os.homedir() });
      }

      if (req.method === "GET" && url.pathname === "/api/update/check") {
        return sendJson(res, await checkForUpdate());
      }

      if (req.method === "POST" && url.pathname === "/api/update/run") {
        return sendJson(res, await runUpdate());
      }

      if (await handleMemoryRoute(req, url, res)) return;
      if (await handleSkillsRoute(req, url, res)) return;
      if (await handlePluginsRoute(req, url, res)) return;

      // ===== Settings (whitelist команд для /code) =====

      if (req.method === "GET" && url.pathname === "/api/settings") {
        const { modelsList } = await import("../../api/models.mjs");
        const { listProviders } = await import("../providers/registry.mjs");
        const current = loadSettings();
        const catalog = Object.entries(COMMAND_CATALOG).map(([name, meta]) => ({
          name,
          description: getCommandDescription(name, current.ui?.language, meta.description),
          risk: meta.risk,
        }));
        const providers = listProviders().map((p) => ({
          id: p.id,
          name: p.name,
          hasAuth: p.hasAuth(),
        }));
        return sendJson(res, {
          allowedCommands: current.allowedCommands,
          commandPermissions: current.commandPermissions || {},
          ui: {
            language: current.ui?.language || "ru",
            webSearchDefault: current.ui?.webSearchDefault !== false,
            memoryDefault: current.ui?.memoryDefault !== false,
            autoSkillDefault: current.ui?.autoSkillDefault !== false,
            languages: Object.values(LANGUAGES).map((language) => getLanguageMeta(language.code)),
          },
          telegram: current.telegram || { enabled: false, botToken: "", chatId: "" },
          catalog,
          openAICompat: {
            embeddedBaseUrl: `http://127.0.0.1:${port}/v1`,
            anthropicBaseUrl: `http://127.0.0.1:${port}`,
            anthropicMessagesUrl: `http://127.0.0.1:${port}/v1/messages`,
            apiKeys: current.openAICompat?.apiKeys || { deepseek: "", qwen: "" },
            models: modelsList().data.map((m) => m.id),
            providers,
          },
        });
      }

      if (req.method === "POST" && url.pathname === "/api/settings/openai-key") {
        const body = await readJsonBody(req);
        const provider = String(body.provider || "");
        const apiKey = ensureOpenAICompatApiKey(provider);
        return sendJson(res, { provider, apiKey });
      }

      if (req.method === "PUT" && url.pathname === "/api/settings") {
        const body = await readJsonBody(req);
        const saved = saveSettings({
          allowedCommands: body.allowedCommands,
          commandPermissions: body.commandPermissions,
          ui: body.ui,
          telegram: body.telegram,
        });
        return sendJson(res, {
          allowedCommands: saved.allowedCommands,
          commandPermissions: saved.commandPermissions,
          ui: saved.ui,
          telegram: saved.telegram,
        });
      }

      // ===== Conversations =====

      if (req.method === "POST" && url.pathname === "/api/conversations") {
        const body = await readJsonBody(req);

        let workspace = String(body.workspace || workspaceRoot).trim() || workspaceRoot;
        if (workspace.startsWith("~/") || workspace === "~") {
          workspace = path.join(os.homedir(), workspace.slice(1));
        }
        workspace = path.resolve(workspace);

        const exists = fs.existsSync(workspace);
        if (!exists) {
          if (!body.createFolder) {
            return sendJson(
              res,
              { error: `Папка не существует: ${workspace}. Поставь галочку «Создать папку», если хочешь чтобы я её создал.` },
              400,
            );
          }
          const safeRoots = [os.homedir(), path.resolve(workspaceRoot), path.join(os.homedir(), "Documents")];
          const isUnderSafe = safeRoots.some((root) => workspace === root || workspace.startsWith(root + path.sep));
          if (!isUnderSafe) {
            return sendJson(
              res,
              { error: `Создание новой папки разрешено только под ${os.homedir()}/. Укажи путь в твоей домашней директории.` },
              400,
            );
          }
          try {
            fs.mkdirSync(workspace, { recursive: true });
          } catch (error) {
            return sendJson(res, { error: `Не удалось создать папку: ${error.message}` }, 500);
          }
        } else if (!fs.statSync(workspace).isDirectory()) {
          return sendJson(res, { error: `Путь существует, но это не папка: ${workspace}` }, 400);
        }

        const allowedProviders = new Set(["deepseek", "qwen", "chatgpt"]);
        const requestedProvider = String(body.provider || "deepseek");
        if (!allowedProviders.has(requestedProvider)) {
          return sendJson(res, { error: `Провайдер "${requestedProvider}" не поддерживается.` }, 400);
        }
        const provider = requestedProvider;
        // Сессию DeepSeek создаём только для DeepSeek-чатов. У Qwen и ChatGPT свои
        // web-диалоги, которые появляются при первом сообщении.
        const sessionId = null;
        const now = new Date().toISOString();
        const rawTitle = String(body.title || "").trim();
        // Допустимые режимы per-provider. Если режим не из набора — fallback на дефолт провайдера.
        const providerCatalog = getProviderCatalog(provider);
        const modeCfg = {
          allowed: providerCatalog.modes.map((item) => item.id),
          default: providerCatalog.defaultMode,
        };
        const mode = modeCfg.allowed.includes(String(body.mode)) ? String(body.mode) : modeCfg.default;
        const requestedModel = String(body.model || "").trim();
        const model = await resolveProviderModel(provider, requestedModel, mode);
        const appSettings = loadSettings();
        const conversation = {
          id: randomUUID(),
          sessionId,
          provider,
          title: rawTitle || "New chat",
          autoTitle: !rawTitle,
          workspace,
          mode,
          model,
          roleId: normalizeRoleId(body.roleId),
          pipelineMode: body.pipelineMode === true,
          coderMode: body.coderMode === true || body.hardwareMode === true,
          hardwareMode: body.hardwareMode === true,
          memoryEnabled: appSettings.ui?.memoryDefault !== false,
          autoSkill: appSettings.ui?.autoSkillDefault !== false,
          skillId: typeof body.skillId === "string" && body.skillId ? body.skillId : null,
          parentMessageId: null,
          // Отдельный chain для /code, чтобы Coding Agent system-prompt не загрязнял обычный чат.
          codeParentMessageId: null,
          messages: [],
          createdAt: now,
          updatedAt: now,
        };
        state.conversations.unshift(conversation);
        state.activeConversationId = conversation.id;
        saveWindowState(workspaceRoot, state);
        logConsole(`[chat] created ${provider}/${mode}: ${conversation.title} (${conversation.id})`);
        return sendJson(res, { conversation });
      }

      const conversationMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
      if (req.method === "GET" && conversationMatch) {
        const conversation = state.conversations.find((item) => item.id === conversationMatch[1]);
        if (!conversation) return sendJson(res, { error: "Conversation not found" }, 404);
        state.activeConversationId = conversation.id;
        saveWindowState(workspaceRoot, state);
        return sendJson(res, { conversation, running: isRunning(conversation.id) });
      }

      // Обновление настроек чата: модель (для Qwen) и coderMode toggle.
      // Тело: { model?: string, coderMode?: boolean }
      if (req.method === "PATCH" && conversationMatch) {
        const id = conversationMatch[1];
        const conversation = state.conversations.find((item) => item.id === id);
        if (!conversation) return sendJson(res, { error: "Conversation not found" }, 404);
        const body = await readJsonBody(req);
        if (typeof body.model === "string" && body.model.length > 0) {
          conversation.model = body.model;
        }
        if (typeof body.roleId === "string") {
          conversation.roleId = normalizeRoleId(body.roleId);
        }
        if (typeof body.pipelineMode === "boolean") {
          conversation.pipelineMode = body.pipelineMode;
        }
        if (typeof body.coderMode === "boolean") {
          conversation.coderMode = body.coderMode;
          if (!body.coderMode) conversation.hardwareMode = false;
        }
        if (typeof body.hardwareMode === "boolean") {
          conversation.hardwareMode = body.hardwareMode;
          if (body.hardwareMode) conversation.coderMode = true;
        }
        if (typeof body.memoryEnabled === "boolean") {
          conversation.memoryEnabled = body.memoryEnabled;
        }
        if (typeof body.autoSkill === "boolean") {
          conversation.autoSkill = body.autoSkill;
        }
        if (body.skillId === null || typeof body.skillId === "string") {
          conversation.skillId = body.skillId ? String(body.skillId) : null;
        }
        conversation.updatedAt = new Date().toISOString();
        saveWindowState(workspaceRoot, state);
        return sendJson(res, { conversation });
      }

      const installMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/install-request\/(approve|reject)$/);
      if (req.method === "POST" && installMatch) {
        const conversation = state.conversations.find((item) => item.id === installMatch[1]);
        if (!conversation) return sendJson(res, { error: "Conversation not found" }, 404);
        const request = conversation.pendingInstallRequest;
        if (!request || request.status !== "pending") {
          return sendJson(res, { error: "No pending install request" }, 400);
        }
        if (installMatch[2] === "reject") {
          conversation.pendingInstallRequest = { ...request, status: "rejected", updatedAt: new Date().toISOString() };
          conversation.updatedAt = new Date().toISOString();
          saveWindowState(workspaceRoot, state);
          return sendJson(res, { conversation });
        }
        conversation.pendingInstallRequest = { ...request, status: "running", updatedAt: new Date().toISOString() };
        conversation.updatedAt = new Date().toISOString();
        saveWindowState(workspaceRoot, state);
        runApprovedInstall(request, workspaceRoot, (progress) => {
          conversation.pendingInstallRequest = {
            ...conversation.pendingInstallRequest,
            ...progress,
            status: "running",
            updatedAt: new Date().toISOString(),
          };
          conversation.updatedAt = new Date().toISOString();
          saveWindowState(workspaceRoot, state);
        })
          .then((result) => {
            conversation.pendingInstallRequest = {
              ...request,
              status: result.ok ? "installed" : "failed",
              result,
              updatedAt: new Date().toISOString(),
            };
            conversation.messages.push({
              role: "assistant",
              content: result.ok
                ? `Установка завершена: ${request.title}`
                : `Установка не удалась: ${request.title}\n${result.stderr || result.error || ""}`.trim(),
              createdAt: new Date().toISOString(),
            });
            conversation.updatedAt = new Date().toISOString();
            saveWindowState(workspaceRoot, state);
          })
          .catch((error) => {
            conversation.pendingInstallRequest = {
              ...request,
              status: "failed",
              result: { ok: false, error: error.message },
              updatedAt: new Date().toISOString(),
            };
            conversation.updatedAt = new Date().toISOString();
            saveWindowState(workspaceRoot, state);
          });
        return sendJson(res, { conversation, runningInstall: true });
      }

      const permissionMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/permission-request\/(approve|reject)$/);
      if (req.method === "POST" && permissionMatch) {
        const conversation = state.conversations.find((item) => item.id === permissionMatch[1]);
        if (!conversation) return sendJson(res, { error: "Conversation not found" }, 404);
        const request = conversation.pendingPermissionRequest;
        if (!request || request.status !== "pending") {
          return sendJson(res, { error: "No pending permission request" }, 400);
        }
        if (permissionMatch[2] === "reject") {
          conversation.pendingPermissionRequest = { ...request, status: "rejected", updatedAt: new Date().toISOString() };
          saveWindowState(workspaceRoot, state);
          return sendJson(res, { conversation });
        }
        const current = loadSettings();
        const key = request.permissionKey;
        const commandPermissions = { ...(current.commandPermissions || {}) };
        if (key === "allowPythonModuleAndEval") {
          commandPermissions.allowPythonModuleAndEval = true;
        } else if (key === "allowShell") {
          commandPermissions.allowShell = true;
        } else {
          return sendJson(res, { error: `Unknown permission: ${key}` }, 400);
        }
        saveSettings({ allowedCommands: current.allowedCommands, commandPermissions });
        conversation.pendingPermissionRequest = { ...request, status: "enabled", updatedAt: new Date().toISOString() };
        saveWindowState(workspaceRoot, state);
        return sendJson(res, { conversation });
      }

      if (req.method === "DELETE" && conversationMatch) {
        const id = conversationMatch[1];
        const beforeCount = state.conversations.length;
        state.conversations = state.conversations.filter((item) => item.id !== id);
        if (state.conversations.length === beforeCount) {
          return sendJson(res, { error: "Conversation not found" }, 404);
        }
        if (state.activeConversationId === id) {
          state.activeConversationId = state.conversations[0]?.id || null;
        }
        const deletedConversationIds = new Set(
          Array.isArray(state.deletedConversationIds) ? state.deletedConversationIds.map(String) : [],
        );
        deletedConversationIds.add(id);
        state.deletedConversationIds = Array.from(deletedConversationIds).slice(-5000);
        if (state.activeByWorkspace && typeof state.activeByWorkspace === "object") {
          for (const [workspace, conversationId] of Object.entries(state.activeByWorkspace)) {
            if (conversationId === id) delete state.activeByWorkspace[workspace];
          }
        }
        saveWindowState(workspaceRoot, state);
        return sendJson(res, {
          deleted: true,
          activeConversationId: state.activeConversationId,
          conversations: conversationList(state),
        });
      }

      // Остановка выполнения чата (фоновая задача: /code-агент или pipeline).
      const stopMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/stop$/);
      if (req.method === "POST" && stopMatch) {
        const conversation = state.conversations.find((item) => item.id === stopMatch[1]);
        if (!conversation) return sendJson(res, { error: "Conversation not found" }, 404);
        const stopped = stopTask(conversation.id);
        if (stopped) logConsole(`[stop] task stopped for ${conversation.id}`);
        return sendJson(res, { conversation, stopped, running: isRunning(conversation.id) });
      }

      const messageMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
      if (req.method === "POST" && messageMatch) {
        // 30 МБ: ChatGPT-картинки приходят inline (base64) прямо в теле сообщения.
        const body = await readJsonBody(req, 30_000_000);
        const conversation = state.conversations.find((item) => item.id === messageMatch[1]);
        if (!conversation) return sendJson(res, { error: "Conversation not found" }, 404);

        const prompt = String(body.content || "").trim();
        if (!prompt) return sendJson(res, { error: "Message is empty" }, 400);
        conversation.pendingQuestion = null;

        if (body.pipeline === true || conversation.pipelineMode === true) {
          if (isRunning(conversation.id)) {
            conversation.messages.push({
              role: "assistant",
              content: "⏳ В этом чате уже выполняется задача. Подожди завершения.",
              createdAt: new Date().toISOString(),
            });
            conversation.updatedAt = new Date().toISOString();
            saveWindowState(workspaceRoot, state);
            return sendJson(res, { conversation, running: true });
          }
          conversation.messages.push({
            role: "user",
            content: prompt,
            createdAt: new Date().toISOString(),
            pipelineRun: true,
          });
          conversation.messages.push({
            role: "assistant",
            content: "Pipeline started. Передаю задачу по связям...",
            createdAt: new Date().toISOString(),
            pipelineStatus: "running",
          });
          conversation.updatedAt = new Date().toISOString();
          state.activeConversationId = conversation.id;
          saveWindowState(workspaceRoot, state);
          startTask(conversation.id, "pipeline", async (signal) => {
            await runPipelineFromConversation(conversation.id, prompt, body, signal);
          }, "Pipeline");
          return sendJson(res, { conversation, running: true });
        }

        // Маршрутизация по провайдеру.
        const convProvider = conversation.provider || "deepseek";
        logConsole(`[chat] ${convProvider} message in ${conversation.title}: ${summarizeForLog(prompt)}`);
        logConsoleBlock("user", prompt);
        if (convProvider === "qwen") {
          // Пушим user-сообщение СРАЗУ, до запроса к Qwen, чтобы оно отображалось
          // в UI пока ждём ответ (4-5 сек). Иначе пользовательское сообщение
          // «исчезает» с экрана до момента, как придёт ответ.
          conversation.messages.push({
            role: "user",
            content: prompt,
            createdAt: new Date().toISOString(),
          });
          conversation.updatedAt = new Date().toISOString();
          saveWindowState(workspaceRoot, state);

          // Lazy-init Qwen-клиента — создаём один раз за life сервера.
          try {
            let qwenClient = await getOrCreateQwenClient();
            // Lazy createChat: на первом сообщении. Модель — из чата.
            if (!conversation.sessionId) {
              conversation.sessionId = await qwenApiCall((c) =>
                c.createChat({ model: conversation.model || undefined }),
              );
              saveWindowState(workspaceRoot, state);
              qwenClient = await getOrCreateQwenClient();
            }

            // /code-режим или Coder-mode (per-chat toggle) → запускаем code-agent.
            // ASYNC: задача идёт в фоне через task-runner. Возвращаем conversation
            // сразу с running:true, UI делает polling до завершения.
            const agentModes = await resolveAgentModes(prompt);
            const agentInput = resolveConversationAgentTask(prompt, conversation, agentModes);
            const hardwareMode = conversation.hardwareMode === true;
            if (agentInput.run) {
              const task = agentInput.task;
              if (agentInput.empty) {
                conversation.messages.push({
                  role: "assistant",
                  content: AGENT_TASK_EMPTY_HELP,
                  createdAt: new Date().toISOString(),
                });
                conversation.updatedAt = new Date().toISOString();
                saveWindowState(workspaceRoot, state);
                return sendJson(res, { conversation });
              }

              if (isRunning(conversation.id)) {
                captureRunningClarification(conversation, prompt);
                conversation.updatedAt = new Date().toISOString();
                saveWindowState(workspaceRoot, state);
                return sendJson(res, { conversation, running: true });
              }

              const { createQwenAgentAdapter } = await import("../providers/qwen/agent-adapter.mjs");
              const { QWEN_RELOGIN_IN_PROGRESS_MESSAGE } = await import("../providers/qwen/session-errors.mjs");
              const progressLogs = [];
              const progressMessage = createCodeProgressMessage(task, { browserOnly: agentInput.browserOnly });
              conversation.messages.push(progressMessage);
              const adapter = createQwenAgentAdapter({
                complete: (opts) =>
                  qwenApiCall((c) => c.complete(opts), {
                    onRelogin: () => {
                      progressMessage.content = [
                        QWEN_RELOGIN_IN_PROGRESS_MESSAGE,
                        "",
                        summarizeForLog(task, 240),
                      ].join("\n");
                      progressMessage.updatedAt = new Date().toISOString();
                      conversation.updatedAt = progressMessage.updatedAt;
                      saveWindowState(workspaceRoot, state);
                    },
                  }),
              });
              const workspacePath = path.resolve(conversation.workspace || workspaceRoot);
              await prepareBrowserAgentTask(task);
              const qwenCodeUseSearch = await resolveProviderSearchEnabled(task, body, searchEnabled);
              const baseOptions = {
                sessionId: conversation.sessionId,
                thinkingEnabled: body.thinking === true,
                searchEnabled: qwenCodeUseSearch,
                model: conversation.model || undefined,
              };
              const parentId = getCodeParentMessageId(conversation);
              conversation.updatedAt = new Date().toISOString();
              saveWindowState(workspaceRoot, state);

              startTask(conversation.id, "code", async (signal) => {
                const memorySavedHandler = createCodeMemorySavedHandler({
                  conversation,
                  progressMessage,
                  workspaceRoot,
                  state,
                  saveWindowState,
                });
                try {
                  logConsole(`[code] qwen started: ${summarizeForLog(task)}`);
                  const codeResult = await runAgentTask(adapter, baseOptions, workspacePath, task, parentId, {
                    signal,
                    ...buildAgentTaskOptions(conversation, body, {
                      hardwareMode,
                      systemPrompt: hardwareMode ? createHardwareAgentPrompt() : "",
                      agentInput,
                    }),
                    onMemorySaved: memorySavedHandler,
                    takeInterrupts: () => takeRunningClarifications(conversation),
                    onTool: (_call, result, log) => {
                      captureInstallRequest(conversation, result);
                      captureQuestionRequest(conversation, result);
                      capturePermissionRequest(conversation, result);
                      progressLogs.push(log);
                      progressMessage.content = formatCodeProgressMessage(task, progressLogs, { browserOnly: agentInput.browserOnly });
                      progressMessage.updatedAt = new Date().toISOString();
                      conversation.updatedAt = progressMessage.updatedAt;
                      saveWindowState(workspaceRoot, state);
                    },
                  });
                  conversation.codeParentMessageId = codeResult.parentMessageId ?? conversation.codeParentMessageId;
                  conversation.codeAgentPromptVersion = CODE_AGENT_PROMPT_VERSION;
                  const toolText = codeResult.toolLogs.length ? `${codeResult.toolLogs.join("\n")}\n\n` : "";
                  const finalized = finalizeCodeTaskMessage(codeResult);
                  conversation.lastAgentMeta = finalized.agentMeta;
                  progressMessage.content = `${toolText}${finalized.content}`.trimEnd();
                  delete progressMessage.streaming;
                  progressMessage.updatedAt = new Date().toISOString();
                  if (toolText) logConsoleBlock("code tools", toolText);
                  logConsoleBlock("assistant", codeResult.message);
                  logConsole(`[code] qwen completed: ${codeResult.toolLogs.length} tool log(s)`);
                } catch (err) {
                  progressMessage.content = `⚠️ /code error: ${err.message}`;
                  delete progressMessage.streaming;
                  progressMessage.updatedAt = new Date().toISOString();
                  logConsole(`[code] qwen failed: ${err.message}`);
                }
                conversation.updatedAt = new Date().toISOString();
                saveWindowState(workspaceRoot, state);
              }, "Qwen /code");

              return sendJson(res, { conversation, running: true });
            }

            const isQwenReasoning = findProviderModel("qwen", conversation.model)?.reasoning === true;
            const qwenUseSearch = await resolveProviderSearchEnabled(prompt, body, searchEnabled);
            let qwenPrompt = qwenUseSearch ? withWebSearchInstruction(prompt) : prompt;

            if (isRunning(conversation.id)) {
              return sendJson(res, { error: "Дождитесь завершения текущего ответа Qwen." }, 409);
            }

            const { formatQwenStreamDisplay } = await import("../providers/qwen/client.mjs");
            const streamMessage = {
              role: "assistant",
              content: "…",
              streaming: true,
              createdAt: new Date().toISOString(),
            };
            conversation.messages.push(streamMessage);
            conversation.updatedAt = new Date().toISOString();
            saveWindowState(workspaceRoot, state);

            beginNdjsonStream(res);
            writeNdjsonLine(res, { type: "start", conversation });

            let answerText = "";
            let thinkingText = "";
            let lastSave = 0;
            const pushStreamDelta = () => {
              streamMessage.content = formatQwenStreamDisplay(thinkingText, answerText);
              streamMessage.updatedAt = new Date().toISOString();
              conversation.updatedAt = streamMessage.updatedAt;
              const now = Date.now();
              if (now - lastSave >= 180) {
                lastSave = now;
                saveWindowState(workspaceRoot, state);
              }
              writeNdjsonLine(res, { type: "delta", content: streamMessage.content });
            };

            try {
              const { QWEN_RELOGIN_IN_PROGRESS_MESSAGE } = await import("../providers/qwen/session-errors.mjs");
              const result = await qwenApiCall(
                (c) =>
                  c.complete({
                    chatId: conversation.sessionId,
                    prompt: qwenPrompt,
                    parentId: conversation.parentMessageId,
                    thinking: isQwenReasoning ? true : (body.thinking === true),
                    search: qwenUseSearch,
                    model: conversation.model || undefined,
                    onText: (chunk) => {
                      answerText += chunk;
                      pushStreamDelta();
                    },
                    onThinking: (chunk) => {
                      thinkingText += chunk;
                      pushStreamDelta();
                    },
                  }),
                {
                  onRelogin: () => {
                    streamMessage.content = QWEN_RELOGIN_IN_PROGRESS_MESSAGE;
                    streamMessage.updatedAt = new Date().toISOString();
                    pushStreamDelta();
                  },
                },
              );
              conversation.parentMessageId = result.lastMessageId ?? conversation.parentMessageId;
              const finalText = result.thinkingText
                ? formatQwenStreamDisplay(result.thinkingText, result.text)
                : String(result.text || "").trim();
              delete streamMessage.streaming;
              streamMessage.content = finalText || "[empty]";
              streamMessage.updatedAt = new Date().toISOString();
              conversation.updatedAt = streamMessage.updatedAt;
              saveWindowState(workspaceRoot, state);
              scheduleChatMemorySave({
                conversation,
                body,
                workspacePath: path.resolve(conversation.workspace || workspaceRoot),
                userPrompt: prompt,
                assistantText: finalText,
              });
              logConsoleBlock("assistant", finalText || "[empty]");
              logConsole(`[chat] qwen assistant response: ${finalText.length} char(s)`);
              writeNdjsonLine(res, { type: "done", conversation });
            } catch (error) {
              delete streamMessage.streaming;
              streamMessage.content = `⚠️ Qwen error: ${formatQwenError(error)}`;
              streamMessage.updatedAt = new Date().toISOString();
              conversation.updatedAt = streamMessage.updatedAt;
              saveWindowState(workspaceRoot, state);
              logConsole(`[chat] qwen failed: ${error.message}`);
              writeNdjsonLine(res, { type: "error", conversation, message: error.message });
            }
            endNdjsonStream(res);
            return;
          } catch (error) {
            conversation.messages.push({
              role: "assistant",
              content: `⚠️ Qwen error: ${formatQwenError(error)}`,
              createdAt: new Date().toISOString(),
            });
            conversation.updatedAt = new Date().toISOString();
            saveWindowState(workspaceRoot, state);
            logConsole(`[chat] qwen failed: ${error.message}`);
          }
          return sendJson(res, { conversation });
        }
        if (convProvider === "chatgpt") {
          const now = new Date().toISOString();
          const isFirstUserMessage = !conversation.messages.some((message) => message.role === "user");
          if (isFirstUserMessage && shouldAutoTitle(conversation)) {
            conversation.title = makeConversationTitle(prompt);
          }
          conversation.messages.push({
            role: "user",
            content: prompt,
            createdAt: now,
          });
          conversation.updatedAt = now;
          state.activeConversationId = conversation.id;
          saveWindowState(workspaceRoot, state);

          const agentModes = await resolveAgentModes(prompt);
          const agentInput = resolveConversationAgentTask(prompt, conversation, agentModes);
          const runChatGPTCodeAgent = agentInput.run;
          const hardwareMode = conversation.hardwareMode === true;
          if (runChatGPTCodeAgent) {
            const task = agentInput.task;
            if (agentInput.empty) {
              conversation.messages.push({
                role: "assistant",
                content: AGENT_TASK_EMPTY_HELP,
                createdAt: new Date().toISOString(),
              });
              conversation.updatedAt = new Date().toISOString();
              saveWindowState(workspaceRoot, state);
              return sendJson(res, { conversation });
            }

            if (isRunning(conversation.id)) {
              captureRunningClarification(conversation, prompt);
              conversation.updatedAt = new Date().toISOString();
              saveWindowState(workspaceRoot, state);
              return sendJson(res, { conversation, running: true });
            }

            try {
              // Гарантируем живую веб-сессию: при слетевшей сессии откроется окно входа.
              await ensureChatGPTSessionReady();
              const chatGPTClient = await getOrCreateChatGPTClient();
              // Картинки прикрепляются к первому шагу агента (через веб-композер ChatGPT).
              const chatGPTCodeImages = Array.isArray(body.images)
                ? body.images.filter((img) => img && img.dataBase64 && img.name)
                : [];
              const { createChatGPTAgentAdapter } = await import("../providers/chatgpt/agent-adapter.mjs");
              const adapter = createChatGPTAgentAdapter(chatGPTClient, {
                conversationId: conversation.sessionId || null,
                images: chatGPTCodeImages,
                onConversationId: (id) => {
                  conversation.sessionId = id;
                  saveWindowState(workspaceRoot, state);
                },
              });
              const workspacePath = path.resolve(conversation.workspace || workspaceRoot);
              await prepareBrowserAgentTask(task);
              const chatGPTCodeUseSearch = await resolveProviderSearchEnabled(task, body, searchEnabled);
              const baseOptions = {
                sessionId: conversation.sessionId,
                searchEnabled: chatGPTCodeUseSearch,
              };
              const parentId = getCodeParentMessageId(conversation);
              const progressLogs = [];
              const progressMessage = createCodeProgressMessage(task, { browserOnly: agentInput.browserOnly });
              conversation.messages.push(progressMessage);
              conversation.updatedAt = new Date().toISOString();
              saveWindowState(workspaceRoot, state);

              startTask(conversation.id, "code", async (signal) => {
                const memorySavedHandler = createCodeMemorySavedHandler({
                  conversation,
                  progressMessage,
                  workspaceRoot,
                  state,
                  saveWindowState,
                });
                try {
                  logConsole(`[code] chatgpt started: ${summarizeForLog(task)}`);
                  const codeResult = await runAgentTask(adapter, baseOptions, workspacePath, task, parentId, {
                    signal,
                    ...buildAgentTaskOptions(conversation, body, {
                      hardwareMode,
                      systemPrompt: hardwareMode ? createHardwareAgentPrompt() : "",
                      agentInput,
                    }),
                    onMemorySaved: memorySavedHandler,
                    takeInterrupts: () => takeRunningClarifications(conversation),
                    onTool: (_call, result, log) => {
                      captureInstallRequest(conversation, result);
                      captureQuestionRequest(conversation, result);
                      capturePermissionRequest(conversation, result);
                      progressLogs.push(log);
                      progressMessage.content = formatCodeProgressMessage(task, progressLogs, { browserOnly: agentInput.browserOnly });
                      progressMessage.updatedAt = new Date().toISOString();
                      conversation.updatedAt = progressMessage.updatedAt;
                      saveWindowState(workspaceRoot, state);
                    },
                  });
                  conversation.codeParentMessageId = codeResult.parentMessageId ?? conversation.codeParentMessageId;
                  conversation.codeAgentPromptVersion = CODE_AGENT_PROMPT_VERSION;
                  conversation.sessionId = adapter.getConversationId() || conversation.sessionId;
                  const toolText = codeResult.toolLogs.length ? `${codeResult.toolLogs.join("\n")}\n\n` : "";
                  const finalized = finalizeCodeTaskMessage(codeResult);
                  conversation.lastAgentMeta = finalized.agentMeta;
                  progressMessage.content = `${toolText}${finalized.content}`.trimEnd();
                  delete progressMessage.streaming;
                  progressMessage.updatedAt = new Date().toISOString();
                  if (toolText) logConsoleBlock("code tools", toolText);
                  logConsoleBlock("assistant", codeResult.message);
                  logConsole(`[code] chatgpt completed: ${codeResult.toolLogs.length} tool log(s)`);
                } catch (err) {
                  progressMessage.content = `⚠️ /code error: ${err.message}`;
                  delete progressMessage.streaming;
                  progressMessage.updatedAt = new Date().toISOString();
                  logConsole(`[code] chatgpt failed: ${err.message}`);
                }
                conversation.updatedAt = new Date().toISOString();
                saveWindowState(workspaceRoot, state);
              }, agentInput.slash ? "ChatGPT /code" : "ChatGPT auto-code");

              return sendJson(res, { conversation, running: true });
            } catch (error) {
              conversation.messages.push({
                role: "assistant",
                content: `⚠️ ChatGPT /code error: ${error.message}`,
                createdAt: new Date().toISOString(),
              });
              conversation.updatedAt = new Date().toISOString();
              saveWindowState(workspaceRoot, state);
              logConsole(`[code] chatgpt failed to start: ${error.message}`);
              return sendJson(res, { conversation });
            }
          }

          try {
            await ensureChatGPTSessionReady();
            const chatGPTClient = await getOrCreateChatGPTClient();
            const modelInfo = findProviderModel("chatgpt", conversation.model);
            const chatGPTImages = Array.isArray(body.images)
              ? body.images.filter((img) => img && img.dataBase64 && img.name)
              : [];

            const streamMessage = {
              role: "assistant",
              content: "…",
              streaming: true,
              createdAt: new Date().toISOString(),
            };
            conversation.messages.push(streamMessage);
            conversation.updatedAt = streamMessage.createdAt;
            saveWindowState(workspaceRoot, state);

            beginNdjsonStream(res);
            writeNdjsonLine(res, { type: "start", conversation });

            let answerText = "";
            let lastSave = 0;
            const pushStreamDelta = () => {
              streamMessage.content = answerText || "…";
              streamMessage.updatedAt = new Date().toISOString();
              conversation.updatedAt = streamMessage.updatedAt;
              const now = Date.now();
              if (now - lastSave >= 180) {
                lastSave = now;
                saveWindowState(workspaceRoot, state);
              }
              writeNdjsonLine(res, { type: "delta", content: streamMessage.content });
            };

            try {
              const result = await chatGPTApiCall((c) =>
                c.complete({
                  prompt,
                  model: modelInfo?.apiModel || conversation.model || undefined,
                  conversationId: conversation.sessionId,
                  parentMessageId: conversation.parentMessageId,
                  images: chatGPTImages,
                  onText: (chunk) => {
                    answerText = String(chunk || "");
                    pushStreamDelta();
                  },
                }),
              );
              conversation.sessionId = result.conversationId ?? conversation.sessionId;
              conversation.parentMessageId = result.lastMessageId ?? conversation.parentMessageId;
              const generatedImages = Array.isArray(result.images) ? result.images.filter(Boolean) : [];
              const apiText = String(result.text || "").trimEnd();
              const streamed = String(answerText || "").trimEnd();
              const finalText = (apiText.length >= streamed.length ? apiText : streamed)
                || (generatedImages.length ? "" : "[empty]");
              delete streamMessage.streaming;
              streamMessage.content = finalText || (generatedImages.length ? "" : "[empty]");
              if (generatedImages.length) streamMessage.images = generatedImages;
              streamMessage.updatedAt = new Date().toISOString();
              conversation.updatedAt = streamMessage.updatedAt;
              saveWindowState(workspaceRoot, state);
              scheduleChatMemorySave({
                conversation,
                body,
                workspacePath: path.resolve(conversation.workspace || workspaceRoot),
                userPrompt: prompt,
                assistantText: finalText,
              });
              logConsoleBlock("assistant", finalText || "[empty]");
              logConsole(`[chat] chatgpt assistant response: ${finalText.length} char(s)`);
              writeNdjsonLine(res, { type: "done", conversation });
            } catch (error) {
              const needsChatGPTLogin = Boolean(error?.needsChatGPTLogin)
                || /сессия истекла|session expired|not logged in|HTTP 401|unauthorized/i.test(String(error?.message || error));
              const browserNotReady = /cloudflare|поле ввода|интерфейс|composer|проверку/i.test(
                String(error?.message || error),
              );
              delete streamMessage.streaming;
              streamMessage.content = needsChatGPTLogin
                ? "⚠️ Нужен вход в ChatGPT: 🧠 → Браузер → вкладка ChatGPT. Войдите, нажмите «Синхронизировать», drawer можно закрыть — сессия сохранится."
                : browserNotReady
                  ? "⚠️ Внутренний ChatGPT ещё не готов. Откройте 🧠 → Браузер → ChatGPT и дождитесь статуса «ChatGPT готов». При зависании нажмите ↻."
                  : `⚠️ ChatGPT error: ${error.message}`;
              streamMessage.updatedAt = new Date().toISOString();
              conversation.updatedAt = streamMessage.updatedAt;
              saveWindowState(workspaceRoot, state);
              logConsole(`[chat] chatgpt failed: ${error.message}`);
              writeNdjsonLine(res, {
                type: "error",
                conversation,
                needsChatGPTLogin,
                message: error.message,
              });
            }
            endNdjsonStream(res);
            return;
          } catch (error) {
            conversation.messages.push({
              role: "assistant",
              content: `⚠️ ChatGPT error: ${error.message}`,
              createdAt: new Date().toISOString(),
            });
            conversation.updatedAt = new Date().toISOString();
            saveWindowState(workspaceRoot, state);
            logConsole(`[chat] chatgpt failed: ${error.message}`);
            return sendJson(res, { conversation });
          }
        }
        if (convProvider !== "deepseek") {
          conversation.messages.push({
            role: "assistant",
            content: `⚠️ Провайдер "${convProvider}" не поддерживается этим CLI.`,
            createdAt: new Date().toISOString(),
          });
          conversation.updatedAt = new Date().toISOString();
          saveWindowState(workspaceRoot, state);
          return sendJson(res, { conversation });
        }

        // Режим берём ИЗ ЧАТА (зафиксирован при создании). Переключить нельзя —
        // DeepSeek завязывает parent_message_id chain на одну модель.
        // Тумблеры (thinking/search) — можно переключать per-message.
        // Поддержка смены модели DeepSeek прямо из селектора чата (как у Qwen)
        let messageMode = String(conversation.mode || "fast");
        if (conversation.model === "deepseek-v4-pro" || conversation.model === "deepseek-reasoner") {
          messageMode = "expert";
        } else if (conversation.model === "deepseek-v4-flash" || conversation.model === "deepseek-chat") {
          messageMode = "fast";
        } else if (conversation.model === "deepseek-v4-vision") {
          messageMode = "vision";
        }
        // thinking: в Expert (Pro) безусловно true (модель R1 не работает без thinking), в остальных по умолчанию.
        let useThinking = effectiveThinkingForMode(messageMode, body.thinking, thinkingEnabled);
        if (messageMode === "expert") {
          useThinking = true;
        }
        let useSearch = await resolveProviderSearchEnabled(prompt, body, searchEnabled);
        // file_id'ы загруженных картинок для vision-режима. Фронт сначала зальёт
        // файлы через /api/upload, потом шлёт их id здесь.
        const refFileIds = Array.isArray(body.refFileIds)
          ? body.refFileIds.filter((id) => typeof id === "string" && id.length > 0)
          : [];
        let effectiveModelType = mapModeToModelType(messageMode, modelType);
        // С картинками и режимом «Распознание» — явный model_type vision, если не задан в .env.
        if (refFileIds.length > 0 && messageMode === "vision" && effectiveModelType == null) {
          effectiveModelType = process.env.DEEPSEEK_MODEL_VISION ?? "vision";
        }
        // С картинками поиск обычно ломает vision-completion (ref_file_ids).
        if (refFileIds.length > 0) {
          useSearch = false;
        }
        if (!conversation.sessionId) {
          conversation.sessionId = await client.createSession();
          saveWindowState(workspaceRoot, state);
        }

        const now = new Date().toISOString();
        const isFirstUserMessage = !conversation.messages.some((message) => message.role === "user");
        if (isFirstUserMessage && shouldAutoTitle(conversation)) {
          conversation.title = makeConversationTitle(prompt);
        }
        conversation.messages.push({ role: "user", content: prompt, createdAt: now });
        conversation.updatedAt = now;
        state.activeConversationId = conversation.id;
        saveWindowState(workspaceRoot, state);

        const agentModes = await resolveAgentModes(prompt);
        const agentInput = resolveConversationAgentTask(prompt, conversation, agentModes);
        const dsHardwareMode = conversation.hardwareMode === true;
        if (agentInput.run) {
          const task = agentInput.task;
          if (agentInput.empty) {
            conversation.messages.push({
              role: "assistant",
              content: AGENT_TASK_EMPTY_HELP,
              createdAt: new Date().toISOString(),
            });
            conversation.updatedAt = new Date().toISOString();
            saveWindowState(workspaceRoot, state);
            return sendJson(res, { conversation });
          }

          if (isRunning(conversation.id)) {
            captureRunningClarification(conversation, prompt);
            conversation.updatedAt = new Date().toISOString();
            saveWindowState(workspaceRoot, state);
            return sendJson(res, { conversation, running: true });
          }

          // КРИТИЧНО: /code держит СВОЙ parent_message_id chain, отдельный от обычного чата.
          // Иначе system-prompt «You are a coding agent, no internet» цепляется к обычным
          // сообщениям, и модель отказывается отвечать на вопросы про реальный мир.
          //
          // ASYNC: запускаем через task-runner, чтобы UI не блокировался и можно было
          // параллельно запустить /code в других чатах. Возвращаем conversation сразу,
          // фронт делает polling /api/state до завершения.
          const workspacePath = path.resolve(conversation.workspace || workspaceRoot);
          await prepareBrowserAgentTask(task);
          const dsCodeUseSearch = await resolveProviderSearchEnabled(task, body, searchEnabled);
          const baseOptions = {
            sessionId: conversation.sessionId,
            modelType: effectiveModelType,
            thinkingEnabled: useThinking,
            searchEnabled: dsCodeUseSearch,
          };
          const parentId = getCodeParentMessageId(conversation);
          const progressLogs = [];
          const progressMessage = createCodeProgressMessage(task, { browserOnly: agentInput.browserOnly });
          conversation.messages.push(progressMessage);
          conversation.updatedAt = new Date().toISOString();
          saveWindowState(workspaceRoot, state);

          startTask(conversation.id, "code", async (signal) => {
            const memorySavedHandler = createCodeMemorySavedHandler({
              conversation,
              progressMessage,
              workspaceRoot,
              state,
              saveWindowState,
            });
            try {
              logConsole(`[code] deepseek started: ${summarizeForLog(task)}`);
              const codeResult = await runAgentTask(client, baseOptions, workspacePath, task, parentId, {
                signal,
                ...buildAgentTaskOptions(conversation, body, {
                  hardwareMode: dsHardwareMode,
                  systemPrompt: dsHardwareMode ? createHardwareAgentPrompt() : "",
                  agentInput,
                }),
                onMemorySaved: memorySavedHandler,
                takeInterrupts: () => takeRunningClarifications(conversation),
                onTool: (_call, result, log) => {
                  captureInstallRequest(conversation, result);
                  captureQuestionRequest(conversation, result);
                  capturePermissionRequest(conversation, result);
                  progressLogs.push(log);
                  progressMessage.content = formatCodeProgressMessage(task, progressLogs, { browserOnly: agentInput.browserOnly });
                  progressMessage.updatedAt = new Date().toISOString();
                  conversation.updatedAt = progressMessage.updatedAt;
                  saveWindowState(workspaceRoot, state);
                },
              });
              conversation.codeParentMessageId = codeResult.parentMessageId ?? conversation.codeParentMessageId;
              conversation.codeAgentPromptVersion = CODE_AGENT_PROMPT_VERSION;
              const toolText = codeResult.toolLogs.length ? `${codeResult.toolLogs.join("\n")}\n\n` : "";
              const finalized = finalizeCodeTaskMessage(codeResult);
              conversation.lastAgentMeta = finalized.agentMeta;
              progressMessage.content = `${toolText}${finalized.content}`.trimEnd();
              delete progressMessage.streaming;
              progressMessage.updatedAt = new Date().toISOString();
              if (toolText) logConsoleBlock("code tools", toolText);
              logConsoleBlock("assistant", codeResult.message);
              logConsole(`[code] deepseek completed: ${codeResult.toolLogs.length} tool log(s)`);
            } catch (err) {
              progressMessage.content = `⚠️ /code error: ${err.message}`;
              delete progressMessage.streaming;
              progressMessage.updatedAt = new Date().toISOString();
              logConsole(`[code] deepseek failed: ${err.message}`);
            }
            conversation.updatedAt = new Date().toISOString();
            saveWindowState(workspaceRoot, state);
          }, agentInput.slash ? "DeepSeek /code" : "DeepSeek auto-code");

          return sendJson(res, { conversation, running: true });
        }

        let deepseekPrompt = useSearch ? withWebSearchInstruction(prompt) : prompt;

        const streamMessage = {
          role: "assistant",
          content: "…",
          streaming: true,
          createdAt: new Date().toISOString(),
        };
        conversation.messages.push(streamMessage);
        conversation.updatedAt = streamMessage.createdAt;
        saveWindowState(workspaceRoot, state);

        beginNdjsonStream(res);
        writeNdjsonLine(res, { type: "start", conversation });

        let answerText = "";
        let lastSave = 0;
        const pushStreamDelta = () => {
          streamMessage.content = answerText || "…";
          streamMessage.updatedAt = new Date().toISOString();
          conversation.updatedAt = streamMessage.updatedAt;
          const now = Date.now();
          if (now - lastSave >= 180) {
            lastSave = now;
            saveWindowState(workspaceRoot, state);
          }
          writeNdjsonLine(res, { type: "delta", content: streamMessage.content });
        };

        try {
          const result = await client.complete({
            sessionId: conversation.sessionId,
            prompt: deepseekPrompt,
            parentMessageId: conversation.parentMessageId,
            modelType: effectiveModelType,
            thinkingEnabled: useThinking,
            searchEnabled: useSearch,
            refFileIds,
            onText: (chunk) => {
              answerText += chunk;
              pushStreamDelta();
            },
          });

          conversation.parentMessageId = result.lastAssistantMessageId ?? conversation.parentMessageId;
          const finalText = String(result.text || answerText || "").trimEnd();
          delete streamMessage.streaming;
          streamMessage.content = finalText || "[empty]";
          streamMessage.updatedAt = new Date().toISOString();
          conversation.updatedAt = streamMessage.updatedAt;
          saveWindowState(workspaceRoot, state);
          scheduleChatMemorySave({
            conversation,
            body,
            workspacePath: path.resolve(conversation.workspace || workspaceRoot),
            userPrompt: prompt,
            assistantText: finalText,
          });
          logConsoleBlock("assistant", finalText);
          logConsole(`[chat] deepseek assistant response: ${finalText.length} char(s)`);
          writeNdjsonLine(res, { type: "done", conversation });
        } catch (error) {
          delete streamMessage.streaming;
          streamMessage.content = `⚠️ DeepSeek error: ${error.message}`;
          streamMessage.updatedAt = new Date().toISOString();
          conversation.updatedAt = streamMessage.updatedAt;
          saveWindowState(workspaceRoot, state);
          logConsole(`[chat] deepseek failed: ${error.message}`);
          writeNdjsonLine(res, { type: "error", conversation, message: error.message });
        }
        endNdjsonStream(res);
        return;
      }

      return sendJson(res, { error: "Not found" }, 404);
    } catch (error) {
      return sendJson(res, { error: error.message }, 500);
    }
  });

  server.on("upgrade", (req, socket, head) => {
    try {
      if (handleChatGPTFrameUpgrade(req, socket, head)) return;
    } catch {}
    socket.destroy();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  const url = `http://127.0.0.1:${port}`;
  if (openWindow) {
    console.log(`Workspace window: ${url}`);
    console.log("Tip: Agent panel (memory/skills/browser) is in the 🧠 drawer inside the app.");
    const { openAppWindowInternal } = await import("./app-window.mjs");
    openAppWindowInternal(url).catch((error) => {
      console.log(`⚠️ Не удалось открыть внутреннее окно: ${error.message}`);
      console.log(`   Пробую окно-приложение (--app) без вкладок…`);
      try {
        openAppWindow(url);
      } catch {
        console.log(`   Откройте вручную: ${url}`);
      }
    });
  } else {
    console.log(`Workspace server: ${url}`);
    console.log(`OpenAI-compatible API: ${url}/v1`);
    console.log("Window opening disabled. Console logging is enabled. Press Ctrl+C to stop.");
  }

  // Graceful shutdown: Ctrl+C, кнопка «Выход» в UI, POST /api/shutdown.
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (signal === "SIGINT") process.stdout.write("\n");
    requestAppShutdown({ source: signal || "signal" }).finally(() => {
      process.exit(0);
    });
  };

  registerShutdownServerCloser((done) => {
    server.close(() => done());
    setTimeout(done, 2000).unref();
  });

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGHUP", () => shutdown("SIGHUP"));
}

function withWebSearchInstruction(prompt) {
  return [
    "[SYSTEM]: Web search is enabled for this message. Use the provider web search for current, latest, news, price, schedule, law, or other time-sensitive questions. Do not say you have no internet access when web search results are available.",
    "",
    prompt,
  ].join("\n");
}

async function resolveAgentModes(prompt) {
  const autoBrowserMode = await resolveAutoBrowserMode(prompt);
  const autoCodeMode = !autoBrowserMode && shouldAutoRunCodeTask(prompt);
  return { autoBrowserMode, autoCodeMode };
}

async function resolveAutoBrowserMode(prompt) {
  try {
    const { shouldAutoRunBrowserTask, shouldAutoRunBrowserTaskWithSnapshot } = await import("./browser-snapshot.mjs");
    if (shouldAutoRunBrowserTask(prompt)) return true;
    if (await shouldAutoRunBrowserTaskWithSnapshot(prompt)) return true;
  } catch {}
  return false;
}

async function resolveAutoCodeMode(prompt) {
  return shouldAutoRunCodeTask(prompt);
}

async function resolveProviderSearchEnabled(prompt, body, globalDefault) {
  const userOn = body.search === true || (body.search !== false && globalDefault);
  if (!userOn) return false;
  try {
    const { shouldPreferBrowserOverProviderSearch } = await import("./browser-snapshot.mjs");
    if (await shouldPreferBrowserOverProviderSearch(prompt)) return false;
  } catch {}
  return true;
}

async function prepareBrowserAgentTask(task) {
  try {
    const { warmBrowserForAgentTask } = await import("./browser-snapshot.mjs");
    await warmBrowserForAgentTask(task);
  } catch {}
}

function summarizeForLog(value, maxLength = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function normalizePipelinePatch(body, conversations) {
  const ids = new Set(conversations.map((conversation) => conversation.id));
  const edges = Array.isArray(body?.edges)
    ? body.edges
        .map((edge) => ({
          from: String(edge?.from || ""),
          to: String(edge?.to || ""),
        }))
        .filter((edge) => edge.from && edge.to && edge.from !== edge.to && ids.has(edge.from) && ids.has(edge.to))
    : [];
  const seen = new Set();
  return {
    edges: edges.filter((edge) => {
      const key = `${edge.from}->${edge.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    updatedAt: new Date().toISOString(),
  };
}

function modeForConversation(conversation) {
  if (conversation.model === "deepseek-v4-pro" || conversation.model === "deepseek-reasoner") return "expert";
  if (conversation.model === "deepseek-v4-flash" || conversation.model === "deepseek-chat") return "fast";
  if (conversation.model === "deepseek-v4-vision") return "vision";
  return String(conversation.mode || "fast");
}

function captureInstallRequest(conversation, toolResult) {
  const install = toolResult?.installRequest;
  if (!install || !install.id || !install.command || !Array.isArray(install.args)) return;
  conversation.pendingInstallRequest = {
    requestId: randomUUID(),
    status: "pending",
    ...install,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function captureQuestionRequest(conversation, toolResult) {
  const question = toolResult?.userQuestion;
  if (!question || !question.question) return;
  conversation.pendingQuestion = {
    questionId: randomUUID(),
    status: "pending",
    question: question.question,
    details: question.details || "",
    choices: Array.isArray(question.choices) ? question.choices : [],
    createdAt: new Date().toISOString(),
  };
}

function capturePermissionRequest(conversation, toolResult) {
  const permission = toolResult?.permissionRequest;
  if (!permission || !permission.id || !permission.permissionKey) return;
  conversation.pendingPermissionRequest = {
    requestId: randomUUID(),
    status: "pending",
    ...permission,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function captureRunningClarification(conversation, prompt) {
  const now = new Date().toISOString();
  conversation.messages.push({ role: "user", content: prompt, createdAt: now, interrupt: true });
  conversation.messages.push({
    role: "assistant",
    content: "⚠️ Уточнение принято. Агент учтёт его на следующем шаге текущей задачи.",
    createdAt: now,
    interruptAck: true,
  });
  const pending = Array.isArray(conversation.pendingInterrupts) ? conversation.pendingInterrupts : [];
  pending.push({ content: prompt, createdAt: now });
  conversation.pendingInterrupts = pending.slice(-10);
  conversation.updatedAt = now;
}

function takeRunningClarifications(conversation) {
  const pending = Array.isArray(conversation.pendingInterrupts) ? conversation.pendingInterrupts : [];
  if (!pending.length) return [];
  conversation.pendingInterrupts = [];
  return pending
    .map((item) => String(item?.content || "").trim())
    .filter(Boolean);
}

function approvedInstallRecipes() {
  return {
    platformio: {
      command: "python3",
      args: ["-m", "pip", "install", "--user", "platformio"],
      verifyCommand: "pio",
      verifyArgs: ["--version"],
    },
    esptool: {
      command: "python3",
      args: ["-m", "pip", "install", "--user", "esptool"],
      verifyCommand: "esptool.py",
      verifyArgs: ["--version"],
    },
    "arduino-cli": {
      command: "brew",
      args: ["install", "arduino-cli"],
      verifyCommand: "arduino-cli",
      verifyArgs: ["version"],
    },
  };
}

function runApprovedInstall(request, cwd, onProgress = () => {}) {
  const recipe = approvedInstallRecipes()[request.id];
  if (!recipe) return Promise.resolve({ ok: false, error: `Unknown install recipe: ${request.id}` });
  if (request.command !== recipe.command || JSON.stringify(request.args) !== JSON.stringify(recipe.args)) {
    return Promise.resolve({ ok: false, error: "Install command does not match approved recipe." });
  }
  return new Promise((resolve) => {
    const env = getCommandExecutionEnv();
    const child = spawn(recipe.command, recipe.args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const startedAt = new Date().toISOString();
    const publish = () => onProgress({
      startedAt,
      stdout: stdout.slice(-12000),
      stderr: stderr.slice(-12000),
    });
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      stderr += "\nInstall timed out after 10 minutes.";
      publish();
    }, 10 * 60 * 1000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      publish();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      publish();
    });
    child.on("error", (error) => {
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: error.message, stdout, stderr });
    });
    child.on("close", async (status, signal) => {
      settled = true;
      clearTimeout(timer);
      const verify = status === 0
        ? await verifyInstalledCommand(recipe, cwd, env)
        : { ok: false, stdout: "", stderr: "" };
      resolve({
        ok: status === 0 && verify.ok,
        status,
        signal,
        command: recipe.command,
        args: recipe.args,
        verifyCommand: recipe.verifyCommand,
        verify,
        stdout: stdout.slice(-12000),
        stderr: [stderr, verify.ok ? "" : verify.stderr || verify.error || ""].filter(Boolean).join("\n").slice(-12000),
      });
    });
  });
}

function verifyInstalledCommand(recipe, cwd, env) {
  if (!recipe.verifyCommand) return Promise.resolve({ ok: true });
  return new Promise((resolve) => {
    const child = spawn(recipe.verifyCommand, recipe.verifyArgs || [], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => resolve({ ok: false, error: error.message, stdout, stderr }));
    child.on("close", (status, signal) => resolve({
      ok: status === 0,
      status,
      signal,
      stdout: stdout.slice(-12000),
      stderr: stderr.slice(-12000),
    }));
  });
}

function createHardwareAgentPrompt() {
  return `ESP / hardware mode is enabled.
- Treat the task as work with a real microcontroller project in this workspace.
- First inspect the project files and identify whether it uses PlatformIO, Arduino CLI, ESP-IDF, or raw esptool artifacts.
- Prefer PlatformIO when platformio.ini exists. Use arduino-cli only for Arduino projects, and esptool.py only for direct ESP diagnostics/flashing.
- Before upload/flash, identify the target board and serial port with safe read-only checks such as list_serial_ports, pio device list, arduino-cli board list, or project file inspection.
- If PlatformIO, arduino-cli, or esptool.py are not installed, still use list_serial_ports for port discovery and then tell the user which external flashing tool must be installed.
- Do not run erase_flash. Do not invent a serial port or board. If the exact port/board/firmware path is missing, ask the user for it.
- Only upload/flash when the user explicitly asks to прошить/upload/flash. For analysis tasks, stop after reporting the plan and required commands.`;
}

function createCodeProgressMessage(task, { browserOnly = false } = {}) {
  const now = new Date().toISOString();
  const label = browserOnly ? "🌐 Браузер" : "⏳ Выполняю задачу";
  return {
    role: "assistant",
    content: `${label}...\n\n${summarizeForLog(task, 240)}`,
    streaming: true,
    createdAt: now,
    updatedAt: now,
  };
}

function getCodeParentMessageId(conversation) {
  if (conversation.codeAgentPromptVersion !== CODE_AGENT_PROMPT_VERSION) {
    conversation.codeParentMessageId = null;
    conversation.codeAgentPromptVersion = CODE_AGENT_PROMPT_VERSION;
    return null;
  }
  return conversation.codeParentMessageId || null;
}

function formatCodeProgressMessage(task, logs, { browserOnly = false } = {}) {
  const visibleLogs = logs.slice(-8).join("\n\n");
  const hiddenCount = Math.max(0, logs.length - 8);
  const prefix = hiddenCount > 0 ? `...ещё ${hiddenCount} предыдущих tool-call(ов)\n\n` : "";
  const label = browserOnly ? "🌐 Браузер" : "⏳ Выполняю задачу";
  return [
    `${label}... tool-call ${logs.length}`,
    summarizeForLog(task, 240),
    "```text",
    `${prefix}${visibleLogs}`.trimEnd(),
    "```",
  ].join("\n\n");
}

export function shouldAutoRunCodeTask(prompt) {
  const text = String(prompt || "").trim();
  if (!text || text === "/code" || text.startsWith("/code ") || text.startsWith("/skill ")) return false;
  const normalized = text.toLowerCase();
  const hasAny = (terms) => terms.some((term) => normalized.includes(term));

  if (/^(как|что|почему|зачем|объясни|расскажи|покажи пример|можешь объяснить)\b/u.test(normalized)) {
    return false;
  }
  if (/^(how|what|why|explain|tell me|can you explain)\b/u.test(normalized)) {
    return false;
  }

  const directAction =
    hasAny(["добавь", "добавить", "сделай", "сделать", "измени", "изменить", "исправь", "исправить", "почини", "починить", "обнови", "обновить", "удали", "удалить", "переименуй", "переименовать", "реализуй", "реализовать", "напиши", "написать", "создай", "создать", "встрой", "встраивай", "встроить", "подключи", "подключить", "проверь", "проверить", "запусти", "запустить", "собери", "собрать", "протестируй", "протестировать", "переведи", "перевести"])
    || /\b(add|create|make|edit|update|change|fix|repair|remove|delete|rename|implement|write|modify|install|run|test|verify|check|build|refactor|wire|integrate)\b/u.test(normalized);

  if (!directAction) return false;

  const strongCodeAction =
    hasAny(["добавь", "измени", "исправь", "почини", "обнови", "удали", "переименуй", "реализуй", "встрой", "встраивай", "встроить", "подключи", "проверь", "запусти", "собери", "протестируй", "переведи"])
    || /\b(add|edit|update|change|fix|repair|remove|delete|rename|implement|modify|install|run|test|verify|build|refactor|wire|integrate)\b/u.test(normalized);
  const projectSignal =
    hasAny(["проект", "код", "файл", "папк", "репозитор", "интерфейс", "плагин", "десктоп", "настройк", "чат", "агент", "модель", "функц", "компонент"])
    || /\b(api|memory|loop|ui|src|test|package|repo|repository|workspace|plugin|desktop|settings|agent|provider)\b/u.test(normalized)
    || /\.(mjs|js|ts|tsx|jsx|json|css|html|md|py|sh|yml|yaml)\b/u.test(normalized)
    || /[/\\]/u.test(normalized);

  return strongCodeAction || projectSignal;
}

// Маппинг режима из UI в значение model_type для DeepSeek API.
//
// Точные значения зависят от того, что DeepSeek принимает на бэкенде —
// мы их не реверсили, это конфигурируется через переменные окружения.
// Хочешь сменить модель для Expert — поставь DEEPSEEK_MODEL_EXPERT=твоё-значение
// в .env. Перезапуск CLI подтянет изменение.
//
// Как узнать правильное значение: открой chat.deepseek.com, DevTools → Network,
// переключи режим, посмотри какой model_type уходит в POST /api/v0/chat/completion.
// Маппинг режима из UI в model_type для DeepSeek API.
// ВАЖНО: реальный DeepSeek-фронт во ВСЕХ режимах (Fast/Expert/Vision) посылает
// model_type: null — отличие режимов закодировано в других флагах
// (thinking_enabled для Expert, ref_file_ids для Vision).
// Если мы шлём model_type: "expert" — DeepSeek принимает (нет 422), но
// архитектурно с ним выключается поиск.
// Через .env можно переопределить для экспериментов с разными моделями.
function mapModeToModelType(mode, fallback) {
  switch (mode) {
    case "expert":
      return process.env.DEEPSEEK_MODEL_EXPERT ?? null;
    case "vision":
      return process.env.DEEPSEEK_MODEL_VISION ?? null;
    case "fast":
    default:
      if (process.env.DEEPSEEK_MODEL_FAST) return process.env.DEEPSEEK_MODEL_FAST;
      return fallback ?? null;
  }
}

// Должны ли мы принудительно включить thinking для данного режима.
// Expert = "глубокое мышление" по умолчанию. Юзер может перебить тумблером.
function effectiveThinkingForMode(mode, userToggle, globalDefault) {
  if (userToggle === true) return true;
  if (userToggle === false) {
    // Юзер явно выключил — даже в Expert уважаем выбор.
    return false;
  }
  // userToggle === undefined: используем дефолт режима.
  if (mode === "expert") return true;
  return globalDefault;
}
