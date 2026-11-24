import { measureProviderExchange } from "../../diagnostics/runtime-metrics.mjs";
// HTTP-клиент chat.qwen.ai.
// API: POST /api/v2/chat/completions?chat_id=<id> со стримингом SSE.
// Auth — через cookies (JWT в куке `token`).
//
// Flow:
//   1. createChat() — создаём chat_id (как DeepSeek createSession)
//   2. complete(chatId, prompt) — шлём сообщение, парсим стрим
//
// Note: реверс на основе одного cURL — некоторые поля (response shape для createChat,
// формат SSE-событий) могут потребовать корректировки после первой попытки.

import { randomUUID } from "node:crypto";
import { qwenQuotaError } from "./account-session.mjs";
import fs from "node:fs";
import { setTimeout as abortableDelay } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { QWEN_BASE_URL, QWEN_DEFAULT_MODEL } from "./config.mjs";
import { qwenBaseHeaders } from "./headers.mjs";
import { isQwenAuthError } from "./auth-manager.mjs";
import {
  createQwenSessionExpiredError,
  extractQwenErrorFields,
  formatQwenSessionExpiredMessage,
  isQwenSessionExpiredCode,
  isQwenSessionExpiredText,
  isQwenAntiBotRejection,
  formatQwenAntiBotMessage,
  throwIfQwenSessionExpiredFromAssistantText,
  throwIfQwenSessionExpiredFromHttp,
} from "./session-errors.mjs";
import { getQwenBrowserProxy, resetQwenBrowserProxy } from "./browser-proxy.mjs";
import { buildQwenCompletionPayload } from "./completion-payload.mjs";
import { resolveQwenContextFileConfig, splitPromptForFileUpload, uploadQwenContextFile } from "./context-file.mjs";
import { harvestQwenChatMessage, harvestTransportFailedCompletion, harvestQwenCheckpoint } from "./harvest.mjs";
import { waitForQwenCompletionSlot, waitForQwenDispatchSlot, createQwenPunishError, qwenAntibotCooldownRemainingMs, startQwenPunishCooldown, registerQwenCompletionSuccess, registerQwenRetryAfter } from "./request-pacing.mjs";
import { createFileLogger } from "../../logging/logger.mjs";

const providerLogger = createFileLogger({ component: "provider.qwen" });

export function isQwenTransientBrowserTransportError(error) {
  const message = String(error?.message || error || "");
  return error?.code === "QWEN_BROWSER_TRANSPORT_FAILURE"
    || /Execution context was destroyed|most likely because of a navigation|Target closed|Page closed|Context closed|Timeout .* exceeded|qwen_page_evaluate_timeout|qwen_response_headers_timeout|net::ERR_ABORTED|NS_BINDING_ABORTED|NS_ERROR_NET_TIMEOUT|Failed to fetch|request is finished/i.test(message);
}

export function qwenBrowserFetchError(result) {
  if (Number(result?.status) !== 0) return null;
  const detail = String(result?.text || "").match(/__fetch_error__:\s*([^\n]+)/)?.[1] || "запрос прерван до HTTP-ответа";
  return Object.assign(new Error(`Qwen не вернул ответ на запрос: ${detail}`), { code: "QWEN_BROWSER_TRANSPORT_FAILURE" });
}

export function throwIfQwenFirstContentTimeout(result) {
  if (Number(result?.status) !== 0) return;
  if (!/qwen_stream_first_content_timeout/i.test(String(result?.text || ""))) return;
  const error = new Error("Qwen stream produced no response content before timeout.");
  error.code = "EMPTY_UPSTREAM_STREAM";
  throw error;
}

// Детект: стрим умер по first-content timeout (сервер принял POST, но не
// отдал ни чанка за firstContentMs). Именно этот кейс kilocode видит как
// EMPTY_UPSTREAM_STREAM после серии успешных tool calls.
export function isQwenFirstContentTimeoutResult(result) {
  return Number(result?.status) === 0
    && /qwen_stream_first_content_timeout/i.test(String(result?.text || ""));
}

function throwIfQwenRateLimited(status, text, retryAfter, accountId) {
  if (Number(status) !== 429) return;
  const retryAfterMs = registerQwenRetryAfter(retryAfter, Date.now(), accountId);
  const error = qwenQuotaError(status, text) || new Error('Qwen ограничил частоту запросов.');
  Object.assign(error, { code: error.code || 'QWEN_RATE_LIMIT', status: 429, retryAfterMs, delivery: 'rejected' });
  throw error;
}

function throwIfQwenAuthFailure(status, text, context) {
  const quota = qwenQuotaError(status, text);
  if (quota) throw quota;
  throwIfQwenSessionExpiredFromHttp(status, text, context);
  const snippet = String(text || "").slice(0, 800);
  const err = new Error(`Qwen ${context} failed: HTTP ${status}: ${snippet}`);
  if (status === 401 || isQwenAuthError(err)) {
    err.isAuthError = true;
  }
  throw err;
}

function finalizeQwenCompletionResult(parsed, rawText, context, accountId, requestStartedAt) {
  // Inspect structured provider events, not generated assistant text.
  for (const line of String(rawText || '').split('\n')) {
    const quota = qwenQuotaError(200, line.replace(/^data:\s*/, ''));
    if (quota) throw quota;
  }
  if (parsed?.error) {
    const errText = String(parsed.error);
    if (isQwenSessionExpiredText(errText)) {
      throw createQwenSessionExpiredError({
        code: extractCodeFromCompletionText(errText),
        details: errText.slice(0, 300),
        context,
      });
    }
    throw Object.assign(new Error(errText), { code: 'QWEN_UPSTREAM_ERROR', delivery: 'rejected',
      upstreamCode: parsed.upstreamError?.code || extractCodeFromCompletionText(errText) });
  }

  if (!parsed?.text && !parsed?.thinkingText) {
    const fields = extractQwenErrorFieldsFromRaw(rawText);
    if (fields && isQwenAntiBotRejection(fields.code, fields.details)) {
      return {
        text: formatQwenAntiBotMessage(fields),
        lastMessageId: null,
        thinkingText: "",
        error: formatQwenAntiBotMessage(fields),
      };
    }
    if (fields && isQwenSessionExpiredCode(fields.code, fields.details)) {
      throw createQwenSessionExpiredError({ ...fields, context });
    }
    const fallback = emptyQwenParseFallback(rawText || "", rawText || "", 0);
    throwIfQwenSessionExpiredFromAssistantText(fallback.text, context);
    return fallback;
  }

  throwIfQwenSessionExpiredFromAssistantText(parsed.text, context);
  if (accountId !== undefined && !parsed.truncated && parsed.text) registerQwenCompletionSuccess(Date.now(), accountId, requestStartedAt);
  return parsed;
}

function extractCodeFromCompletionText(text) {
  const m = String(text || "").match(/ошибку \(([^)]+)\)/i);
  return m?.[1] || "";
}

function extractQwenErrorFieldsFromRaw(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return null;
  try {
    return extractQwenErrorFields(JSON.parse(text));
  } catch {
    return null;
  }
}

// Через какой путь шлём запросы:
//  - "browser" (по умолчанию) — через невидимый Playwright. Запросы автоматически
//    подписываются JS-бандлом chat.qwen.ai (bx-ua и т.д.). РАБОЧИЙ режим.
//  - "direct" — старый прямой fetch с bx-ua из .env. НЕ РАБОТАЕТ из-за anti-bot.
//    Оставлен как fallback и для отладки.
const QWEN_TRANSPORT = process.env.QWEN_TRANSPORT || "browser";
const QWEN_CREATE_CHAT_TIMEOUT_MS = Number(process.env.QWEN_CREATE_CHAT_TIMEOUT_MS || 10_000);

// Авто-режим (/code-агент, CLI, ACP): при "The chat is in progress!" не сдаёмся
// после одной попытки создать новый чат, а крутим цикл повторов с растущими
// паузами, чтобы задача выполнилась без ручного вмешательства пользователя.
// Интерактивный чат (allowNewChatRecovery без autoRetry) ведёт себя как раньше.
const QWEN_AUTO_RETRY_MAX_ATTEMPTS = Number(process.env.QWEN_AUTO_RETRY_MAX_ATTEMPTS || 6);
const QWEN_AUTO_RETRY_BASE_DELAY_MS = Number(process.env.QWEN_AUTO_RETRY_BASE_DELAY_MS || 4_000);
const QWEN_AUTO_RETRY_MAX_DELAY_MS = Number(process.env.QWEN_AUTO_RETRY_MAX_DELAY_MS || 30_000);

// Куда дампим исходящие запросы и сырой стрим при DEEPSEEK_DEBUG_QWEN=1.
// Юзер потом diff'ает с рабочим cURL — сразу видно, где расхождение.
const QWEN_DEBUG_DIR = path.join(os.tmpdir(), "qwen-debug");

// Дефолтная модель Qwen. Можно переопределить через .env: QWEN_MODEL=qwen3-max.
// Per-chat выбор передаётся параметром в createChat()/complete() — он приоритетней.
const ENV_DEFAULT_MODEL = process.env.QWEN_MODEL || QWEN_DEFAULT_MODEL;

