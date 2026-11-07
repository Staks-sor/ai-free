import fs from 'fs';
import os from 'os';
import path from 'path';
// Прототип OpenAI-совместимого /v1/chat/completions.
//
// Поддерживает:
//   - POST /v1/chat/completions с body { model, messages, stream:true/false }
//   - GET  /v1/models
//
// НЕ поддерживает (пока):
//   - tools / function calling (TODO)
//   - logprobs, n>1, seed, и прочие OpenAI-параметры
//   - provider-specific API keys are checked in api/server.mjs and window-app/server.mjs
//
// Маршрутизация: model имя → провайдер (см. models.mjs).
//   - Qwen: создаём чат по запросу (sessionId не персистится между вызовами API!),
//           отправляем последнее user-сообщение, ждём полный ответ.
//   - DeepSeek: аналогично — каждый запрос = свежий чат.
//
// Это значит: внешний клиент должен слать ВСЮ историю в body.messages, чтобы
// модель имела контекст. Сервер не помнит ничего между запросами (stateless).
// Это OpenAI-совместимое поведение — у них тоже stateless.

import { findModel, modelsList } from "./models.mjs";
import { readQwenAuth, qwenCookieHeaderFromArray } from "../src/providers/qwen/auth-files.mjs";
import { QWEN_AUTH_FILE } from "../src/providers/qwen/config.mjs";
import { QwenChatClient } from "../src/providers/qwen/client.mjs";
import { getQwenLiveCatalogOverride } from "../src/providers/qwen/model-sync.mjs";
import { DEFAULT_AUTH_FILE } from "../src/config.mjs";
import { readSavedAuth } from "../src/auth/files.mjs";
import { DeepSeekChatClient } from "../src/providers/deepseek/client.mjs";
import { closingFenceIndex, extractBareToolCalls, formatCompactTools, normalizeToolCallsForSchemas, parseModelToolCalls, repairToolCallJson } from "./tool-calls.mjs";
import { repairToolCallJsonWithLlm } from "./tool-call-llm-repair.mjs";
import { createThinkTagFilter, createToolErrorChipFilter, stripThinkBlocks, stripToolErrorChips } from "./think-filter.mjs";
import { readChatGPTAuth } from "../src/providers/chatgpt/auth-files.mjs";
import { getAvailableAccount, hasAvailableAccounts, markAccountCooldown, markRateLimited, markInvalid, markQwenAuthFailure } from "../src/providers/qwen/account-store.mjs";
import { startQwenPoolPunishCooldown } from "../src/providers/qwen/request-pacing.mjs";
import { resolveAccountForUser } from "../src/providers/qwen/session-router.mjs";
import { CHATGPT_AUTH_FILE } from "../src/providers/chatgpt/config.mjs";
import { ChatGPTChatClient } from "../src/providers/chatgpt/client.mjs";
import { createFileLogger } from "../src/logging/logger.mjs";
import { runWithEmptyStreamRetry } from "./stream-retry.mjs";

// parseModelToolCalls с предварительной зачисткой литеральных <think>-блоков:
// деградировавший Qwen кладёт reasoning (с черновиками tool-call JSON)
// прямо в текстовый канал — без зачистки детектор выдёргивает черновики
// как реальные вызовы ("Tool X does not exists" каскад).
export function parseModelToolCallsSafe(text) {
  return parseModelToolCalls(stripToolErrorChips(stripThinkBlocks(text)));
}

const compatLogger = createFileLogger({ component: "openai-handler" });

// Тройной бэктик для вставки в template literals без raw-экранирования.
const F = "\u0060\u0060\u0060";

// Ленивый singleton Qwen-клиента — переиспользуем через все вызовы API.
const qwenClients = new Map(); // accountId -> client
// Ленивый singleton DeepSeek-клиента — переиспользуем через все вызовы API.
let deepseekClient = null;
function isQwenAuthErrorByMessage(error) {
  return /unauthorized|not.?logged|login required|token.?expired|session.?expired|invalid.?token|sign.?in/i.test(String(error?.message || ""));
}

function isQwenRateLimitError(error) {
  const msg = String(error?.message || "");
  return /rate.?limit|too many requests|429|quota|daily.?limit|free.?tier|guest.?chat.?limit|reached.?the.?(guest|daily|free)|out.?of.?limit|Вы достигли (дневного )?лимита|достигли лимита/i.test(msg);
}

// Часы cooldown из тела ошибки провайдера (FreeQwenAPI: errorBody.num).
function qwenRateLimitHours(error) {
  const inline = String(error?.message || "").match(/"num"\s*:\s*(\d+(?:\.\d+)?)/);
  if (inline) {
    const n = Number(inline[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 24;
}

// Единая точка маркировки pool-аккаунта по ошибке апстрима (стрим и non-stream).
// Ошибки, при которых имеет смысл попробовать ДРУГОЙ аккаунт сразу:
// auth-сбой и rate-limit. Сетевые/антибот — не переключаем (серверная сторона).
function isAccountSwitchEligibleError(error) {
  if (isQwenAuthErrorByMessage(error)) return true;
  if (isQwenRateLimitError(error)) return true;
  // Baxia punish карает профиль аккаунта (per-account кулдаун) — запрос
  // переносим на другой аккаунт пула, а не валим наружу (2026-09-15).
  if (error?.code === "QWEN_ANTIBOT_PUNISH") return true;
  const msg = String(error?.message || "");
  if (/empty.?upstream.?stream|no response content before timeout/i.test(msg)) return true;
  return false;
}

function markQwenAccountOnUpstreamError(accountId, error) {
  if (!accountId || accountId === 'default') return;
  try {
    if (isQwenAuthErrorByMessage(error)) {
      // 401 при живом JWT = риск-флаг провайдера (RGV587-класс): кулдаун
      // вместо invalid, аккаунт вернётся сам. Просроченный JWT -> invalid.
      markQwenAuthFailure(accountId, { cooldownMs: 6 * 3600 * 1000 });
      return;
    }
    if (isQwenRateLimitError(error)) {
      markRateLimited(accountId, qwenRateLimitHours(error));
      return;
    }
    if (error?.code === "QWEN_ANTIBOT_PUNISH") {
      markAccountCooldown(accountId, error.cooldownMs || 600_000);
    }
  } catch (e) {
    // Маркировка — вспомогательная операция: сбой записи accounts.json
    // не должен ломать отправку ошибки клиенту.
    console.warn(`[API][qwen-account] failed to mark ${accountId}: ${e.message}`);
  }
}

// Следующий доступный pool-аккаунт, исключая уже пробованные.
// null — исчерпаны (или пул не используется).
async function nextPoolAccountExcluding(triedIds) {
  const { hasAvailableAccounts, getAvailableAccount } = await import("../src/providers/qwen/account-store.mjs");
  if (!hasAvailableAccounts()) return null;
  for (let i = 0; i < 32; i += 1) {
    const acc = await getAvailableAccount();
    if (!acc) return null;
    if (!triedIds.has(acc.id)) return acc;
  }
  return null;
}

// Автологин умершего pool-аккаунта (logins.txt: `email password`).
// Гейты: QWEN_AUTOLOGIN != 0; один прогон на аккаунт на процесс; пароль
// найден. Headless по умолчанию (QWEN_AUTOLOGIN_HEADLESS=0 — окно видно).
// Возвращает true при успехе; любая неудача — false (ротация продолжается).
async function tryQwenAutoLogin(accountId, { reason = "" } = {}) {
  if (process.env.QWEN_AUTOLOGIN === "0") return false;
  try {
    const { getAccountAnyStatus } = await import("../src/providers/qwen/account-store.mjs");
    const { autoLoginQwenAccount } = await import("../src/providers/qwen/auto-login.mjs");
    const account = getAccountAnyStatus(accountId);
    if (!account) return false;
    console.log(`🤖 [API][qwen-account] ${accountId}: пытаюсь автологин (${reason})`);
    const headless = !/^(0|false|no|off)$/i.test(String(process.env.QWEN_AUTOLOGIN_HEADLESS ?? "1"));
    await autoLoginQwenAccount(account, { headless });
    console.log(`✅ [API][qwen-account] ${accountId}: автологин успешен — пул пополнен`);
    return true;
  } catch (err) {
    console.warn(`⚠️ [API][qwen-account] ${accountId}: автологин не прошёл (${err?.message?.slice(0, 120)})`);
    return false;
  }
}

// Автологин ЛЮБОГО мёртвого слота с паролем — когда пул исчерпан на этапе
// выбора аккаунта (последняя попытка до ухода на default и ручного окна).
async function tryQwenAutoLoginAnyDeadAccount({ reason = "" } = {}) {
  if (process.env.QWEN_AUTOLOGIN === "0") return false;
  try {
    const { loadAccounts } = await import("../src/providers/qwen/account-store.mjs");
    const { resolveQwenAutoLogin, loadQwenLogins } = await import("../src/providers/qwen/auto-login.mjs");
    const logins = loadQwenLogins();
    if (!logins || !logins.size) return false;
    // Сначала честно мёртвые (invalid), потом кулдаунные — invalid вернутся
    // в ротацию сразу, кулдаунные только после сброса resetAt.
    const all = loadAccounts();
    const dead = all.filter((a) => a?.invalid);
    const cooled = all.filter((a) => !a?.invalid);
    for (const account of [...dead, ...cooled]) {
      const plan = resolveQwenAutoLogin({ account, logins, enabled: true });
      if (!plan || !plan.allowed) continue;
      const ok = await tryQwenAutoLogin(account.id, { reason: `${reason} → ${account.id}` });
      if (ok) return true;
    }
    return false;
  } catch (err) {
    console.warn(`⚠️ [API][qwen-account] автологин мёртвых слотов не прошёл: ${err?.message?.slice(0, 120)}`);
    return false;
  }
}

async function getQwenClientForAccount(accountId, { allowRefresh = true } = {}) {
  if (!accountId) accountId = 'default';
  if (qwenClients.has(accountId)) return qwenClients.get(accountId);
  let auth = readQwenAuth(QWEN_AUTH_FILE);
  if (accountId !== 'default') {
    const { getAccountById } = await import("../src/providers/qwen/account-store.mjs");
    const acc = getAccountById(accountId);
    if (!acc?.token) throw new Error(`Account ${accountId} not found or missing token`);
    auth = { token: acc.token, cookieHeader: acc.cookieHeader };
  }
  if (!auth?.token && allowRefresh) {
    const { getQwenAuthManager } = await import("../src/providers/qwen/auth-manager.mjs");
    auth = await getQwenAuthManager().refresh({ forceVisible: false });
  }
  if (!auth?.token) {
    throw new Error(
      "Qwen не подключён. Запусти: npm run login-qwen (или npm run welcome)",
    );
  }
  const client = new QwenChatClient({
    token: auth.token,
    cookieHeader: auth.cookieHeader,
    accountId,
    debug: Boolean(process.env.API_DEBUG),
  });
  qwenClients.set(accountId, client);
  return client;
}

async function getDeepSeekClient() {
  if (deepseekClient) return deepseekClient;
  const auth = readSavedAuth(DEFAULT_AUTH_FILE);
  if (!auth?.token || !auth?.cookieHeader) {
    throw new Error("DeepSeek не подключён. Запусти: npm run login");
  }
  deepseekClient = new DeepSeekChatClient({
    token: auth.token,
    cookieHeader: auth.cookieHeader,
    hifLeim: auth.hifLeim,
    debug: Boolean(process.env.API_DEBUG),
  });
  return deepseekClient;
}

let chatgptClient = null;
async function getChatGPTClient() {
  if (chatgptClient) return chatgptClient;
  const auth = readChatGPTAuth(CHATGPT_AUTH_FILE);
  if (!auth?.accessToken) {
    throw new Error("ChatGPT не подключён. Импортируйте сессию или запустите npm run login-chatgpt");
  }
  chatgptClient = new ChatGPTChatClient({
    accessToken: auth.accessToken,
    cookies: auth.cookies,
    cookieHeader: auth.cookieHeader,
    userAgent: auth.userAgent,
    debug: Boolean(process.env.API_DEBUG),
  });
  return chatgptClient;
}

export async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/v1/models") {
    const provider = req.openAICompatProvider || null;
    const qwen = provider === "qwen" ? await getQwenLiveCatalogOverride() : null;
    const list = modelsList(qwen ? { qwen } : {});
    if (!provider) return sendJson(res, list);
    return sendJson(res, {
      ...list,
      data: list.data.filter((model) => model.owned_by === provider),
    });
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    return handleChatCompletions(req, res);
  }

  if (req.method === "POST" && url.pathname === "/v1/responses") {
    return handleResponses(req, res);
  }

  if (req.method === "POST" && url.pathname === "/v1/messages") {
    return handleAnthropicMessages(req, res);
  }

  if (req.method === "GET" && url.pathname === "/") {
    return sendJson(res, {
      name: "AI Free openai-compat",
      version: "0.1.0-prototype",
      endpoints: ["GET /v1/models", "POST /v1/chat/completions", "POST /v1/responses", "POST /v1/messages"],
      docs: "see README.md in api/",
    });
  }

  res.statusCode = 404;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: { message: "Not found", type: "not_found_error" } }));
}

