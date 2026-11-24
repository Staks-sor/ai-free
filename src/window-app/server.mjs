import { formatHarnessFailureMessage } from "../harness/errors.mjs";
import { assertTaskContinuation } from "../harness/task-view.mjs";
import { prepareConversationHandoff, buildConversationPrompt } from "../harness/handoff.mjs";
import { resolveUploadConversation } from "./upload-account-binding.mjs";
// HTTP-сервер окна чатов на 127.0.0.1:port. Биндится только на loopback —
// снаружи недоступен. Реализует все REST-эндпойнты, которые рисует фронт.
// На SIGINT/SIGTERM/SIGHUP — graceful shutdown, фронт замечает через heartbeat и закрывается.

import fs from "node:fs";
import http from "node:http";
import { createLocalHttpSecurity } from "./local-http-security.mjs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { openAppWindow } from "../browser/launch.mjs";
import { AGENT_ROLES, getAgentRole, normalizeRoleId } from "../agent-runtime/roles.mjs";
import {
  buildPipelineAcceptancePrompt,
  buildPipelineCoordinatorPrompt,
  buildPipelineDeveloperSystemPrompt,
  buildPipelineMemoryItem,
  buildPipelineSynthesisPrompt,
  buildPipelineStepInput,
  buildPipelineTeamPlan,
  isPipelineTeamIntrospection,
  normalizePipelineAgents,
  parsePipelineAcceptance,
  parsePipelineAssignments,
} from "../agent-runtime/pipeline-team.mjs";
import { createWebAccountManager } from "../providers/web-account-manager.mjs";
import { createWebAccountAdapters } from "../providers/web-account-adapters.mjs";
import { handleAccountRequest } from "./account-routes.mjs";
import { createProviderAccountPool } from "../providers/account-pool.mjs";
import { AntigravityClient } from "../providers/antigravity/client.mjs";
import { getAntigravityStatus } from "../providers/antigravity/runtime.mjs";
import { runAntigravityConversationTurn } from "../providers/antigravity/window-adapter.mjs";
import { createAntigravityAgentAdapter } from "../providers/antigravity/agent-adapter.mjs";
import { createQwenAccountManager, formatQwenSwitchNotice, isSameQwenIdentity } from "../providers/qwen/account-manager.mjs";
import { createQwenAccountSession } from "../providers/qwen/account-session.mjs";
import { isQwenCaptchaError, isQwenCaptchaRetryableTurn, recoverQwenCaptchaState } from "../providers/qwen/captcha-state.mjs";
import { getCommandExecutionEnv } from "../code-agent/executor.mjs";
import { runAgentTask } from "../agent-orchestrator/index.mjs";
import { createConversationHarnessRunner } from "../harness/conversation-runner.mjs";
import { recoverHarnessTasks, isHarnessOwnerAlive } from "../harness/task-state.mjs";
import { CODE_AGENT_PROMPT_VERSION } from "../code-agent/prompt.mjs";
import {
  COMMAND_CATALOG,
  ensureOpenAICompatApiKey,
  loadSettings,
  resolveOpenAICompatApiKey,
  saveSettings,
} from "../state/settings.mjs";
import { conversationList, makeConversationTitle, shouldAutoTitle } from "../state/conversations.mjs";
import { startTask, isRunning, getRunningIds, stopTask, extendTaskWait, waitForAllTasks } from "./task-runner.mjs";
import { getShutdownStatus, registerShutdownServerCloser, requestAppShutdown } from "../app-shutdown.mjs";
import { getStateFile, loadWindowState, createWindowStateWriter } from "../state/window-state.mjs";
import { LANGUAGES, getLanguageMeta } from "../i18n/index.mjs";
import { getLocalizedAgentRoles } from "../i18n/agent-roles.mjs";
import { getCommandDescription } from "../i18n/command-descriptions.mjs";
import { listBrowseDirectories } from "./browse-fs.mjs";
import {
  beginNdjsonStream,
  responseAbortSignal,
  MAX_IMAGE_MESSAGE_BODY_BYTES,
  endSavedNdjsonStream,
  readJsonBody,
  sendHtml,
  sendSavedJson,
  writeNdjsonLine,
} from "./http.mjs";
import { renderWindowHtml } from "./ui-html.mjs";
import { handleWorkspaceFilesRequest } from "./workspace-files.mjs";
import { handleQwenCaptchaLiveInput, handleQwenCaptchaLiveStream, renderEmbedQwenCaptchaHtml } from "./qwen-captcha-live.mjs";
import { openExternalLink } from "./external-link.mjs";
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
  stopChatGPTInAppBrowser,
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
  getDeepSeekResumeCheckpoint,
  getCodeSessionId,
  migrateLegacyCodeSession,
  resolveConversationAgentTask,
  setCodeSessionId,
} from "./agent-task.mjs";
import { handleMemoryRoute } from "./routes/memory.mjs";
import { handleSkillsRoute } from "./routes/skills.mjs";
import { handlePluginsRoute } from "./routes/plugins.mjs";
import { handleLegalConsentRoute } from "./routes/legal-consents.mjs";
import { createCodeMemorySavedHandler, scheduleChatMemorySave } from "./memory-hooks.mjs";
import { deleteConversationImages, persistChatImages, resolveChatImage, restoreChatImages } from "./chat-images.mjs";
import { createDeepSeekAgentAdapter } from "../providers/deepseek/agent-adapter.mjs";
import { toProviderImageFiles } from "../providers/image-input.mjs";
import { addMemory, warmMemoryBackend } from "../memory/store.mjs";
import { buildMemoryContextResult } from "../memory/context-builder.mjs";
import { shouldSaveChatTurn } from "../memory/chat-save.mjs";
import { warmGraphBackend } from "../memory/graph/store.mjs";
import { getVoiceStatus, installSttRuntime, transcribeAudio } from "../stt/service.mjs";
import { scheduleWindowRestart } from "../updater.mjs";
import { checkForUpdate, runUpdate } from "../desktop-transition.mjs";
import { collectDiagnostics } from "./diagnostics.mjs";
import { createSupportRoutes } from "./routes/support.mjs";
import { createAnnouncementRoutes } from "./routes/announcements.mjs";
import { handleRequest as handleOpenAICompatRequest } from "../../api/openai-handler.mjs";
import { assertLicensedAccess } from '../licensing/client.mjs';
import { requiresDesktopLicense } from '../licensing/desktop-gate.mjs';
import { setOpenAICorsHeaders } from "../../api/server.mjs";
import {
  findProviderModel,
  getProviderCatalog,
  getProviderDefaultModel,
  uiModelCatalog,
} from "../providers/model-catalog.mjs";
import { createFileLogger } from "../logging/logger.mjs";

const appLogger = createFileLogger({ component: "window-server" });