export class QwenChatClient {
  constructor({ token, cookieHeader, accountId = 'default', debug = false }) {
    this.token = token;
    this.cookieHeader = cookieHeader;
    this.accountId = accountId;
    this.debug = debug;
    this.supportsImageAttachments = QWEN_TRANSPORT === "browser";
  }

  setAuth({ token, cookieHeader }) {
    if (token) this.token = token;
    if (cookieHeader) this.cookieHeader = cookieHeader;
  }

  // Создание нового чата на сервере.
  //
  // ВАЖНО: Qwen-сервер НЕ создаёт чат сам на первом /completions, как мы думали.
  // Нужен предварительный POST /api/v2/chats/new — он возвращает server-issued
  // chat_id, который потом идёт в /completions?chat_id=...
  //
  // Поток (повторяет SPA-флоу):
  //   1. POST /chats/new {title, models, chat_mode, chat_type, timestamp_ms, project_id:""}
  //   2. Сервер возвращает { success, data: { id, title, ... } }
  //   3. Возвращаем data.id
  async recoverCheckpoint(chatId, checkpoint) {
    const proxy = await getQwenBrowserProxy({ accountId: this.accountId, debug: this.debug });
    const turn = checkpoint.qwenTurn;
    if (turn?.chatId && turn.chatId !== chatId) return null;
    const split = !turn && typeof proxy.submitNativeTurn !== 'function'
      && splitPromptForFileUpload(checkpoint.prompt, resolveQwenContextFileConfig());
    const savedTurn = turn ? { ...checkpoint, ...turn } : { ...checkpoint, prompt: split?.inline || checkpoint.prompt };
    if (typeof proxy.pendingCompletionRequests === "function") {
      savedTurn.originalTransportClosed = (await proxy.pendingCompletionRequests()) === 0;
    }
    return harvestQwenCheckpoint({ chatId, checkpoint: savedTurn,
      fetcher: async ({ chatId, limit }) => {
        const result = await proxy.proxyApiGet({ path: `/api/v2/chats/${chatId}?direction=up&limit=${limit}` });
        if (result?.ok === false || result?.json?.success === false) {
          throwIfQwenAuthFailure(result.status, JSON.stringify(result.json || {}), 'history');
        }
        return result;
      },
    });
  }

  async createChat({ title = "Новый чат", model = ENV_DEFAULT_MODEL } = {}) {
    if (QWEN_TRANSPORT !== "browser") {
      // В direct-режиме fallback на клиентский UUID (всё равно direct не работает из-за анти-бота).
      const fallbackId = randomUUID();
      console.log(`[qwen] (direct transport) client-side chat_id: ${fallbackId}`);
      return fallbackId;
    }

    const proxy = await getQwenBrowserProxy({ accountId: this.accountId, debug: this.debug });
    const url = `${QWEN_BASE_URL}/api/v2/chats/new`;
    const body = JSON.stringify({
      title,
      models: [model],
      chat_mode: "normal",
      chat_type: "t2t",
      timestamp: Date.now(), // ВНИМАНИЕ: миллисекунды (в /completions — секунды)
      project_id: "",
    });

    // chatId: null — навигировать никуда не нужно, остаёмся на главной.
    const result = await proxy.proxyFetch({
      url,
      body,
      chatId: null,
      timeoutMs: QWEN_CREATE_CHAT_TIMEOUT_MS,
      streamIdleTimeoutMs: 5_000,
      maxAttempts: 1,
    });
    if (!result.ok) {
      throwIfQwenAuthFailure(result.status, result.text, "createChat");
    }

    let json;
    try {
      json = JSON.parse(result.text);
    } catch {
      const looksLikeHtml = /<!doctype html|<html[\s>]/i.test(result.text || "");
      if (looksLikeHtml || /text\/html/i.test(result.contentType || "")) {
        throwIfQwenSessionExpiredFromHttp(result.status, result.text, "createChat");
        throw Object.assign(new Error('Qwen createChat returned HTML instead of JSON. Причина не подтверждена.'), { code: 'QWEN_UNEXPECTED_RESPONSE' });
      }
      throw new Error(`Qwen createChat: non-JSON response: ${result.text.slice(0, 500)}`);
    }

    // Структура ответа: { success: true, data: { id: "uuid", ... } }.
    // На всякий случай проверим несколько мест где сервер мог положить id.
    const id = json?.data?.id || json?.data?.chat_id || json?.id || json?.chat_id;
    if (!id) {
      throw new Error(`Qwen createChat: no id in response: ${JSON.stringify(json).slice(0, 500)}`);
    }
    if (json.success === false) {
      throw new Error(`Qwen createChat: server returned success=false: ${JSON.stringify(json).slice(0, 500)}`);
    }

    console.log(`[qwen] server-issued chat_id: ${id}`);
    return id;
  }