// Единая точка выбора pool-аккаунта для запроса (экспортировано для тестов).
// Пул непуст → обычный выбор (TG-привязка/round-robin). Пул пуст → попытка
// автологина мёртвого слота с паролем; не вышло → 'default'.
export async function pickQwenAccountForRequest({ headers = {} } = {}) {
  if (!hasAvailableAccounts()) {
    const rescued = await tryQwenAutoLoginAnyDeadAccount({ reason: "pool exhausted at request routing" });
    if (!rescued) return "default";
  }
  const telegramUserId = headers['x-telegram-user-id'] || headers['x-chat-id'] || null;
  if (telegramUserId) {
    const acc = resolveAccountForUser(telegramUserId);
    if (acc) return acc.id;
  }
  const acc = await getAvailableAccount();
  return acc ? acc.id : "default";
}

// Фабрика refreshClient для стрим-пути pool-аккаунта. Инцидент 03.10:
// маркировка ДО попытки refresh сжигала пул на естественных часовых exp.
// Теперь: успешный silent refresh → БЕЗ наказания; провал → маркировка+throw.
// Экспортировано для теста qwen-refresh-no-penalty.
export function makeQwenAccountRefreshClient(qwenAccountId, { refreshFromProfile = null } = {}) {
  return async (error) => {
    const { isQwenAuthError } = await import("../src/providers/qwen/auth-manager.mjs");
    if (!isQwenAuthError(error)) throw error;
    qwenClients.delete(qwenAccountId);
    if (qwenAccountId !== "default") {
      try {
        const refresher = refreshFromProfile
          || (await import("../src/providers/qwen/browser-login.mjs")).refreshQwenAccountAuthFromProfile;
        const fresh = await refresher(qwenAccountId);
        const newClient = new QwenChatClient({
          token: fresh.token,
          cookieHeader: qwenCookieHeaderFromArray(fresh.cookies),
          accountId: qwenAccountId,
          debug: Boolean(process.env.API_DEBUG),
        });
        qwenClients.set(qwenAccountId, newClient);
        console.log(`🔄 Qwen acc ${qwenAccountId}: JWT тихо обновлён из профиля (1h access-token era).`);
        return newClient;
      } catch (refreshError) {
        console.warn(`[API][qwen-account] silent refresh failed (${refreshError.message}) — ротация на следующий`);
        markQwenAccountOnUpstreamError(qwenAccountId, error);
        throw error;
      }
    }
    const { getQwenAuthManager } = await import("../src/providers/qwen/auth-manager.mjs");
    const fresh = await getQwenAuthManager().refresh({ forceVisible: false });
    const newClient = new QwenChatClient({
      token: fresh.token,
      cookieHeader: fresh.cookieHeader,
      accountId: qwenAccountId,
      debug: Boolean(process.env.API_DEBUG),
    });
    qwenClients.set(qwenAccountId, newClient);
    return newClient;
  };
}