export function isChatGPTLoginRecoveryRequired(error) {
  const message = String(error?.message || error || "");
  return Boolean(error?.needsChatGPTLogin)
    || /сессия истекла|session expired|not logged in|HTTP 401|unauthorized|вход не завершён|поле ввода|composer|cloudflare|проверку/i.test(message);
}

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
  appLogger.info("server.starting", {
    workspaceRoot,
    port,
    modelType,
    thinkingEnabled,
    searchEnabled,
    openWindow,
  });
  // ChatGPT по умолчанию работает во встроенной панели AI Free через Camoufox.
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
  const stateWriter = createWindowStateWriter(workspaceRoot, state, {
    onError: error => appLogger.error("state.save.failed", error),
  });
  const saveWindowState = (_root, value) => stateWriter.schedule(value);
  const sendJson = (res, body, status) => sendSavedJson(stateWriter, res, body, status);
  const endNdjsonStream = res => endSavedNdjsonStream(stateWriter, res);
  const tasksRecovered = recoverHarnessTasks(state);
  const captchaRecovered = recoverQwenCaptchaState(state);
  if (tasksRecovered || captchaRecovered) {
    saveWindowState(workspaceRoot, state);
    await stateWriter.flush();
  }
  const runConversationAgentTask = createConversationHarnessRunner({
    runAgent: runAgentTask,
    persist: ({ type }) => {
      saveWindowState(workspaceRoot, state);
      if (["checkpoint_saved", "task_finished", "task_resume_scheduled"].includes(type)) return stateWriter.flush();
    },
    onFailure: (conversation, error) => markQwenCaptcha(conversation, error, conversation.qwenCodeAccountId || conversation.qwenAccountId || "default", "code"),
    onAutoContinue: (conversation, { provider, nextResumeAt, waitMs, attempt, recoveryOnly }) => {
      extendTaskWait(conversation.id, waitMs);
      const resumeAt = new Date(nextResumeAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      const label = getProviderCatalog(provider)?.label || provider;
      for (let i = conversation.messages.length - 1; i >= 0; i--) {
        const message = conversation.messages[i];
        if (message.role !== "assistant" || !message.streaming) continue;
        message.content = recoveryOnly
          ? `${label}: проверяю, сохранился ли ответ. Следующая проверка истории в ${resumeAt}. Если ответ найден, задача продолжится. Кнопка «Стоп» отменяет ожидание.`
          : `${label}: временная пауза. Задача сохранена; автоматически продолжу в ${resumeAt} (попытка ${attempt}/2). Кнопка «Стоп» отменяет продолжение.`;
        message.updatedAt = new Date().toISOString();
        conversation.updatedAt = message.updatedAt;
        break;
      }
    },
  });

  setImmediate(() => {
    warmMemoryBackend().catch(() => {});
    warmGraphBackend().catch(() => {});
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
  let codexClient = null;
  let googleAIClient = null;
  let glmClient = null;
  let antigravityClient = null;
  let antigravityChatDir = null;
  let antigravityCatalogCache = null;
  const providerLoginJobs = new Map();
  const providerLoginStates = new Map();
  const providerAccountPool = createProviderAccountPool();
  const qwenActiveRequests = new Map();
  const qwenCaptchaOpenJobs = new Map();
  const qwenAccounts = createQwenAccountManager({ pool: providerAccountPool });
  const webAccounts = createWebAccountManager({
    adapters: createWebAccountAdapters({ legacyDeepSeekClient: client }),
    isBusy: (provider, id) => state.conversations.some(c => c.provider === provider
      && (c.providerAccountId || "default") === id
      && (isRunning(c.id) || c.messages?.some(m => m.streaming))),
  });
  function markQwenCaptcha(conversation, error, accountId = conversation.qwenAccountId || "default", mode = "chat") {
    if (!isQwenCaptchaError(error) || error.delivery === "not_sent") return;
    if (conversation.pendingQwenCaptcha?.accountId === accountId && conversation.pendingQwenCaptcha?.mode === mode) return;
    conversation.pendingQwenCaptcha = {
      accountId,
      mode,
      createdAt: new Date().toISOString(),
      status: "cooldown",
    };
  }
  providerAccountPool.register("qwen", {
    listAccounts: () => qwenAccounts.routingAccounts().map(account => ({ ...account, disabled: account.disabled || !account.token || qwenAccounts.isLoggingIn(account.id) })),
  });

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
      accountId: auth.accountId || auth.id || "default",
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

  async function leaseQwenWorkerClient(affinityKey, options = {}) {
    return {
      accountId: "managed",
      managed: true,
      client: createQwenAccountSession({
        pool: providerAccountPool, affinityKey, buildClient: buildQwenClientFromAuth,
        autoSwitch: qwenAccounts.autoSwitch, markLimited: qwenAccounts.markLimited,
        markInvalid: qwenAccounts.markInvalid, refreshAccount: qwenAccounts.refreshAccount,
        recoverUnavailable: qwenAccounts.recoverUnavailable,
        sameAccountIdentity: (oldId, account) => isSameQwenIdentity(qwenAccounts.list().find(item => item.id === oldId), account),
        onLoginRequired: async accountId => {
          const snapshot = await qwenAccounts.snapshot();
          if (snapshot.login.state !== 'running') {
            const accounts = qwenAccounts.list();
            const existing = accounts.find(account => account.id === accountId)
              || accounts.find(account => account.id === snapshot.accounts.find(item => item.status === 'invalid')?.id);
            if (!existing) throw new Error('Не найден аккаунт Qwen для переподключения.');
            await qwenAccounts.action({ action: 'login', id: existing.id });
          }
          await qwenAccounts.waitForLogin();
          const result = await qwenAccounts.snapshot();
          if (result.login.state === 'failed') throw new Error(result.login.error);
          return result.login.state === 'done';
        },
        beforeRequest: assertLicensedAccess, ...options,
      }),
      // Each model request holds its own lease; tool execution never gets replayed.
      release: () => false,
    };
  }

  function recordQwenSwitch(conversation, event) {
    conversation.messages.push({ role: "assistant", content: formatQwenSwitchNotice(qwenAccounts.list(), event), createdAt: new Date().toISOString() });
    saveWindowState(workspaceRoot, state);
  }

  async function refreshChatGPTAuthFromOpenBrowser() {
    const { isChatGPTBrowserProxyActive, syncChatGPTAuthFromActiveProxy } = await import("../providers/chatgpt/browser-proxy.mjs");
    if (!isChatGPTBrowserProxyActive()) return;
    try {
      await syncChatGPTAuthFromActiveProxy();
    } catch {}
  }

  let chatGPTAuthRefreshJob = null;
  function refreshChatGPTAuthInBackground() {
    if (chatGPTAuthRefreshJob) return;
    chatGPTAuthRefreshJob = refreshChatGPTAuthFromOpenBrowser()
      .catch(() => {})
      .finally(() => { chatGPTAuthRefreshJob = null; });
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
        const { getChatGPTBrowserProxy, syncChatGPTAuthFromActiveProxy } = await import("../providers/chatgpt/browser-proxy.mjs");
        await getChatGPTBrowserProxy();
        const synced = await syncChatGPTAuthFromActiveProxy();
        if (isChatGPTAuthUsable(synced)) return synced;
        const cached = readChatGPTAuth(CHATGPT_AUTH_FILE);
        if (isChatGPTAuthUsable(cached)) return cached;
      } catch {}
    }
    if (embedUi) {
      const err = new Error(
        "ChatGPT: нажмите кнопку «Браузер», откройте вкладку ChatGPT и войдите. После входа нажмите «Синхронизировать».",
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

  async function getOrCreateChatGPTClient({ forceRebuild = false, conversation = null } = {}) {
    if (webAccounts.resolve("chatgpt", conversation).id !== "default") return webAccounts.client("chatgpt", conversation);
    if (chatGPTClient && !forceRebuild) return chatGPTClient;
    const auth = await ensureChatGPTAuth();
    chatGPTClient = await buildChatGPTClientFromAuth(auth);
    return chatGPTClient;
  }

  async function getOrCreateCodexClient({ forceRebuild = false } = {}) {
    if (codexClient && !forceRebuild) return codexClient;
    if (codexClient && forceRebuild) codexClient.close?.();
    const { isCodexAuthenticated } = await import("../providers/codex/auth.mjs");
    if (!isCodexAuthenticated()) {
      const error = new Error("OpenAI Codex не подключён. Нажмите «Войти через ChatGPT» и завершите авторизацию.");
      error.code = "CODEX_AUTH_REQUIRED";
      throw error;
    }
    const { getCodexRuntimeDir } = await import("../providers/codex/runtime.mjs");
    const { CodexAppServerClient } = await import("../providers/codex/app-server-client.mjs");
    codexClient = new CodexAppServerClient({ chatCwd: getCodexRuntimeDir() });
    return codexClient;
  }

  async function startGoogleAILogin() {
    if (providerLoginJobs.has("googleai")) return false;
    const { getProvider } = await import("../providers/registry.mjs");
    const provider = getProvider("googleai");
    if (providerLoginJobs.has("googleai")) return false;
    const loginJob = (async () => {
      await provider.login({});
      googleAIClient = null;
    })();
    providerLoginStates.set("googleai", { state: "running", error: "" });
    providerLoginJobs.set("googleai", loginJob);
    loginJob
      .then(() => providerLoginStates.set("googleai", { state: "completed", error: "" }))
      .catch((error) => providerLoginStates.set("googleai", { state: "error", error: error.message || String(error) }))
      .finally(() => providerLoginJobs.delete("googleai"));
    return true;
  }

  async function getOrCreateGoogleAIClient({ forceRebuild = false, conversation = null } = {}) {
    if (webAccounts.resolve("googleai", conversation).id !== "default") return webAccounts.client("googleai", conversation);
    if (googleAIClient && !forceRebuild) return googleAIClient;
    const { GOOGLE_AI_AUTH_FILE } = await import("../providers/google-ai/config.mjs");
    const { readGoogleAIAuth, isGoogleAIAuthUsable, invalidateGoogleAIAuth } = await import("../providers/google-ai/auth-files.mjs");
    if (!isGoogleAIAuthUsable(readGoogleAIAuth(GOOGLE_AI_AUTH_FILE))) {
      await startGoogleAILogin();
      throw new Error("Google AI не подключён. Открывается окно Camoufox для входа в Google.");
    }
    const { GoogleAIChatClient } = await import("../providers/google-ai/client.mjs");
    googleAIClient = new GoogleAIChatClient({
      debug: Boolean(process.env.DEEPSEEK_DEBUG_GOOGLE_AI),
      onAuthRequired: async () => {
        invalidateGoogleAIAuth(GOOGLE_AI_AUTH_FILE);
        googleAIClient = null;
        await startGoogleAILogin();
      },
    });
    return googleAIClient;
  }

  async function getOrCreateGLMClient({ forceRebuild = false, conversation = null } = {}) {
    if (webAccounts.resolve("glm", conversation).id !== "default") return webAccounts.client("glm", conversation);
    if (glmClient && !forceRebuild) return glmClient;
    const { GLM_AUTH_FILE } = await import("../providers/glm/config.mjs");
    const { readGLMAuth, isGLMAuthUsable } = await import("../providers/glm/auth-files.mjs");
    const { isGLMStorageStateUsable } = await import("../providers/glm/storage-state.mjs");
    if (!isGLMAuthUsable(readGLMAuth(GLM_AUTH_FILE)) || !isGLMStorageStateUsable()) {
      throw new Error("GLM не подключён. Нажмите «Подключить» и завершите вход в Z.ai.");
    }
    const { GLMChatClient } = await import("../providers/glm/client.mjs");
    glmClient = new GLMChatClient({ debug: Boolean(process.env.DEEPSEEK_DEBUG_GLM) });
    return glmClient;
  }

  function isChatGPTAuthError(error) {
    const message = String(error?.message || error || "");
    if (/unusual activity/i.test(message)) return false;
    return /access token is missing|HTTP 401|unauthorized|not logged in|сессия истекла|session expired/i.test(message);
  }

  async function chatGPTApiCall(fn, conversation = null) {
    if (webAccounts.resolve("chatgpt", conversation).id !== "default") return fn(await webAccounts.client("chatgpt", conversation));
    let client = await getOrCreateChatGPTClient({ conversation });
    try {
      return await fn(client);
    } catch (error) {
      if (error?.promptSubmitted) throw error;
      if (error?.delivery !== "not_sent" || !isChatGPTAuthError(error)) throw error;
      console.log("[chatgpt] auth error, reloading browser session…");
      const { resetChatGPTBrowserProxy } = await import("../providers/chatgpt/browser-proxy.mjs");
      await resetChatGPTBrowserProxy();
      chatGPTClient = null;
      client = await getOrCreateChatGPTClient({ forceRebuild: true, conversation });
      try {
        return await fn(client);
      } catch (retryError) {
        if (retryError?.delivery !== "not_sent" || !isChatGPTAuthError(retryError)) throw retryError;
        console.log("[chatgpt] reload failed, re-auth required…");
        await resetChatGPTBrowserProxy();
        chatGPTClient = null;
        if (process.env.CHATGPT_EMBED_IN_UI === "1") {
          throw new Error(
            "ChatGPT: сессия истекла. Нажмите кнопку «Браузер», откройте вкладку ChatGPT и войдите снова.",
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
  async function ensureChatGPTSessionReady(conversation) {
    if (webAccounts.resolve("chatgpt", conversation).id !== "default") return;
    await chatGPTApiCall(async () => {
      const { getChatGPTBrowserProxy } = await import("../providers/chatgpt/browser-proxy.mjs");
      const proxy = await getChatGPTBrowserProxy({ debug: Boolean(process.env.DEEPSEEK_DEBUG_CHATGPT) });
      await proxy.ensureReady();
    }, conversation);
  }

  function isQwenTransportError(error) {
    const message = String(error?.message || error || "");
    return /Execution context was destroyed|Target page, context or browser has been closed|Target closed|Page closed|Context closed|Failed to fetch|request is finished/i.test(message);
  }

  function formatQwenError(error) {
    const message = String(error?.message || error || "");
    if (isQwenCaptchaError(error)) return "Qwen временно ограничил API-запрос. Капча может не появиться на странице чата; повторите запрос после паузы.";
    if (error?.isQwenSessionExpired || /сессия qwen устарела/i.test(message)) {
      return message.includes("🔒") ? message : `🔒 Сессия Qwen устарела\n\n${message}`;
    }
    if (/qwen_page_evaluate_timeout|qwen_response_headers_timeout/i.test(message)) {
      return (
        "Qwen не ответил на запрос до тайм-аута браузерного транспорта. " +
        "По этому тайм-ауту нельзя определить, принял ли Qwen сообщение. " +
        "SYNVOX остановил повторную отправку, чтобы не создать дубли. " +
        "Если Qwen показывает «Авторизоваться», войдите заново; иначе проверьте чат на сайте Qwen перед повтором."
      );
    }
    return message;
  }

  // Вызов Qwen API: relogin только при реально протухшей сессии (401/HTML), не при Bad_Request anti-bot.
  async function qwenApiCall(fn, { onRelogin = null, clientRef = null } = {}) {
    if (clientRef?.managed) return fn(clientRef.client);
    const { isQwenSessionExpiredError } = await import("../providers/qwen/session-errors.mjs");
    let client = clientRef?.client || await getOrCreateQwenClient();
    const pooledAccountId = clientRef?.accountId && clientRef.accountId !== "default"
      ? clientRef.accountId
      : null;
    let transportResetDone = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await fn(client);
      } catch (error) {
        if (isQwenTransportError(error) && !transportResetDone) {
          console.log(`[qwen] browser transport error, resetting proxy: ${error.message}`);
          const { resetQwenBrowserProxy } = await import("../providers/qwen/browser-proxy.mjs");
          await resetQwenBrowserProxy(pooledAccountId);
          if (pooledAccountId) {
            const { getAccountById } = await import("../providers/qwen/account-store.mjs");
            const account = getAccountById(pooledAccountId);
            if (!account) throw error;
            client = await buildQwenClientFromAuth({ ...account, accountId: pooledAccountId });
            clientRef.client = client;
          } else {
            qwenClient = null;
            client = await getOrCreateQwenClient({ forceRebuild: true });
          }
          transportResetDone = true;
          continue;
        }
        if (!isQwenSessionExpiredError(error) || attempt >= 2) throw error;
        if (pooledAccountId) {
          const { markInvalid } = await import("../providers/qwen/account-store.mjs");
          markInvalid(pooledAccountId);
          throw error;
        }
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
        if (clientRef) clientRef.client = client;
      }
    }
    throw new Error("unreachable: qwenApiCall retry budget");
  }

  async function getQwenCatalogOverrideSafe(options = {}) {
    try {
      const { getQwenLiveCatalogOverride } = await import("../providers/qwen/model-sync.mjs");
      return await getQwenLiveCatalogOverride(options);
    } catch (error) {
      logConsole(`[qwen] live model catalog failed: ${error.message}`);
      return null;
    }
  }

  async function getUiModelCatalog(options = {}) {
    const qwen = await getQwenCatalogOverrideSafe(options);
    const overrides = qwen ? { qwen } : {};
    if (getAntigravityStatus().authenticated) {
      try {
        if (!antigravityCatalogCache || Date.now() - antigravityCatalogCache.checkedAt > 60_000) {
          const models = await (antigravityClient ||= new AntigravityClient()).listModels();
          if (models.length) antigravityCatalogCache = { checkedAt: Date.now(), models };
        }
        if (antigravityCatalogCache?.models?.length) overrides.antigravity = {
          models: antigravityCatalogCache.models,
          defaultModel: antigravityCatalogCache.models.some((model) => model.id === 'gemini-3.8-flash-medium')
            ? 'gemini-3.8-flash-medium' : antigravityCatalogCache.models[0].id,
        };
      } catch (error) {
        logConsole(`[antigravity] model catalog failed: ${error.message}`);
      }
    }
    return uiModelCatalog(overrides);
  }

  async function resolveProviderModel(provider, requestedModel, mode) {
    if (provider === 'antigravity') {
      const live = (await getUiModelCatalog()).providers.antigravity;
      return live.models.some((model) => model.id === requestedModel) ? requestedModel : live.defaultModel;
    }
    if (provider === "qwen") {
      const live = await getQwenCatalogOverrideSafe();
      if (live?.models?.some((model) => model.id === requestedModel)) return requestedModel;
      return live?.defaultModel || getProviderDefaultModel(provider, mode);
    }
    return findProviderModel(provider, requestedModel)
      ? requestedModel
      : getProviderDefaultModel(provider, mode);
  }

  async function resolveQwenSearchEnabled(modelId, prompt, body, globalDefault) {
    const requested = await resolveProviderSearchEnabled(prompt, body, globalDefault);
    if (!requested) return false;
    const catalog = await getQwenCatalogOverrideSafe();
    const { qwenLiveModelSupportsSearch } = await import("../providers/qwen/model-sync.mjs");
    return qwenLiveModelSupportsSearch(catalog, modelId);
  }

  async function resolveQwenThinking(modelId) {
    const catalog = await getQwenCatalogOverrideSafe();
    const { qwenLiveModelSupportsThinking } = await import("../providers/qwen/model-sync.mjs");
    return qwenLiveModelSupportsThinking(catalog, modelId)
      || (!catalog && findProviderModel("qwen", modelId)?.reasoning === true);
  }

  async function runPipelineFromConversation(startConversationId, initialPrompt, requestOptions = {}, signal = null) {
    const conversation = state.conversations.find((candidate) => candidate.id === startConversationId);
    if (!conversation) return;
    const resume = conversation.qwenPipelinePaused && /^(?:продолжи(?:ть)?|continue|resume)[.!\s]*$/i.test(initialPrompt.trim()) ? conversation.qwenPipelineRun : null;
    if (resume) initialPrompt = resume.goal;
    else {
      initialPrompt = buildConversationPrompt(initialPrompt, conversation);
      delete conversation.qwenPipelineCheckpoint;
    }
    delete conversation.qwenPipelinePaused;
    const plan = buildPipelineTeamPlan(conversation);
    const configuredTeamPlan = normalizePipelineAgents(conversation.pipelineAgents).length ? plan : [];
    const teamIntrospection = isPipelineTeamIntrospection(initialPrompt);
    const memory = buildMemoryContextResult(initialPrompt, conversation.workspace || workspaceRoot, {
      memoryEnabled: conversation.memoryEnabled !== false && requestOptions.memoryEnabled !== false,
      forceMemory: true,
    });
    const outputs = resume?.outputs || [];
    const leaderStep = {
      id: "leader",
      roleId: "assistant",
      provider: conversation.provider || "deepseek",
      model: conversation.model || "",
      conversationId: conversation.id,
    };
    let assignments = resume?.assignments || [];
    const pausePipeline = error => {
      if (error.code !== 'QWEN_ACCOUNTS_PAUSED') return false;
      const interruptedStep = conversation.qwenPipelineCheckpoint?.stepId;
      const index = assignments.findIndex(step => step.id === interruptedStep);
      conversation.qwenPipelineRun = { goal: initialPrompt, assignments, outputs: [...outputs], nextStep: index >= 0 ? index : assignments.length };
      conversation.qwenPipelinePaused = true;
      conversation.messages.push({ role: 'assistant', content: error.message, createdAt: new Date().toISOString() });
      saveWindowState(workspaceRoot, state);
      return true;
    };
    try {
      if (resume?.assignments?.length) {
        // Continue at the saved step; completed worker actions are not re-run.
      } else if (teamIntrospection) {
        assignments = [];
      } else {
        const coordinatorPrompt = buildPipelineCoordinatorPrompt({
          leaderProvider: leaderStep.provider,
          leaderModel: leaderStep.model,
          userTask: initialPrompt,
          plan,
          memoryContext: memory.context,
        });
        const coordinatorResult = await completePipelineConversation(conversation, leaderStep, initialPrompt, {
          rawPrompt: coordinatorPrompt,
          appendMessage: false,
          thinking: requestOptions.thinking === true,
          search: false,
        });
        assignments = parsePipelineAssignments(coordinatorResult, plan, initialPrompt);
      }
    } catch (error) {
      if (error.code === 'QWEN_ACCOUNTS_PAUSED') {
        conversation.qwenPipelineRun = { goal: initialPrompt, assignments: [], outputs, nextStep: 0 };
        conversation.qwenPipelinePaused = true;
        conversation.messages.push({ role: 'assistant', content: error.message, createdAt: new Date().toISOString() });
        saveWindowState(workspaceRoot, state);
        return;
      }
      logConsole(`[pipeline] coordinator fallback: ${error.message}`);
    }

    for (let stepIndex = resume?.nextStep || 0; stepIndex < assignments.length; stepIndex++) {
      const step = assignments[stepIndex];
      conversation.qwenPipelineRun = { goal: initialPrompt, assignments, outputs: [...outputs], nextStep: stepIndex };
      if (signal?.aborted) break;
      let output = "";
      const stepInput = buildPipelineStepInput({
        goal: initialPrompt,
        task: step.task,
        outputs,
        memoryContext: memory.context,
      });
      try {
        if (step.roleId === "developer" && step.provider === "qwen") {
          output = await runPipelineCodeAgent(conversation, step, stepInput, requestOptions, signal);
          conversation.messages.push({
            role: "assistant",
            content: output || "[empty]",
            createdAt: new Date().toISOString(),
            roleId: step.roleId,
            agentProvider: step.provider,
            agentModel: step.model,
            pipelineRun: true,
          });
          conversation.updatedAt = new Date().toISOString();
          saveWindowState(workspaceRoot, state);
        } else {
          output = await completePipelineConversation(conversation, step, stepInput, {
            sourceTitle: `${getProviderCatalog(leaderStep.provider)?.label || leaderStep.provider} · ${getAgentRole(step.roleId).label}`,
            memoryContext: memory.context,
            thinking: requestOptions.thinking === true,
            search: requestOptions.search === true,
          });
        }
      } catch (error) {
        output = `⚠️ Pipeline step failed: ${error.message}`;
        conversation.messages.push({
          role: "assistant",
          content: output,
          createdAt: new Date().toISOString(),
          roleId: step.roleId,
          agentProvider: step.provider,
          agentModel: step.model,
          pipelineRun: true,
          pipelineStatus: "failed",
        });
        conversation.updatedAt = new Date().toISOString();
        if (error.code === 'QWEN_ACCOUNTS_PAUSED') conversation.qwenPipelinePaused = true;
        saveWindowState(workspaceRoot, state);
        if (conversation.qwenPipelinePaused) return;
        break;
      }
      outputs.push({ roleId: step.roleId, provider: step.provider, model: step.model, text: output });
    }

    const developerStep = [...assignments]
      .reverse()
      .find((step) => step.roleId === "developer" && step.provider === "qwen");
    if (developerStep && !signal?.aborted) {
      let revisionCount = 0;
      while (!signal?.aborted) {
        const acceptancePrompt = buildPipelineAcceptancePrompt({ userTask: initialPrompt, outputs });
        let acceptance = null;
        try {
          const acceptanceText = await completePipelineConversation(conversation, leaderStep, initialPrompt, {
            rawPrompt: acceptancePrompt,
            appendMessage: false,
            thinking: requestOptions.thinking === true,
            search: false,
          });
          acceptance = parsePipelineAcceptance(acceptanceText);
        } catch (error) {
          if (pausePipeline(error)) return;
          logConsole(`[pipeline] acceptance review failed: ${error.message}`);
        }
        if (!acceptance || acceptance.accepted) break;
        if (revisionCount >= 2) {
          outputs.push({
            roleId: "reviewer",
            provider: leaderStep.provider,
            model: leaderStep.model,
            text: `Acceptance rejected after automatic revisions: ${acceptance.feedback}`,
          });
          break;
        }

        revisionCount += 1;
        const revisionInput = buildPipelineStepInput({
          goal: initialPrompt,
          task: [
            "Continue the same workspace task and fix the rejected implementation.",
            `Original developer assignment: ${developerStep.task}`,
            `Main AI acceptance feedback: ${acceptance.feedback}`,
            "Use workspace tools, keep correct existing work, implement every missing requirement, and verify before finishing.",
          ].join("\n"),
          outputs,
          memoryContext: memory.context,
        });
        try {
          const revisedOutput = await runPipelineCodeAgent(
            conversation,
            developerStep,
            revisionInput,
            requestOptions,
            signal,
          );
          conversation.messages.push({
            role: "assistant",
            content: revisedOutput || "[empty]",
            createdAt: new Date().toISOString(),
            roleId: developerStep.roleId,
            agentProvider: developerStep.provider,
            agentModel: developerStep.model,
            pipelineRun: true,
            pipelineRevision: revisionCount,
          });
          outputs.push({
            roleId: developerStep.roleId,
            provider: developerStep.provider,
            model: developerStep.model,
            text: revisedOutput,
          });
          conversation.updatedAt = new Date().toISOString();
          saveWindowState(workspaceRoot, state);
        } catch (error) {
          if (pausePipeline(error)) return;
          outputs.push({
            roleId: "reviewer",
            provider: leaderStep.provider,
            model: leaderStep.model,
            text: `Automatic revision failed: ${error.message}`,
          });
          break;
        }
      }
    }

    if (!signal?.aborted) {
      try {
        const synthesisPrompt = buildPipelineSynthesisPrompt({
          userTask: initialPrompt,
          outputs,
          plan: configuredTeamPlan,
          teamIntrospection,
        });
        const finalText = await completePipelineConversation(conversation, leaderStep, initialPrompt, {
          rawPrompt: synthesisPrompt,
          pipelineCoordinator: true,
          thinking: requestOptions.thinking === true,
          search: false,
        });
        outputs.push({
          roleId: "assistant",
          provider: leaderStep.provider,
          model: leaderStep.model,
          text: finalText,
        });
      } catch (error) {
        if (pausePipeline(error)) return;
        logConsole(`[pipeline] leader synthesis failed: ${error.message}`);
        const failureText = `⚠️ Главный агент ${getProviderCatalog(leaderStep.provider)?.label || leaderStep.provider} не смог завершить ответ: ${error.message}`;
        conversation.messages.push({
          role: "assistant",
          content: failureText,
          createdAt: new Date().toISOString(),
          roleId: "assistant",
          agentProvider: leaderStep.provider,
          agentModel: leaderStep.model,
          pipelineCoordinator: true,
          pipelineRun: true,
          pipelineStatus: "failed",
        });
        outputs.push({
          roleId: "assistant",
          provider: leaderStep.provider,
          model: leaderStep.model,
          text: failureText,
        });
        conversation.updatedAt = new Date().toISOString();
        saveWindowState(workspaceRoot, state);
      }
    }

    const memoryItem = buildPipelineMemoryItem({ goal: initialPrompt, outputs });
    let memorySaved = 0;
    if (memoryItem && conversation.memoryEnabled !== false && shouldSaveChatTurn(initialPrompt, memoryItem.content)) {
      memorySaved = addMemory({ ...memoryItem, workspace: conversation.workspace || workspaceRoot }) ? 1 : 0;
    }
    conversation.lastAgentMeta = {
      ...(conversation.lastAgentMeta || {}),
      memoryUsed: memory.usedCount || 0,
      graphUsed: memory.graphUsed || 0,
      memorySaved,
      memoryPending: false,
    };
    conversation.updatedAt = new Date().toISOString();
    delete conversation.qwenPipelineRun;
    delete conversation.qwenPipelineCheckpoint;
    saveWindowState(workspaceRoot, state);
  }

  async function runPipelineCodeAgent(conversation, step, task, requestOptions = {}, signal = null) {
    const { createQwenAgentAdapter, createQwenAgentTransport } = await import("../providers/qwen/agent-adapter.mjs");
    const affinityKey = `${conversation.workspace || workspaceRoot}:${conversation.id}:${step.id}`;
    const saved = conversation.qwenPipelineCheckpoint?.stepId === step.id ? conversation.qwenPipelineCheckpoint : null;
    if (saved) task = saved.task;
    let checkpoint = saved || { task };
    let initialPrompt = saved?.initialPrompt || "";
    const workerLease = await leaseQwenWorkerClient(affinityKey, {
      context: () => initialPrompt.slice(0, 14000) + "\n" + JSON.stringify(checkpoint),
      onSwitch: event => recordQwenSwitch(conversation, event),
    });
    try {
      const chatId = await qwenApiCall(
        (client) => client.createChat({ model: step.model || undefined }),
        { clientRef: workerLease },
      );
      const adapter = createQwenAgentAdapter(createQwenAgentTransport(operation =>
        qwenApiCall(operation, { clientRef: workerLease }),
      ));
      const workspacePath = path.resolve(conversation.workspace || workspaceRoot);
      const toolLogs = [];
      const codeResult = await runConversationAgentTask(conversation, adapter, {
        sessionId: chatId,
        thinkingEnabled: requestOptions.thinking === true,
        searchEnabled: await resolveQwenSearchEnabled(
          step.model,
          task,
          requestOptions,
          searchEnabled,
        ),
        model: step.model || undefined,
      }, workspacePath, task, null, {
        harnessProvider: step.provider,
        accessMode: conversation.accessMode === "computer" ? "computer" : "project",
        signal,
        resumeState: saved,
        onCheckpoint: value => {
          if (!initialPrompt) initialPrompt = value.prompt;
          checkpoint = { task: value.task, toolLogs: value.toolLogs.slice(-20) };
          conversation.qwenPipelineCheckpoint = { ...value, initialPrompt, stepId: step.id };
          saveWindowState(workspaceRoot, state);
        },
        systemPrompt: buildPipelineDeveloperSystemPrompt(),
        roleId: "developer",
        memoryEnabled: false,
        autoSkill: false,
        onTool: (_call, result, log) => {
          captureInstallRequest(conversation, result);
          captureQuestionRequest(conversation, result);
          capturePermissionRequest(conversation, result);
          toolLogs.push(log);
          conversation.updatedAt = new Date().toISOString();
          saveWindowState(workspaceRoot, state);
        },
      });
      const finalized = finalizeCodeTaskMessage(codeResult);
      conversation.lastAgentMeta = finalized.agentMeta;
      delete conversation.qwenPipelineCheckpoint;
      logConsole(`[pipeline] qwen developer ${workerLease.accountId} completed: ${toolLogs.length} tool log(s)`);
      return finalized.content.trimEnd();
    } finally {
      workerLease.release();
    }
  }

  async function completePipelineConversation(conversation, step, input, options = {}) {
    const role = getAgentRole(step.roleId);
    const prompt = options.rawPrompt || buildPipelinePrompt(conversation, role, input, options.sourceTitle, options.memoryContext);
    const provider = step.provider || conversation.provider || "deepseek";
    let accountConversation = conversation;
    if (provider !== conversation.provider && ["deepseek", "chatgpt", "glm", "googleai"].includes(provider)) {
      const bindings = conversation.pipelineAccountIds ||= {};
      bindings[provider] ||= webAccounts.selected(provider);
      accountConversation = { providerAccountId: bindings[provider] };
      saveWindowState(workspaceRoot, state);
    }
    const model = step.model || conversation.model;
    const appendResult = (content) => {
      if (options.appendMessage === false) return;
      conversation.messages.push({
        role: "assistant",
        content: content || "[empty]",
        createdAt: new Date().toISOString(),
        roleId: role.id,
        agentProvider: provider,
        agentModel: model,
        pipelineCoordinator: options.pipelineCoordinator === true,
        pipelineRun: true,
      });
      conversation.updatedAt = new Date().toISOString();
      saveWindowState(workspaceRoot, state);
    };
    if (provider === "qwen") {
      // Pipeline steps must not inherit the normal chat context. A fresh upstream
      // chat keeps old user turns (for example "видишь плату?") out of the step.
      const affinityKey = `${conversation.workspace || workspaceRoot}:${conversation.id}:${step.id}`;
      const workerLease = await leaseQwenWorkerClient(affinityKey, {
        context: () => prompt,
        onSwitch: event => recordQwenSwitch(conversation, event),
      });
      try {
        const chatId = await qwenApiCall(
          (c) => c.createChat({ model: model || undefined }),
          { clientRef: workerLease },
        );
        const isReasoning = await resolveQwenThinking(model);
        const result = await qwenApiCall((c) =>
          c.complete({
            chatId,
            prompt,
            thinking: isReasoning ? true : options.thinking === true,
            search: options.search === true,
            model: model || undefined,
          }), { clientRef: workerLease });
        const text = result.thinkingText
          ? `🧠 ${result.thinkingText.trim()}\n\n---\n\n${result.text.trim()}`
          : result.text.trim();
        const cleanText = extractPipelineResult(text);
        appendResult(cleanText);
        return cleanText || "[empty]";
      } finally {
        workerLease.release();
      }
    }

    if (provider === "codex") {
      throw new Error("Codex CLI доступен только как обычный чатовый режим и не используется в pipeline.");
    }
    if (provider === 'antigravity') {
      throw new Error('Antigravity CLI пока не поддерживает pipeline; используйте отдельный чат.');
    }

    if (provider === "chatgpt") {
      // Шаг цепочки — в свежем веб-диалоге (conversationId: null), чтобы не тянуть
      // старый контекст чата. ChatGPT сам создаст новый разговор под этот шаг.
      const result = await chatGPTApiCall((c) => c.complete({ prompt, model, conversationId: null }), accountConversation);
      const cleanText = extractPipelineResult(String(result.text || "").trim());
      appendResult(cleanText);
      return cleanText;
    }

    if (["googleai", "glm"].includes(provider)) {
      const browserClient = provider === "glm"
        ? await getOrCreateGLMClient({ conversation: accountConversation })
        : await getOrCreateGoogleAIClient({ conversation: accountConversation });
      const result = await browserClient.complete({
        prompt,
        model: model || null,
        conversationId: null,
        images: [],
      });
      const cleanText = extractPipelineResult(String(result.text || "").trim());
      appendResult(cleanText);
      return cleanText || "[empty]";
    }

    if (provider !== "deepseek") {
      throw new Error(`Pipeline provider is not supported: ${provider}`);
    }

    // Pipeline steps run in a fresh upstream session by design. The UI chat still
    // stores the step transcript, but the provider does not see stale turns.
    const client = await webAccounts.client("deepseek", accountConversation);
    const pipelineSessionId = await client.createSession();
    const messageMode = modeForConversation({ ...conversation, model });
    const result = await client.complete({
      sessionId: pipelineSessionId,
      prompt,
      modelType: mapModeToModelType(messageMode, modelType),
      thinkingEnabled: messageMode === "expert" ? true : options.thinking === true,
      searchEnabled: options.search === true,
    });
    const text = extractPipelineResult(result.text.trimEnd());
    appendResult(text);
    return text || "[empty]";
  }

  function buildPipelinePrompt(conversation, role, input, sourceTitle, memoryContext = "") {
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
      ...(memoryContext ? ["", "Память проекта (только проверенные прошлые решения):", memoryContext] : []),
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

  const localHttpSecurity = createLocalHttpSecurity();
  const handleSupportRequest = createSupportRoutes();
  const handleAnnouncementRequest = createAnnouncementRoutes();
  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    const requestStartedAt = Date.now();
    const requestPath = String(req.url || "/").split("?", 1)[0];
    res.once("finish", () => {
      appLogger.info("http.request.complete", {
        requestId,
        method: req.method,
        path: requestPath,
        statusCode: res.statusCode,
        durationMs: Date.now() - requestStartedAt,
      });
    });
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const rejected = localHttpSecurity.check(req, url.pathname);
      if (rejected) return sendJson(res, { error: rejected.error }, rejected.status);
      if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/embed/"))) {
        localHttpSecurity.issueCookie(res, req);
      }
      if (requiresDesktopLicense(req.method, url.pathname)) {
        try { await assertLicensedAccess(); }
        catch (error) { return sendJson(res, { error: error.message, licenseBlocked: true }, error.status || 402); }
      }

      if (req.method === "GET" && url.pathname === "/") {
        const settings = loadSettings();
        return sendHtml(res, renderWindowHtml({
          language: settings.ui?.language,
          ui: {
            language: settings.ui?.language || "ru",
            ideSurface: process.env.AI_FREE_VSCODE === '1' || process.env.AI_FREE_JETBRAINS === '1',
            webSearchDefault: settings.ui?.webSearchDefault !== false,
          },
        }));
      }

      if (req.method === 'POST' && url.pathname === '/api/subscription/open-external') {
        const host = String(req.headers.host || '');
        if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) || req.headers.origin !== 'http://' + host || !String(req.headers['content-type'] || '').startsWith('application/json')) return sendJson(res, { error: 'Invalid origin' }, 403);
        try { await openExternalLink((await readJsonBody(req, 4096)).url); return sendJson(res, { opened: true }); }
        catch (error) { return sendJson(res, { error: error.message }, 400); }
      }

      if (await handleAccountRequest(req, res, url, { qwen: qwenAccounts, web: webAccounts, sendJson, readBody: readJsonBody })) return;
      if (await handleSupportRequest(req, res, url, { sendJson, readBody: readJsonBody })) return;
      if (await handleAnnouncementRequest(req, res, url, { sendJson, readBody: readJsonBody })) return;

      if (req.method === "GET" && ["/assets/synvox-watermark.png", "/assets/synvox-mark.png"].includes(url.pathname)) {
        const file = new URL(url.pathname === "/assets/synvox-mark.png" ? "./assets/synvox-mark.png" : "./assets/synvox-watermark.png", import.meta.url);
        const stat = fs.statSync(file);
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Content-Length": stat.size,
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        });
        fs.createReadStream(file).pipe(res);
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/chat-images/")) {
        const image = resolveChatImage(url.pathname);
        if (!image) {
          res.statusCode = 404;
          return res.end("Image not found");
        }
        const stat = fs.statSync(image.file);
        res.writeHead(200, {
          "Content-Type": image.mimeType,
          "Content-Length": stat.size,
          "Cache-Control": "private, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        });
        fs.createReadStream(image.file).pipe(res);
        return;
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

      if (req.method === "POST" && url.pathname === "/api/chatgpt/stop-live") {
        try {
          const result = await stopChatGPTInAppBrowser();
          chatGPTClient = null;
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
        setOpenAICorsHeaders(res, req);
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

      if (await handleLegalConsentRoute(req, url, res)) return;

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
        if (!providerLoginJobs.has("chatgpt") && webAccounts.selected("chatgpt") === "default") {
          refreshChatGPTAuthInBackground();
        }
        const { listProviders } = await import("../providers/registry.mjs");
        const providers = await Promise.all(listProviders().map(async (p) => {
          const accounts = p.id === "qwen" ? await qwenAccounts.snapshot()
            : ["deepseek", "chatgpt", "glm", "googleai"].includes(p.id) ? await webAccounts.snapshot(p.id) : null;
          const primary = accounts?.accounts.find(a => a.primary);
          const status = typeof p.getStatus === "function" ? p.getStatus() : null;
          return {
            id: p.id,
            name: p.name,
            description: p.description,
            hasAuth: p.id === "qwen" ? p.hasAuth() : accounts ? primary?.connected === true : status ? status.authenticated === true : p.hasAuth(),
            loginState: accounts && accounts.login.state !== "idle" ? ({ done: "completed", failed: "error" }[accounts.login.state] || accounts.login.state) : providerLoginStates.get(p.id)?.state || "idle",
            loginError: accounts?.login.error || providerLoginStates.get(p.id)?.error || "",
            loginMessage: accounts?.login.message || "",
            loginPhase: accounts?.login.phase || null,
            loginCode: accounts?.login.code || null,
            runtime: status ? {
              installed: status.installed === true,
              version: status.version || null,
              source: status.runtimeSource || null,
              message: status.message || "",
            } : null,
          };
        }));
        return sendJson(res, { providers });
      }

      if (req.method === "GET" && url.pathname === "/api/model-catalog") {
        return sendJson(res, await getUiModelCatalog({ force: url.searchParams.get("refresh") === "qwen" }));
      }

      if (req.method === "GET" && url.pathname === "/api/agent-roles") {
        const current = loadSettings();
        return sendJson(res, { roles: getLocalizedAgentRoles(current.ui?.language) });
      }

      if (req.method === "POST" && url.pathname === "/api/providers/codex/install") {
        try {
          const { installCodexRuntime } = await import("../providers/codex/runtime.mjs");
          const runtime = await installCodexRuntime();
          codexClient?.close?.();
          codexClient = null;
          return sendJson(res, { ok: true, runtime });
        } catch (error) {
          return sendJson(res, { error: error.message || String(error) }, 500);
        }
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
          if (["deepseek", "chatgpt", "glm", "googleai"].includes(providerId)) {
            const current = await webAccounts.snapshot(providerId);
            if (current.login.state !== "running") {
              const primary = current.accounts.find(a => a.primary);
              await webAccounts.action(providerId, { action: "login", ...(primary ? { id: primary.id } : {}) });
            }
            return sendJson(res, { ok: true, loginStarted: true, embedLogin: providerId === "chatgpt" && webAccounts.selected(providerId) === "default", hasAuth: false });
          }
          if (providerLoginJobs.has(providerId)) {
            return sendJson(res, {
              ok: true,
              loginStarted: true,
              alreadyRunning: true,
              hasAuth: provider.hasAuth(),
            });
          }
          if (providerId === "googleai") {
            const loginStarted = await startGoogleAILogin();
            return sendJson(res, {
              ok: true,
              loginStarted: true,
              alreadyRunning: !loginStarted,
              hasAuth: provider.hasAuth(),
            });
          }
          const embeddedChatGPTLogin = providerId === "chatgpt";
          const loginJob = (async () => {
            if (embeddedChatGPTLogin) {
              await warmChatGPTInAppBrowser();
              chatGPTClient = null;
            } else if (providerId === "qwen") {
              const { selectQwenReconnectAccount } = await import("../providers/qwen/account-manager.mjs");
              const activeQwenChat = state.conversations.find(item => item.id === state.activeConversationId && item.provider === "qwen");
              const existingAccount = selectQwenReconnectAccount(qwenAccounts.list(), [activeQwenChat?.qwenAccountId, activeQwenChat?.qwenCodeAccountId]);
              await qwenAccounts.action({ action: 'login', ...(existingAccount ? { id: existingAccount.id } : {}) });
              await qwenAccounts.waitForLogin();
              const snapshot = await qwenAccounts.snapshot();
              if (snapshot.login.state === 'failed') throw new Error(snapshot.login.error);
              qwenClient = null;
            } else await provider.login({});
            if (providerId === "glm") {
              glmClient = null;
            }
            if (providerId === "codex") {
              codexClient?.close?.();
              codexClient = null;
            }
          })();
          providerLoginStates.set(providerId, { state: "running", error: "" });
          providerLoginJobs.set(providerId, loginJob);
          loginJob
            .then(() => {
              providerLoginStates.set(providerId, { state: "completed", error: "" });
            })
            .catch((error) => {
              providerLoginStates.set(providerId, { state: "error", error: error.message || String(error) });
              console.error(`[provider-login] ${providerId} failed:`, error);
            })
            .finally(() => {
              providerLoginJobs.delete(providerId);
            });
          return sendJson(res, {
            ok: true,
            loginStarted: true,
            embedLogin: embeddedChatGPTLogin,
            hasAuth: provider.hasAuth(),
          });
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
          const uploadConversation = resolveUploadConversation(state, body);
          const uploadClient = await webAccounts.client("deepseek", uploadConversation || null);
          const fileId = await uploadClient.uploadFile(
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

      if (await handleWorkspaceFilesRequest(req, res, url, { state, sendJson })) return;

      if (req.method === "GET" && url.pathname === "/api/state") {
        try { await stateWriter.refresh(); }
        catch (error) { return sendJson(res, { error: error.message, code: error.code || "STATE_SAVE_FAILED" }, error.code === "STATE_CONFLICT" ? 409 : 503); }
        return sendJson(res, {
          workspaceRoot,
          stateFile: getStateFile(),
          stateStoreDirectory: `${getStateFile()}.revisions`,
          activeConversationId: state.activeConversationId,
          conversations: conversationList(state),
          pipeline: state.pipeline || { edges: [] },
          runningTaskIds: [...new Set([...getRunningIds(), ...state.conversations.filter(c =>
            isHarnessOwnerAlive(c.harnessTask) && (["created", "queued", "running"].includes(c.harnessTask.status)
              || c.harnessTask.nextResumeAt)).map(c => c.id)])],
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
        if (process.env.AI_FREE_VSCODE === "1" || process.env.AI_FREE_JETBRAINS === "1") {
          return sendJson(res, { error: "IDE plugins must be updated through their marketplace" }, 403);
        }
        const body = await readJsonBody(req).catch(() => ({}));
        const result = await runUpdate();
        if (body.restart === true && result.updated && result.restartReady !== false) {
          scheduleWindowRestart({ port, workspaceRoot });
          setTimeout(() => {
            requestAppShutdown({ source: "update-restart" }).finally(() => {
              setTimeout(() => process.exit(0), 200).unref();
            });
          }, 250).unref();
          return sendJson(res, { ...result, restarting: true });
        }
        return sendJson(res, result);
      }

      if (await handleMemoryRoute(req, url, res)) return;
      if (await handleSkillsRoute(req, url, res)) return;
      if (await handlePluginsRoute(req, url, res)) return;

      // ===== Settings (whitelist команд для /code) =====

      // Compatibility responses for an already-open pre-free UI. They are
      // intentionally local: no installation identity is read or sent.
      if (req.method === "GET" && url.pathname === "/api/subscription") {
        return sendJson(res, { state: "free_release", paymentEnabled: false });
      }
      if (req.method === "POST" && ["/api/subscription/telegram", "/api/subscription/robokassa"].includes(url.pathname)) {
        return sendJson(res, { error: "Payments are no longer available; SYNVOX is free." }, 410);
      }

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

      if (req.method === "GET" && url.pathname === "/api/diagnostics") {
        return sendJson(res, await collectDiagnostics({
          workspaceRoot,
          state,
          runningTaskIds: getRunningIds(),
        }));
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

        if (body.handoffFrom) {
          const host = String(req.headers.host || "");
          if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
            || req.headers.origin !== "http://" + host || !String(req.headers["content-type"] || "").startsWith("application/json")) {
            return sendJson(res, { error: "Invalid origin" }, 403);
          }
        }
        let handoff;
        try {
          handoff = prepareConversationHandoff(state, body, workspace, id => isRunning(id) || qwenActiveRequests.has(id));
        } catch (error) { return sendJson(res, { error: error.message }, error.status || 400); }

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

        const allowedProviders = new Set(["deepseek", "qwen", "chatgpt", "codex", "googleai", "glm", "antigravity"]);
        const requestedProvider = String(body.provider || "deepseek");
        if (!allowedProviders.has(requestedProvider)) {
          return sendJson(res, { error: `Провайдер "${requestedProvider}" не поддерживается.` }, 400);
        }
        const provider = requestedProvider;
        // Сессию DeepSeek создаём только для DeepSeek-чатов. У остальных провайдеров свои
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
          ...(["deepseek", "chatgpt", "glm", "googleai"].includes(provider) ? { providerAccountId: webAccounts.selected(provider) } : {}),
          ...(handoff ? { handoff } : {}),
          title: rawTitle || "New chat",
          autoTitle: !rawTitle,
          workspace,
          mode,
          model,
          roleId: normalizeRoleId(body.roleId),
          pipelineMode: body.pipelineMode === true,
          pipelineAgents: [],
          interactionMode: body.interactionMode === "discuss" ? "discuss" : "execute",
          accessMode: "project",
          coderMode: body.interactionMode !== "discuss",
          hardwareMode: body.hardwareMode === true,
          memoryEnabled: appSettings.ui?.memoryDefault !== false,
          autoSkill: appSettings.ui?.autoSkillDefault !== false,
          skillId: typeof body.skillId === "string" && body.skillId ? body.skillId : handoff?.skillId || null,
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
      const qwenLiveMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/qwen-captcha\/(live-stream|live-input)$/);
      const qwenEmbedMatch = url.pathname === "/embed/qwen-captcha";
      if (qwenEmbedMatch || qwenLiveMatch) {
        const host = String(req.headers.host || "");
        if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return sendJson(res, { error: "Invalid host" }, 403);
        if (req.method === "POST" && (req.headers.origin !== "http://" + host || !String(req.headers["content-type"] || "").startsWith("application/json"))) {
          return sendJson(res, { error: "Invalid origin" }, 403);
        }
        const id = qwenEmbedMatch ? url.searchParams.get("conversationId") : qwenLiveMatch[1];
        const conversation = state.conversations.find((item) => item.id === id);
        const pending = conversation?.provider === "qwen" && conversation.pendingQwenCaptcha;
        if (!pending || !["ready", "not_shown"].includes(pending.status)) {
          return sendJson(res, { error: "Qwen verification page is not ready" }, 409);
        }
        if (qwenEmbedMatch && req.method === "GET") return sendHtml(res, renderEmbedQwenCaptchaHtml(id));
        if (qwenLiveMatch?.[2] === "live-stream" && req.method === "GET") {
          try { return await handleQwenCaptchaLiveStream(req, res, pending.accountId); }
          catch (error) { return sendJson(res, { error: error.message }, 503); }
        }
        if (qwenLiveMatch?.[2] === "live-input" && req.method === "POST") {
          try { return sendJson(res, await handleQwenCaptchaLiveInput(pending.accountId, await readJsonBody(req, 4096))); }
          catch (error) { return sendJson(res, { error: error.message }, 400); }
        }
        return sendJson(res, { error: "Method not allowed" }, 405);
      }
      const qwenCaptchaMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/qwen-captcha\/(open|done)$/);
      if (req.method === "POST" && qwenCaptchaMatch) {
        const conversation = state.conversations.find((item) => item.id === qwenCaptchaMatch[1]);
        if (conversation?.provider !== "qwen" || !conversation.pendingQwenCaptcha) {
          return sendJson(res, { error: "Qwen captcha is not pending for this chat" }, 409);
        }
        if (qwenCaptchaMatch[2] === "done" && conversation.pendingQwenCaptcha.status === "cooldown") {
          return sendJson(res, { error: "Сначала откройте Qwen и пройдите показанную проверку." }, 409);
        }
        try {
          const { openQwenCaptchaBrowser, finishQwenCaptchaBrowser } = await import("../providers/qwen/browser-proxy.mjs");
          const pending = conversation.pendingQwenCaptcha;
          // Repair pending challenges saved before chat/code identity was separated.
          if (!pending.mode && !pending.retry && conversation.qwenCheckpoint && conversation.qwenCodeAccountId) {
            pending.accountId = conversation.qwenCodeAccountId;
            pending.mode = "code";
          }
          const accountId = pending.accountId;
          if (qwenCaptchaMatch[2] === "open") {
            if (!qwenCaptchaOpenJobs.has(accountId)) {
              const pendingCaptcha = conversation.pendingQwenCaptcha;
              pendingCaptcha.status = "opening";
              delete pendingCaptcha.error;
              saveWindowState(workspaceRoot, state);
              const job = openQwenCaptchaBrowser(accountId)
                .then((result) => {
                  pendingCaptcha.challengeVisible = result.challengeVisible === true;
                  pendingCaptcha.status = result.loginRequired ? "login_required" : pendingCaptcha.challengeVisible ? "ready" : "not_shown";
                })
                .catch((error) => {
                  pendingCaptcha.status = "error";
                  pendingCaptcha.error = error.message;
                })
                .finally(() => {
                  qwenCaptchaOpenJobs.delete(accountId);
                  conversation.updatedAt = new Date().toISOString();
                  saveWindowState(workspaceRoot, state);
                });
              qwenCaptchaOpenJobs.set(accountId, job);
            }
            return sendJson(res, { ok: true, opening: true });
          }
          if (qwenCaptchaOpenJobs.has(accountId) || !["ready", "not_shown"].includes(conversation.pendingQwenCaptcha.status)) {
            return sendJson(res, { error: "Окно Qwen ещё открывается." }, 409);
          }
          if (!await finishQwenCaptchaBrowser(accountId, { chatId: pending.mode === "code" ? getCodeSessionId(conversation) : conversation.sessionId })) {
            return sendJson(res, { error: "Qwen пока не подтвердил прохождение проверки. Если капча не видна, дождитесь окончания ограничения и повторите запрос." }, 409);
          }
          const retry = conversation.pendingQwenCaptcha.retry;
          if (isQwenCaptchaRetryableTurn(conversation, retry)) conversation.qwenCaptchaRetry = retry;
          delete conversation.pendingQwenCaptcha;
          conversation.updatedAt = new Date().toISOString();
          saveWindowState(workspaceRoot, state);
          return sendJson(res, { ok: true, conversation, resumeQwenCaptcha: Boolean(conversation.qwenCaptchaRetry),
            resumeQwenCode: pending.mode === "code" && conversation.harnessTask?.checkpoint?.phase === "awaiting_model" && !isRunning(conversation.id) });
        } catch (error) {
          return sendJson(res, { error: error.message }, 500);
        }
      }
      if (req.method === "GET" && conversationMatch) {
        const conversation = state.conversations.find((item) => item.id === conversationMatch[1]);
        if (!conversation) return sendJson(res, { error: "Conversation not found" }, 404);
        state.activeConversationId = conversation.id;
        saveWindowState(workspaceRoot, state);
        return sendJson(res, { conversation, running: isRunning(conversation.id) });
      }

      // Обновление модели и режима работы текущего чата.
      if (req.method === "PATCH" && conversationMatch) {
        const id = conversationMatch[1];
        const conversation = state.conversations.find((item) => item.id === id);
        if (!conversation) return sendJson(res, { error: "Conversation not found" }, 404);
        const body = await readJsonBody(req);
        if (["discuss", "execute"].includes(body.interactionMode) && isRunning(conversation.id)) return sendJson(res, { error: "Остановите задачу перед сменой режима." }, 409);
        if (["project", "computer"].includes(body.accessMode) && body.accessMode !== (conversation.accessMode === "computer" ? "computer" : "project")
          && (isRunning(conversation.id) || qwenActiveRequests.has(conversation.id))) {
          return sendJson(res, { error: "Остановите задачу перед сменой режима доступа." }, 409);
        }
        if (typeof body.model === "string" && body.model.length > 0 && body.model !== conversation.model && isRunning(conversation.id)) {
          return sendJson(res, { error: "Остановите задачу перед сменой модели." }, 409);
        }
        if (typeof body.model === "string" && body.model.length > 0) {
          conversation.model = body.model;
        }
        if (typeof body.roleId === "string") {
          conversation.roleId = normalizeRoleId(body.roleId);
        }
        if (typeof body.pipelineMode === "boolean") {
          conversation.pipelineMode = body.pipelineMode;
        }
        if (Array.isArray(body.pipelineAgents)) {
          conversation.pipelineAgents = normalizePipelineAgents(body.pipelineAgents);
        }
        if (["discuss", "execute"].includes(body.interactionMode)) {
          conversation.interactionMode = body.interactionMode;
        }
        if (["project", "computer"].includes(body.accessMode)) {
          conversation.accessMode = body.accessMode;
        }
        conversation.coderMode = conversation.interactionMode !== "discuss";
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
        } else if (key === "allowDestructiveActions") {
          commandPermissions.allowDestructiveActions = true;
        } else if (key === "allowExternalWrites") {
          commandPermissions.allowExternalWrites = true;
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
        deleteConversationImages(id);
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
        const streamingRequest = qwenActiveRequests.get(conversation.id);
        streamingRequest?.abort();
        const stopped = stopTask(conversation.id) || Boolean(streamingRequest);
        if (stopped) logConsole(`[stop] task stopped for ${conversation.id}`);
        return sendJson(res, { conversation, stopped, running: isRunning(conversation.id) });
      }

      const messageMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
      if (req.method === "POST" && messageMatch) {
        try { await assertLicensedAccess(); }
        catch (error) { return sendJson(res, { error: error.message }, error.status || 503); }
        // Image-capable providers receive the complete inline attachment batch.
        const body = await readJsonBody(req, MAX_IMAGE_MESSAGE_BODY_BYTES);
        const conversation = state.conversations.find((item) => item.id === messageMatch[1]);
        if (!conversation) return sendJson(res, { error: "Conversation not found" }, 404);

        if (body.resumeTaskId) {
          const host = String(req.headers.host || "");
          if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
            || req.headers.origin !== "http://" + host || !String(req.headers["content-type"] || "").startsWith("application/json")) {
            return sendJson(res, { error: "Invalid origin" }, 403);
          }
          try { assertTaskContinuation(conversation, body.resumeTaskId, { running: isRunning(conversation.id) || qwenActiveRequests.has(conversation.id) }); }
          catch (error) { return sendJson(res, { error: error.message }, error.status || 409); }
          body.content = "продолжи";
          conversation.interactionMode = "execute";
          conversation.coderMode = true;
        }
        const qwenCaptchaRetry = body.resumeQwenCaptcha === true ? conversation.qwenCaptchaRetry : null;
        if (body.resumeQwenCaptcha === true && !isQwenCaptchaRetryableTurn(conversation, qwenCaptchaRetry)) {
          return sendJson(res, { error: "Этот вопрос уже изменён или повторён. Отправьте его заново вручную." }, 409);
        }
        if (qwenCaptchaRetry) {
          body.content = conversation.messages[qwenCaptchaRetry.userIndex].content;
          body.thinking = qwenCaptchaRetry.thinking;
          body.searchEnabled = qwenCaptchaRetry.searchEnabled;
        }
        const prompt = String(body.content || "").trim();
        if (!prompt) return sendJson(res, { error: "Message is empty" }, 400);
        if (qwenCaptchaRetry) body.images = restoreChatImages(conversation.id, conversation.messages[qwenCaptchaRetry.userIndex]?.images || []);
        toProviderImageFiles(body.images || []);
        const userMessageSource = body.source === "telegram" ? "telegram" : "";
        const storedImages = qwenCaptchaRetry ? [] : persistChatImages(
          conversation.id,
          Array.isArray(body.displayImages) && body.displayImages.length ? body.displayImages : body.images,
        );
        const storedImageUrls = storedImages.map((image) => image.url);
        appLogger.info("chat.message.received", {
          requestId,
          conversationId: conversation.id,
          provider: conversation.provider || "deepseek",
          model: conversation.model || null,
          source: userMessageSource || "desktop",
          promptChars: prompt.length,
          imageCount: storedImages.length,
          pipeline: body.pipeline === true || conversation.pipelineMode === true,
          coderMode: conversation.coderMode,
          searchEnabled: body.searchEnabled === true,
        });
        const createUserMessage = (extra = {}) => ({
          role: "user",
          content: prompt,
          createdAt: new Date().toISOString(),
          ...(userMessageSource ? { source: userMessageSource } : {}),
          ...(storedImageUrls.length ? { images: storedImageUrls } : {}),
          ...extra,
        });
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
          conversation.messages.push(createUserMessage({ pipelineRun: true }));
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
        const client = convProvider === "deepseek" ? await webAccounts.client("deepseek", conversation) : null;
        migrateLegacyCodeSession(conversation);
        logConsole(`[chat] ${convProvider} message in ${conversation.title}: ${summarizeForLog(prompt)}`);
        logConsoleBlock("user", prompt);
        if (convProvider === "qwen") {
          if (qwenActiveRequests.has(conversation.id)) return sendJson(res, { error: "Дождитесь завершения текущего ответа Qwen." }, 409);
          delete conversation.qwenCaptchaRetry;
          const qwenAbort = new AbortController();
          qwenActiveRequests.set(conversation.id, qwenAbort);
          res.once('close', () => { if (!res.writableEnded) qwenAbort.abort(); });
          // Пушим user-сообщение СРАЗУ, до запроса к Qwen, чтобы оно отображалось
          // в UI пока ждём ответ (4-5 сек). Иначе пользовательское сообщение
          // «исчезает» с экрана до момента, как придёт ответ.
          if (!qwenCaptchaRetry) conversation.messages.push(createUserMessage());
          const qwenUserIndex = qwenCaptchaRetry?.userIndex ?? conversation.messages.length - 1;
          conversation.updatedAt = new Date().toISOString();
          saveWindowState(workspaceRoot, state);

          // Lazy-init Qwen-клиента — создаём один раз за life сервера.
          try {
            let onAccountSwitch = event => recordQwenSwitch(conversation, event);
            const resumeCheckpoint = conversation.qwenPaused && /^(?:продолжи(?:ть)?|continue|resume)[.!\s]*$/i.test(prompt.trim()) ? conversation.qwenCheckpoint : null;
            let initialAgentPrompt = resumeCheckpoint?.initialPrompt || "";
            const agentModes = await resolveAgentModes(prompt);
            const agentInput = resolveConversationAgentTask(prompt, conversation, agentModes);
            const qwenCodeTurn = agentInput.run || Boolean(resumeCheckpoint);
            const qwenSessionField = qwenCodeTurn ? "codeSessionId" : "sessionId";
            const qwenAccountField = qwenCodeTurn ? "qwenCodeAccountId" : "qwenAccountId";
            const qwenRequest = await leaseQwenWorkerClient(conversation.id + (qwenCodeTurn ? ":code" : ":chat"), {
              signal: qwenAbort.signal,
              initial: { accountId: conversation[qwenAccountField], chatId: conversation[qwenAccountField] ? conversation[qwenSessionField] : null },
              context: () => [
                initialAgentPrompt.slice(0, 14000),
                JSON.stringify(conversation.messages.filter(m => !m.streaming).slice(-8).map(m => ({ role: m.role, content: String(m.content || '').slice(-1500) }))),
                JSON.stringify({ task: conversation.qwenCheckpoint?.task, toolLogs: conversation.qwenCheckpoint?.toolLogs?.slice(-20) }),
              ].join("\n"),
              onSwitch: event => onAccountSwitch(event),
              onSession: ({ accountId, chatId }) => {
                conversation[qwenAccountField] = accountId;
                conversation[qwenSessionField] = chatId;
                saveWindowState(workspaceRoot, state);
              },
            });
            // Lazy createChat: на первом сообщении. Модель — из чата.
            if (!conversation[qwenSessionField] || !conversation[qwenAccountField]) {
              conversation[qwenSessionField] = await qwenApiCall((c) =>
                c.createChat({ model: conversation.model || undefined }),
                { clientRef: qwenRequest },
              );
              saveWindowState(workspaceRoot, state);
            }

            // /code-режим или Coder-mode (per-chat toggle) → запускаем code-agent.
            // ASYNC: задача идёт в фоне через task-runner. Возвращаем conversation
            // сразу с running:true, UI делает polling до завершения.
            const hardwareMode = conversation.hardwareMode === true;
            if (agentInput.run || resumeCheckpoint) {
              const task = resumeCheckpoint?.task || agentInput.task;
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

              const { createQwenAgentAdapter, createQwenAgentTransport } = await import("../providers/qwen/agent-adapter.mjs");
              const { QWEN_RELOGIN_IN_PROGRESS_MESSAGE } = await import("../providers/qwen/session-errors.mjs");
              const progressLogs = [];
              const progressMessage = createCodeProgressMessage(task, { browserOnly: agentInput.browserOnly });
              conversation.messages.push(progressMessage);
              const adapter = createQwenAgentAdapter(createQwenAgentTransport(operation =>
                  qwenApiCall(operation, {
                    clientRef: qwenRequest,
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
              ));
              const workspacePath = path.resolve(conversation.workspace || workspaceRoot);
              await prepareBrowserAgentTask(task);
              const qwenCodeUseSearch = await resolveQwenSearchEnabled(
                conversation.model,
                task,
                body,
                searchEnabled,
              );
              const baseOptions = {
                sessionId: getCodeSessionId(conversation),
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
                  const codeResult = await runConversationAgentTask(conversation, adapter, baseOptions, workspacePath, task, parentId, {
                    signal,
                    resumeState: resumeCheckpoint,
                    harnessResume: agentInput.harnessResume === true,
                    onCheckpoint: checkpoint => {
                      if (!initialAgentPrompt) initialAgentPrompt = checkpoint.prompt;
                      conversation.qwenCheckpoint = { ...checkpoint, initialPrompt: initialAgentPrompt };
                      saveWindowState(workspaceRoot, state);
                    },
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
                      progressMessage.toolLogs = [...progressLogs];
                      progressMessage.content = formatCodeProgressMessage(task, progressLogs, { browserOnly: agentInput.browserOnly });
                      progressMessage.updatedAt = new Date().toISOString();
                      conversation.updatedAt = progressMessage.updatedAt;
                      saveWindowState(workspaceRoot, state);
                    },
                  });
                  conversation.codeParentMessageId = codeResult.parentMessageId ?? conversation.codeParentMessageId;
                  delete conversation.qwenCheckpoint;
                  delete conversation.qwenPaused;
                  delete conversation.pendingQwenCaptcha;
                  conversation.codeAgentPromptVersion = CODE_AGENT_PROMPT_VERSION;
                  const toolText = codeResult.toolLogs.length ? `${codeResult.toolLogs.join("\n")}\n\n` : "";
                  progressMessage.toolLogs = [...codeResult.toolLogs];
                  const finalized = finalizeCodeTaskMessage(codeResult);
                  conversation.lastAgentMeta = finalized.agentMeta;
                  progressMessage.content = finalized.content.trimEnd();
                  delete progressMessage.streaming;
                  progressMessage.updatedAt = new Date().toISOString();
                  if (toolText) logConsoleBlock("code tools", toolText);
                  logConsoleBlock("assistant", codeResult.message);
                  logConsole(`[code] qwen completed: ${codeResult.toolLogs.length} tool log(s)`);
                } catch (err) {
                  conversation.qwenPaused = err.code === 'QWEN_ACCOUNTS_PAUSED' || err.code === 'QWEN_ANTIBOT_PUNISH';
                  markQwenCaptcha(conversation, err, conversation.qwenCodeAccountId || "default", "code");
                  progressMessage.content = err.code === 'QWEN_ANTIBOT_PUNISH'
                    ? "Qwen отклонил запрос проверкой доступа. Задача сохранена. Локальная пауза не устанавливалась; если капчи нет, ручная проверка недоступна."
                    : formatHarnessFailureMessage(conversation, err);
                  delete progressMessage.streaming;
                  progressMessage.updatedAt = new Date().toISOString();
                  logConsole(`[code] qwen failed: ${err.message}`);
                }
                conversation.updatedAt = new Date().toISOString();
                saveWindowState(workspaceRoot, state);
              }, "Qwen /code", { staleAfterMs: 45 * 60_000 });

              return sendJson(res, { conversation, running: true });
            }

            const isQwenReasoning = await resolveQwenThinking(conversation.model);
            const qwenUseSearch = await resolveQwenSearchEnabled(
              conversation.model,
              prompt,
              body,
              searchEnabled,
            );
            let qwenPrompt = buildConversationPrompt(qwenUseSearch ? withWebSearchInstruction(prompt) : prompt, conversation);

            if (isRunning(conversation.id)) {
              return sendJson(res, { error: "Дождитесь завершения текущего ответа Qwen." }, 409);
            }

            const { formatQwenStreamDisplay } = await import("../providers/qwen/client.mjs");
            const streamMessage = qwenCaptchaRetry ? conversation.messages[qwenCaptchaRetry.assistantIndex] : {
              role: "assistant",
              content: "…",
              streaming: true,
              createdAt: new Date().toISOString(),
            };
            if (qwenCaptchaRetry) {
              streamMessage.content = "…";
              streamMessage.streaming = true;
              delete streamMessage.qwenCaptchaRetryable;
            } else conversation.messages.push(streamMessage);
            const qwenAssistantIndex = conversation.messages.indexOf(streamMessage);
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
            onAccountSwitch = event => {
              recordQwenSwitch(conversation, event);
              answerText = "";
              thinkingText = "";
              pushStreamDelta();
            };

            try {
              const { QWEN_RELOGIN_IN_PROGRESS_MESSAGE } = await import("../providers/qwen/session-errors.mjs");
              const result = await qwenApiCall(
                (c) =>
                  c.complete({
                    chatId: conversation.sessionId,
                    prompt: qwenPrompt,
                    images: body.images || [],
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
                  clientRef: qwenRequest,
                  onRelogin: () => {
                    streamMessage.content = QWEN_RELOGIN_IN_PROGRESS_MESSAGE;
                    streamMessage.updatedAt = new Date().toISOString();
                    pushStreamDelta();
                  },
                },
              );
              conversation.parentMessageId = result.lastMessageId ?? conversation.parentMessageId;
              // Qwen recovered «The chat is in progress!» by creating a fresh
              // chat_id. Закрепляем его в conversation.sessionId, чтобы следующие
              // сообщения шли в восстановленный чат, а не в зависший старый.
              if (result.recoveredChatId && result.recoveredChatId !== conversation.sessionId) {
                console.log(`[chat] qwen recovered into fresh chat_id=${result.recoveredChatId} (was ${conversation.sessionId})`);
                conversation.sessionId = result.recoveredChatId;
                // parentId уже обновлён result.lastMessageId выше.
              }
              const finalText = result.thinkingText
                ? formatQwenStreamDisplay(result.thinkingText, result.text)
                : String(result.text || "").trim();
              delete streamMessage.streaming;
              streamMessage.content = finalText || "[empty]";
              delete conversation.pendingQwenCaptcha;
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
              markQwenCaptcha(conversation, error);
              delete streamMessage.streaming;
              streamMessage.content = `⚠️ Qwen error: ${formatQwenError(error)}`;
              if (isQwenCaptchaError(error) && !answerText && !thinkingText && !body.refFileIds?.length && !body.images?.length) {
                streamMessage.qwenCaptchaRetryable = true;
                conversation.pendingQwenCaptcha.retry = {
                  userIndex: qwenUserIndex,
                  assistantIndex: qwenAssistantIndex,
                  thinking: body.thinking === true,
                  searchEnabled: body.searchEnabled === true,
                };
              }
              streamMessage.updatedAt = new Date().toISOString();
              conversation.updatedAt = streamMessage.updatedAt;
              saveWindowState(workspaceRoot, state);
              logConsole(`[chat] qwen failed: ${error.message}`);
              writeNdjsonLine(res, { type: "error", conversation, message: error.message });
            }
            endNdjsonStream(res);
            return;
          } catch (error) {
            markQwenCaptcha(conversation, error);
            conversation.messages.push({
              role: "assistant",
              content: `⚠️ Qwen error: ${formatQwenError(error)}`,
              createdAt: new Date().toISOString(),
            });
            conversation.updatedAt = new Date().toISOString();
            saveWindowState(workspaceRoot, state);
            logConsole(`[chat] qwen failed: ${error.message}`);
          } finally { qwenActiveRequests.delete(conversation.id); }
          return sendJson(res, { conversation });
        }
        if (convProvider === 'antigravity') {
          const now = new Date().toISOString();
          if (!conversation.messages.some((message) => message.role === 'user') && shouldAutoTitle(conversation)) {
            conversation.title = makeConversationTitle(prompt);
          }
          conversation.messages.push(createUserMessage({ createdAt: now }));
          conversation.updatedAt = now;
          state.activeConversationId = conversation.id;
          saveWindowState(workspaceRoot, state);

          const status = getAntigravityStatus();
          if (!status.authenticated) {
            conversation.messages.push({ role: 'assistant', content: `⚠️ Antigravity: ${status.message}`, createdAt: new Date().toISOString() });
            saveWindowState(workspaceRoot, state);
            return sendJson(res, { conversation });
          }
          const antigravity = (antigravityClient ||= new AntigravityClient());
          const agentInput = resolveConversationAgentTask(prompt, conversation, await resolveAgentModes(prompt));
          if (agentInput.run) {
            if (agentInput.empty) {
              conversation.messages.push({ role: 'assistant', content: AGENT_TASK_EMPTY_HELP, createdAt: new Date().toISOString() });
              saveWindowState(workspaceRoot, state);
              return sendJson(res, { conversation });
            }
            if (isRunning(conversation.id)) {
              captureRunningClarification(conversation, prompt);
              saveWindowState(workspaceRoot, state);
              return sendJson(res, { conversation, running: true });
            }
            const task = agentInput.task;
            const progressLogs = [];
            const progressMessage = createCodeProgressMessage(task, { browserOnly: agentInput.browserOnly });
            conversation.messages.push(progressMessage);
            saveWindowState(workspaceRoot, state);
            startTask(conversation.id, 'code', async (signal) => {
              const adapter = createAntigravityAgentAdapter(antigravity, {
                conversationId: getCodeSessionId(conversation), model: conversation.model || null,
                onConversationId: id => { setCodeSessionId(conversation, id); saveWindowState(workspaceRoot, state); },
              });
              try {
                const codeResult = await runConversationAgentTask(conversation, adapter,
                  { sessionId: getCodeSessionId(conversation), searchEnabled: true },
                  path.resolve(conversation.workspace || workspaceRoot), task, getCodeParentMessageId(conversation), {
                    signal, ...buildAgentTaskOptions(conversation, body, { agentInput }),
                    onMemorySaved: createCodeMemorySavedHandler({ conversation, progressMessage, workspaceRoot, state, saveWindowState }),
                    takeInterrupts: () => takeRunningClarifications(conversation),
                    onTool: (_call, result, log) => {
                      captureInstallRequest(conversation, result); captureQuestionRequest(conversation, result); capturePermissionRequest(conversation, result);
                      progressLogs.push(log); progressMessage.toolLogs = [...progressLogs];
                      progressMessage.content = formatCodeProgressMessage(task, progressLogs, { browserOnly: agentInput.browserOnly });
                      progressMessage.updatedAt = new Date().toISOString(); saveWindowState(workspaceRoot, state);
                    },
                  });
                conversation.codeParentMessageId = codeResult.parentMessageId ?? conversation.codeParentMessageId;
                conversation.codeAgentPromptVersion = CODE_AGENT_PROMPT_VERSION;
                progressMessage.toolLogs = [...codeResult.toolLogs];
                const finalized = finalizeCodeTaskMessage(codeResult);
                conversation.lastAgentMeta = finalized.agentMeta;
                progressMessage.content = finalized.content.trimEnd();
              } catch (error) {
                progressMessage.content = signal.aborted ? '⏹ Остановлено пользователем.' : formatHarnessFailureMessage(conversation, error);
              } finally {
                adapter.close();
                delete progressMessage.streaming;
                progressMessage.updatedAt = new Date().toISOString();
                conversation.updatedAt = new Date().toISOString();
                saveWindowState(workspaceRoot, state);
              }
            }, 'Antigravity /code');
            return sendJson(res, { conversation, running: true });
          }

          try {
            // Headless CLI may write inside its cwd; keep ordinary chat away from user projects.
            antigravityChatDir ||= fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-antigravity-chat-'));
            await runAntigravityConversationTurn({
              client: antigravity, conversation, prompt, cwd: antigravityChatDir,
              onChange: () => saveWindowState(workspaceRoot, state),
            });
          } catch (error) {
            conversation.messages.push({ role: 'assistant', content: `⚠️ Antigravity: ${error.message}`, createdAt: new Date().toISOString() });
            conversation.updatedAt = new Date().toISOString();
            saveWindowState(workspaceRoot, state);
          }
          return sendJson(res, { conversation });
        }
        if (convProvider === "codex") {
          const now = new Date().toISOString();
          const isFirstUserMessage = !conversation.messages.some((message) => message.role === "user");
          if (isFirstUserMessage && shouldAutoTitle(conversation)) conversation.title = makeConversationTitle(prompt);
          conversation.messages.push(createUserMessage({ createdAt: now }));
          conversation.updatedAt = now;
          state.activeConversationId = conversation.id;
          saveWindowState(workspaceRoot, state);

          const agentModes = await resolveAgentModes(prompt);
          const agentInput = resolveConversationAgentTask(prompt, conversation, agentModes);
          if (agentInput.run) {
            const task = agentInput.task;
            if (agentInput.empty) {
              conversation.messages.push({ role: "assistant", content: AGENT_TASK_EMPTY_HELP, createdAt: new Date().toISOString() });
              saveWindowState(workspaceRoot, state);
              return sendJson(res, { conversation });
            }
            if (isRunning(conversation.id)) {
              captureRunningClarification(conversation, prompt);
              saveWindowState(workspaceRoot, state);
              return sendJson(res, { conversation, running: true });
            }
            try {
              const codex = await getOrCreateCodexClient();
              const adapter = (await import("../providers/codex/agent-adapter.mjs")).createCodexAgentAdapter(codex, {
                conversationId: getCodeSessionId(conversation),
                model: conversation.model && conversation.model !== "codex" ? conversation.model : null,
                onConversationId: (id) => { setCodeSessionId(conversation, id); saveWindowState(workspaceRoot, state); },
              });
              const workspacePath = path.resolve(conversation.workspace || workspaceRoot);
              const parentId = getCodeParentMessageId(conversation);
              const progressLogs = [];
              const progressMessage = createCodeProgressMessage(task, { browserOnly: agentInput.browserOnly });
              conversation.messages.push(progressMessage);
              saveWindowState(workspaceRoot, state);
              startTask(conversation.id, "code", async (signal) => {
                try {
                  const codeResult = await runConversationAgentTask(conversation, adapter, { sessionId: getCodeSessionId(conversation), searchEnabled: true }, workspacePath, task, parentId, {
                    signal,
                    ...buildAgentTaskOptions(conversation, body, { agentInput }),
                    onMemorySaved: createCodeMemorySavedHandler({ conversation, progressMessage, workspaceRoot, state, saveWindowState }),
                    takeInterrupts: () => takeRunningClarifications(conversation),
                    onTool: (_call, result, log) => {
                      captureInstallRequest(conversation, result);
                      captureQuestionRequest(conversation, result);
                      capturePermissionRequest(conversation, result);
                      progressLogs.push(log);
                      progressMessage.toolLogs = [...progressLogs];
                      progressMessage.content = formatCodeProgressMessage(task, progressLogs, { browserOnly: agentInput.browserOnly });
                      progressMessage.updatedAt = new Date().toISOString();
                      saveWindowState(workspaceRoot, state);
                    },
                  });
                  conversation.codeParentMessageId = codeResult.parentMessageId ?? conversation.codeParentMessageId;
                  conversation.codeAgentPromptVersion = CODE_AGENT_PROMPT_VERSION;
                  setCodeSessionId(conversation, adapter.getConversationId());
                  progressMessage.toolLogs = [...codeResult.toolLogs];
                  const finalized = finalizeCodeTaskMessage(codeResult);
                  conversation.lastAgentMeta = finalized.agentMeta;
                  progressMessage.content = finalized.content.trimEnd();
                  delete progressMessage.streaming;
                  progressMessage.updatedAt = new Date().toISOString();
                } catch (error) {
                  progressMessage.content = `⚠️ Codex /code error: ${error.message}`;
                  delete progressMessage.streaming;
                  progressMessage.updatedAt = new Date().toISOString();
                }
                conversation.updatedAt = new Date().toISOString();
                saveWindowState(workspaceRoot, state);
              }, agentInput.slash ? "Codex /code" : "Codex auto-code");
              return sendJson(res, { conversation, running: true });
            } catch (error) {
              conversation.messages.push({ role: "assistant", content: `⚠️ Codex /code error: ${error.message}`, createdAt: new Date().toISOString() });
              saveWindowState(workspaceRoot, state);
              return sendJson(res, { conversation });
            }
          }

          try {
            const codex = await getOrCreateCodexClient();
            const startedAt = Date.now();
            const result = await codex.complete({
              prompt: buildConversationPrompt(prompt, conversation),
              images: body.images || [],
              signal: responseAbortSignal(res),
              sessionId: conversation.sessionId || null,
              model: conversation.model && conversation.model !== "codex" ? conversation.model : null,
            });
            const elapsedMs = Date.now() - startedAt;
            conversation.sessionId = result.sessionId || conversation.sessionId;
            logConsole(`[codex] response ${elapsedMs}ms thread=${conversation.sessionId || "new"}`);
            conversation.messages.push({
              role: "assistant",
              content: String(result.text || "[empty]").trimEnd() || "[empty]",
              createdAt: new Date().toISOString(),
            });
            conversation.updatedAt = new Date().toISOString();
            saveWindowState(workspaceRoot, state);
            return sendJson(res, { conversation });
          } catch (error) {
            if (error.sessionId) conversation.sessionId = error.sessionId;
            conversation.messages.push({
              role: "assistant",
              content: `⚠️ Codex error: ${error.message}`,
              createdAt: new Date().toISOString(),
            });
            conversation.updatedAt = new Date().toISOString();
            saveWindowState(workspaceRoot, state);
            return sendJson(res, { conversation, needsCodexLogin: error.code === "CODEX_AUTH_REQUIRED" });
          }
        }

        if (convProvider === "chatgpt") {
          const now = new Date().toISOString();
          const isFirstUserMessage = !conversation.messages.some((message) => message.role === "user");
          if (isFirstUserMessage && shouldAutoTitle(conversation)) {
            conversation.title = makeConversationTitle(prompt);
          }
          conversation.messages.push(createUserMessage({ createdAt: now }));
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
              await ensureChatGPTSessionReady(conversation);
              const chatGPTClient = await getOrCreateChatGPTClient({ conversation });
              const { createChatGPTAgentAdapter } = await import("../providers/chatgpt/agent-adapter.mjs");
              const adapter = createChatGPTAgentAdapter(chatGPTClient, {
                conversationId: getCodeSessionId(conversation),
                model: conversation.model || null,
                onConversationId: (id) => {
                  setCodeSessionId(conversation, id);
                  saveWindowState(workspaceRoot, state);
                },
              });
              const workspacePath = path.resolve(conversation.workspace || workspaceRoot);
              await prepareBrowserAgentTask(task);
              const chatGPTCodeUseSearch = await resolveProviderSearchEnabled(task, body, searchEnabled);
              const baseOptions = {
                sessionId: getCodeSessionId(conversation),
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
                  const codeResult = await runConversationAgentTask(conversation, adapter, baseOptions, workspacePath, task, parentId, {
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
                      progressMessage.toolLogs = [...progressLogs];
                      progressMessage.content = formatCodeProgressMessage(task, progressLogs, { browserOnly: agentInput.browserOnly });
                      progressMessage.updatedAt = new Date().toISOString();
                      conversation.updatedAt = progressMessage.updatedAt;
                      saveWindowState(workspaceRoot, state);
                    },
                  });
                  conversation.codeParentMessageId = codeResult.parentMessageId ?? conversation.codeParentMessageId;
                  conversation.codeAgentPromptVersion = CODE_AGENT_PROMPT_VERSION;
                  setCodeSessionId(conversation, adapter.getConversationId());
                  const toolText = codeResult.toolLogs.length ? `${codeResult.toolLogs.join("\n")}\n\n` : "";
                  progressMessage.toolLogs = [...codeResult.toolLogs];
                  const finalized = finalizeCodeTaskMessage(codeResult);
                  conversation.lastAgentMeta = finalized.agentMeta;
                  progressMessage.content = finalized.content.trimEnd();
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
              const needsChatGPTLogin = isChatGPTLoginRecoveryRequired(error);
              conversation.messages.push({
                role: "assistant",
                content: needsChatGPTLogin
                  ? "⚠️ Нужен вход в ChatGPT: кнопка «Браузер» → вкладка ChatGPT. Завершите вход и нажмите «Синхронизировать»."
                  : `⚠️ ChatGPT /code error: ${error.message}`,
                createdAt: new Date().toISOString(),
              });
              conversation.updatedAt = new Date().toISOString();
              saveWindowState(workspaceRoot, state);
              logConsole(`[code] chatgpt failed to start: ${error.message}`);
              return sendJson(res, { conversation, needsChatGPTLogin });
            }
          }

          try {
            const chatGPTClient = await getOrCreateChatGPTClient({ conversation });
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
                  prompt: buildConversationPrompt(prompt, conversation),
                  model: modelInfo?.apiModel || conversation.model || undefined,
                  conversationId: conversation.sessionId,
                  parentMessageId: conversation.parentMessageId,
                  images: chatGPTImages,
                  onText: (chunk) => {
                    answerText = String(chunk || "");
                    pushStreamDelta();
                  },
                }), conversation,
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
              const needsChatGPTLogin = isChatGPTLoginRecoveryRequired(error);
              const browserNotReady = /cloudflare|поле ввода|интерфейс|composer|проверку/i.test(
                String(error?.message || error),
              );
              delete streamMessage.streaming;
              streamMessage.content = needsChatGPTLogin
                ? "⚠️ Нужен вход в ChatGPT: кнопка «Браузер» → вкладка ChatGPT. Войдите и нажмите «Синхронизировать»."
                : browserNotReady
                  ? "⚠️ Внутренний ChatGPT ещё не готов. Нажмите кнопку «Браузер», откройте вкладку ChatGPT и дождитесь готовности. При зависании нажмите ↻."
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
        if (["googleai", "glm"].includes(convProvider)) {
          const browserProviderLabel = convProvider === "glm" ? "GLM" : "Google AI";
          const now = new Date().toISOString();
          const isFirstUserMessage = !conversation.messages.some((message) => message.role === "user");
          if (isFirstUserMessage && shouldAutoTitle(conversation)) {
            conversation.title = makeConversationTitle(prompt);
          }
          conversation.messages.push(createUserMessage({ createdAt: now }));
          conversation.updatedAt = now;
          state.activeConversationId = conversation.id;
          saveWindowState(workspaceRoot, state);

          const agentModes = await resolveAgentModes(prompt);
          const agentInput = resolveConversationAgentTask(prompt, conversation, agentModes);
          const browserProviderImages = Array.isArray(body.images)
            ? body.images.filter((image) => image?.name && image?.mimeType && image?.dataBase64)
            : [];
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

            try {
              const client = convProvider === "glm"
                ? await getOrCreateGLMClient({ conversation })
                : await getOrCreateGoogleAIClient({ conversation });
              const adapter = convProvider === "glm"
                ? (await import("../providers/glm/agent-adapter.mjs")).createGLMAgentAdapter(client, {
                  conversationId: getCodeSessionId(conversation),
                  model: conversation.model || null,
                  onConversationId: (id) => {
                    setCodeSessionId(conversation, id);
                    saveWindowState(workspaceRoot, state);
                  },
                  onModel: (model) => {
                    conversation.model = model;
                    saveWindowState(workspaceRoot, state);
                  },
                })
                : (await import("../providers/google-ai/agent-adapter.mjs")).createGoogleAIAgentAdapter(client, {
                // Start the first Coder task in a clean Google AI thread. Reusing a
                // normal chat can make the page reader return its previous answer.
                conversationId: getCodeSessionId(conversation),

                onConversationId: (id) => {
                  setCodeSessionId(conversation, id);
                  saveWindowState(workspaceRoot, state);
                },
                });
              const workspacePath = path.resolve(conversation.workspace || workspaceRoot);
              await prepareBrowserAgentTask(task);
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
                  const codeResult = await runConversationAgentTask(conversation, adapter, {
                    sessionId: getCodeSessionId(conversation),
                    searchEnabled: true,
                  }, workspacePath, task, parentId, {
                    signal,
                    ...buildAgentTaskOptions(conversation, body, {
                      hardwareMode: conversation.hardwareMode === true,
                      systemPrompt: conversation.hardwareMode === true ? createHardwareAgentPrompt() : "",
                      agentInput,
                    }),
                    onMemorySaved: memorySavedHandler,
                    takeInterrupts: () => takeRunningClarifications(conversation),
                    onTool: (_call, result, log) => {
                      captureInstallRequest(conversation, result);
                      captureQuestionRequest(conversation, result);
                      capturePermissionRequest(conversation, result);
                      progressLogs.push(log);
                      progressMessage.toolLogs = [...progressLogs];
                      progressMessage.content = formatCodeProgressMessage(task, progressLogs, { browserOnly: agentInput.browserOnly });
                      progressMessage.updatedAt = new Date().toISOString();
                      conversation.updatedAt = progressMessage.updatedAt;
                      saveWindowState(workspaceRoot, state);
                    },
                  });
                  conversation.codeParentMessageId = codeResult.parentMessageId ?? conversation.codeParentMessageId;
                  conversation.codeAgentPromptVersion = CODE_AGENT_PROMPT_VERSION;
                  setCodeSessionId(conversation, adapter.getConversationId());
                  conversation.model = adapter.getModel?.() || conversation.model;
                  progressMessage.toolLogs = [...codeResult.toolLogs];
                  const finalized = finalizeCodeTaskMessage(codeResult);
                  conversation.lastAgentMeta = finalized.agentMeta;
                  progressMessage.content = finalized.content.trimEnd();
                  delete progressMessage.streaming;
                  progressMessage.updatedAt = new Date().toISOString();
                  logConsole(`[code] ${convProvider} completed: ${codeResult.toolLogs.length} tool log(s)`);
                } catch (error) {
                  progressMessage.content = `⚠️ ${browserProviderLabel} /code error: ${error.message}`;
                  delete progressMessage.streaming;
                  progressMessage.updatedAt = new Date().toISOString();
                  logConsole(`[code] ${convProvider} failed: ${error.message}`);
                }
                conversation.updatedAt = new Date().toISOString();
                saveWindowState(workspaceRoot, state);
              }, agentInput.slash ? `${browserProviderLabel} /code` : `${browserProviderLabel} auto-code`);

              return sendJson(res, { conversation, running: true });
            } catch (error) {
              conversation.messages.push({
                role: "assistant",
                content: `⚠️ ${browserProviderLabel} /code error: ${error.message}`,
                createdAt: new Date().toISOString(),
              });
              conversation.updatedAt = new Date().toISOString();
              saveWindowState(workspaceRoot, state);
              return sendJson(res, { conversation });
            }
          }

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
          try {
            const client = convProvider === "glm"
              ? await getOrCreateGLMClient({ conversation })
              : await getOrCreateGoogleAIClient({ conversation });
            let answerText = "";
            const result = await client.complete({
              prompt: buildConversationPrompt(prompt, conversation),
              signal: responseAbortSignal(res),
              model: conversation.model || null,
              conversationId: conversation.sessionId,
              humanReadable: convProvider === "glm",
              images: browserProviderImages,
              onText: (text) => {
                answerText = String(text || "");
                streamMessage.content = answerText || "…";
                streamMessage.updatedAt = new Date().toISOString();
                conversation.updatedAt = streamMessage.updatedAt;
                writeNdjsonLine(res, { type: "delta", content: streamMessage.content });
              },
            });
            conversation.sessionId = result.conversationId || conversation.sessionId;
            conversation.model = result.model || conversation.model;
            const finalText = String(result.text || answerText || "[empty]").trimEnd();
            delete streamMessage.streaming;
            streamMessage.content = finalText;
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
            writeNdjsonLine(res, { type: "done", conversation });
          } catch (error) {
            delete streamMessage.streaming;
            streamMessage.content = `⚠️ ${browserProviderLabel} error: ${error.message}`;
            streamMessage.updatedAt = new Date().toISOString();
            conversation.updatedAt = streamMessage.updatedAt;
            saveWindowState(workspaceRoot, state);
            writeNdjsonLine(res, { type: "error", conversation, message: error.message });
          }
          endNdjsonStream(res);
          return;
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
        if (refFileIds.length > 0) {
          effectiveModelType = process.env.DEEPSEEK_MODEL_VISION ?? "vision";
        }
        // С картинками поиск обычно ломает vision-completion (ref_file_ids).
        if (refFileIds.length > 0 || body.images?.length) {
          useSearch = false;
        }
        const now = new Date().toISOString();
        const isFirstUserMessage = !conversation.messages.some((message) => message.role === "user");
        if (isFirstUserMessage && shouldAutoTitle(conversation)) {
          conversation.title = makeConversationTitle(prompt);
        }
        conversation.messages.push(createUserMessage({ createdAt: now }));
        conversation.updatedAt = now;
        state.activeConversationId = conversation.id;
        saveWindowState(workspaceRoot, state);

        const agentModes = await resolveAgentModes(prompt);
        const agentInput = resolveConversationAgentTask(prompt, conversation, agentModes);
        const dsHardwareMode = conversation.hardwareMode === true;
        const resumeCheckpoint = getDeepSeekResumeCheckpoint(conversation, prompt);
        if (agentInput.run || resumeCheckpoint) {
          const task = resumeCheckpoint?.task || agentInput.task;
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

          if (!getCodeSessionId(conversation)) {
            setCodeSessionId(conversation, await client.createSession());
            saveWindowState(workspaceRoot, state);
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
            sessionId: getCodeSessionId(conversation),
            modelType: effectiveModelType,
            thinkingEnabled: useThinking,
            searchEnabled: dsCodeUseSearch,
          };
          const parentId = getCodeParentMessageId(conversation);
          const progressLogs = [...(resumeCheckpoint?.toolLogs || [])];
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
              const codeResult = await runConversationAgentTask(conversation, createDeepSeekAgentAdapter(client, { refFileIds }), baseOptions, workspacePath, task, parentId, {
                signal,
                resumeState: resumeCheckpoint,
                preloadProjectReview: true,
                onCheckpoint: value => {
                  conversation.deepseekCheckpoint = value;
                  saveWindowState(workspaceRoot, state);
                },
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
                  progressMessage.toolLogs = [...progressLogs];
                  progressMessage.content = formatCodeProgressMessage(task, progressLogs, { browserOnly: agentInput.browserOnly });
                  progressMessage.updatedAt = new Date().toISOString();
                  conversation.updatedAt = progressMessage.updatedAt;
                  saveWindowState(workspaceRoot, state);
                },
              });
              conversation.codeParentMessageId = codeResult.parentMessageId ?? conversation.codeParentMessageId;
              delete conversation.deepseekCheckpoint;
              delete conversation.deepseekPaused;
              conversation.codeAgentPromptVersion = CODE_AGENT_PROMPT_VERSION;
              const toolText = codeResult.toolLogs.length ? `${codeResult.toolLogs.join("\n")}\n\n` : "";
                  progressMessage.toolLogs = [...codeResult.toolLogs];
              const finalized = finalizeCodeTaskMessage(codeResult);
              conversation.lastAgentMeta = finalized.agentMeta;
              progressMessage.content = finalized.content.trimEnd();
              delete progressMessage.streaming;
              progressMessage.updatedAt = new Date().toISOString();
              if (toolText) logConsoleBlock("code tools", toolText);
              logConsoleBlock("assistant", codeResult.message);
              logConsole(`[code] deepseek completed: ${codeResult.toolLogs.length} tool log(s)`);
            } catch (err) {
              conversation.deepseekPaused = err.code === "DEEPSEEK_RATE_LIMIT" && Boolean(conversation.deepseekCheckpoint);
              progressMessage.content = conversation.deepseekPaused
                ? "DeepSeek пока ограничивает запросы. Задача и прочитанные файлы сохранены; позже напишите «продолжи» в этом чате."
                : `⚠️ /code error: ${err.message}`;
              delete progressMessage.streaming;
              progressMessage.updatedAt = new Date().toISOString();
              logConsole(`[code] deepseek failed: ${err.message}`);
            }
            conversation.updatedAt = new Date().toISOString();
            saveWindowState(workspaceRoot, state);
          }, agentInput.slash ? "DeepSeek /code" : "DeepSeek auto-code");

          return sendJson(res, { conversation, running: true });
        }

        if (!conversation.sessionId) {
          conversation.sessionId = await client.createSession();
          saveWindowState(workspaceRoot, state);
        }
        let deepseekPrompt = buildConversationPrompt(useSearch ? withWebSearchInstruction(prompt) : prompt, conversation);

        const streamMessage = {
          role: "assistant",
          content: "…",
          ...(refFileIds.length || body.images?.length ? { effectiveModel: "DeepSeek Vision" } : {}),
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
          const result = await createDeepSeekAgentAdapter(client).complete({
            sessionId: conversation.sessionId,
            signal: responseAbortSignal(res),
            prompt: deepseekPrompt,
            parentMessageId: conversation.parentMessageId,
            modelType: effectiveModelType,
            thinkingEnabled: useThinking,
            searchEnabled: useSearch,
            refFileIds,
            images: body.images || [],
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
      appLogger.error("http.request.error", error, {
        requestId,
        method: req.method,
        path: requestPath,
        durationMs: Date.now() - requestStartedAt,
      });
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
  appLogger.info("server.started", { url, workspaceRoot, port });
  const startupConversation = state.conversations.find((item) => item.id === state.activeConversationId);
  if (startupConversation?.provider === "qwen") {
    setImmediate(() => {
      import("../providers/qwen/browser-proxy.mjs")
        .then(({ getQwenBrowserProxy }) => getQwenBrowserProxy())
        .catch((error) => logConsole(`[qwen] background warm-up failed: ${error.message}`));
    });
  }
  let telegramBot = null;
  if (process.env.AI_FREE_DISABLE_TELEGRAM !== "1") {
    import("../telegram/bot.mjs")
      .then((m) => m.startTelegramBot({
        port,
        workspaceRoot,
        log: (message) => logConsole(message),
      }))
      .then((bot) => {
        telegramBot = bot;
      })
      .catch((error) => logConsole(`[telegram] failed to start: ${error.message}`));
  }

  if (openWindow) {
    console.log(`Workspace window: ${url}`);
    console.log("Tip: Memory and skills are in Settings; the workspace browser has its own topbar button.");
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

  registerShutdownServerCloser(async (done) => {
    appLogger.info("server.stopping", { port });
    for (const close of [() => telegramBot?.stop?.(), () => codexClient?.close?.()]) {
      try { await close(); } catch (error) { appLogger.error("shutdown.transport.close.failed", error); }
    }
    codexClient = null;
    if (!await waitForAllTasks()) appLogger.warn("shutdown.tasks.timeout");
    stateWriter.flush().catch(error => appLogger.error("state.shutdown.save.failed", error)).finally(() => {
      server.close(() => {
        appLogger.info("server.stopped", { port });
        done();
      });
      setTimeout(done, 2000).unref();
    });
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
  const mainAgentId = String(body?.mainAgentId || "");
  return {
    edges: edges.filter((edge) => {
      const key = `${edge.from}->${edge.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    mainAgentId: ids.has(mainAgentId) ? mainAgentId : null,
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

export function captureRunningClarification(conversation, prompt) {
  const now = new Date().toISOString();
  const clarification = String(prompt || "").trim();
  const pending = Array.isArray(conversation.pendingInterrupts) ? conversation.pendingInterrupts : [];
  const lastUserMessage = [...(conversation.messages || [])]
    .reverse()
    .find((message) => message?.role === "user");
  if (clarification && String(lastUserMessage?.content || "").trim() !== clarification) {
    conversation.messages.push({ role: "user", content: clarification, createdAt: now, interrupt: true });
  }
  const lastPending = pending[pending.length - 1];
  if (clarification && String(lastPending?.content || "").trim() !== clarification) {
    pending.push({ content: clarification, createdAt: now });
  }
  conversation.pendingInterrupts = pending.slice(-10);
  conversation.updatedAt = now;
}

export function takeRunningClarifications(conversation) {
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
  const label = browserOnly ? "🌐 Браузер" : "⏳ Выполняю задачу";
  return `${label}... tool-call ${logs.length}\n\n${summarizeForLog(task, 240)}`;
}

export function shouldAutoRunCodeTask(prompt) {
  const text = String(prompt || "").trim();
  if (!text || text === "/code" || text.startsWith("/code ") || text.startsWith("/skill ")) return false;
  const normalized = text.toLowerCase();
  const hasAny = (terms) => terms.some((term) => normalized.includes(term));

  if (/видишь[^?]*папк/u.test(normalized)) return true;
  if (/(?:текущ|наш|эт)[а-я]*\s+(?:проект|репозитор|папк|файл)/u.test(normalized)) return true;
  if (/(?:наш[а-я]*|эт[а-я]*|текущ[а-я]*)\s+(?:программ|приложени)[а-я]*/u.test(normalized)) return true;
  if (/(?:дум[а-я]*|улучш[а-я]*|рекоменд[а-я]*|посовет[а-я]*)[^.!?]{0,80}(?:проект|репозитор)|(?:проект|репозитор)[^.!?]{0,80}(?:улучш|рекоменд|посовет)/u.test(normalized)) return true;

  if (/^(как|что|почему|зачем|объясни|расскажи|покажи пример|можешь объяснить)\b/u.test(normalized)) {
    return false;
  }
  if (/^(how|what|why|explain|tell me|can you explain)\b/u.test(normalized)) {
    return false;
  }

  const directAction =
    hasAny(["изучи", "проанализируй", "проанализировать", "оцени", "оценить", "добавь", "добавить", "сделай", "сделать", "измени", "изменить", "исправь", "исправить", "почини", "починить", "обнови", "обновить", "удали", "удалить", "переименуй", "переименовать", "реализуй", "реализовать", "напиши", "написать", "создай", "создать", "встрой", "встраивай", "встроить", "подключи", "подключить", "проверь", "проверить", "запусти", "запустить", "собери", "собрать", "протестируй", "протестировать", "переведи", "перевести"])
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