  // Отправка сообщения в существующий чат. parentId — id предыдущего assistant-сообщения
  // для chain-of-context (как parent_message_id у DeepSeek).
  //
  // Восстановление при «The chat is in progress!»:
  // Qwen иногда держит предыдущую генерацию чата «активной» на сервере
  // (прерванный стрим, зависшая очередь). В этом состоянии он отклоняет новые
  // сообщения в тот же chat_id кодом Bad_Request: «The chat is in progress!».
  // Короткие повторы в тот же чат чаще всего не помогают — зависший turn может
  // висеть минутами. Поэтому, если мягкие повторы (1.5с / 3с) не освободили чат,
  // мы создаём НОВЫЙ чат и повторяем запрос туда с пустым parentId. Это сразу
  // разблокирует пользователя без ручного «нового разговора». Серверная
  // обёртка читает optional поле result.recoveredChatId и обновляет
  // conversation.sessionId, чтобы следующие сообщения шли в тот же чат.
  async complete({
    chatId,
    prompt,
    images = [],
    parentId = null,
    thinking = true,
    search = true,
    onText = null,
    onThinking = null,
    model = ENV_DEFAULT_MODEL,
    allowNewChatRecovery = true,
    // autoRetry=true включает авто-режим для /code-агента, CLI и ACP:
    // при застревании "The chat is in progress!" клиент многократно создаёт
    // новые чаты с растущими паузами, пока не пробьётся или не исчерпает лимит.
    // Интерактивный чат по умолчанию НЕ включает авто-режим (одно восстановление
    // + читаемое сообщение пользователю), чтобы не висеть долго в UI.
    autoRetry = false,
    signal = null,
  }) {
    signal?.throwIfAborted();
    const startedAt = Date.now();
    providerLogger.info("provider.qwen.request", {
      operation: "completion",
      model,
      chatId,
      promptChars: String(prompt || "").length,
      thinking,
      search,
      autoRetry,
    });
    try {
      const result = await this.#completeWithRecovery({
        chatId, prompt, images, parentId, thinking, search, onText, onThinking, model,
        allowNewChatRecovery, autoRetry, signal,
      });
      providerLogger.info("provider.qwen.success", {
        operation: "completion",
        model,
        responseChars: String(result?.text || "").length,
        recovered: Boolean(result?.recoveredChatId),
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      providerLogger.error("provider.qwen.error", error, {
        operation: "completion",
        model,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  // Внутренняя реализация complete с восстановлением через новый чат.
  //
  // Два режима:
  //  • Интерактивный (autoRetry=false): одна попытка создать новый чат, затем
  //    читаемое сообщение пользователю — чтобы UI не висел долго в ожидании.
  //  • Авто-режим (autoRetry=true, для /code-агента, CLI, ACP): если новый чат
  //    тоже застрял, повторяем создание новых чатов с растущими паузами
  //    (4с → 8с → 16с → 30с…) до QWEN_AUTO_RETRY_MAX_ATTEMPTS попыток. Так
  //    автономная задача не падает из-за зависшего turn на сервере Qwen и
  //    не требует ручного «подожди и пришли ещё раз».
  async #completeWithRecovery({
    chatId,
    prompt,
    images = [],
    parentId,
    thinking,
    search,
    onText,
    onThinking,
    model,
    allowNewChatRecovery,
    autoRetry,
    signal,
  }) {
    let nativeBootstrap = null;
    const round = await this.#completionRound({
      chatId,
      prompt,
      images,
      parentId,
      thinking,
      search,
      onText,
      onThinking,
      model,
      signal,
      onNativeBootstrap: info => { nativeBootstrap = info; },
    });

    // Успех — отдаём как есть. Оба состояния ниже означают, что сохранённая
    // серверная ветка Qwen больше не пригодна и запрос надо перенести в свежий чат.
    const invalidParentStuck = Boolean(round.invalidParentStuck);
    const transportStuck = Boolean(round.transportStuck);
    if (!round.chatInProgressStuck && !invalidParentStuck && !transportStuck) {
      return nativeBootstrap ? { ...round.result, recoveredChatId: nativeBootstrap.chatId } : round.result;
    }

    // allowNewChatRecovery относится к занятости чата. Потерянный parent_id всегда
    // восстанавливаем автоматически: повтор с тем же parent_id заведомо не поможет.
    if (!allowNewChatRecovery && !invalidParentStuck && !transportStuck) {
      return {
        text: formatQwenChatInProgressUserMessage(),
        lastMessageId: null,
        thinkingText: "",
        chatInProgress: true,
      };
    }

    // Сколько раз ещё можно попытаться создать свежий чат.
    // В авто-режиме лимит берём из ENV; в интерактивном — ровно один раз.
    const maxFreshAttempts = autoRetry
      ? Math.max(1, QWEN_AUTO_RETRY_MAX_ATTEMPTS)
      : 1;

    for (let attempt = 1; attempt <= maxFreshAttempts; attempt += 1) {
      signal?.throwIfAborted();
      // Пауза перед созданием нового чата: в авто-режиме растёт экспоненциально,
      // чтобы дать серверу Qwen время освободить зависший turn. В интерактивном
      // режиме (попытка №1) паузы нет — мы уже подождали в мягких повторах.
      if (autoRetry && attempt > 1) {
        const delay = Math.min(
          QWEN_AUTO_RETRY_BASE_DELAY_MS * 2 ** (attempt - 2),
          QWEN_AUTO_RETRY_MAX_DELAY_MS,
        );
        providerLogger.warn("provider.qwen.retry", {
          operation: "fresh_chat_recovery",
          attempt,
          maxAttempts: maxFreshAttempts,
          waitMs: delay,
        });
        if (this.debug) console.log(`[qwen] auto-retry: waiting ${Math.round(delay / 1000)}s before attempt ${attempt}/${maxFreshAttempts}…`);
        await waitForQwenChat(delay, signal);
      }

      try {
        if (this.debug) console.log(`[qwen] chat stuck "in progress" — creating a fresh chat (attempt ${attempt}/${maxFreshAttempts})…`);
        const freshChatId = await this.createChat({
          title: "Новый чат",
          model: model || ENV_DEFAULT_MODEL,
        });
        console.log(`[qwen] recovered into fresh chat_id=${freshChatId} (was ${chatId})`);
        const recovered = await this.#completionRound({
          chatId: freshChatId,
          prompt,
          images,
          parentId: null,
          thinking,
          search,
          onText,
          onThinking,
          model,
          signal,
        });
        if (!recovered.chatInProgressStuck && !recovered.invalidParentStuck && !recovered.transportStuck) {
          return {
            ...recovered.result,
            recoveredChatId: freshChatId,
          };
        }
        if (this.debug) console.log(`[qwen] fresh chat_id=${freshChatId} also stuck in progress (attempt ${attempt}/${maxFreshAttempts}).`);
        // В авто-режиме — продолжаем цикл к следующей попытке. В интерактивном
        // (attempt=1, maxFreshAttempts=1) — выходим и отдаём сообщение ниже.
      } catch (recoveryError) {
        signal?.throwIfAborted();
        if (this.debug) console.log(`[qwen] new-chat recovery failed (attempt ${attempt}/${maxFreshAttempts}): ${recoveryError?.message || recoveryError}`);
        // Ошибка создания чата — в авто-режим продолжаем цикл, иначе падаем ниже.
      }
    }

    // Все попытки создания нового чата исчерпаны — отдаём понятное сообщение
    // вместо сырого «Bad_Request: The chat is in progress!».
    if (autoRetry && this.debug) {
      console.log(`[qwen] auto-retry exhausted after ${maxFreshAttempts} attempts — giving up.`);
    }
    if (transportStuck) throw round.transportError;
    return {
      text: invalidParentStuck
        ? formatQwenInvalidParentUserMessage()
        : formatQwenChatInProgressUserMessage(),
      lastMessageId: null,
      thinkingText: "",
      chatInProgress: !invalidParentStuck,
      invalidParent: invalidParentStuck,
    };
  }

  // Один раунд запроса в конкретный chat_id: мягкие повторы внутри одного чата
  // (1.5с / 3с для «in progress», reset proxy для recoverable stream error).
  // Возвращает { result, chatInProgressStuck } — последний флаг означает, что
  // чат «in progress» и мягкие повторы в тот же chat_id исчерпаны.
  async #completionRound({
    chatId,
    prompt,
    images = [],
    parentId,
    thinking,
    search,
    onText,
    onThinking,
    model,
    signal,
    onNativeBootstrap,
  }) {
    signal?.throwIfAborted();
    let completionStartedAt;
    // Большой промпт → файл-вложение context.txt (аналог вставки большого
    // текста в поле ввода веб-интерфейса). Punish может возникать и независимо
    // от размера промпта, поэтому его отдельно обрабатываем как ограничение.
    let promptToUse = String(prompt || "");
    let contextFiles = null;
    const browserProxy = QWEN_TRANSPORT === "browser" ? await getQwenBrowserProxy({ accountId: this.accountId, debug: this.debug }) : null;
    const nativeComposer = typeof browserProxy?.submitNativeTurn === "function";
    if (images.length && !nativeComposer) throw Object.assign(new Error("Qwen image input requires the native browser composer."), { code: "QWEN_IMAGE_TRANSPORT_UNAVAILABLE", delivery: "not_sent" });
    let expectedImageFileIds;
    if (nativeComposer) parentId = await resolveQwenNativeParent(browserProxy, chatId, parentId);
    const originalChatId = chatId;
    let nativeBootstrap = null;
    const acceptNativeBootstrap = info => {
      if (nativeComposer && parentId == null && info?.previousChatId === originalChatId
        && typeof info.chatId === 'string' && info.chatId.trim() && info.chatId !== originalChatId) {
        nativeBootstrap = info;
        chatId = info.chatId;
        onNativeBootstrap?.(info);
      }
    };
    const contextFileConfig = resolveQwenContextFileConfig();
    const split = !nativeComposer && splitPromptForFileUpload(promptToUse, contextFileConfig);
    if (split) {
      const proxy = await getQwenBrowserProxy({ accountId: this.accountId, debug: this.debug });
      providerLogger.info("provider.qwen.context_file", {
        operation: "upload",
        fileChars: split.fileChars,
        inlineChars: split.inlineChars,
      });
      const attachment = await uploadQwenContextFile({
        proxyApiPost: (path, apiBody) => proxy.proxyApiPost({ path, body: apiBody, chatId }),
        content: split.fileText,
      });
      promptToUse = split.inline;
      contextFiles = [attachment];
      if (this.debug) {
        console.log(`[qwen] context moved to file: ${split.fileChars} chars → ${attachment.name} (${attachment.id}); inline left: ${split.inlineChars}`);
      }
    }

    const body = buildQwenCompletionPayload({
      chatId,
      prompt: promptToUse,
      parentId,
      model,
      thinking,
      search,
      files: contextFiles,
    });

    const headers = {
      ...qwenBaseHeaders(this.cookieHeader),
      Referer: `${QWEN_BASE_URL}/c/${chatId}`,
    };

    const url = `${QWEN_BASE_URL}/api/v2/chat/completions?chat_id=${encodeURIComponent(chatId)}`;
    const bodyStr = JSON.stringify(body);

    if (this.debug) {
      try {
        fs.mkdirSync(QWEN_DEBUG_DIR, { recursive: true });
        const dump = { url, method: "POST", transport: QWEN_TRANSPORT, headers, body };
        fs.writeFileSync(
          path.join(QWEN_DEBUG_DIR, "last-request.json"),
          JSON.stringify(dump, null, 2),
        );
        console.log(`[qwen] dumped request → ${path.join(QWEN_DEBUG_DIR, "last-request.json")}`);
      } catch (e) {
        console.error(`[qwen] failed to dump request: ${e.message}`);
      }
    }

    if (QWEN_TRANSPORT === "browser") {
      let chatInProgressSeen = false;
      let roundStreamParser = null; // парсер текущей попытки — виден в catch
      let postedOnce = false; // completion-POST уже отправлялся в этом чате
      let requestStartedSeconds = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          roundStreamParser = null;
          const proxy = await getQwenBrowserProxy({ accountId: this.accountId, debug: this.debug });
          // Pacing: минимальный интервал между POST /completions, чтобы не
          // разгонять риск-скоринг Baxia. Также кидает QWEN_ANTIBOT_PUNISH,
          // если активен кулдаун после детектированной punish-страницы.
          const pacingWaitMs = await waitForQwenCompletionSlot({ accountId: this.accountId, signal, deferDispatch: true });
          if (pacingWaitMs > 0 && this.debug) {
            console.log(`[qwen] pacing: waited ${pacingWaitMs}ms before completion`);
          }
          requestStartedSeconds = Math.floor(Date.now() / 1000);
          completionStartedAt = Date.now();
          const { result, parser: streamParser } = await fetchQwenCompletionWithMetrics(proxy,
            { url, body: bodyStr, chatId, maxAttempts: 1,
              nativeTurn: nativeComposer ? { prompt: promptToUse, images, parentId, model, thinking, search, signal,
                allowNativeRootChat: parentId == null } : null,
              beforeSend: async () => {
              await waitForQwenDispatchSlot({ accountId: this.accountId, signal });
              requestStartedSeconds = Math.floor(Date.now() / 1000);
              completionStartedAt = Date.now();
              postedOnce = true;
            } },
            { onText, onThinking, attempt: attempt + 1, onParser: parser => { roundStreamParser = parser; } });
          acceptNativeBootstrap(result.nativeBootstrap);
          expectedImageFileIds = result.qwenImageFileIds;

          throwIfQwenRateLimited(result.status, result.text, result.retryAfter, this.accountId);

          // First-content timeout (2026-08-24, kilocode): сервер принял POST,
          // но молчит дольше firstContentMs. Генерация на сервере часто жива —
          // сначала harvest истории, ошибка только если и там пусто.
          if (isQwenFirstContentTimeoutResult(result)) {
            const harvested = images.length ? { recovered: await this.recoverCheckpoint(chatId, {
              prompt: promptToUse, parentMessageId: parentId,
              qwenTurn: { chatId, prompt: promptToUse, parentMessageId: parentId, imageCount: images.length, expectedImageFileIds },
            }) } : await harvestAfterFirstContentTimeout({
              result,
              chatId,
              onText,
              getProxy: () => getQwenBrowserProxy({ accountId: this.accountId, debug: this.debug }),
              sinceTimestamp: requestStartedSeconds,
              debug: this.debug,
            });
            if (harvested.recovered) {
              return {
                result: finalizeQwenCompletionResult(harvested.recovered, "", "completion (browser, first-content harvest)", this.accountId, completionStartedAt),
                chatInProgressStuck: false,
              };
            }
          }
          throwIfQwenFirstContentTimeout(result);
          // Прокси пометил ответ как Baxia punish (антибот-капча) —
          // кулдаун уже включён в прокси, наверх уходит понятная ошибка.
          if (result.punish) {
            throw createQwenPunishError(qwenAntibotCooldownRemainingMs(Date.now(), this.accountId), result.status > 0 ? "rejected" : "unknown");
          }
          const fetchError = qwenBrowserFetchError(result);
          if (fetchError) throw fetchError;

          // Стрим оборвался без терминального маркера (текст шёл, потом
          // тишина/abort). Порядок восстановления (см. HAR 2026-08-21):
          //   1. RESUME: пустой POST ?response_id=... — сервер продолжает
          //      тот же SSE-ответ, sibling-ветки не плодятся.
          //   2. HARVEST: GET истории чата — сервер часто уже сохранил
          //      готовый ответ; забираем его без единого ретрая.
          // Слепой re-POST полного body ЗАПРЕЩЁН: он создавал "2/2", "3/4"
          // ретраи в веб-морде и дублированный текст у пользователя.
          let parsed;
          if (result.recoveredNativeAnswer) {
            const saved = result.recoveredNativeAnswer;
            const prefix = streamParser?.snapshot?.() || '';
            if (prefix && !saved.text.startsWith(prefix)) throw Object.assign(new Error('Qwen: поток не совпадает с сохранённым ответом.'),
              { code: 'QWEN_BROWSER_TRANSPORT_FAILURE', delivery: 'unknown' });
            const tail = saved.text.slice(prefix.length);
            if (tail) onText?.(tail);
            parsed = { ...saved, thinkingText: '', harvested: true, streamFinished: true, contentReceived: true };
          } else {
            parsed = streamParser
              ? streamParser.finish(result.text)
              : parseQwenResponseText(result.text, result.contentType, onText);
          }

          if (parsed?.punish) {
            const { backoffMs } = startQwenPunishCooldown(Date.now(), this.accountId);
            throw createQwenPunishError(backoffMs, "rejected");
          }

          if (nativeComposer && parsed?.truncated) {
            const recovered = await this.recoverCheckpoint(chatId, { prompt: promptToUse, parentMessageId: parentId,
              qwenTurn: { chatId, prompt: promptToUse, parentMessageId: parentId, ...(images.length ? { imageCount: images.length, expectedImageFileIds } : {}) } });
            if (!recovered?.text) throw Object.assign(new Error('Qwen: штатный поток прервался; проверяю сохранённый ответ.'),
              { code: 'QWEN_BROWSER_TRANSPORT_FAILURE', delivery: 'unknown' });
            parsed = recovered;
          } else if (streamParser && parsed?.truncated && parsed?.responseId) {
            const recoveredStream = await this.#recoverTruncatedStream({
              chatId,
              truncated: parsed,
              streamParser,
              onText,
              onThinking,
            });
            if (recoveredStream) parsed = recoveredStream;
          }

          providerLogger.info("provider.qwen.response", {
            operation: "completion",
            transport: "browser",
            attempt: attempt + 1,
            statusCode: result.status,
            contentType: result.contentType,
            responseBytes: result.text?.length || 0,
            streamTruncated: Boolean(parsed?.truncated),
            streamResumed: Boolean(parsed?.resumed),
            harvested: Boolean(parsed?.harvested),
          });

          if (this.debug) {
            try {
              fs.mkdirSync(QWEN_DEBUG_DIR, { recursive: true });
              fs.writeFileSync(
                path.join(QWEN_DEBUG_DIR, "last-response.txt"),
                `# transport=browser, stream=${Boolean(streamParser)}, status=${result.status}, content-type=${result.contentType}, bytes=${result.text?.length || 0}\n\n${result.text || ""}`,
              );
              console.log(`[qwen] dumped response → ${path.join(QWEN_DEBUG_DIR, "last-response.txt")}`);
            } catch {}
          }

          // result.ok=false (status 0 / HTTP-ошибка): бросаем ТОЛЬКО если
          // recovery (resume/harvest) не собрал текст. Если обрыв стрима
          // был восстановлен — работаем с parsed дальше как с успехом.
          if (!result.ok && !parsed?.text && !parsed?.thinkingText) {
            throwIfQwenAuthFailure(result.status, result.text, "completion (browser)");
          }

          if (isQwenInvalidParentError(parsed, result.text)) {
            if (nativeComposer) throw Object.assign(new Error('Qwen: сохранённая ветка больше не доступна. Проверьте чат перед продолжением.'),
              { code: 'HARNESS_REVIEW_REQUIRED', delivery: 'rejected' });
            return { result: null, chatInProgressStuck: false, invalidParentStuck: true };
          }

          if (isQwenChatInProgressError(parsed, result.text)) {
            if (nativeComposer) throw Object.assign(new Error('Qwen: в этом чате ещё выполняется предыдущий ответ. Задача сохранена.'),
              { code: 'QWEN_NATIVE_CHAT_IN_PROGRESS', delivery: 'rejected' });
            chatInProgressSeen = true;
            if (attempt < 2) {
              const waitMs = 1_500 * (attempt + 1);
              providerLogger.warn("provider.qwen.retry", {
                operation: "chat_in_progress",
                attempt: attempt + 1,
                waitMs,
              });
              if (this.debug) console.log(`[qwen] chat is still finalizing; retrying same turn in ${waitMs}ms…`);
              await waitForQwenChat(waitMs, signal);
              continue;
            }
            // Все 3 попытки в тот же чат ушли в «in progress».
            return { result: null, chatInProgressStuck: true };
          }

          return { result: finalizeQwenCompletionResult(parsed, result.text, "completion (browser)", this.accountId, completionStartedAt), chatInProgressStuck: false };
        } catch (error) {
          acceptNativeBootstrap(error.qwenNativeBootstrap);
          if (nativeBootstrap) error.qwenNativeBootstrap = nativeBootstrap;
          error.qwenTurn = { chatId, prompt: promptToUse, parentMessageId: parentId, requestStartedAt: requestStartedSeconds ? requestStartedSeconds * 1000 : Date.now(),
            ...(images.length ? { imageCount: images.length, expectedImageFileIds: error.qwenImageFileIds || expectedImageFileIds } : {}) };
          providerLogger.error("provider.qwen.error", error, {
            operation: "completion_round",
            transport: "browser",
            attempt: attempt + 1,
          });
          // Punish/кулдаун не ретраим на месте — ошибка уходит наверх,
          // агентный слой получит понятный код и сообщение о капче.
          if (error?.code === "QWEN_ANTIBOT_PUNISH") {
            if (postedOnce && error.delivery === "unknown") {
              const recovered = await this.recoverCheckpoint(chatId, { prompt: promptToUse, parentMessageId: parentId, qwenTurn: error.qwenTurn }).catch(() => null);
              if (recovered) return { result: finalizeQwenCompletionResult(recovered, "", "completion (challenge history)", this.accountId, completionStartedAt), chatInProgressStuck: false };
            }
            throw error;
          }
          // Native UI errors never fall back to another completion POST or a
          // different chat. The harness recovers this exact turn through GET.
          if (nativeComposer) throw error;
          // 2026-08-21: слепой re-POST того же body ЗАПРЕЩЁН, если POST уже
          // отправлялся. Сервер мог его получить (AbortError до первого
          // чанка — POST доставлен, генерация идёт): повтор создал бы
          // sibling-ветку под тем же юзер-месседжем (полевой инцидент:
          // «1/2» под запросом, дубль текста). Сначала harvest истории.
          // Let the harness wait and resume the checkpoint; keep the signed-in
          // browser. Pre-dispatch navigation failure needs neither harvest nor reset.
          if (error.delivery === "not_sent" && isQwenTransientBrowserTransportError(error)) throw error;
          if (postedOnce && isQwenTransientBrowserTransportError(error)) {
            const streamedText = roundStreamParser ? (roundStreamParser.snapshot?.() ?? "") : "";
            providerLogger.warn("provider.qwen.stream_resume", {
              operation: "transport_failure_harvest",
              chatId,
              attempt: attempt + 1,
              streamedChars: streamedText.length,
            });
            let harvestOutcome = null;
            const recovered = await harvestTransportFailedCompletion({
              chatId,
              streamedText,
              onText,
              sinceTimestamp: requestStartedSeconds,
              onOutcome: outcome => { harvestOutcome = outcome; },
              getProxy: () => getQwenBrowserProxy({ accountId: this.accountId, debug: this.debug }),
              debug: this.debug,
            });
            if (recovered) {
              return { result: finalizeQwenCompletionResult(recovered, "", "completion (browser, transport-harvest)", this.accountId, completionStartedAt), chatInProgressStuck: false };
            }
            if (harvestOutcome?.reason === "post_not_delivered") {
              return { result: null, chatInProgressStuck: false, transportStuck: true, transportError: error };
            }
            // Пустая история не доказывает, что POST не дошёл до Qwen.
            // После тайм-аута повтор может создать второй ответ на тот же запрос.
            throw error;
          }
          if (attempt >= 2 || !isQwenTransientBrowserTransportError(error)) {
            // Транспортная/авторизационная ошибка не считается «in progress».
            if (chatInProgressSeen) return { result: null, chatInProgressStuck: true };
            throw error;
          }
          if (this.debug) console.log(`[qwen] transient browser transport error, resetting proxy and retrying: ${error.message}`);
          await resetQwenBrowserProxy(this.accountId);
          continue;
        }
      }
      // Цикл вышел без return (теоретически недостижимо, но для безопасности).
      return { result: null, chatInProgressStuck: chatInProgressSeen };
    }

    await waitForQwenCompletionSlot({ accountId: this.accountId, signal });

    completionStartedAt = Date.now();

    // FALLBACK: прямой fetch с bx-ua из .env (обычно ломается на Bad_Request).
    return measureProviderExchange("qwen", async probe => {
      const res = await fetch(url, { method: "POST", headers, body: bodyStr, signal });
      probe.headers();

      if (!res.ok) {
        const text = await res.text();
        throwIfQwenRateLimited(res.status, text, res.headers.get("retry-after"), this.accountId);
        throwIfQwenAuthFailure(res.status, text, "completion");
      }

      const contentType = String(res.headers.get("content-type") || "");
      console.log(`[qwen] response content-type: ${contentType}`);

      // Единый парсинг через parseQwenResponseText: он корректно обрабатывает
      // и одиночный JSON-ошибку (success:false + data.code/details), и SSE-стрим,
      // и применяет formatQwenStreamError (в т.ч. читаемое сообщение для
      // «chat is in progress!»).
      const directText = await res.text();
      const parsed = parseQwenResponseText(directText, contentType, onText);
      if (parsed?.punish) {
        const { backoffMs } = startQwenPunishCooldown(Date.now(), this.accountId);
        throw createQwenPunishError(backoffMs, "rejected");
      }

      // Восстановление «chat is in progress!» работает и для direct-транспорта,
      // чтобы не зависеть от того, какой transport сейчас активен.
      if (isQwenInvalidParentError(parsed, directText)) {
        return { result: null, chatInProgressStuck: false, invalidParentStuck: true };
      }
      if (isQwenChatInProgressError(parsed, directText)) {
        return { result: null, chatInProgressStuck: true, invalidParentStuck: false };
      }

      const directFinalized = finalizeQwenCompletionResult(parsed, directText, "completion (direct)", this.accountId, completionStartedAt);
      return { result: directFinalized, chatInProgressStuck: false };
    }, { http: true });
  }

  // Восстановление оборванного SSE-стрима: сначала resume-POST по
  // response_id (сервер продолжает тот же ответ), затем harvest из
  // истории чата (сервер уже сохранил готовый ответ).
  // Возвращает новый parsed-результат или null (восстановить не удалось —
  // вызывающий код работает с частичным текстом как раньше).
  async #recoverTruncatedStream({ chatId, truncated, onText, onThinking }) {
    return recoverTruncatedQwenStream({
      chatId,
      truncated,
      onText,
      onThinking,
      getProxy: () => getQwenBrowserProxy({ accountId: this.accountId, debug: this.debug }),
      debug: this.debug,
    });
  }
}