async function handleChatCompletions(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    return sendError(res, 400, `Invalid JSON: ${e.message}`);
  }

  const modelName = body?.model;
  if (!modelName) return sendError(res, 400, "Missing 'model' field");

  console.log(`[API] POST /v1/chat/completions (model: ${modelName}, stream: ${Boolean(body.stream)}, tools: ${body.tools ? body.tools.length : 0})`);

  let mapping = findModel(modelName);
  if (req.openAICompatProvider === "qwen") {
    const liveQwen = await getQwenLiveCatalogOverride();
    if (liveQwen) {
      // Fast-варианты («qwen3.8-max-fast») в живом каталоге отсутствуют —
      // валидируем базовое имя и гасим reasoning.
      const { base, fast } = stripFastModelSuffix(modelName);
      const liveModel = liveQwen.models.find((model) => model.id === base);
      if (!liveModel) {
        return sendError(res, 404, `Qwen model '${base}' is not available for the current account. Refresh /v1/models and select an active model.`);
      }
      mapping = {
        name: modelName,
        provider: "qwen",
        model: liveModel.id,
        label: liveModel.label,
        reasoning: fast ? false : liveModel.reasoning === true,
        vision: liveModel.vision === true,
      };
    }
  }
  if (!mapping) return sendError(res, 404, `Unknown model: ${modelName}`);
  if (req.openAICompatProvider && mapping.provider !== req.openAICompatProvider) {
    return sendError(
      res,
      403,
      `API key for ${req.openAICompatProvider} cannot be used with ${mapping.provider} model '${modelName}'`,
    );
  }

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length) return sendError(res, 400, "Missing 'messages' array");
  compatLogger.info("api.chat.request", {
    provider: mapping.provider,
    model: modelName,
    stream: body.stream === true,
    messageCount: messages.length,
    messageChars: countMessageCharacters(messages),
    toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
  });

  const basePrompt = buildPromptFromChatBody(
    { ...body, tools: toolsForModelPrompt(body.tools) },
    modelName,
    mapping,
  );
  const search = requestSearchEnabled(body);
  const prompt = search ? withWebSearchInstruction(basePrompt) : basePrompt;
  const thinking = resolveAdaptiveThinking({
    thinking: requestThinkingEnabled(body, mapping),
    toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
    messageCount: messages.length,
  });
  const images = extractOpenAIChatImages(messages);

  if (images.length && mapping.provider === "qwen") {
    return sendError(
      res,
      400,
      "Qwen image upload is not supported by the current web transport. Select DeepSeek V4 Vision or ChatGPT so the image is actually processed.",
    );
  }

  let qwenAccountId = 'default';
  if (mapping.provider === "qwen") {
    qwenAccountId = await pickQwenAccountForRequest({ headers: req.headers });
  }
  if (mapping.provider === "qwen") {
    console.log(`[API][qwen-account] ${qwenAccountId === 'default' ? 'default (auth.json)' : qwenAccountId}`);
  }

  try {
    if (mapping.provider === "qwen") {
      const runQwen = async (client, { accountAttempt = 1 } = {}) => {
        if (body.stream === true) {
          return handleQwenStream(client, null, prompt, modelName, mapping.model, res, {
            accountId: qwenAccountId,
            thinking,
            search,
            tools: body.tools,
            createChat: (currentClient) => currentClient.createChat({ model: mapping.model, title: "API request" }),
            refreshClient: makeQwenAccountRefreshClient(qwenAccountId),
          });
        }
        // Инцидент 03.10 «субагенты невидимы»: не-стрим путь (субагенты
        // Hermes, stream:false) не писал таймингов — в консоли видны только
        // createChat chat_id и тишина. Теперь те же stages, что у стрима.
        // accountAttempt — параметром (не из замыкания: объявлен в цикле
        // ротации ниже; инцидент 18:14 «accountAttempt is not defined»).
        const nonStreamRequestId = `qwen_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        logQwenTiming(nonStreamRequestId, "create_chat_start", { account: qwenAccountId, attempt: accountAttempt });
        const chatId = await client.createChat({ model: mapping.model, title: "API request" });
        logQwenTiming(nonStreamRequestId, "create_chat_done", { attempt: accountAttempt, create_chat_ms: 0 });
        logQwenTiming(nonStreamRequestId, "completion_start", { attempt: accountAttempt });
        const result = await client.complete({ chatId, prompt, thinking, search, model: mapping.model });
        logQwenTiming(nonStreamRequestId, "completion_done", {
          attempt: accountAttempt,
          completion_ms: 0,
          text_chars: String(result?.text || "").length,
        });
        // Квота аккаунта в тексте ответа (инцидент 2026-10-12): daily limit
        // приходит HTTP 200 обычным контентом — рвём ход синтетической
        // rate-limit ошибкой, чтобы сработала account-ротация (24h-кулдаун
        // → следующий аккаунт пула), а не выдача лимита клиенту «как ответ».
        const nonStreamQuotaError = quotaLimitErrorFromText(result?.text);
        if (nonStreamQuotaError) {
          logQwenTiming(nonStreamRequestId, "quota_limit_detected", { attempt: accountAttempt });
          throw nonStreamQuotaError;
        }
        return sendJson(res, toOpenAIResponse(modelName, result.text, body.tools));
      };

      // Retry-цикл по pool-аккаунтам (как retryAfterAccountSwitch FreeQwenAPI):
      // 401/429/rate-limit -> маркируем аккаунт -> берём следующий -> новый чат.
      // IP-punish breaker: второй подряд Baxia-punish на разных аккаунтах =
      // бан по IP, не по профилю — стоп ротации, пулевый кулдаун, честная
      // ошибка (ротация в шторм только сжигает пул: инцидент 2026-09-16).
      const triedAccountIds = new Set();
      let currentAccountId = qwenAccountId;
      let punishErrorsInARow = 0;
      for (let accountAttempt = 0; accountAttempt < 3; accountAttempt += 1) {
        let client = await getQwenClientForAccount(currentAccountId);
        try {
          const result = await runQwen(client, { accountAttempt: accountAttempt + 1 });
          punishErrorsInARow = 0;
          return result;
        } catch (e) {
          markQwenAccountOnUpstreamError(currentAccountId, e);
          const { isQwenAuthError } = await import("../src/providers/qwen/auth-manager.mjs");
          const accountSwitchEligible = isAccountSwitchEligibleError(e);
          if (e?.code === "QWEN_ANTIBOT_PUNISH") {
            punishErrorsInARow += 1;
            if (punishErrorsInARow >= 2) {
              const poolMs = startQwenPoolPunishCooldown();
              console.warn(`[API][qwen-account] Baxia punish на ${punishErrorsInARow} аккаунтах подряд — вероятен IP-level бан, пулевый кулдаун ${Math.round(poolMs / 1000)}s, ротация остановлена`);
              const poolErr = new Error(
                `Qwen Baxia antibot punish на нескольких аккаунтах подряд (вероятно IP-level). Пул в кулдауне ~${Math.round(poolMs / 1000)}s. Решите капчу в окне браузера ai-free, подождите или снизьте частоту (QWEN_COMPLETION_MIN_INTERVAL_MS).`,
              );
              poolErr.code = "QWEN_ANTIBOT_PUNISH";
              poolErr.cooldownMs = poolMs;
              throw poolErr;
            }
          } else {
            punishErrorsInARow = 0;
          }
          // Default-путь: старое поведение — refresh auth.json и один повтор.
          if (currentAccountId === 'default') {
            if (!isQwenAuthError(e)) throw e;
            const { getQwenAuthManager } = await import("../src/providers/qwen/auth-manager.mjs");
            qwenClients.delete('default');
            const fresh = await getQwenAuthManager().refresh({ forceVisible: false });
            client = new QwenChatClient({
              token: fresh.token,
              cookieHeader: fresh.cookieHeader,
              debug: Boolean(process.env.API_DEBUG),
            });
            qwenClients.set('default', client);
            return await runQwen(client);
          }
          if (!accountSwitchEligible || accountAttempt >= 2) throw e;
          const next = await nextPoolAccountExcluding(triedAccountIds);
          if (!next) {
            // Последний шанс: автологин умершего аккаунта (если есть пароль
            // в logins.txt и QWEN_AUTOLOGIN != 0). Один прогон на процесс.
            const relogged = await tryQwenAutoLogin(currentAccountId, {
              reason: `rotation exhausted (${e.message.slice(0, 60)})`,
            });
            if (relogged) {
              triedAccountIds.add(currentAccountId);
              qwenClients.delete(currentAccountId);
              // остаёмся на том же аккаунте — следующий attempt пойдёт с живым слотом
              console.log(`[API][qwen-account] ${currentAccountId}: автологин прошёл, продолжаем на нём`);
            } else {
              throw e;
            }
          } else {
            triedAccountIds.add(currentAccountId);
            console.log(`[API][qwen-account] ${currentAccountId} failed (${e.message.slice(0, 80)}), switching to ${next.id}`);
            qwenClients.delete(currentAccountId);
            currentAccountId = next.id;
          }
        }
      }
    }
    if (mapping.provider === "deepseek") {
      const client = await getDeepSeekClient();
      // DeepSeek: создаём сессию и отправляем completion.
      const sessionId = await client.createSession();
      const refFileIds = [];
      for (const image of images) {
        refFileIds.push(await client.uploadFile(
          Buffer.from(image.dataBase64, "base64"),
          image.mimeType,
          image.name,
          { chatSessionId: sessionId },
        ));
      }
      const deepSeekModel = refFileIds.length ? "vision" : mapping.model;

      if (body.stream === true) {
        return handleDeepSeekStream(client, sessionId, prompt, modelName, deepSeekModel, res, {
          thinking: refFileIds.length ? false : thinking,
          search: refFileIds.length ? false : search,
          tools: body.tools,
          refFileIds,
        });
      }

      const result = await client.complete({
        sessionId,
        prompt,
        modelType: deepSeekModel,
        thinkingEnabled: refFileIds.length ? false : thinking,
        searchEnabled: refFileIds.length ? false : search,
        refFileIds,
      });
      return sendJson(res, toOpenAIResponse(modelName, result.text, body.tools));
    }
    if (mapping.provider === "chatgpt") {
      const client = await getChatGPTClient();
      if (body.stream === true) {
        return handleChatGPTStream(client, prompt, modelName, mapping.model, res, { tools: body.tools });
      }
      const result = await client.complete({
        prompt,
        model: mapping.model,
        images,
      });
      return sendJson(res, toOpenAIResponse(modelName, result.text, body.tools));
    }
    return sendError(res, 500, `Unknown provider: ${mapping.provider}`);
  } catch (e) {
    compatLogger.error("api.chat.upstream_error", e, {
      provider: mapping.provider,
      model: modelName,
      stream: body.stream === true,
    });
    console.error("[API] Upstream error:", e.message);
    return sendError(res, 500, humanizeUpstreamError(e.message));
  }
}

function countMessageCharacters(messages) {
  return messages.reduce((total, message) => {
    if (typeof message?.content === "string") return total + message.content.length;
    if (!Array.isArray(message?.content)) return total;
    return total + message.content.reduce((sum, part) => (
      sum + (typeof part?.text === "string" ? part.text.length : 0)
    ), 0);
  }, 0);
}

function withWebSearchInstruction(prompt) {
  return [
    "[SYSTEM]: Web search is enabled for this request. Use the provider web search for current, latest, news, price, schedule, law, or other time-sensitive questions. Do not say you have no internet access when web search results are available.",
    "",
    prompt,
  ].join("\n");
}

export function buildPromptFromChatBody(body, modelName, mapping) {
  // OpenAI присылает ВСЮ историю каждый раз. Мы её сжимаем в один prompt —
  // конкатенируем с лейблами ролей. Это упрощение прототипа; для качества контекста
  // потом сделаем proper multi-turn через persistent sessionId + parent_id chain.
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  let prompt = "";
  let promptLengthAfterTools = 0;
  if (body.tools && body.tools.length > 0) {
    // DeepSeek-Reasoner (R1) и Qwen QwQ часто игнорируют мягкие инструкции —
    // вставляют свои bash-команды, придуманный синтаксис, или прячут tool-вызовы
    // в <think>. Поэтому промпт жёсткий: positive + negative few-shot,
    // запрет <think>, явное упоминание модели если она reasoning-class.
    const isReasoner =
      /reason|r1|qwq|expert/i.test(String(modelName)) ||
      mapping.model === "expert";
    const reasonerNote = isReasoner
      ? `
NOTE FOR REASONING MODELS (R1 / QwQ / Reasoner):
- Do NOT wrap the final answer in <think>…</think>. After your reasoning, your
  final output MUST be either plain text OR a ${F}tool_calls${F} block.
`
      : "";

    // Reasoning-модели Qwen (qwen3-max и др.) видят список тулов и пытаются
    // вызывать их своим ВНУТРЕННИМ tool-call механизмом прямо во время
    // thinking-фазы — бэкенд отвечает «Tool X does not exists» и модель
    // каскадит по всем именам (execute_code, write_file, terminal, …;
    // воспроизведено в нативной веб-морде 2026-08-21). Запрет обязателен
    // для ЛЮБОЙ модели с тулами, не только для reasoner-имён.
    const nativeCallBan = `
CRITICAL — HOW TOOLS ARE EXECUTED HERE:
- This chat has NO native/internal tool execution. The ONLY way to run a tool
  is the ${F}tool_calls${F} markdown block in your FINAL visible answer.
- NEVER attempt tool calls during your thinking/reasoning phase. Do NOT
  invoke, announce or "run" tools (including internal helpers like
  execute_code, write_file, terminal, tool_search, web_search) inside
  thinking — the backend rejects them ("Tool ... does not exists") and the
  whole turn fails. Think in plain text only; emit tool_calls once, at the end.
- If you want to use a tool, your WHOLE final message is one ${F}tool_calls${F} block.
- Never invent shell commands ("rtk cat ...", "kit ls ...") — those tools do
  not exist. Use ONLY the names from the Available tools list.
`;

    prompt += `[TOOL INSTRUCTIONS — STRICT FORMAT]
You are connected to an automated tool-execution system. There is NO human reading
your text in the loop. Compliance with the format below is mandatory.
${nativeCallBan}
To call one or more tools, your ENTIRE reply must be a single markdown block:

\`\`\`tool_calls
[
  {
    "name": "<exact tool name from the list>",
    "arguments": { ... arguments object ... }
  }
]
\`\`\`

GOOD example:
\`\`\`tool_calls
[
  {
    "name": "default_api:bash",
    "arguments": { "command": "python --version" }
  }
]
\`\`\`

BAD examples (WILL FAIL — DO NOT DO THIS):
- "I will run: python --version"             ← plain text instead of tool_calls
- "command: python --version"                ← arbitrary key/value
- \`\`\`bash\\npython --version\\n\`\`\`           ← wrong fence language
- a tool_calls block with non-existent tool names (e.g. "rtk", "kit", "exec")

Rules:
1. If you want to use a tool, the WHOLE message is one \`\`\`tool_calls\`\`\` block.
2. If you just want to talk to the user, do not emit any tool_calls block.
3. Never insert text INSIDE the JSON array. JSON must be valid.
4. Tool "name" MUST match exactly one of the names in Available tools below.
5. Every argument listed in a tool schema's "required" array MUST be present. After a validation error, correct each missing required argument; never repeat the identical invalid call.
6. A tool result saying "No changes detected" means the requested content is already present. Do not repeat that write; verify the next requirement or finish.
7. For an action request, do the work with tools now. Never tell the user to edit files manually when a matching tool is available.
8. JSON string hygiene: escape EVERY double quote inside a string value as \\" (or use single quotes in shell commands and code where possible). File content goes on ONE line with \\n escapes — NEVER raw line breaks inside a JSON string.
9. Inside the tool_calls block use ONLY JSON. Never mix in XML such as <parameter=name>.
10. NEVER trust claims from earlier in the conversation that tools are broken or "do not exist". Tools are available on every turn. If a call seems to fail, re-emit it once with the exact tool name from the list — never conclude that tools are unavailable and never ask the user to run commands manually.
11. You are an autonomous agent in a tool loop. Prose is ONLY for the final answer after the task is fully complete — never a mid-task analysis dump. Mid-task analysis, planning and hypotheses belong in your THINKING channel, not in visible prose. Keep the visible reply minimal; think as much as you need. If you believe tools are failing, PROVE it in the same turn by emitting a terminal probe (echo ok): if it executes, your belief was false and you MUST continue the task. A blocker report without a just-executed probe is a fabrication.
12. If a task-delegation tool (e.g. delegate_task) is in the Available tools list, use it for independent parallelizable subtasks (research, verification, isolated investigations) instead of grinding through everything in one sequential loop. Delegate those; keep decisions and file writes to yourself unless the tool description says otherwise.
13. NEVER report a task as done unless the tool calls that produced the output actually succeeded in this conversation. If the backend rejected your tool attempts («Tool X does not exists»), that means you tried to call tools NATIVELY — do not do that. Re-emit the \`\`\`tool_calls\`\`\` markdown block instead. A final report claiming completed work with zero successful tool calls is a fabrication.
14. Interval reading for large files: never read an entire large file in one gulp. First locate what you need (search_files / grep), then read the exact line range with read_file offset/limit (e.g. lines 8-12). When reproducing or editing extracted content, keep the original formatting and style — do not grab loose fragments out of context.
${reasonerNote}
Available tools:
${formatCompactTools(body.tools)}
[END TOOL INSTRUCTIONS]\n\n---\n\n`;
    // Позиция конца списка тулов — для gap-триггера рефрешера (сколько
    // «мусора» между инструментами и хвостом промпта).
    promptLengthAfterTools = prompt.length;
  }

  const toolNameByCallId = new Map();
  for (const message of messages) {
    for (const call of message?.tool_calls || []) {
      if (call?.id && call?.function?.name) toolNameByCallId.set(call.id, call.function.name);
    }
  }

  let imageNumber = 0;
  prompt += messages
    .map((m) => {
      if (m.role === "tool") {
        const toolName = m.name || toolNameByCallId.get(m.tool_call_id) || "unknown tool";
        return `[TOOL RESULT FOR ${toolName}]:\n${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`;
      }
      if (m.role === "system") {
        return `[SYSTEM]:\n${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`;
      }
      let content = formatOpenAIMessageContent(m.content, () => `openai-image-${++imageNumber}`);
      if (m.role === "assistant" && m.tool_calls) {
        try {
          const tcs = m.tool_calls.map(tc => ({
            name: tc.function.name,
            arguments: typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments
          }));
          content += `\n\`\`\`tool_calls\n${JSON.stringify(tcs, null, 2)}\n\`\`\``;
        } catch(e) {}
      }
      return `[${(m.role || "user").toUpperCase()}]:\n${content}`;
    })
    .join("\n\n---\n\n");

  prompt += `\n\n---\n[CURRENT API ROUTING — AUTHORITATIVE]:
The current OpenAI-compatible request is routed to provider "${mapping.provider}" with requested model id "${modelName}".
If the user asks what model you are, answer using this current requested model id and provider.
Do not copy model identity from earlier assistant messages in the conversation history; those may have come from a different provider before the user switched models.`;
    
  // Ensure the prompt ends with a clear directive if tools are available
  if (body.tools && body.tools.length > 0) {
    prompt += `\n\n---\n[SYSTEM REMINDER]: You MUST use the exact JSON array format wrapped in ${F}tool_calls${F} to call tools. If you output plain bash commands, it will fail.`;

    // Глубокий tool-loop (TG-инцидент 02.10 «Hermes не может подгрузить
    // скиллы», depth 376+): инструкции тулов сидят в голове промпта за
    // 60–100к символов, attention их теряет — модель отвечает прозой и
    // «признаётся», что инструменты не отзываются. Повторяем компактный
    // список тулов + формат в самом хвосте — последнее перед генерацией.
    // Второй триггер (03.10 00:01): свежая сессия, но system-блок раздут —
    // gap от конца списка тулов до хвоста промпта.
    prompt += toolRefresherBlock({
      tools: body.tools,
      messageCount: messages.length,
      promptTailGapChars: prompt.length - promptLengthAfterTools,
    });

    // Транскрипт заканчивается tool-результатом: модель должна продолжить
    // задачу СЕЙЧАС, а не отвечать на последний user-месседж ("retry and
    // continue" она читала как yes/no-вопрос и отвечала голым "Yes").
    const last = messages[messages.length - 1];
    if (last?.role === "tool") {
      prompt += `\n\n---\n[TASK IN PROGRESS — CONTINUE NOW]:\n` +
        `The last message above is a TOOL RESULT, not a user reply. The user's ` +
        `latest instruction still stands and work is unfinished. Continue the ` +
        `task right now: either the next ${F}tool_calls${F} block, or (only if ` +
        `truly everything is done) the final answer to the user's task.\n` +
        `NEVER reply with bare acknowledgements ("Yes", "OK", "Done") — they ` +
        `are not valid answers to the task.`;
    }
  }

  return prompt;
}

const OPENAI_IMAGE_EXTENSIONS = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/bmp", "bmp"],
]);

function parseInlineImageUrl(url) {
  const match = String(url || "").match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) return null;
  const mimeType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const extension = OPENAI_IMAGE_EXTENSIONS.get(mimeType);
  if (!extension) return null;
  const dataBase64 = match[2].replace(/\s+/g, "");
  const size = Buffer.byteLength(dataBase64, "base64");
  if (!size || size > 10 * 1024 * 1024) return null;
  return { mimeType, extension, dataBase64 };
}

