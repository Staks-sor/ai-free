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
import fs from "node:fs";
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
import { createFileLogger } from "../../logging/logger.mjs";

const providerLogger = createFileLogger({ component: "provider.qwen" });

export function isQwenTransientBrowserTransportError(error) {
  const message = String(error?.message || error || "");
  return /Execution context was destroyed|most likely because of a navigation|Target closed|Page closed|Context closed|Timeout .* exceeded|qwen_page_evaluate_timeout|net::ERR_ABORTED|Failed to fetch|request is finished/i.test(message);
}

function throwIfQwenAuthFailure(status, text, context) {
  try {
    throwIfQwenSessionExpiredFromHttp(status, text, context);
  } catch (error) {
    if (error?.isQwenSessionExpired) throw error;
  }
  const snippet = String(text || "").slice(0, 800);
  const err = new Error(`Qwen ${context} failed: HTTP ${status}: ${snippet}`);
  if (status === 401 || status === 403 || isQwenAuthError(err)) {
    err.isAuthError = true;
  }
  throw err;
}

function finalizeQwenCompletionResult(parsed, rawText, context) {
  if (parsed?.error) {
    const errText = String(parsed.error);
    if (isQwenSessionExpiredText(errText)) {
      throw createQwenSessionExpiredError({
        code: extractCodeFromCompletionText(errText),
        details: errText.slice(0, 300),
        context,
      });
    }
    return {
      text: errText,
      lastMessageId: parsed.lastMessageId ?? null,
      thinkingText: parsed.thinkingText || "",
    };
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
  constructor({ token, cookieHeader, debug = false }) {
    this.token = token;
    this.cookieHeader = cookieHeader;
    this.debug = debug;
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
  async createChat({ title = "Новый чат", model = ENV_DEFAULT_MODEL } = {}) {
    if (QWEN_TRANSPORT !== "browser") {
      // В direct-режиме fallback на клиентский UUID (всё равно direct не работает из-за анти-бота).
      const fallbackId = randomUUID();
      console.log(`[qwen] (direct transport) client-side chat_id: ${fallbackId}`);
      return fallbackId;
    }

    const proxy = await getQwenBrowserProxy({ debug: this.debug });
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
        throw new Error(
          "Qwen createChat returned HTML instead of JSON. " +
          "Обычно это значит, что chat.qwen.ai отдал login/anti-bot страницу вместо API. " +
          "Открой Qwen login заново и повтори запрос.",
        );
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
  }) {
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
        chatId, prompt, parentId, thinking, search, onText, onThinking, model,
        allowNewChatRecovery, autoRetry,
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
    parentId,
    thinking,
    search,
    onText,
    onThinking,
    model,
    allowNewChatRecovery,
    autoRetry,
  }) {
    const round = await this.#completionRound({
      chatId,
      prompt,
      parentId,
      thinking,
      search,
      onText,
      onThinking,
      model,
    });

    // Успех — отдаём как есть. Оба состояния ниже означают, что сохранённая
    // серверная ветка Qwen больше не пригодна и запрос надо перенести в свежий чат.
    const invalidParentStuck = Boolean(round.invalidParentStuck);
    if (!round.chatInProgressStuck && !invalidParentStuck) return round.result;

    // allowNewChatRecovery относится к занятости чата. Потерянный parent_id всегда
    // восстанавливаем автоматически: повтор с тем же parent_id заведомо не поможет.
    if (!allowNewChatRecovery && !invalidParentStuck) {
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
        await waitForQwenChat(delay);
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
          parentId: null,
          thinking,
          search,
          onText,
          onThinking,
          model,
        });
        if (!recovered.chatInProgressStuck && !recovered.invalidParentStuck) {
          return {
            ...recovered.result,
            recoveredChatId: freshChatId,
          };
        }
        if (this.debug) console.log(`[qwen] fresh chat_id=${freshChatId} also stuck in progress (attempt ${attempt}/${maxFreshAttempts}).`);
        // В авто-режиме — продолжаем цикл к следующей попытке. В интерактивном
        // (attempt=1, maxFreshAttempts=1) — выходим и отдаём сообщение ниже.
      } catch (recoveryError) {
        if (this.debug) console.log(`[qwen] new-chat recovery failed (attempt ${attempt}/${maxFreshAttempts}): ${recoveryError?.message || recoveryError}`);
        // Ошибка создания чата — в авто-режим продолжаем цикл, иначе падаем ниже.
      }
    }

    // Все попытки создания нового чата исчерпаны — отдаём понятное сообщение
    // вместо сырого «Bad_Request: The chat is in progress!».
    if (autoRetry && this.debug) {
      console.log(`[qwen] auto-retry exhausted after ${maxFreshAttempts} attempts — giving up.`);
    }
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
    parentId,
    thinking,
    search,
    onText,
    onThinking,
    model,
  }) {
    const body = buildQwenCompletionPayload({
      chatId,
      prompt,
      parentId,
      model,
      thinking,
      search,
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
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const proxy = await getQwenBrowserProxy({ debug: this.debug });
          const useLiveStream = typeof onText === "function" || typeof onThinking === "function";
          const streamParser = useLiveStream
            ? createQwenIncrementalParser({ onText, onThinking })
            : null;
          const result = useLiveStream
            ? await proxy.proxyFetchStream({
              url,
              body: bodyStr,
              chatId,
              onRawChunk: (chunk) => streamParser.push(chunk),
            })
            : await proxy.proxyFetch({ url, body: bodyStr, chatId });

          providerLogger.info("provider.qwen.response", {
            operation: "completion",
            transport: "browser",
            attempt: attempt + 1,
            statusCode: result.status,
            contentType: result.contentType,
            responseBytes: result.text?.length || 0,
          });

          if (this.debug) {
            try {
              fs.mkdirSync(QWEN_DEBUG_DIR, { recursive: true });
              fs.writeFileSync(
                path.join(QWEN_DEBUG_DIR, "last-response.txt"),
                `# transport=browser, stream=${useLiveStream}, status=${result.status}, content-type=${result.contentType}, bytes=${result.text?.length || 0}\n\n${result.text || ""}`,
              );
              console.log(`[qwen] dumped response → ${path.join(QWEN_DEBUG_DIR, "last-response.txt")}`);
            } catch {}
          }

          if (!result.ok) {
            throwIfQwenAuthFailure(result.status, result.text, "completion (browser)");
          }

          const parsed = useLiveStream
            ? streamParser.finish(result.text)
            : parseQwenResponseText(result.text, result.contentType, onText);

          if (isQwenInvalidParentError(parsed, result.text)) {
            return { result: null, chatInProgressStuck: false, invalidParentStuck: true };
          }

          if (isQwenChatInProgressError(parsed, result.text)) {
            chatInProgressSeen = true;
            if (attempt < 2) {
              const waitMs = 1_500 * (attempt + 1);
              providerLogger.warn("provider.qwen.retry", {
                operation: "chat_in_progress",
                attempt: attempt + 1,
                waitMs,
              });
              if (this.debug) console.log(`[qwen] chat is still finalizing; retrying same turn in ${waitMs}ms…`);
              await waitForQwenChat(waitMs);
              continue;
            }
            // Все 3 попытки в тот же чат ушли в «in progress».
            return { result: null, chatInProgressStuck: true };
          }

          if (attempt < 2 && isQwenRecoverableStreamError(parsed, result.text)) {
            if (this.debug) console.log("[qwen] recoverable stream error, resetting browser proxy…");
            await resetQwenBrowserProxy();
            continue;
          }

          return { result: finalizeQwenCompletionResult(parsed, result.text, "completion (browser)"), chatInProgressStuck: false };
        } catch (error) {
          providerLogger.error("provider.qwen.error", error, {
            operation: "completion_round",
            transport: "browser",
            attempt: attempt + 1,
          });
          if (attempt >= 2 || !isQwenTransientBrowserTransportError(error)) {
            // Транспортная/авторизационная ошибка не считается «in progress».
            if (chatInProgressSeen) return { result: null, chatInProgressStuck: true };
            throw error;
          }
          if (this.debug) console.log(`[qwen] transient browser transport error, resetting proxy and retrying: ${error.message}`);
          await resetQwenBrowserProxy();
          continue;
        }
      }
      // Цикл вышел без return (теоретически недостижимо, но для безопасности).
      return { result: null, chatInProgressStuck: chatInProgressSeen };
    }

    // FALLBACK: прямой fetch с bx-ua из .env (обычно ломается на Bad_Request).
    const res = await fetch(url, { method: "POST", headers, body: bodyStr });

    if (!res.ok) {
      const text = await res.text();
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

    // Восстановление «chat is in progress!» работает и для direct-транспорта,
    // чтобы не зависеть от того, какой transport сейчас активен.
    if (isQwenInvalidParentError(parsed, directText)) {
      return { result: null, chatInProgressStuck: false, invalidParentStuck: true };
    }
    if (isQwenChatInProgressError(parsed, directText)) {
      return { result: null, chatInProgressStuck: true, invalidParentStuck: false };
    }

    const directFinalized = finalizeQwenCompletionResult(parsed, directText, "completion (direct)");
    return { result: directFinalized, chatInProgressStuck: false };
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
  const responseSelector = createQwenResponseSelector();

  function consumeEvent(raw) {
    const ev = parseSseEvent(raw);
    if (!ev.data || ev.data === "[DONE]") return;
    let parsed;
    try { parsed = JSON.parse(ev.data); } catch { return; }
    if (!responseSelector.accept(parsed)) return;
    const errMsg = formatQwenStreamError(parsed);
    if (errMsg) {
      error = errMsg;
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
      buffer += String(chunk || "");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        consumeEvent(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (error) break;
      }
    },
    finish(rawFallback = "") {
      if (buffer.trim()) consumeEvent(buffer);
      if (error) {
        return { text: error, lastMessageId, thinkingText: thinkingBuf, error };
      }
      if (!fullText && !thinkingBuf) {
        const fallback = emptyQwenParseFallback(rawFallback, rawFallback, 0);
        return { ...fallback, error: null };
      }
      return { text: fullText, lastMessageId, thinkingText: thinkingBuf, error: null };
    },
  };
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
        return { text: errMsg, lastMessageId: null, thinkingText: "" };
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
      return { text: errMsg, lastMessageId, thinkingText: "" };
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

function waitForQwenChat(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