// Понятное сообщение для пользователя, когда «The chat is in progress!»
// пережила и мягкие повторы, и попытку создать новый чат.
function formatQwenChatInProgressUserMessage() {
  return (
    "⏳ Qwen сейчас занят предыдущим ответом и не принимает новое сообщение в этот чат.\n\n" +
    "AI Free уже попробовал подождать и открыть свежий чат, но сервер Qwen пока не освободился.\n\n" +
    "Что сделать:\n" +
    "• Подожди ~10–20 секунд и пришли сообщение ещё раз — обычно этого хватает.\n" +
    "• Начни новый разговор кнопкой «Новый чат» — это гарантированно даёт чистый чат.\n" +
    "• Если ошибка повторяется часто, перезапусти чат: закрытие окна сбрасывает зависший turn."
  );
}

function formatQwenInvalidParentUserMessage() {
  return (
    "Qwen потерял связь с предыдущим сообщением этой ветки. " +
    "AI Free автоматически открыл свежий чат, но сервер повторно отклонил запрос. " +
    "Попробуй отправить сообщение ещё раз."
  );
}

// SSE-событие с полем error (квота, rate limit и т.д.) — не содержит текста ответа.
export function formatQwenStreamError(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  if (isQwenPunishStub(parsed)) {
    return (
      "Qwen отклонил запрос проверкой безопасности (RGV587). " +
      "Это не доказывает, что сообщение слишком длинное. " +
      "Если показана капча, пройдите её вручную; при временном ограничении подождите и повторите запрос позже."
    );
  }
  const err = parsed.error;
  if (err && typeof err === "object") {
    const code = String(err.code || err.type || "error");
    const details = String(
      err.details || err.message || err.detail || err.msg || JSON.stringify(err),
    );
    return formatQwenUserFacingError(code, details);
  }
  const data = parsed.data;
  if (parsed.success === false && data && typeof data === "object") {
    const code = String(data.code || data.type || "error");
    const details = String(data.details || data.message || data.detail || JSON.stringify(data));
    return formatQwenUserFacingError(code, details);
  }
  return null;
}