export function extractOpenAIChatImages(messages) {
  const images = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!Array.isArray(message?.content)) continue;
    for (const part of message.content) {
      if (part?.type !== "image_url") continue;
      const parsed = parseInlineImageUrl(part.image_url?.url);
      if (!parsed) continue;
      images.push({
        name: `openai-image-${images.length + 1}.${parsed.extension}`,
        mimeType: parsed.mimeType,
        dataBase64: parsed.dataBase64,
      });
    }
  }
  return images;
}

function formatOpenAIMessageContent(content, nextImageName) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content.map((part) => {
    if (typeof part?.text === "string") return part.text;
    if (part?.type === "image_url") {
      const parsed = parseInlineImageUrl(part.image_url?.url);
      if (!parsed) return "[UNSUPPORTED IMAGE]";
      return `[IMAGE: ${nextImageName()}.${parsed.extension}]`;
    }
    return JSON.stringify(part);
  }).filter(Boolean).join("\n");
}

async function handleResponses(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    return sendError(res, 400, `Invalid JSON: ${e.message}`);
  }

  const modelName = body?.model;
  if (!modelName) return sendError(res, 400, "Missing 'model' field");

  console.log(`[API] POST /v1/responses (model: ${modelName}, stream: ${Boolean(body.stream)})`);

  const mapping = findModel(modelName);
  if (!mapping) return sendError(res, 404, `Unknown model: ${modelName}`);
  if (req.openAICompatProvider && mapping.provider !== req.openAICompatProvider) {
    return sendError(
      res,
      403,
      `API key for ${req.openAICompatProvider} cannot be used with ${mapping.provider} model '${modelName}'`,
    );
  }

  const messages = responsesInputToMessages(body.input);
  if (!messages.length) return sendError(res, 400, "Missing 'input' field");
  const options = {
    search: requestSearchEnabled(body),
    thinking: requestThinkingEnabled(body, mapping),
  };
  const basePrompt = buildPromptFromChatBody({ messages, tools: toolsForModelPrompt(body.tools) }, modelName, mapping);
  const prompt = options.search ? withWebSearchInstruction(basePrompt) : basePrompt;

  try {
    const text = await completeText(mapping, prompt, options);
    const response = toResponsesResponse(modelName, text);
    if (body.stream === true) {
      return sendResponsesStream(res, response);
    }
    return sendJson(res, response);
  } catch (e) {
    console.error("[API] Responses upstream error:", e.message);
    if (body.stream === true) return sendResponsesStreamError(res, modelName, e.message);
    return sendError(res, 500, humanizeUpstreamError(e.message));
  }
}

async function handleAnthropicMessages(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    return sendAnthropicError(res, 400, `Invalid JSON: ${e.message}`);
  }

  const modelName = body?.model;
  if (!modelName) return sendAnthropicError(res, 400, "Missing 'model' field");

  console.log(`[API] POST /v1/messages (model: ${modelName}, stream: ${Boolean(body.stream)}, tools: ${body.tools ? body.tools.length : 0})`);

  const mapping = findModel(modelName);
  if (!mapping) return sendAnthropicError(res, 404, `Unknown model: ${modelName}`);
  if (req.openAICompatProvider && mapping.provider !== req.openAICompatProvider) {
    return sendAnthropicError(
      res,
      403,
      `API key for ${req.openAICompatProvider} cannot be used with ${mapping.provider} model '${modelName}'`,
    );
  }

  const messages = anthropicMessagesToChatMessages(body);
  if (!messages.length) return sendAnthropicError(res, 400, "Missing 'messages' array");

  const tools = toolsForModelPrompt(anthropicToolsToOpenAITools(body.tools));
  const options = {
    search: requestSearchEnabled(body),
    thinking: requestThinkingEnabled(body, mapping),
  };
  const basePrompt = buildPromptFromChatBody({ messages, tools }, modelName, mapping);
  const prompt = options.search ? withWebSearchInstruction(basePrompt) : basePrompt;

  try {
    const text = await completeText(mapping, prompt, options);
    const response = toAnthropicMessageResponse(modelName, text);
    if (body.stream === true) {
      return sendAnthropicMessageStream(res, response);
    }
    return sendJson(res, response);
  } catch (e) {
    console.error("[API] Anthropic upstream error:", e.message);
    if (body.stream === true) return sendAnthropicStreamError(res, e.message);
    return sendAnthropicError(res, 500, humanizeUpstreamError(e.message), "api_error");
  }
}

async function completeText(mapping, prompt, { thinking = false, search = false } = {}) {
  if (mapping.provider === "qwen") {
    const runQwen = async (client) => {
      const chatId = await client.createChat({ model: mapping.model, title: "Responses API request" });
      const result = await client.complete({
        chatId,
        prompt,
        thinking,
        search,
        model: mapping.model,
      });
      return result.text || "";
    };

    const qwenAccountId = 'default';
    let client = await getQwenClientForAccount(qwenAccountId);
    try {
      return await runQwen(client);
    } catch (e) {
      const { isQwenAuthError, getQwenAuthManager } = await import("../src/providers/qwen/auth-manager.mjs");
      if (!isQwenAuthError(e)) throw e;
      qwenClients.delete(qwenAccountId);
      const fresh = await getQwenAuthManager().refresh({ forceVisible: false });
      client = new QwenChatClient({
        token: fresh.token,
        cookieHeader: fresh.cookieHeader,
        accountId: qwenAccountId,
        debug: Boolean(process.env.API_DEBUG),
      });
      qwenClients.set(qwenAccountId, client);
      return await runQwen(client);
    }
  }

  if (mapping.provider === "deepseek") {
    const client = await getDeepSeekClient();
    const sessionId = await client.createSession();
    const result = await client.complete({
      sessionId,
      prompt,
      modelType: mapping.model,
      thinkingEnabled: thinking,
      searchEnabled: search,
    });
    return result.text || "";
  }
  if (mapping.provider === "chatgpt") {
    const client = await getChatGPTClient();
    const result = await client.complete({
      prompt,
      model: mapping.model,
    });
    return result.text || "";
  }

  throw new Error(`Unknown provider: ${mapping.provider}`);
}

// Отправка SSE-события в OpenAI формате.
function sendSseEvent(res, data) {
  if (res.destroyed || res.writableEnded) return false;
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  return true;
}

function sendNamedSseEvent(res, event, data) {
  if (res.destroyed || res.writableEnded) return false;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  return true;
}

function writeSseRaw(res, text) {
  if (res.destroyed || res.writableEnded) return false;
  res.write(text);
  return true;
}

function responsesInputToMessages(input) {
  if (typeof input === "string") return [{ role: "user", content: input }];
  if (!Array.isArray(input)) return [];

  return input.map((item) => {
    if (typeof item === "string") return { role: "user", content: item };
    const role = typeof item?.role === "string" ? item.role : "user";
    return { role, content: responsesContentToText(item?.content ?? item) };
  }).filter((message) => String(message.content || "").trim());
}

function responsesContentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.input_text === "string") return part.input_text;
      if (typeof part?.output_text === "string") return part.output_text;
      return JSON.stringify(part);
    }).join("\n");
  }
  if (typeof content?.text === "string") return content.text;
  return JSON.stringify(content ?? "");
}

function toResponsesResponse(model, text) {
  const createdAt = Math.floor(Date.now() / 1000);
  const id = `resp_${createdAt}${Math.random().toString(36).slice(2, 10)}`;
  const itemId = `msg_${Math.random().toString(36).slice(2, 10)}`;
  const parsed = parseModelToolCallsSafe(text);
  const toolOutput = parsed.calls.map((call) => ({
    id: `fc_${Math.random().toString(36).slice(2, 10)}`,
    type: "function_call",
    status: "completed",
    call_id: `call_${Math.random().toString(36).slice(2, 10)}`,
    name: call.name,
    arguments: call.arguments,
  }));
  const messageOutput = parsed.content
    ? [
        {
          id: itemId,
          type: "message",
          status: "completed",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: parsed.content,
              annotations: [],
            },
          ],
        },
      ]
    : [];
  return {
    id,
    object: "response",
    created_at: createdAt,
    status: "completed",
    model,
    output: [...messageOutput, ...toolOutput],
    output_text: parsed.content || "",
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    },
  };
}

function sendResponsesStream(res, response) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const inProgress = { ...response, status: "in_progress", output: [] };

  sendNamedSseEvent(res, "response.created", {
    type: "response.created",
    response: inProgress,
  });
  response.output.forEach((outputItem, outputIndex) => {
    sendNamedSseEvent(res, "response.output_item.added", {
      type: "response.output_item.added",
      output_index: outputIndex,
      item: outputItem.type === "message" ? { ...outputItem, content: [] } : outputItem,
    });

    if (outputItem.type === "message") {
      const contentPart = outputItem.content[0];
      sendNamedSseEvent(res, "response.content_part.added", {
        type: "response.content_part.added",
        item_id: outputItem.id,
        output_index: outputIndex,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      });
      sendNamedSseEvent(res, "response.output_text.delta", {
        type: "response.output_text.delta",
        item_id: outputItem.id,
        output_index: outputIndex,
        content_index: 0,
        delta: contentPart.text,
      });
      sendNamedSseEvent(res, "response.output_text.done", {
        type: "response.output_text.done",
        item_id: outputItem.id,
        output_index: outputIndex,
        content_index: 0,
        text: contentPart.text,
      });
      sendNamedSseEvent(res, "response.content_part.done", {
        type: "response.content_part.done",
        item_id: outputItem.id,
        output_index: outputIndex,
        content_index: 0,
        part: contentPart,
      });
    }

    sendNamedSseEvent(res, "response.output_item.done", {
      type: "response.output_item.done",
      output_index: outputIndex,
      item: outputItem,
    });
  });
  sendNamedSseEvent(res, "response.completed", {
    type: "response.completed",
    response,
  });
  res.end();
}

function sendResponsesStreamError(res, model, rawMessage) {
  const message = humanizeUpstreamError(rawMessage);
  const response = toResponsesResponse(model, "");
  response.status = "failed";
  response.error = { message, type: "server_error", code: "upstream_error" };

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  sendNamedSseEvent(res, "response.failed", {
    type: "response.failed",
    response,
  });
  res.end();
}