function isQwenPunishStub(parsed) {
  return Array.isArray(parsed?.ret)
    && parsed.ret.some((value) => /RGV587|FAIL_SYS_USER_VALIDATE/i.test(String(value)));
}

export function formatQwenUserFacingError(code, details) {
  const d = details.toLowerCase();
  const c = String(code || "").toLowerCase();
  if (isQwenAntiBotRejection(code, details)) {
    return formatQwenAntiBotMessage({ code, details });
  }
  if (isQwenSessionExpiredCode(c, details)) {
    return formatQwenSessionExpiredMessage({ code, details });
  }
  if (
    d.includes("quota exceeded")
    || d.includes("allocated quota")
    || d.includes("token-limit")
    || d.includes("insufficient quota")
  ) {
    return (
      "Qwen отклонил этот запрос по quota/token-limit.\n\n" +
      "Это не обязательно значит, что аккаунт полностью заблокирован: Qwen иногда отдаёт allocated quota exceeded на один тяжёлый запрос, а следующий короткий запрос проходит нормально.\n\n" +
      "Что сделать:\n" +
      "• Повтори запрос, если он был короткий\n" +
      "• Для большой /code-задачи разбей её на части или выбери модель полегче\n" +
      "• Если ошибка повторяется подряд, проверь лимиты / подписку: https://chat.qwen.ai\n" +
      "• Справка Alibaba: https://help.aliyun.com/zh/model-studio/error-code#token-limit\n\n" +
      `Код: ${code}\n${details}`
    );
  }
  if (d.includes("rate limit") || d.includes("too many requests") || code.includes("rate")) {
    return `Слишком много запросов к Qwen (rate limit).\n\n${details}`;
  }
  if (isQwenInvalidParentText(`${code} ${details}`)) {
    return formatQwenInvalidParentUserMessage();
  }
  if (d.includes("chat is in progress") || d.includes("chat_in_progress")) {
    return formatQwenChatInProgressUserMessage();
  }
  return `Qwen вернул ошибку (${code}):\n\n${details}`;
}

export function formatQwenStreamDisplay(thinkingText, answerText) {
  const thinking = String(thinkingText || "").trim();
  const answer = String(answerText || "").trim();
  if (thinking && answer) return `🧠 ${thinking}\n\n---\n\n${answer}`;
  if (thinking) return `🧠 ${thinking}`;
  return answer || "…";
}

function createQwenResponseSelector() {
  let targetResponseId = null;
  let sawCreatedEvent = false;
  const responseIndexes = new Map();

  return {
    accept(parsed) {
      const created = parsed?.["response.created"];
      if (created && typeof created === "object") {
        sawCreatedEvent = true;
        const responseId = created.response_id == null ? "" : String(created.response_id);
        const responseIndex = Number(created.response_index);
        if (responseId && Number.isFinite(responseIndex)) {
          responseIndexes.set(responseId, responseIndex);
        }
        if (responseId && responseIndex === 0) {
          targetResponseId = responseId;
        } else if (responseId && !targetResponseId && !Number.isFinite(responseIndex)) {
          targetResponseId = responseId;
        }
        return !responseId || responseId === targetResponseId;
      }

      const responseId = parsed?.response_id == null ? "" : String(parsed.response_id);
      if (!responseId) return true;
      if (targetResponseId) return responseId === targetResponseId;

      const responseIndex = responseIndexes.get(responseId);
      if (responseIndex === 0) {
        targetResponseId = responseId;
        return true;
      }
      if (Number.isFinite(responseIndex) || sawCreatedEvent) return false;

      // Older Qwen streams may omit response.created. In that format the first
      // text-bearing response is the only discriminator available.
      targetResponseId = responseId;
      return true;
    },
  };
}

export function createQwenIncrementalParser({ onText = null, onThinking = null } = {}) {
  let buffer = "";
  let fullText = "";
  let thinkingBuf = "";
  let lastMessageId = null;
  let error = null;
  let upstreamError = null;
  let punish = false;
  // Жизненный цикл стрима: нужен, чтобы отличить честное окончание
  // ([DONE] / delta.status=finished / finish_reason) от обрыва посреди
  // генерации — обрыв восстанавливается resume-POST по response_id.
  let streamFinished = false;
  let streamResponseId = "";
  const responseSelector = createQwenResponseSelector();

  function consumeEvent(raw) {
    const ev = parseSseEvent(raw);
    if (!ev.data) return;
    if (ev.data === "[DONE]") {
      streamFinished = true;
      return;
    }
    let parsed;
    try { parsed = JSON.parse(ev.data); } catch { return; }
    const rid = qwenStreamResponseIdOf(parsed);
    if (rid) streamResponseId = rid;
    if (qwenStreamHasTerminalMarker(parsed)) streamFinished = true;
    if (!responseSelector.accept(parsed)) return;
    if (isQwenPunishStub(parsed)) punish = true;
    const errMsg = formatQwenStreamError(parsed);
    if (errMsg) {
      error = errMsg;
      upstreamError = extractQwenErrorFields(parsed);
      return;
    }
    const found = extractTextRecursively(parsed);
    if (found.text) {
      if (found.isThinking) {
        thinkingBuf += found.text;
        onThinking?.(found.text);
      } else {
        fullText += found.text;
        onText?.(found.text);
      }
    }
    if (found.messageId) lastMessageId = String(found.messageId);
  }

  return {
    push(chunk) {
      const textLengthBefore = fullText.length;
      const thinkingLengthBefore = thinkingBuf.length;
      buffer += String(chunk || "");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        consumeEvent(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (error) break;
      }
      return fullText.length > textLengthBefore || thinkingBuf.length > thinkingLengthBefore;
    },
    // Мгновенный снимок видимого текста (для transport-harvest: хвост =
    // harvested минус уже отправленные дельты).
    snapshot() {
      return fullText;
    },
    finish(rawFallback = "") {
      if (buffer.trim()) consumeEvent(buffer);
      // Обрыв посреди генерации: контент шёл, но терминального маркера не
      // было. Отдаём частичный текст + флаги, чтобы вызывающий слой мог
      // переподключиться по response_id (см. createQwenStreamContinuation).
      const truncated = !streamFinished && (fullText.length > 0 || thinkingBuf.length > 0);
      if (error) {
        return { text: error, lastMessageId, thinkingText: thinkingBuf, error, upstreamError, punish, streamFinished, truncated, responseId: streamResponseId, contentReceived: false };
      }
      if (!fullText && !thinkingBuf) {
        const fallback = emptyQwenParseFallback(rawFallback, rawFallback, 0);
        // contentReceived=false: это диагностическое сообщение, а НЕ реальный
        // контент стрима. Resume-конвейер не должен принимать его за успех.
        return { ...fallback, error: null, punish, streamFinished, truncated: false, responseId: streamResponseId, contentReceived: false };
      }
      return { text: fullText, lastMessageId, thinkingText: thinkingBuf, error: null, punish, streamFinished, truncated, responseId: streamResponseId, contentReceived: true };
    },
  };
}

// response_id текущей генерации: приходит и в response.created, и в каждом
// content-чанке. Нужен для resume-POST (?response_id=...) и для harvest.
export function qwenStreamResponseIdOf(parsed) {
  const created = parsed?.["response.created"];
  if (created && typeof created === "object" && created.response_id != null) {
    return String(created.response_id);
  }
  if (parsed?.response_id != null) return String(parsed.response_id);
  return "";
}

// Терминальные маркеры SSE-стрима Qwen (любой из них = генерация завершена):
//   • choices[0].finish_reason (OpenAI-совместимый маркер)
//   • choices[0].delta.status === "finished" (собственный формат Qwen v2)
// [DONE] обрабатывается отдельно в consumeEvent.
export function qwenStreamHasTerminalMarker(parsed) {
  const choice = Array.isArray(parsed?.choices) ? parsed.choices[0] : null;
  if (!choice) return false;
  if (choice.finish_reason) return true;
  const status = choice?.delta?.status;
  return status === "finished" || status === "completed";
}

// Состояние сессии продолжения оборванного стрима. Морда шлёт ПУСТОЙ POST
// /api/v2/chat/completions?chat_id=<id>&response_id=<rid> и сервер продолжает
// тот же SSE-ответ — без создания sibling-ветки в дереве сообщений (слепой
// re-POST полного body порождает "2/2", "3/4" ретраи в веб-интерфейсе).
export function createQwenStreamContinuation({ chatId, responseId } = {}) {
  const rid = String(responseId || "");
  const maxResumes = Math.max(0, Number(process.env.QWEN_RESUME_MAX_ATTEMPTS ?? 2));
  let resumesUsed = 0;

  return {
    resumeUrl() {
      return `${QWEN_BASE_URL}/api/v2/chat/completions?chat_id=${encodeURIComponent(String(chatId || ""))}&response_id=${encodeURIComponent(rid)}`;
    },
    // Морда шлёт пустое тело; заголовки (bx-*, source: web, x-request-id)
    // проставляет browser-proxy как для обычного completion-запроса.
    resumeBody() {
      return "{}";
    },
    shouldResume({ truncated, streamFinished: finished } = {}) {
      if (!rid) return false;
      if (finished) return false;
      if (!truncated) return false;
      return resumesUsed < maxResumes;
    },
    markResumeAttempt() {
      resumesUsed += 1;
    },
    remainingResumes() {
      return Math.max(0, maxResumes - resumesUsed);
    },
    retryDelayMs() {
      return Number(process.env.QWEN_RESUME_RETRY_DELAY_MS || 1500);
    },
    get responseId() {
      return rid;
    },
  };
}

// Полный конвейер восстановления оборванного стрима. Прокси и паузы
// инжектируются (getProxy / retryDelayMs) — тестируется без браузера.
export async function recoverTruncatedQwenStream({
  chatId,
  truncated,
  onText = null,
  onThinking = null,
  getProxy,
  debug = false,
}) {
  const continuation = createQwenStreamContinuation({
    chatId,
    responseId: truncated?.responseId,
  });

  // --- Этап 1: RESUME (пустой POST ?response_id=...) ---
  while (continuation.shouldResume({ truncated: true, streamFinished: false })) {
    continuation.markResumeAttempt();
    try {
      const proxy = await getProxy();
      if (debug) console.log(`[qwen] stream truncated mid-generation; resuming response_id=${truncated.responseId} (remaining ${continuation.remainingResumes()})…`);
      providerLogger.warn("provider.qwen.stream_resume", {
        operation: "resume",
        chatId,
        responseId: truncated.responseId,
        remaining: continuation.remainingResumes(),
      });
      const resumeParser = createQwenIncrementalParser({ onText, onThinking });
      const resumeResult = await proxy.proxyFetchStream({
        url: continuation.resumeUrl(),
        body: continuation.resumeBody(),
        chatId,
        onRawChunk: (chunk) => resumeParser.push(chunk),
        maxAttempts: 1,
      });
      const resumeParsed = resumeParser.finish(resumeResult.text || "");
      const resumeGotContent = Boolean(resumeParsed.contentReceived);
      if (resumeParsed.streamFinished || (resumeGotContent && !resumeParsed.truncated)) {
        // Сервер продолжил стрим: склеиваем хвост с уже полученным текстом.
        // Дельту уже отдал в onText сам resumeParser (живой стрим наверх).
        // Диагностический текст от emptyQwenParseFallback (contentReceived=false)
        // успехом НЕ считается — идём к harvest.
        return {
          ...(resumeGotContent ? resumeParsed : {}),
          text: resumeGotContent ? truncated.text + (resumeParsed.text || "") : truncated.text,
          thinkingText: (truncated.thinkingText || "") + (resumeGotContent ? resumeParsed.thinkingText || "" : ""),
          resumed: true,
          truncated: false,
          streamFinished: resumeParsed.streamFinished || resumeGotContent,
          responseId: truncated.responseId,
        };
      }
      if (debug) console.log(`[qwen] resume attempt returned no continuation (${resumeResult.status}, bytes=${resumeResult.text?.length || 0})`);
    } catch (error) {
      providerLogger.warn("provider.qwen.stream_resume", {
        operation: "resume_error",
        chatId,
        responseId: truncated.responseId,
        error: error?.message || String(error),
      });
    }
    await waitForQwenChat(continuation.retryDelayMs());
  }

  // --- Этап 2: HARVEST (GET истории чата) ---
  try {
    const proxy = await getProxy();
    if (debug) console.log(`[qwen] resume exhausted; harvesting saved response ${truncated.responseId} from chat history…`);
    providerLogger.warn("provider.qwen.stream_resume", { operation: "harvest", chatId, responseId: truncated.responseId });
    const harvested = await harvestQwenChatMessage({
      chatId,
      responseId: truncated.responseId,
      fetcher: async ({ cursor }) => proxy.proxyApiGet({
        path: cursor
          ? `/api/v2/chats/${encodeURIComponent(chatId)}?cursor=${encodeURIComponent(cursor)}&direction=down&limit=10`
          : `/api/v2/chats/${encodeURIComponent(chatId)}?direction=up&limit=10`,
      }),
    });
    if (harvested.found && harvested.text) {
      // В streaming-режиме дельты уже ушли только до места обрыва —
      // до streamed-текста. Чтобы клиент получил хвост, вычисляем суффикс
      // сохранённого ответа и отдаём его через onText. Если сервер
      // переписал начало (общий префикс короткий) — не стримим ничего:
      // дублировать весь текст хуже, чем оставить честный обрыв.
      streamHarvestTail({
        harvestedText: harvested.text,
        streamedText: String(truncated.text || ""),
        onText,
      });
      return {
        text: harvested.text,
        lastMessageId: harvested.messageId,
        thinkingText: truncated.thinkingText || "",
        error: null,
        streamFinished: true,
        truncated: false,
        responseId: truncated.responseId,
        harvested: true,
      };
    }
    if (debug) console.log(`[qwen] harvest not found (${harvested.reason})`);
  } catch (error) {
    providerLogger.warn("provider.qwen.stream_resume", {
      operation: "harvest_error",
      chatId,
      responseId: truncated.responseId,
      error: error?.message || String(error),
    });
  }

  return null;
}