// Превращает сырое сообщение об ошибке от апстрима в читабельную фразу.
// Особый случай — chat.deepseek.com отдаёт HTTP 422 с serde-сообщением
// "unknown variant 'X' expected one of 'DEFAULT', 'default', 'expert', 'vision'".
// Это происходит, когда в model_type ушло OpenAI-имя ("deepseek-reasoner")
// вместо допустимого значения. Подсказываем, что обычно лечится обновлением репо.
function humanizeUpstreamError(rawMessage) {
  const msg = String(rawMessage || "");
  if (/quota exceeded|allocated quota|token-limit/i.test(msg)) {
    return (
      "Qwen quota exceeded (Alibaba Cloud). Check limits at chat.qwen.ai or try a smaller model. " +
      `Details: ${msg}`
    );
  }
  if (msg.includes("422") && /unknown variant/i.test(msg)) {
    const match = msg.match(/unknown variant `([^`]+)`/i);
    const bad = match ? match[1] : "?";
    return (
      `Upstream rejected model_type='${bad}'. ` +
      `This usually means api/models.mjs is out of date — ` +
      `'deepseek-reasoner' must map to model: "expert", ` +
      `'deepseek-chat' to model: null. ` +
      `Run 'git pull' and restart the API server. ` +
      `Original error: ${msg}`
    );
  }
  return msg;
}

// SSE-чанк ошибки в OpenAI-совместимом формате.
// Шлём ДВА события подряд:
//   1) chat.completion.chunk c finish_reason="stop" и content-дельтой — клиенты
//      вроде Continue/Cursor дочитают и закроются гладко.
//   2) data: { error: { message, type, code } } — клиенты вроде Kilo Code
//      смотрят именно сюда. error — ОБЪЕКТ (string ломает Zod-схему).
// После — обязательный data: [DONE].
function sendStreamError(res, modelName, rawMessage) {
  if (res.destroyed || res.writableEnded) return;
  const message = humanizeUpstreamError(rawMessage);
  const ts = Math.floor(Date.now() / 1000);
  const id = `chatcmpl-${ts}${Math.random().toString(36).slice(2, 10)}`;

  const chunk = {
    id,
    object: "chat.completion.chunk",
    created: ts,
    model: modelName,
    choices: [
      { index: 0, delta: { content: `\n[Error] ${message}` }, finish_reason: "stop" },
    ],
  };
  sendSseEvent(res, chunk);
  sendSseEvent(res, {
    error: { message, type: "server_error", code: "upstream_error" },
  });
  writeSseRaw(res, "data: [DONE]\n\n");
  if (!res.destroyed && !res.writableEnded) res.end();
}

// Формирует SSE-чанк в OpenAI формате.
function toOpenAIStreamChunk(model, textDelta, isFirst = false) {
  const ts = Math.floor(Date.now() / 1000);
  const chunk = {
    id: `chatcmpl-${ts}${Math.random().toString(36).slice(2, 10)}`,
    object: "chat.completion.chunk",
    created: ts,
    model,
    choices: [{ index: 0, delta: isFirst ? { role: "assistant" } : { content: textDelta } }],
  };
  return chunk;
}

// Обработка streaming-запроса к Qwen.
export async function handleQwenStream(client, chatId, prompt, modelName, model, res, {
  thinking = false,
  search = false,
  createChat = null,
  refreshClient = null,
  tools = [],
  accountId = null,
  getClientForAccount = null,
} = {}) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const requestId = `qwen_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const startedAt = Date.now();
  const parser = new StreamParser(modelName, res, { tools });
  // Деградировавший Qwen шлёт reasoning литеральным текстом с <think>-тегами;
  // внутри — черновики tool-call JSON, которые детектор ловил как реальные
  // вызовы. Фильтр вырезает think-блоки до того, как буфер увидит парсер.
  // Поверх — чипострига: ошибки бэкенда «Tool X does not exists.» утекают
  // в видимый текст и не живут в think-канале, поэтому идут вторым слоем.
  // ПОРЯДОК (инцидент 29.10 11:24): чипы могут идти ПЕРЕД валидным
  // tool_calls-блоком; fabrication-гейт обязан видеть текст ПОСЛЕ
  // чипостриги, иначе топит рабочий вызов → 3 ретрая → заглушка.
  // Цепочка: thinkFilter → chipFilter → fabricationGate → parser.
  let fabricationGate = null;
  const chipFilter = createToolErrorChipFilter({
    onText: (t) => {
      if (fabricationGate && !fabricationGate.fabricated()) {
        const released = fabricationGate.push(t);
        if (released) {
          clientSawText = true;
          parser.onText(released);
        }
      } else if (!fabricationGate) {
        parser.onText(t);
      }
    },
    // 07.11 шторм-детект: каждый вырезанный чип репортится гейту.
    // 4+ без доставленного tool_calls → "storm" → ретрай с наддогом.
    onChip: () => {
      if (fabricationGate) fabricationGate.registerChip();
    },
  });
  const thinkFilter = createThinkTagFilter({ onText: (t) => chipFilter.push(t) });
  // Гейт фабрикации (инциденты 03.10 «Model claims tool failure but no tool
  // calls»): первые символы ответа копятся до отпускания клиенту; если ход
  // начинается с «инструменты недоступны» — дропаем его целиком и ретраим
  // в новом чате с контр-наддогом. До 2 попыток на запрос.
  // Сам объект гейта объявлен выше (chipFilter замыкается на него).
  let fabricationRetries = 0;
  const FABRICATION_MAX_RETRIES = Number(process.env.QWEN_FABRICATION_RETRIES ?? 2);
  let counterNudge = "";
  let sawDelta = false;
  // Инцидент 04.10 12:02: sawDelta — ТРАНСПОРТНЫЙ прогресс (heartbeat молчит,
  // ретраи скипаются). Но гейт фабрикации может проглотить весь ход: клиент
  // ничего не видел, а sawDelta=true. clientSawText — истина только когда
  // текст реально ушёл клиенту (парсеру). Именно он блокирует
  // ретрай/ротацию mid-stream; транспортный sawDelta — только heartbeat.
  let clientSawText = false;
  let firstDeltaAt = 0;
  const heartbeat = setInterval(() => {
    if (!sawDelta) writeSseRaw(res, `: qwen waiting ${elapsedMs(startedAt)}ms\n\n`);
  }, 3_000);
  writeSseRaw(res, `: qwen stream opened ${requestId}\n\n`);

  try {
    let activeClient = client;
    let activeChatId = chatId;
    let lastError = null;
    // Ротация pool-аккаунтов в стрим-пути (паритет с не-стрим циклом ниже).
    // Инцидент 2026-09-25: 401 на create_chat валил стрим сразу, клиент
    // ретраил вручную; не-стрим путь в это время ротировал аккаунты.
    const triedAccountIds = new Set();
    let currentAccountId = accountId;
    let punishErrorsInARow = 0;

    accountRotation: for (let accountAttempt = 0; accountAttempt < 3; accountAttempt += 1) {
      // 2026-09-30 «depth 47+ пустые стримы»: после пустого стрима повторяем
      // с forceContextFile — история уезжает в context-файл, Qwen получает
      // компактный инлайн-запрос. Плавающий лимит ловим по факту ошибки.
      let forceContextFile = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          if (!activeChatId) {
            if (typeof createChat !== "function") throw new Error("Qwen stream requires chatId or createChat callback");
            const createStartedAt = Date.now();
            logQwenTiming(requestId, "create_chat_start", { account: currentAccountId || "default", attempt: attempt + 1, total_ms: elapsedMs(startedAt) });
            activeChatId = await createChat(activeClient);
            logQwenTiming(requestId, "create_chat_done", {
              attempt: attempt + 1,
              create_chat_ms: elapsedMs(createStartedAt),
              total_ms: elapsedMs(startedAt),
            });
          }

          const completionStartedAt = Date.now();
          logQwenTiming(requestId, "completion_start", { attempt: attempt + 1, total_ms: elapsedMs(startedAt) });
          fabricationGate = makeToolFabricationGate();
          await runWithEmptyStreamRetry({
            requireDelta: true,
            operation: ({ onDelta }) => activeClient.complete({
              chatId: activeChatId,
              prompt: prompt + counterNudge,
              thinking,
              search,
              model,
              forceContextFile,
              onText: onDelta,
              // Thinking-дельты (phase:"think") → parser.onThinking →
              // SSE reasoning_content. Фабрикация-гейт и фильтры <think>
              // тут не нужны: это отдельный канал, черновики JSON из
              // reasoning не попадают в content/toolsBuffer.
              onThinking: (t) => parser.onThinking(t),
            }),
            onDelta: (textDelta) => {
              if (!sawDelta) {
                sawDelta = true;
                firstDeltaAt = Date.now();
                logQwenTiming(requestId, "first_delta", {
                  attempt: attempt + 1,
                  ttft_ms: elapsedMs(startedAt),
                  completion_to_first_delta_ms: elapsedMs(completionStartedAt),
                });
              }
              // Дельты идут в thinkFilter → chipFilter → fabricationGate →
              // parser (гейт видит текст ПОСЛЕ чипостриги — инцидент 29.10).
              // При детекте fabrication гейт молчит: клиент не видит прозу,
              // ход ретраится после завершения upstream.
              if (fabricationGate && !fabricationGate.fabricated()) {
                thinkFilter.push(textDelta);
                if (fabricationGate.fabricated()) {
                  logQwenTiming(requestId, "fabrication_detected", { attempt: attempt + 1, total_ms: elapsedMs(startedAt) });
                }
              }
            },
            beforeRetry: async ({ attempt: emptyAttempt, error }) => {
              if (typeof createChat !== "function") throw error;
              logQwenTiming(requestId, "empty_stream_retry", {
                attempt: emptyAttempt,
                total_ms: elapsedMs(startedAt),
              });
              // Пустой стрим на большом промпте — переносим историю в файл.
              forceContextFile = true;
              activeChatId = await createChat(activeClient);
            },
          });
          logQwenTiming(requestId, "completion_done", {
            attempt: attempt + 1,
            completion_ms: elapsedMs(completionStartedAt),
            total_ms: elapsedMs(startedAt),
            first_delta_ms: firstDeltaAt ? firstDeltaAt - startedAt : null,
          });
          // Ход закончился: отпускаем остаток буфера гейта (короткие ответы
          // < окна детекции целиком сидят в буфере). При детекте flush = "".
          // Гейт-остаток — уже чипо- и think-очищенный текст, идёт прямо
          // в парсер (повторная фильтрация исказила бы текст).
          const gateTail = fabricationGate ? fabricationGate.flush() : "";
          if (gateTail) {
            clientSawText = true;
            parser.onText(gateTail);
          }
          // Квота аккаунта в стриме (инцидент 2026-10-12): не «фабрикация»,
          // не ретрай с наддогом — ретраить тот же аккаунт бессмысленно
          // (лимит аккаунтный). Разрываем ход синтетической rate-limit
          // ошибкой → account-ротация (markRateLimited 24h → след. пул).
          if (fabricationGate?.kind() === "quota") {
            const quotaError = quotaLimitErrorFromText(fabricationGate.detectedText()) || new Error("Qwen rate limit (daily limit в контенте ответа)");
            quotaError.code = "QWEN_RATE_LIMIT";
            logQwenTiming(requestId, "quota_limit_detected", { attempt: attempt + 1, total_ms: elapsedMs(startedAt) });
            throw quotaError;
          }
          // Фабрикация «инструменты недоступны»: ход дропнут гейтом (клиент
          // не видел прозу), upstream завершён. Ретраим в новом чате с
          // контр-наддогом — до FABRICATION_MAX_RETRIES раз, потом сдаёмся
          // и пропускаем ответ как есть (последняя попытка без гейта).
          if (fabricationGate?.fabricated() && fabricationRetries < FABRICATION_MAX_RETRIES) {
            fabricationRetries += 1;
            // Наддог зависит от причины: fabrication — «не выдумывай отказ»,
            // storm — «бэкенд отвергает нативные вызовы; тулы живут
            // в markdown-блоке ответа, не в thinking» (07.11, субагент 29-52:
            // 15 чипов → ложный «Задача выполнена»).
            counterNudge = fabricationGate.kind() === "storm"
              ? `\n\n---\n[SYSTEM]: Your previous turn tried to call tools NATIVELY and the backend rejected every attempt («Tool X does not exists» x${fabricationGate.detectedText().match(/(\d+)/)?.[1] ?? "4+"}). Native tool calls DO NOT work here. To call a tool, output a \`\`\`tool_calls\`\`\` markdown block (JSON array) as your ENTIRE visible reply. Never call tools during thinking. If the task is complete, output the final report — but NEVER claim work was done unless the tool calls actually succeeded in this conversation.`
              : `\n\n---\n[SYSTEM]: Your previous reply claimed tools are unavailable. That was FALSE — tools are live. Do NOT write any explanation about tools. Reply ONLY with the \`\`\`tool_calls\`\`\` block (JSON array) for the next action, or the final answer if the task is complete.`;
            logQwenTiming(requestId, "fabrication_retry", { attempt: fabricationRetries, total_ms: elapsedMs(startedAt) });
            activeChatId = null; // новый чат — старое дерево с фабрикацией не переиспользуем
            forceContextFile = false;
            continue; // снова в attempt-цикл (attempt < 3)
          }
          // Последняя попытка или лимит ретраев: если опять фабрикация —
          // пропускаем ответ прозой как есть (гейт уже отдал пустоту,
          // нужно отдать хоть что-то — флешнем буфер как текст).
          if (fabricationGate?.fabricated()) {
            // Гейт молчал весь ход; клиент ничего не получил.
            // Отдаём честную ошибку-заглушку вместо зависания.
            thinkFilter.push("[Инструменты доступны, но модель повторно ответила прозой о недоступности инструментов. Повторите запрос.]");
            fabricationGate = null; // заглушка пошла — больше не фильтруем
          }
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          // Пустой стрим: attempt 0-1 → повтор с forceContextFile (история в
          // файл-вложение), attempt 2 — окончательный throw наружу.
          if (error?.code === "EMPTY_UPSTREAM_STREAM" && attempt < 2) {
            forceContextFile = true;
            activeChatId = null;
            continue;
          }
          if (error?.code === "EMPTY_UPSTREAM_STREAM") throw error;
          // Baxia punish (антибот-капча): кулдаун активен, слепой retry
          // с пересозданием чата только сильнее разгоняет скоринг.
          if (error?.code === "QWEN_ANTIBOT_PUNISH") throw error;
          // Квота аккаунта (daily limit в контенте): silent-refresh бессмысленен
          // (лимит аккаунтный, не auth) — выходим из attempt-цикла с lastError,
          // чтобы сработала account-ротация (throw улетел бы мимо неё клиенту).
          if (error?.code === "QWEN_RATE_LIMIT") break;
          if (clientSawText || attempt >= 1 || typeof refreshClient !== "function") throw error;
          logQwenTiming(requestId, "retry_before_first_delta", {
            attempt: attempt + 1,
            total_ms: elapsedMs(startedAt),
            error: error.message,
          });
          // Silent refresh сам упал (прокси не выдал JWT и т.п.) — НЕ рвём
          // поток: выходим на account-ротацию, она переключит аккаунт.
          // Инцидент 02.10: throw отсюда улетал мимо ротации прямиком клиенту.
          try {
            activeClient = await refreshClient(error);
          } catch (refreshError) {
            console.warn(`[API][qwen-account] stream: silent refresh failed (${refreshError.message}) — пробуем ротацию`);
            lastError = error;
            break;
          }
          activeChatId = null;
        }
      }
      if (!lastError) break accountRotation;

      // --- account-ротация (паритет с не-стрим путём) ---
      // Ротируем только если клиент ещё не видел текст (clientSawText=false):
      // после первого видимого delta перескакивать поздно и видно клиенту.
      // Гейт фабрикации мог проглотить весь ход — тогда ротация безопасна.
      if (currentAccountId && currentAccountId !== "default" && !clientSawText) {
        markQwenAccountOnUpstreamError(currentAccountId, lastError);
        if (lastError?.code === "QWEN_ANTIBOT_PUNISH") {
          punishErrorsInARow += 1;
          if (punishErrorsInARow >= 2) {
            const poolMs = startQwenPoolPunishCooldown();
            console.warn(`[API][qwen-account] stream: Baxia punish на ${punishErrorsInARow} аккаунтах подряд — вероятен IP-level бан, пулевый кулдаун ${Math.round(poolMs / 1000)}s`);
            lastError.cooldownMs = poolMs;
            throw lastError;
          }
        } else {
          punishErrorsInARow = 0;
        }
        const accountSwitchEligible = isAccountSwitchEligibleError(lastError);
        if (!accountSwitchEligible || accountAttempt >= 2) throw lastError;
        const next = await nextPoolAccountExcluding(triedAccountIds);
        if (!next) {
          // Последний шанс стрим-пути (инцидент 03.10: ручное окно логина
          // открылось посреди прод-запроса): автологин умершего аккаунта с
          // паролем из logins.txt, headless. Успех → остаёмся на нём.
          const relogged = await tryQwenAutoLogin(currentAccountId, {
            reason: `stream rotation exhausted (${lastError.message.slice(0, 60)})`,
          });
          if (relogged) {
            triedAccountIds.add(currentAccountId);
            qwenClients.delete(currentAccountId);
            console.log(`[API][qwen-account] stream: ${currentAccountId}: автологин прошёл, продолжаем на нём`);
            continue accountRotation;
          }
          throw lastError;
        }
        triedAccountIds.add(currentAccountId);
        console.log(`[API][qwen-account] stream: ${currentAccountId} failed (${lastError.message.slice(0, 80)}), switching to ${next.id}`);
        qwenClients.delete(currentAccountId);
        // Тестируемость: инъекция фабрики клиентов (в проде — реальная).
        activeClient = typeof getClientForAccount === "function"
          ? await getClientForAccount(next.id)
          : await getQwenClientForAccount(next.id);
        currentAccountId = next.id;
        activeChatId = null;
        continue accountRotation;
      }
      throw lastError;
    }
    clearInterval(heartbeat);
    if (res.destroyed || res.writableEnded) return;
    thinkFilter.flush();
    chipFilter.flush();
    await parser.onEnd();
    writeSseRaw(res, "data: [DONE]\n\n");
    if (!res.destroyed && !res.writableEnded) res.end();
    logQwenTiming(requestId, "stream_done", { total_ms: elapsedMs(startedAt) });
  } catch (e) {
    clearInterval(heartbeat);
    logQwenTiming(requestId, "stream_error", {
      total_ms: elapsedMs(startedAt),
      first_delta_ms: firstDeltaAt ? firstDeltaAt - startedAt : null,
      error: e.message,
    });
    console.error("[API] Qwen stream error:", e.message);
    markQwenAccountOnUpstreamError(accountId, e);
    sendStreamError(res, modelName, e.message);
  }
}