// Отдаёт через onText недостающий хвост harvest-текста (то, что сервер
// сгенерировал ПОСЛЕ обрыва стрима). Если streamed-текст не является
// префиксом сохранённого (сервер переписал начало) — хвост не стримим:
// дублирование хуже честного обрыва.
export function streamHarvestTail({ harvestedText, streamedText, onText }) {
  if (typeof onText !== "function") return;
  const saved = String(harvestedText || "");
  const streamed = String(streamedText || "");
  if (!saved) return;
  if (streamed && saved.startsWith(streamed)) {
    const tail = saved.slice(streamed.length);
    if (tail) onText(tail);
    return;
  }
  // Нет общего префикса (или streamed пуст и это не-стрим вызов) —
  // отдаём сохранённый текст целиком, только если наверх ничего не ушло.
  if (!streamed) {
    onText(saved);
  }
}

// First-content timeout (2026-08-24, kilocode over npm run api): сервер
// принял completion-POST, но не выдал ни чанка за firstContentMs (240s на
// деградированных днях). При этом генерация на сервере ЧАСТО ПРОДОЛЖАЕТСЯ —
// инцидент 2026-08-21 доказал, что ответ сохраняется в истории чата.
// Вместо мгновенного EMPTY_UPSTREAM_STREAM — пробуем harvest истории;
// если сервер так и не родил контент, ошибка уходит наверх как раньше.
export async function harvestAfterFirstContentTimeout({
  result,
  chatId,
  onText = null,
  sinceTimestamp = null,
  getProxy,
  pollMs,
  timeoutMs,
  debug = false,
}) {
  if (!isQwenFirstContentTimeoutResult(result)) {
    return { applicable: false };
  }
  const recovered = await harvestTransportFailedCompletion({
    chatId,
    streamedText: "",
    onText,
    sinceTimestamp,
    getProxy,
    pollMs,
    timeoutMs,
    debug,
  });
  if (!recovered) return { applicable: true, recovered: null };
  providerLogger.warn("provider.qwen.stream_resume", {
    operation: "first_content_timeout_harvest",
    chatId,
    chars: recovered.text?.length || 0,
  });
  return { applicable: true, recovered };
}

function findQwenErrorInSseText(text) {
  const blocks = text.split(/\r?\n\r?\n/).filter(Boolean);
  for (const raw of blocks) {
    const ev = parseSseEvent(raw);
    if (!ev.data || ev.data === "[DONE]") continue;
    try {
      const msg = formatQwenStreamError(JSON.parse(ev.data));
      if (msg) return msg;
    } catch {
      // ignore
    }
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload.startsWith("{")) continue;
    try {
      const msg = formatQwenStreamError(JSON.parse(payload));
      if (msg) return msg;
    } catch {
      // ignore
    }
  }
  return null;
}

function emptyQwenParseFallback(text, rawAccumulated, eventCount) {
  const scan = findQwenErrorInSseText(rawAccumulated || text);
  if (scan) {
    return { text: scan, lastMessageId: null, thinkingText: "" };
  }
  const bytes = (rawAccumulated || text).length;
  return {
    text:
      `Qwen ответил (${bytes} байт), но текста в ответе нет (только служебные события).\n\n` +
      `Сырой ответ (первые 1500 символов):\n\n${(rawAccumulated || text).slice(0, 1500)}`,
    lastMessageId: null,
    thinkingText: "",
  };
}

// Парсит полный текст ответа (от browser-proxy — он отдаёт весь body одним куском).
// Поддерживает оба варианта: одиночный JSON и SSE-стрим из много "data: {...}" блоков.
// Если передан onText callback, вызывает его для каждого найденного текстового кусочка.
export function parseQwenResponseText(text, contentType, onText) {
  const ct = String(contentType || "").toLowerCase();

  // Одиночный JSON-ответ (обычно — ошибка или non-streaming endpoint).
  if (ct.includes("application/json") || text.trim().startsWith("{")) {
    try {
      const json = JSON.parse(text);
      const errMsg = formatQwenStreamError(json);
      if (errMsg) {
        return { text: errMsg, lastMessageId: null, thinkingText: "", error: errMsg,
          upstreamError: extractQwenErrorFields(json), punish: isQwenPunishStub(json) };
      }
      const found = extractTextRecursively(json);
      if (found.text) {
        return { text: found.text, lastMessageId: found.messageId, thinkingText: found.isThinking ? found.text : "" };
      }
      return {
        text: `⚠️ Qwen вернул JSON, но текста в нём нет:\n\n${JSON.stringify(json, null, 2).slice(0, 1200)}`,
        lastMessageId: null,
        thinkingText: "",
      };
    } catch {
      // не JSON — падаем дальше на SSE-парсинг
    }
  }

  // SSE: разделяем по \n\n, парсим каждое событие.
  const events = text.split(/\r?\n\r?\n/).filter(Boolean);
  let fullText = "";
  let thinkingBuf = "";
  let lastMessageId = null;
  const responseSelector = createQwenResponseSelector();

  for (const raw of events) {
    const ev = parseSseEvent(raw);
    if (!ev.data || ev.data === "[DONE]") continue;
    let parsed;
    try { parsed = JSON.parse(ev.data); } catch { continue; }
    if (!responseSelector.accept(parsed)) continue;
    const errMsg = formatQwenStreamError(parsed);
    if (errMsg) {
      return { text: errMsg, lastMessageId, thinkingText: "", error: errMsg,
        upstreamError: extractQwenErrorFields(parsed), punish: isQwenPunishStub(parsed) };
    }
    const found = extractTextRecursively(parsed);
    if (found.text) {
      if (found.isThinking) {
        thinkingBuf += found.text;
      } else {
        fullText += found.text;
        onText?.(found.text);
      }
    }
    if (found.messageId) lastMessageId = String(found.messageId);
  }

  if (!fullText && !thinkingBuf) {
    return emptyQwenParseFallback(text, text, events.length);
  }
  return { text: fullText, lastMessageId, thinkingText: thinkingBuf };
}