function elapsedMs(startedAt) {
  return Date.now() - startedAt;
}

function logQwenTiming(requestId, stage, fields = {}) {
  const details = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
  console.log(`[API][qwen-timing] request=${requestId} stage=${stage}${details ? ` ${details}` : ""}`);
}

// Обработка streaming-запроса к ChatGPT.
async function handleChatGPTStream(client, prompt, modelName, model, res, { tools = [] } = {}) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const parser = new StreamParser(modelName, res, { tools });
  try {
    await client.complete({
      prompt,
      model,
      onText: (textDelta) => parser.onText(textDelta),
    });
    await parser.onEnd();
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (e) {
    console.error("[API] ChatGPT stream error:", e.message);
    sendStreamError(res, modelName, e.message);
  }
}
// Обработка streaming-запроса к DeepSeek.
async function handleDeepSeekStream(client, sessionId, prompt, modelName, model, res, {
  thinking = false,
  search = false,
  tools = [],
  refFileIds = [],
} = {}) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const parser = new StreamParser(modelName, res, { tools });
  try {
    let activeSessionId = sessionId;
    await runWithEmptyStreamRetry({
      operation: ({ onDelta }) => client.complete({
        sessionId: activeSessionId,
        prompt,
        modelType: model,
        thinkingEnabled: thinking,
        searchEnabled: search,
        refFileIds,
        onText: onDelta,
      }),
      onDelta: (textDelta) => parser.onText(textDelta),
      beforeRetry: async ({ attempt, error }) => {
        compatLogger.warn("api.deepseek.empty_stream_retry", {
          model: modelName,
          attempt,
          reason: error.message,
        });
        activeSessionId = await client.createSession();
      },
    });
    await parser.onEnd();
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (e) {
    console.error("[API] DeepSeek stream error:", e.message);
    sendStreamError(res, modelName, e.message);
  }
}

// Формат OpenAI chat completion response.
function toOpenAIResponse(model, text, tools = []) {
  const ts = Math.floor(Date.now() / 1000);
  
  let tool_calls = undefined;
  let content = text;
  let finish_reason = "stop";

  const parsed = parseModelToolCallsSafe(text);
  const normalized = normalizeToolCallsForSchemas(parsed.calls, tools);
  if (normalized.calls.length) {
    content = parsed.content;
    tool_calls = normalized.calls.map((call) => ({
      id: `call_${Math.random().toString(36).slice(2, 10)}`,
      type: "function",
      function: {
        name: call.name,
        arguments: call.arguments,
      },
    }));
    finish_reason = "tool_calls";
  }

  return {
    id: `chatcmpl-${ts}${Math.random().toString(36).slice(2, 10)}`,
    object: "chat.completion",
    created: ts,
    model,
    choices: [
      {
        index: 0,
        message: { 
          role: "assistant", 
          content,
          ...(tool_calls ? { tool_calls } : {})
        },
        finish_reason,
      },
    ],
    // Реальные usage-метрики у нас не доступны, ставим заглушку.
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

export function toAnthropicMessageResponse(model, text) {
  const parsed = parseModelToolCallsSafe(text);
  const content = [];
  if (parsed.content) {
    content.push({ type: "text", text: parsed.content });
  }
  for (const call of parsed.calls) {
    content.push({
      type: "tool_use",
      id: `toolu_${Math.random().toString(36).slice(2, 12)}`,
      name: call.name,
      input: parseToolArgumentsObject(call.arguments),
    });
  }

  return {
    id: `msg_${Math.floor(Date.now() / 1000)}${Math.random().toString(36).slice(2, 10)}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: parsed.calls.length ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

function parseToolArgumentsObject(value) {
  if (value && typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sendAnthropicMessageStream(res, response) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const started = { ...response, content: [], stop_reason: null, stop_sequence: null };
  sendNamedSseEvent(res, "message_start", {
    type: "message_start",
    message: started,
  });

  response.content.forEach((block, index) => {
    const emptyBlock = block.type === "text"
      ? { type: "text", text: "" }
      : { ...block, input: {} };
    sendNamedSseEvent(res, "content_block_start", {
      type: "content_block_start",
      index,
      content_block: emptyBlock,
    });

    if (block.type === "text") {
      sendNamedSseEvent(res, "content_block_delta", {
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text: block.text },
      });
    } else if (block.type === "tool_use") {
      sendNamedSseEvent(res, "content_block_delta", {
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input || {}) },
      });
    }

    sendNamedSseEvent(res, "content_block_stop", {
      type: "content_block_stop",
      index,
    });
  });

  sendNamedSseEvent(res, "message_delta", {
    type: "message_delta",
    delta: {
      stop_reason: response.stop_reason,
      stop_sequence: response.stop_sequence,
    },
    usage: { output_tokens: 0 },
  });
  sendNamedSseEvent(res, "message_stop", { type: "message_stop" });
  res.end();
}

function sendAnthropicStreamError(res, rawMessage) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  sendNamedSseEvent(res, "error", {
    type: "error",
    error: {
      type: "api_error",
      message: humanizeUpstreamError(rawMessage),
    },
  });
  res.end();
}

function sendAnthropicError(res, status, message, type = "invalid_request_error") {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({
    type: "error",
    error: { type, message },
  }));
}

function sendJson(res, payload, status = 200) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message) {
  sendJson(res, { error: { message, type: "invalid_request_error" } }, status);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

// Fast-суффикс имени модели («qwen3.8-max-fast», «qwen3.7-plus:fast»):
// то же апстрим-ядро, но thinking выключен — зеркалит «Быстрый» режим web-
// морды chat.qwen.ai (feature_config.thinking_enabled=false из капчи F12).
export function stripFastModelSuffix(name) {
  const base = String(name || "");
  const match = base.match(/^(.+?)(?:-fast|:fast)$/i);
  return match ? { base: match[1], fast: true } : { base, fast: false };
}

// Компактный повторитель тулов для хвоста промпта.
// Два триггера (2026-10-02/03 TG-инциденты «Hermes не может подгрузить скиллы»):
//   1. depth: messageCount > QWEN_TOOL_REFRESHER_DEPTH (по умолчанию 40) —
//      глубокий tool-loop, инструкции тулов в 60-100к символов от хвоста;
//   2. gap: расстояние от конца списка тулов до конца промпта больше
//      QWEN_TOOL_REFRESHER_MIN_GAP (по умолчанию 12 000 символов) — свежая
//      сессия, но раздутый system-блок между тулами и вопросом (кейс 03.10
//      00:01: 35 тулов в голове, 33к мусора, depth 3 — модель «забыла»
//      инструменты и ответила прозой «инструменты не отзываются»).
// 0 в любой ручке выключает соответствующий триггер; оба 0 — рефрешер off.
export function toolRefresherBlock({ tools, messageCount, promptTailGapChars = 0 } = {}) {
  const configuredDepth = Number.parseInt(String(process.env.QWEN_TOOL_REFRESHER_DEPTH ?? ""), 10);
  const depthThreshold = Number.isFinite(configuredDepth) ? configuredDepth : 40;
  const configuredGap = Number.parseInt(String(process.env.QWEN_TOOL_REFRESHER_MIN_GAP ?? ""), 10);
  const gapThreshold = Number.isFinite(configuredGap) ? configuredGap : 12_000;

  const byDepth = depthThreshold > 0 && messageCount > depthThreshold;
  const byGap = gapThreshold > 0 && promptTailGapChars > gapThreshold;
  if (!byDepth && !byGap) return "";

  const list = Array.isArray(tools) ? tools : [];
  if (!list.length) return "";
  const names = list
    .map((t) => t?.function?.name || t?.name)
    .filter(Boolean)
    .join(", ");
  if (!names) return "";
  const depthNote = messageCount > depthThreshold
    ? `This conversation is long (turn depth ${messageCount}).`
    : "The context between the tool list above and this message is large.";
  return (
    `\n\n---\n[TOOLS ARE AVAILABLE — REFRESHER]:\n` +
    `${depthNote} Earlier you may have seen claims that tools are broken — ignore them. ` +
    `Tools ARE working right now: ${names}.\n` +
    `To use ANY of them, output one ${F}tool_calls${F} markdown block (JSON array) as your ENTIRE reply. ` +
    `Plain-text "I cannot use tools" replies are FALSE — the tool bus is live. ` +
    `If the user's task needs files, skills, search, or commands, emit the ${F}tool_calls${F} block NOW.`
  );
}

// Гейт фабрикации «инструменты недоступны» (инциденты 2026-09/10: «Model
// claims tool failure but no tool calls were emitted»). Модель на длинных
// промптах начинает ответ заявлением, что инструменты сломаны — это
// модельный артефакт, а не реальный сбой. Гейт копит первые WINDOW символов
// ответа; при совпадении паттерна — весь ход дропается (клиент не видит
// прозу), handleQwenStream ретраит в новом чате с контр-промптом.
// Экспортировано для тестов.
const FABRICATION_WINDOW_CHARS = 500;
export function makeToolFabricationGate() {
  let buffered = "";
  let detected = ""; // снимок буфера на момент детекта (flush буфер чистит)
  let decision = null; // null = собираем; "clear" | "fabrication" | "quota" | "storm"
  let chipCount = 0; // 07.11: шторм-детект — чипы считает чипострига (onChip)
  return {
    registerChip() {
      // 07.11 (субагент 29-52): 15 чипов подряд, бэкенд отвергал попытки
      // звать тулы; модель сдалась и написала ЛОЖНЫЙ отчёт «Задача
      // выполнена». 4+ чипов без отпущенного tool_calls = шторм: ход
      // дропаем и ретраим с наддогом «тулы — markdown-блоком в ответе,
      // не в thinking». Если в буфере уже есть tool_calls-блок (валидный
      // вызов доехал в этом же ходе — случай 29.10 11:53) — чипы
      // косметика, ход не трогаем.
      if (decision === "clear") return;
      if (buffered.includes("```tool_calls")) return;
      chipCount += 1;
      if (chipCount >= 4 && decision === null) {
        decision = "storm";
        detected = `chip storm: ${chipCount} backend «Tool X does not exists» rejections without a delivered tool call`;
      }
    },
    push(textDelta) {
      if (decision === "fabrication" || decision === "quota") return ""; // после детекта — полная тишина
      if (decision === "clear") return textDelta; // проверено — пропускаем
      buffered += String(textDelta || "");
      if (detectQuotaLimitText(buffered)) {
        decision = "quota";
        detected = buffered;
        return "";
      }
      if (detectToolFabrication(buffered)) {
        decision = "fabrication";
        detected = buffered;
        return "";
      }
      if (buffered.length >= FABRICATION_WINDOW_CHARS) {
        decision = "clear";
        const out = buffered;
        buffered = ""; // отдан клиенту — не дублировать во flush
        return out;
      }
      return "";
    },
    flush() {
      // Страховка: шторм прилип, но в буфере доехал валидный tool_calls —
      // ход жив, отпускаем (ложный шторм хуже пропущенного).
      if (decision === "storm" && buffered.includes("```tool_calls")) {
        decision = "clear";
      }
      if (decision === "fabrication" || decision === "quota" || decision === "storm") return "";
      const out = buffered;
      buffered = "";
      return out;
    },
    fabricated() {
      return decision === "fabrication" || decision === "quota" || decision === "storm";
    },
    // Почему ход дропнут: "quota" — лимит аккаунта (лечится ротацией),
    // "fabrication" — модельный артефакт (лечится ретраем с наддогом),
    // "storm" — чип-шторм бэкенда (ретраем с наддогом про markdown-тулы).
    // null — ход не дропнут (в т.ч. "clear": окно прошло, текст чист).
    kind() {
      return decision === "quota" || decision === "fabrication" || decision === "storm" ? decision : null;
    },
    // Текст, на котором сработал детект (для диагностики/синтетической ошибки).
    detectedText() {
      return detected;
    },
  };
}

// Квота/лимит аккаунта в НАЧАЛЕ ответа. Инцидент 2026-10-12 (телеметрия
// run-...T14-40-43-957Z): Qwen отдаёт daily limit HTTP 200 обычной
// SSE-дельтой (phase=answer, status=finished) — это не error-событие,
// единственный маркер — сам текст. Живые формулировки RU/EN/CN.
const QUOTA_LIMIT_PATTERN = /Вы\s+достигли\s+(дневного\s+)?лимита|достигли\s+лимита|daily\s+(free\s+)?limit|reached\s+(the\s+)?daily\s+limit|free\s+tier\s+(limit|exhausted)|guest\s+chat\s+limit|out[_\s]of[_\s]limit|您已达到每日限制|已达到免费额度|免费试用已用完|今日用量已达上限/i;

function detectQuotaLimitText(text) {
  return QUOTA_LIMIT_PATTERN.test(String(text || "").slice(0, FABRICATION_WINDOW_CHARS));
}

// Не-стрим путь (субагенты Hermes): текст ответа → синтетическая
// rate-limit ошибка для account-ротации (markRateLimited → следующий пул).
export function quotaLimitErrorFromText(text) {
  if (!detectQuotaLimitText(text)) return null;
  const err = new Error(`Qwen rate limit (daily limit в контенте ответа): ${String(text).slice(0, 160)}`);
  err.code = "QWEN_RATE_LIMIT";
  return err;
}

// Паттерны по живым формулировкам инцидентов (детектор onEnd уже ловит
// те же слова, но ПОСЛЕ того, как проза ушла клиенту — здесь ловим ДО).
// Квота-паттерны вынесены в QUOTA_LIMIT_PATTERN: у них другое лечение.
// «не отвечает» добавлен 29.10 (утечка 11:55: «система временно не
// отвечает на запросы» — попытка 2 прошла гейт в TG).
function detectToolFabrication(text) {
  const head = String(text || "").slice(0, FABRICATION_WINDOW_CHARS);
  return /\bdoes not exists?\b|инструмент[а-яё]*[^\n.]{0,80}(недоступн|сломан|не\s*работа|не\s+существ|не\s+отвеча)|tool\s+execution\s+backend[^\n.]{0,80}недоступн|tools?\s+(are\s+)?(broken|unavailable|failing|not\s+responding)|не\s+могу\s+(вызв?ать|использовать)\s+инструмент|(система|сервис)[^\n.]{0,40}не\s+отвеча[^\n.]{0,40}(инструмент|запрос)/i.test(head);
}

export function requestThinkingEnabled(body, mapping = null) {
  // Явное понижение из OpenAI-совместимого reasoning_effort (Hermes
  // agent.reasoning_effort) имеет приоритет над флагом модели.
  const effort = String(body?.reasoning_effort ?? body?.reasoning?.effort ?? "").toLowerCase();
  if (effort === "none" || effort === "minimal" || effort === "low") return false;
  return Boolean(
    body?.thinking === true ||
    body?.reasoning === true ||
    body?.reasoning?.effort ||
    mapping?.reasoning === true
  );
}

// Адаптивное мышление: «Авто»-режим Qwen пере-думает на глубоких tool-циклах
// (инциденты 2026-09). История порога: 20 → 200 (25.10, вместе с эмуляцией
// reasoning_content) → снят полностью (29.10, просьба пользователя: с
// thinking-каналом долгие размышления видны и полезны, гасить их по счётчику
// сообщений больше не нужно). QWEN_ADAPTIVE_THINKING_DEPTH=N возвращает
// пороговое поведение, QWEN_ADAPTIVE_THINKING=off — форсирует thinking.
export function resolveAdaptiveThinking({ thinking, toolCount, messageCount, env = process.env } = {}) {
  if (!thinking) return false;
  if (String(env.QWEN_ADAPTIVE_THINKING || "").trim().toLowerCase() === "off") return true;
  if (!toolCount) return true;
  const configured = Number.parseInt(env.QWEN_ADAPTIVE_THINKING_DEPTH || "", 10);
  if (!(configured > 0)) return true; // лимит снят: thinking на любой глубине
  if (messageCount > configured) {
    console.log(`[API] qwen adaptive thinking: tool loop depth ${messageCount} > ${configured} — thinking off for this turn`);
    return false;
  }
  return true;
}

export function requestSearchEnabled(body) {
  return Boolean(
    body?.search === true ||
    body?.web_search === true ||
    body?.web_search_options ||
    body?.metadata?.search === true ||
    body?.metadata?.web_search === true ||
    hasNativeWebSearchTool(body?.tools)
  );
}

function hasNativeWebSearchTool(tools) {
  return Array.isArray(tools) && tools.some(isNativeWebSearchTool);
}

// Нативный (провайдерский) web-search определяется ТОЛЬКО по hosted-формату
// тулзы: OpenAI Responses/Chat Compat ({ type: "web_search_20250305" }) или
// Anthropic ({ type: "web_search_20250305", name: "web_search" }).
//
// Function-тул с именем web_search (Hermes Gateway и подобные клиенты
// шлюют его как { type: "function", function: { name: "web_search" } }) —
// это КЛИЕНТСКИЙ тул: модель должна вызывать его через ```tool_calls,
// а Hermes исполняет и возвращает результат. Матчить его как нативный
// нельзя: это включает auto_search у Qwen + врущий промпт-префикс
// "Web search is enabled" — модель доверяет, зовёт свой внутренний
// поиск, которого нет в зарегистрированных тулзах, и каскадит
// "Tool web search does not exist" (issue: thinking-дампы 2026-08).
function isNativeWebSearchTool(tool) {
  const type = String(tool?.type || tool?.function?.type || "").toLowerCase();
  if (!type) return false;
  return type.includes("web_search") || type.includes("web-search");
}

export function toolsForModelPrompt(tools) {
  return Array.isArray(tools)
    ? tools.filter((tool) => !isNativeWebSearchTool(tool))
    : tools;
}

function anthropicMessagesToChatMessages(body) {
  const result = [];
  const system = anthropicContentToText(body?.system);
  if (system.trim()) result.push({ role: "system", content: system });
  if (!Array.isArray(body?.messages)) return result;

  for (const message of body.messages) {
    const role = message?.role === "assistant" ? "assistant" : message?.role === "system" ? "system" : "user";
    const content = anthropicContentToText(message?.content);
    if (content.trim()) result.push({ role, content });
  }
  return result;
}

function anthropicContentToText(content) {
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text" && typeof part.text === "string") return part.text;
      if (part?.type === "tool_result") {
        return `[TOOL RESULT FOR ${part.tool_use_id || "tool"}]:\n${anthropicContentToText(part.content)}`;
      }
      if (part?.type === "tool_use") {
        return `\`\`\`tool_calls\n${JSON.stringify([{ name: part.name, arguments: part.input || {} }], null, 2)}\n\`\`\``;
      }
      return JSON.stringify(part);
    }).filter(Boolean).join("\n");
  }
  if (typeof content?.text === "string") return content.text;
  return JSON.stringify(content);
}

function anthropicToolsToOpenAITools(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => {
    if (isNativeWebSearchTool(tool)) return tool;
    const name = tool?.name || tool?.function?.name;
    if (!name) return null;
    return {
      type: "function",
      function: {
        name,
        description: tool?.description || tool?.function?.description || "",
        parameters: tool?.input_schema || tool?.parameters || tool?.function?.parameters || { type: "object", properties: {} },
      },
    };
  }).filter(Boolean);
}

export class StreamParser {
  constructor(modelName, res, { tools = [] } = {}) {
    this.modelName = modelName;
    this.res = res;
    this.buffer = "";
    this.isTools = false;
    this.isXmlTools = false;
    this.isBareTools = false;
    this.toolsBuffer = "";
    this.first = true;
    this.ended = false;
    this.id = `chatcmpl-${Math.floor(Date.now() / 1000)}${Math.random().toString(36).slice(2, 10)}`;
    this.tools = tools;
    this.outputCount = 0;
    this.rawText = "";
  }

  // Thinking-канал (Qwen phase:"think" → OpenAI reasoning_content): Hermes
  // рендерит эти дельты как Reasoning-блок, как с нативными reasoning-
  // провайдерами (GLM через z.ai). Текст идёт ОТДЕЛЬНЫМ delta-полем и не
  // попадает в content/toolsBuffer — черновики tool-call JSON внутри
  // reasoning не могут стать ложными вызовами.
  onThinking(textDelta) {
    if (!textDelta) return;
    if (this.first) {
      this.sendChunk({ role: "assistant" }, true);
      this.first = false;
    }
    this.sendChunk({ reasoning_content: textDelta });
  }