// Парсер SSE-стрима Qwen.
// Формат у них точно не реверсили — ищем text/content рекурсивно по всему объекту.
// При DEEPSEEK_DEBUG_QWEN=1 печатаем КАЖДОЕ событие целиком для отладки.
async function parseQwenStream(res, onText, debug) {
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = "";
  let rawAccumulated = ""; // полный сырой стрим — для диагностики
  let fullText = "";
  let lastMessageId = null;
  let thinkingBuf = "";
  let eventCount = 0;
  let firstFewRaw = []; // первые 3 события сохраняем целиком для диагностики
  const responseSelector = createQwenResponseSelector();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;
    rawAccumulated += chunk;

    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const event = parseSseEvent(rawEvent);
      if (!event.data) continue;
      if (event.data === "[DONE]") {
        if (debug) console.error(`[qwen-sse] got [DONE] after ${eventCount} events, text="${fullText.slice(0,200)}"`);
        return { text: fullText, lastMessageId, thinkingText: thinkingBuf };
      }

      eventCount += 1;

      let parsed;
      try { parsed = JSON.parse(event.data); } catch {
        if (debug) console.error("[qwen-sse] non-JSON event:", event.data.slice(0, 300));
        continue;
      }

      if (!responseSelector.accept(parsed)) continue;

      const streamErr = formatQwenStreamError(parsed);
      if (streamErr) {
        if (debug) console.error("[qwen-sse] API error event:", streamErr.slice(0, 200));
        return { text: streamErr, lastMessageId, thinkingText: thinkingBuf };
      }

      // Сохраняем первые 3 события целиком — даже без debug. Если в конце текст пустой,
      // печатаем эти примеры в throw-сообщение или console чтобы было видно формат.
      if (firstFewRaw.length < 3) firstFewRaw.push(event.data);

      if (debug) console.error("[qwen-sse]", JSON.stringify(parsed));

      // ЖАДНЫЙ extract: рекурсивно ходим по объекту и собираем все строки из
      // полей, похожих на content/text/delta. Это работает, даже если формат
      // отличается от наших предположений (OpenAI-style choices[0].delta.content).
      const found = extractTextRecursively(parsed);
      if (found.text) {
        if (found.isThinking) {
          thinkingBuf += found.text;
        } else {
          fullText += found.text;
          onText?.(found.text);
        }
      }
      if (found.messageId) lastMessageId = String(found.messageId);
    }
  }

  // При debug — всегда дампим полный сырой стрим в файл, независимо от того,
  // распарсилось что-то или нет. Это даёт сравнение с тем, что приходит на фронт Qwen.
  if (debug) {
    try {
      fs.mkdirSync(QWEN_DEBUG_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(QWEN_DEBUG_DIR, "last-response.txt"),
        `# events=${eventCount}, bytes=${rawAccumulated.length}, extracted=${fullText.length}\n\n${rawAccumulated}`,
      );
      console.log(`[qwen] dumped response → ${path.join(QWEN_DEBUG_DIR, "last-response.txt")}`);
    } catch (e) {
      console.error(`[qwen] failed to dump response: ${e.message}`);
    }
  }

  // Если ничего не извлекли — печатаем СЫРОЙ стрим в чат целиком (первые 1500 символов).
  // Это всегда даёт юзеру что-то полезное, по чему я смогу починить парсер.
  if (!fullText && !thinkingBuf) {
    console.error(`[qwen-sse] no text extracted. Raw stream (${rawAccumulated.length} chars):\n${rawAccumulated.slice(0, 2000)}`);
    return emptyQwenParseFallback("", rawAccumulated, eventCount);
  }

  return { text: fullText, lastMessageId, thinkingText: thinkingBuf };
}

// Рекурсивно ищет в объекте поля content / text / delta и собирает строки.
// Возвращает первое найденное (Qwen обычно посылает по одному chunk за event).
// Различает thinking (поле phase === "think" / type === "think") и обычный ответ.
function extractTextRecursively(node, isThinking = false) {
  let text = "";
  let messageId = null;
  let foundThinking = isThinking;

  if (!node || typeof node !== "object") return { text, messageId, isThinking: foundThinking };

  // Проверка thinking phase в текущем узле.
  if (node.phase === "think" || node.phase === "thinking" || node.type === "think") {
    foundThinking = true;
  }

  // Прямые поля с текстом.
  if (typeof node.content === "string") text += node.content;
  if (typeof node.text === "string") text += node.text;
  if (typeof node.delta === "string") text += node.delta;
  if (typeof node.delta_content === "string") text += node.delta_content;

  // ID сообщения.
  if (typeof node.response_id === "string" || typeof node.response_id === "number") messageId = node.response_id;
  if (typeof node.message_id === "string" || typeof node.message_id === "number") messageId = node.message_id;
  if (typeof node.id === "string" && (node.role === "assistant" || node.role === "ai")) messageId = node.id;

  // Рекурсия в массивы.
  if (Array.isArray(node)) {
    for (const item of node) {
      const sub = extractTextRecursively(item, foundThinking);
      text += sub.text;
      if (sub.messageId) messageId = sub.messageId;
      if (sub.isThinking) foundThinking = sub.isThinking;
    }
    return { text, messageId, isThinking: foundThinking };
  }

  // Рекурсия в объект. ВАЖНО: не пропускаем delta/content — они могут быть
  // объектами (например, OpenAI-формат Qwen: choices[0].delta — это объект
  // с полями {role, content, phase, status}, и текст внутри content).
  // Пропускаем только метаданные (phase/type) — они не контейнеры с текстом.
  for (const [key, value] of Object.entries(node)) {
    if (["phase", "type"].includes(key)) continue;
    if (typeof value !== "object" || value === null) continue;
    const sub = extractTextRecursively(value, foundThinking);
    text += sub.text;
    if (sub.messageId) messageId = sub.messageId;
    if (sub.isThinking) foundThinking = sub.isThinking;
  }

  return { text, messageId, isThinking: foundThinking };
}

function parseSseEvent(raw) {
  const event = { event: "", data: "" };
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("event:")) event.event = line.slice(6).trim();
    else if (line.startsWith("data:")) {
      event.data += (event.data ? "\n" : "") + line.slice(5).trimStart();
    }
  }
  return event;
}

export function isQwenRecoverableStreamError(parsed, rawText = "") {
  const blob = `${parsed?.error || ""}\n${parsed?.text || ""}\n${rawText}`.toLowerCase();
  if (isQwenSessionExpiredText(blob)) return false;
  return /bad_request|internal_error|непредвиденн|unexpected error/.test(blob);
}

function isQwenInvalidParentText(text) {
  return /(?:invalid\s+input\s+chat\s+)?parent[_\s-]?id[^\n]*(?:not\s+exist|does\s+not\s+exist|invalid|unknown|not\s+found)/i.test(String(text || ""));
}

export function isQwenInvalidParentError(parsed, rawText = "") {
  const blob = `${parsed?.error || ""}\n${parsed?.text || ""}\n${rawText}`;
  return isQwenInvalidParentText(blob);
}

export function isQwenChatInProgressError(parsed, rawText = "") {
  const blob = `${parsed?.error || ""}\n${parsed?.text || ""}\n${rawText}`.toLowerCase();
  return /chat\s+is\s+(?:still\s+)?in\s+progress|chat_in_progress/.test(blob);
}

function waitForQwenChat(ms, signal) {
  return abortableDelay(ms, undefined, { signal: signal || undefined });
}

// An omitted parent follows the saved native chat, as a normal web reply does.
// Explicit checkpoint branches always remain pinned; never guess from a list.
export async function resolveQwenNativeParent(proxy, chatId, parentId) {
  if (parentId != null && parentId !== '') return parentId;
  const unavailable = () => Object.assign(new Error('Qwen: не удалось подтвердить завершённую ветку чата. Запрос не отправлен; задача сохранена.'),
    { code: 'QWEN_NATIVE_UI_UNAVAILABLE', delivery: 'not_sent' });
  if (await proxy.pendingCompletionRequests() !== 0) throw unavailable();
  const response = await proxy.proxyApiGet({ path: `/api/v2/chats/${encodeURIComponent(chatId)}?direction=up&limit=100`, chatId });
  if (await proxy.pendingCompletionRequests() !== 0) throw unavailable();
  if (response?.ok === false || response?.json?.success === false) {
    try { throwIfQwenSessionExpiredFromHttp(response.status, JSON.stringify(response.json || {}), 'Qwen history'); }
    catch (error) { error.delivery = 'not_sent'; throw error; }
  }
  const chat = response?.json?.data?.chat;
  const history = chat?.history;
  const nodes = history?.messages;
  if (response?.ok !== true || response.json?.success !== true || !nodes || typeof nodes !== 'object' || Array.isArray(nodes)
    || history.pagination?.has_more_newer !== false || history.pagination?.newest_id !== history.currentId) throw unavailable();
  if (!history.currentId && Object.keys(nodes).length === 0 && Array.isArray(chat.messages) && chat.messages.length === 0) return null;
  const current = nodes[history.currentId];
  if (!current || current.id !== history.currentId || current.role !== 'assistant' || current.done !== true
    || !Array.isArray(current.childrenIds) || current.childrenIds.length !== 0) throw unavailable();
  return current.id;
}

// A completion exchange is measured without changing buffered/streaming mode.
export function fetchQwenCompletionWithMetrics(proxy, request, { onText = null, onThinking = null,
  attempt = 1, onParser = () => {} } = {}) {
  const native = Boolean(request.nativeTurn) && typeof proxy.submitNativeTurn === "function";
  const live = native || typeof proxy.proxyFetchStream === "function";
  return measureProviderExchange("qwen", async probe => {
    const parser = live ? createQwenIncrementalParser({ onText: probe.text, onThinking: probe.thinking }) : null;
    onParser(parser);
    const completion = { ...request, maxAttempts: 1 };
    let result;
    try {
      result = native
      ? await proxy.submitNativeTurn({ ...request.nativeTurn, chatId: request.chatId, beforeSend: request.beforeSend,
        onRawChunk: chunk => parser.push(chunk) })
      : live
      ? await proxy.proxyFetchStream({ ...completion, onRawChunk: chunk => parser.push(chunk) })
      : await proxy.proxyFetch(completion);
    } catch (error) {
      if (isQwenTransientBrowserTransportError(error)) {
        error.code ||= "QWEN_BROWSER_TRANSPORT_FAILURE";
        error.delivery ||= "unknown";
      }
      throw error;
    }
    return { result, parser };
  }, { onText, onThinking, attempt, observeText: live });
}