  onText(textDelta) {
    this.rawText += textDelta;
    if (this.isBareTools) {
      this.buffer += textDelta;
      return;
    }
    if (this.first) {
      this.sendChunk({ role: "assistant" }, true);
      this.first = false;
    }

    if (!this.isTools && !this.isXmlTools) {
      this.buffer += textDelta;
      
      // Look for multiple tool block indicators
      const idx = this.buffer.indexOf("```tool_calls");
      const idxJson = this.buffer.indexOf("```json");
      const idxXml = findXmlToolStart(this.buffer);

      if (idx !== -1 || idxJson !== -1 || idxXml !== -1) {
        const actualIdx = earliestIndex([idx, idxJson, idxXml]);
        if (actualIdx === idxXml) {
          this.isXmlTools = true;

          const before = this.buffer.slice(0, actualIdx);
          if (before) {
            this.sendChunk({ content: before });
          }
          this.toolsBuffer = this.buffer.slice(actualIdx);
        } else {
          this.isTools = true;
          const offset = actualIdx === idx ? 13 : 7;

          const before = this.buffer.slice(0, actualIdx);
          if (before) {
            this.sendChunk({ content: before });
          }
          this.toolsBuffer = this.buffer.slice(actualIdx + offset);
        }
      } else {
        const bareStart = findBareToolStart(this.buffer, this.tools);
        if (bareStart !== -1) {
          const before = this.buffer.slice(0, bareStart);
          if (before) this.sendChunk({ content: before });
          this.buffer = this.buffer.slice(bareStart);
          this.isBareTools = true;
          return;
        }
        if (this.buffer.length > 96) {
          const toEmit = this.buffer.slice(0, -80);
          if (toEmit) {
            this.sendChunk({ content: toEmit });
            this.buffer = this.buffer.slice(-80);
          }
        }
      }
    } else {
      this.toolsBuffer += textDelta;
    }
  }

  async onEnd() {
    if (this.ended) return;
    this.ended = true;
    let finishReason = "stop";
    if (this.first && !this.buffer && !this.toolsBuffer) {
      this.sendChunk({ role: "assistant" }, true);
      this.first = false;
      this.sendChunk({ content: "[Error] Upstream model stream ended without response content. Retry the request." });
    }
    if (this.isBareTools) {
      const availableNames = this.tools
        .map((tool) => tool?.function?.name || tool?.name)
        .filter(Boolean);
      const bareCalls = extractBareToolCalls(this.buffer, { allowedNames: availableNames });
      const sent = this.sendToolCalls(bareCalls);
      if (sent > 0) finishReason = "tool_calls";
      else this.sendChunk({ content: this.buffer });
    } else if (!this.isTools && !this.isXmlTools && this.buffer) {
      const availableNames = this.tools
        .map((tool) => tool?.function?.name || tool?.name)
        .filter(Boolean);
      const bareCalls = extractBareToolCalls(this.rawText, {
        allowedNames: availableNames.length ? availableNames : undefined,
      });
      if (bareCalls.length) {
        const sent = this.sendToolCalls(bareCalls);
        if (sent > 0) {
          this.sendTerminalChunk("tool_calls");
          return;
        }
      }
      // Just in case it never closes or emits normal text
      this.sendChunk({ content: this.buffer });
    } else if (this.isXmlTools) {
      const parsed = parseModelToolCalls(this.toolsBuffer);
      if (parsed.calls.length) {
        console.log(`[API] Parsed streaming XML tool calls: ${parsed.calls.length}`);
        const sent = this.sendToolCalls(parsed.calls);
        if (sent > 0) finishReason = "tool_calls";
        else this.sendChunk({ content: "[Error] Upstream model returned an empty tool call. Retry the request." });
      } else {
        console.error("[API] Error parsing XML tool calls from streaming response");
        this.sendChunk({ content: "\n[Error parsing XML tool call from model]\n" + this.toolsBuffer });
      }
    } else if (this.isTools) {
      // Sometimes the model outputs extra text before the array, like "[ASSISTANT]```tool_calls ["
      // Let's extract everything from the first '[' to the last ']'.
      let jsonStr = this.toolsBuffer;
      
      const firstBracket = jsonStr.indexOf("[");
      // Закрывающий fence — ПОСЛЕДНИЙ ``` с пробельным хвостом: внутри
      // content бывают вложенные markdown-фенсы (инцидент 2026-10-23),
      // первый-match рвал JSON посередине и терял хвостовые ключи (path).
      let lastBracket = closingFenceIndex(jsonStr);
      if (lastBracket !== -1) {
        jsonStr = jsonStr.slice(0, lastBracket);
        lastBracket = jsonStr.lastIndexOf("]");
      } else {
        lastBracket = jsonStr.lastIndexOf("]");
      }
      
      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket >= firstBracket) {
        jsonStr = jsonStr.slice(firstBracket, lastBracket + 1);
      } else {
        // Fallback cleanup if brackets are missing
        jsonStr = jsonStr.replace(/```\s*$/, "").trim();
        if (!jsonStr.startsWith("[")) jsonStr = "[" + jsonStr;
        // if model stream ended abruptly, it might not have ]
        if (!jsonStr.endsWith("]")) {
           if (jsonStr.endsWith("}")) jsonStr = jsonStr + "]";
           else jsonStr = jsonStr + "}]";
        }
      }

      // Общая ладдер-лапка ремонтов из tool-calls.mjs: та же серия попыток,
      // что и в non-stream дорожке (parseModelToolCalls), — дропнутые
      // закрывающие кавычки, неэкранированные внутренние кавычки, пропавший
      // ключ "arguments", обрезанный блок, мусор Reasoner'а.
      const parsed = repairToolCallJson(jsonStr);
      let calls = parsed ? (Array.isArray(parsed) ? parsed : [parsed]).flat(Infinity) : [];

      // GUARD (инцидент 2026-10-23): output-лимит Qwen (~1k токенов на
      // длинном контексте) обрывает блок посреди content; ремонт JSON
      // «спасает» вызов БЕЗ хвостовых required-полей (path шёл после
      // content) → Hermes отвечает missing required field → модель
      // повторяет тот же oversized-вызов → вечный цикл guardrail.
      // Такой калеченный вызов НЕ отправляем — возвращаем модели явную
      // инструкцию дробить полезную нагрузку.
      // toolsBuffer хранит блок БЕЗ заголовка ```tool_calls (парсер его
      // срезает). Закрывающий fence = ПОСЛЕДНИЙ ``` с пробельным хвостом
      // (внутренние markdown-фенсы в content не считаются).
      const fenceClosed = closingFenceIndex(String(this.toolsBuffer || "")) !== -1;
      if (!fenceClosed && calls.length) {
        const check = normalizeToolCallsForSchemas(calls, this.tools);
        if (check.errors.length) {
          const missingList = check.errors
            .map((e) => `${e.name}: ${e.missing.join(", ")}`)
            .join("; ");
          console.warn(`[API] Tool call truncated by output token limit (missing: ${missingList}) — refusing crippled call, asking model to split`);
          compatLogger.warn("api.tool_call.truncated_guard", { missing: missingList });
          this.sendChunk({
            content: `\n[Tool call truncated by the output token limit — required fields were cut off (${missingList}). The call was NOT executed. Re-emit the tool call with a SMALLER payload: put short fields like path FIRST in the arguments object, and split large content into multiple sequential calls (write the first part, then append/patch the rest). Never repeat the identical oversized call.]`,
          });
          this.sendTerminalChunk("stop");
          return;
        }
      }

      let sent = calls.length ? this.sendToolCalls(calls) : 0;
      if (sent > 0) {
        console.log(`[API] Parsed streaming tool calls: ${sent}`);
        finishReason = "tool_calls";
      } else {
        // Опциональный LLM-фолбэк (OpenRouter free-модели, включается через
        // OPENROUTER_API_KEY): детерминированные ремонты не спасли блок
        // (null) или дали пустой/безымянный результат — просим внешнюю
        // модель починить JSON с фидбеком по итерациям.
        let llmCalls = null;
        try {
          llmCalls = await repairToolCallJsonWithLlm(jsonStr, { tools: this.tools });
        } catch { /* фолбэк не должен ронять ответ */ }
        if (llmCalls && llmCalls.length) {
          console.log(`[API] Parsed streaming tool calls: ${llmCalls.length} (LLM fallback)`);
          sent = this.sendToolCalls(llmCalls);
        }
        if (sent > 0) {
          finishReason = "tool_calls";
        } else if (parsed) {
          console.error("[API] Tool call block parsed to an empty call list");
          this.sendChunk({ content: "[Error] Upstream model returned an empty tool call. Retry the request." });
        } else {
          console.error("[API] Error parsing tool calls from streaming response");
          // Дамп сломанного JSON для диагностики: os.tmpdir() кроссплатформенен
          // (жёсткий /tmp не существует на Windows и ронял стрим-закрытие).
          try {
            fs.writeFileSync(path.join(os.tmpdir(), "failed_json.txt"), jsonStr);
          } catch { /* диагностика не должна ломать ответ */ }
          console.error("[API] Problematic JSON string was:\n", JSON.stringify(jsonStr));
          // Fallback: send as normal text so the UI doesn't hang completely
          this.sendChunk({ content: "\n[Error parsing tool call JSON from model]\n" + jsonStr });
        }
      }
    }
    // Детектор фабрикации: ход с запрошенными инструментами выдал прозу с
    // заявлением о «сломанных инструментах» и НОЛЬ вызовов. По факту всех
    // инцидентов 2026-09 это модельный артефакт («режим эссе» с выдуманным
    // оправданием), а не реальный сбой — логируем для мгновенной диагностики.
    if (!this.isTools && !this.isXmlTools && !this.isBareTools && this.tools.length > 0) {
      const text = String(this.rawText || "");
      // Широкий паттерн по живым формулировкам инцидентов (2026-09-15):
      // «инструменты не существуют», «сервис… инструментов полностью недоступен»,
      // «does not exists», «tools are broken».
      if (/\bdoes not exists?\b|инструмент[а-яё]*[^\n.]{0,60}(недоступн|сломан|не\s+работа|не\s+существ)|tool\s+execution\s+backend[^\n.]{0,60}недоступн|tools?\s+(are\s+)?(broken|unavailable|failing)/i.test(text)) {
        const message = "[API] Model claims tool failure but no tool calls were emitted this turn (fabrication signature; executor logs will confirm)";
        console.warn(message);
        compatLogger.warn("api.tool_failure_claim_without_calls", { chars: text.length });
      }
    }
    this.sendTerminalChunk(finishReason);
  }

  sendChunk(delta, isFirst = false) {
    const chunk = {
      id: this.id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: this.modelName,
      choices: [{ index: 0, delta }],
    };
    sendSseEvent(this.res, chunk);
    if (delta.content || delta.tool_calls?.length) this.outputCount += 1;
    if (this.res.flush) this.res.flush();
  }

  sendToolCalls(calls) {
    const normalized = normalizeToolCallsForSchemas(calls, this.tools);
    if (normalized.errors.length) {
      compatLogger.warn("api.tool_call.validation", { errors: normalized.errors });
    }
    let sent = 0;
    const deliveredNames = [];
    normalized.calls.forEach((call, index) => {
      const name = call.name || call.tool;
      if (!name) return;
      deliveredNames.push(name);
      this.sendChunk({
        tool_calls: [{
          index,
          id: `call_${Math.random().toString(36).slice(2, 10)}`,
          type: "function",
          function: {
            name,
            arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments || {})
          }
        }]
      });
      sent += 1;
    });
    // Структурное событие доставки: доказывает в файловом логе, что вызовы
    // реально ушли клиенту (диагностика «блокер-репортов» про несуществующие
    // инструменты — консольные логи теряются при перезапуске/пайпах).
    if (sent > 0) {
      compatLogger.info("api.tool_calls.delivered", { count: sent, names: deliveredNames.join(",") });
    }
    return sent;
  }

  sendTerminalChunk(finishReason) {
    const chunk = {
      id: this.id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: this.modelName,
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    };
    sendSseEvent(this.res, chunk);
    if (this.res.flush) this.res.flush();
  }
}

function earliestIndex(indexes) {
  return indexes.filter((idx) => idx !== -1).sort((a, b) => a - b)[0] ?? -1;
}

function findXmlToolStart(buffer) {
  const lower = String(buffer || "").toLowerCase();
  const starts = [
    lower.indexOf("<tool_call"),
    lower.indexOf("<tool_calls"),
    lower.indexOf("<function="),
  ].filter((idx) => idx !== -1);
  return starts.length ? Math.min(...starts) : -1;
}

function findBareToolStart(buffer, tools) {
  const available = new Set((tools || [])
    .map((tool) => tool?.function?.name || tool?.name)
    .filter(Boolean));
  if (!available.size) return -1;

  const pattern = /\{\s*"name"\s*:\s*"([^"]+)"/g;
  for (const match of String(buffer || "").matchAll(pattern)) {
    if (available.has(match[1])) return match.index ?? -1;
  }
  return -1;
}
