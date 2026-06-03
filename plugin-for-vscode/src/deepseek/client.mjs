// HTTP-клиент к chat.deepseek.com.
// На каждый запрос — подписи (cookies + Bearer), PoW для completion, SSE-парсинг.
// _withReauth: до двух retry на запрос — после silent refresh и после visible re-login.

import { BASE_URL, COMPLETION_PATH } from "../config.mjs";
import { baseHeaders } from "./headers.mjs";
import { solvePow } from "./pow.mjs";
import { streamSse } from "./sse.mjs";

// Экспорт для тестов и документации статусов upload/fetch_files.
const FILE_STATUS_READY = [
  "SUCCESS", "READY", "DONE", "COMPLETED", "FINISHED", "OK", "AVAILABLE", "SUCCEEDED",
];
const FILE_STATUS_PENDING = [
  "PENDING", "PROCESSING", "UPLOADING", "RUNNING", "PARSING", "PARSE",
  "PARSING_IMAGE", "INDEXING", "QUEUED", "WAITING", "INIT", "INITIALIZING",
];

export function isDeepSeekFileReadyStatus(status) {
  const s = String(status || "").toUpperCase();
  if (!s) return false;
  if (isDeepSeekFileFailedStatus(status)) return false;
  if (FILE_STATUS_PENDING.includes(s) || s.includes("PARS")) return false;
  return FILE_STATUS_READY.includes(s);
}

// Терминальная ошибка — polling бессмысленен (CONTENT_EMPTY = «картинку не разобрали»).
export function isDeepSeekFileFailedStatus(status, file = null) {
  const s = String(status || "").toUpperCase();
  if (!s) return false;
  if (["FAILED", "ERROR", "REJECTED", "DELETED", "CANCELLED", "CONTENT_EMPTY"].includes(s)) {
    return true;
  }
  if (s.endsWith("_EMPTY") || s.includes("AUDIT_FAIL") || s.includes("UNSAFE")) return true;
  if (file?.error_code) return true;
  const audit = String(file?.audit_result || "").toUpperCase();
  if (audit && (audit.includes("FAIL") || audit.includes("REJECT") || audit.includes("BLOCK"))) {
    return true;
  }
  return false;
}

export function formatDeepSeekFileFailure(file, fileId) {
  const status = String(file?.status || "unknown");
  const name = file?.file_name || file?.name || fileId;
  if (status.toUpperCase() === "CONTENT_EMPTY") {
    return (
      `DeepSeek не смог обработать изображение «${name}» (статус CONTENT_EMPTY: пустое содержимое). ` +
      `Частые причины: SVG/слишком большой файл/картинка без распознаваемого текста или объектов. ` +
      `Попробуй JPG или PNG до 4 МБ, со скриншотом или фото с чётким содержимым.`
    );
  }
  const extra = [
    file?.error_code ? `error_code=${file.error_code}` : "",
    file?.audit_result ? `audit=${file.audit_result}` : "",
  ].filter(Boolean).join(", ");
  return `Обработка файла «${name}» не удалась (status=${status}${extra ? `, ${extra}` : ""}).`;
}

export class DeepSeekChatClient {
  constructor({ cookieHeader, token, debug, authManager = null }) {
    this.cookieHeader = cookieHeader;
    this.token = token;
    this.debug = debug;
    this.authManager = authManager;
  }

  setAuthManager(authManager) {
    this.authManager = authManager;
  }

  _applyAuth(auth) {
    if (!auth) return;
    if (auth.cookieHeader) this.cookieHeader = auth.cookieHeader;
    if (auth.token) this.token = auth.token;
  }

  // Обёртка с эскалацией: до 2 retry на один API-вызов.
  // 1-й retry — после silent headless refresh.
  // 2-й retry — после visible re-login (forceVisible=true, силент пропускается).
  async _withReauth(fn) {
    let escalate = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        if (!error?.isAuthError || !this.authManager) throw error;
        if (attempt >= 2) throw error;
        if (this.debug) {
          console.error(`[auth] attempt ${attempt + 1} got auth error; refreshing (escalate=${escalate}).`);
        }
        const fresh = await this.authManager.refresh({ forceVisible: escalate });
        this._applyAuth(fresh);
        escalate = true;
      }
    }
    throw new Error("unreachable: _withReauth retry budget exhausted");
  }

  async json(path, opts = {}) {
    return await this._withReauth(() => this._jsonOnce(path, opts));
  }

  async _jsonOnce(path, { method = "GET", body, headers = {} } = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { ...baseHeaders(this.cookieHeader, this.token), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      if (res.status === 401 || res.status === 403) {
        const err = new Error(`Auth required at ${path}: HTTP ${res.status}`);
        err.isAuthError = true;
        throw err;
      }
      throw new Error(
        `Expected JSON from ${path}, got HTTP ${res.status}: ${text.slice(0, 180)}`,
      );
    }

    if (this.debug) {
      console.error(`[debug] ${method} ${path} -> HTTP ${res.status}`, json);
    }

    if (
      res.status === 401 ||
      res.status === 403 ||
      (json && (json.code === 40002 || json.code === 40003))
    ) {
      const err = new Error(
        `Auth required at ${path}: code ${json?.code ?? ""}, http ${res.status}`,
      );
      err.isAuthError = true;
      throw err;
    }

    if (!res.ok || (json.code !== undefined && json.code !== 0)) {
      throw new Error(
        `DeepSeek API error at ${path}: HTTP ${res.status}, code ${json.code}, msg ${json.msg || ""}`,
      );
    }

    return json;
  }

  async createSession() {
    const json = await this.json("/api/v0/chat_session/create", {
      method: "POST",
      body: {},
    });

    const session = json?.data?.biz_data?.chat_session;
    if (!session?.id) {
      throw new Error(`Cannot read chat session id: ${JSON.stringify(json).slice(0, 300)}`);
    }
    return session.id;
  }

  async createPowHeader(targetPath) {
    const json = await this.json("/api/v0/chat/create_pow_challenge", {
      method: "POST",
      body: { target_path: targetPath },
    });

    const challenge = json?.data?.biz_data?.challenge;
    if (!challenge) {
      throw new Error(`Cannot read PoW challenge: ${JSON.stringify(json).slice(0, 300)}`);
    }

    const answer = await solvePow(challenge);
    const payload = {
      algorithm: challenge.algorithm,
      challenge: challenge.challenge,
      salt: challenge.salt,
      answer,
      signature: challenge.signature,
      target_path: targetPath,
    };

    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  }

  // Загрузка файла на DeepSeek для использования в vision-режиме.
  // Endpoint и формат — реконструированы из network log'а:
  // POST /api/v0/file/upload_file с multipart/form-data, PoW обязателен,
  // возвращает file_id с префиксом "file-". Этот id потом идёт в ref_file_ids
  // массиве запроса completion.
  async uploadFile(buffer, mimeType, filename, options = {}) {
    return await this._withReauth(() =>
      this._uploadFileOnce(buffer, mimeType, filename, options),
    );
  }

  async _uploadFileOnce(buffer, mimeType, filename, { chatSessionId = null } = {}) {
    const path = "/api/v0/file/upload_file";
    const pow = await this.createPowHeader(path);

    const form = new FormData();
    const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
    form.append("file", blob, filename || "upload.bin");
    if (chatSessionId) {
      form.append("chat_session_id", String(chatSessionId));
    }

    const headers = baseHeaders(this.cookieHeader, this.token);
    // FormData сама проставит Content-Type с boundary — наш дефолтный убираем.
    delete headers["Content-Type"];
    headers["X-DS-PoW-Response"] = pow;
    // Фронт DeepSeek шлёт x-file-size — без него upload может вернуть id, но ref_file_ids даст biz_code 9.
    headers["x-file-size"] = String(buffer?.byteLength ?? buffer?.length ?? 0);

    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers,
      body: form,
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      if (res.status === 401 || res.status === 403) {
        const err = new Error(`Auth required during upload: HTTP ${res.status}`);
        err.isAuthError = true;
        throw err;
      }
      throw new Error(`Upload failed: HTTP ${res.status}: ${text.slice(0, 400)}`);
    }

    if (this.debug) {
      console.error(`[debug] POST ${path} -> HTTP ${res.status}`, json);
    }

    if (
      res.status === 401 ||
      res.status === 403 ||
      (json && (json.code === 40002 || json.code === 40003))
    ) {
      const err = new Error(`Auth required during upload: code ${json?.code ?? ""}`);
      err.isAuthError = true;
      throw err;
    }

    if (!res.ok || (json.code !== undefined && json.code !== 0)) {
      throw new Error(`Upload failed: HTTP ${res.status}, code ${json.code}, msg ${json.msg || ""}: ${text.slice(0, 400)}`);
    }

    const bizWrap = json?.data;
    if (bizWrap?.biz_code !== undefined && bizWrap.biz_code !== 0) {
      throw new Error(
        `Upload rejected: biz_code ${bizWrap.biz_code}, ${bizWrap.biz_msg || ""}: ${text.slice(0, 400)}`,
      );
    }

    // file_id в ответе DeepSeek обычно в data.biz_data.id (формат "file-<uuid>").
    const biz = bizWrap?.biz_data;
    const candidates = [
      biz?.id,
      biz?.file_id,
      biz?.file?.id,
      biz?.file?.file_id,
      biz?.uuid,
      json?.data?.file_id,
      json?.data?.id,
    ].filter(Boolean);
    let fileId = candidates[0];

    // ВСЕГДА логируем что вернул upload — в дебаге, и в исключении при проблемах.
    // Это полезно, потому что точные пути в JSON могут меняться у DeepSeek.
    if (this.debug) {
      console.error("[upload] response:", JSON.stringify(json).slice(0, 1000));
      console.error("[upload] extracted candidates:", candidates);
    }

    if (!fileId) {
      throw new Error(
        `Upload OK but no file_id in response. Body: ${text.slice(0, 600)}`,
      );
    }

    // DeepSeek в completion ждёт file_id с префиксом "file-".
    fileId = String(fileId);
    if (!fileId.startsWith("file-")) {
      if (this.debug) console.error(`[upload] adding "file-" prefix to: ${fileId}`);
      fileId = "file-" + fileId;
    }

    // КРИТИЧНО: даже при status SUCCESS в ответе upload файл может быть ещё не готов
    // для ref_file_ids → biz_code 9 "invalid ref file id". Всегда ждём через fetch_files.
    const initialStatus = biz?.status;
    console.log(
      `[upload] file ${fileId} uploaded (initial status=${initialStatus ?? "unknown"}), waiting until ready...`,
    );
    const finalStatus = await this.waitForFileReady(fileId);
    console.log(`[upload] file ${fileId} ready (status=${finalStatus})`);

    return fileId;
  }

  // Найти запись файла в ответе fetch_files по id (с учётом/без префикса "file-").
  _findFileInBizData(biz, fileId) {
    if (!biz) return null;
    const list = [];
    if (Array.isArray(biz)) list.push(...biz);
    else if (Array.isArray(biz.files)) list.push(...biz.files);
    else list.push(biz);

    const target = String(fileId);
    const variants = new Set([
      target,
      target.startsWith("file-") ? target.slice(5) : `file-${target}`,
    ]);

    for (const item of list) {
      const ids = [item?.id, item?.file_id].filter(Boolean).map(String);
      if (ids.some((id) => variants.has(id) || variants.has(`file-${id}`) || id === target)) {
        return item;
      }
    }
    return list[0] || null;
  }

  _isFileReadyStatus(status) {
    return isDeepSeekFileReadyStatus(status);
  }

  static _isInvalidRefFileError(error) {
    const msg = String(error?.message || "");
    return /biz_code\s*9/i.test(msg) || /invalid ref file id/i.test(msg);
  }

  // Polling статуса файла после upload. Картинки 3–15+ сек (PENDING → PARSING → SUCCESS).
  async waitForFileReady(fileId, { timeoutMs = 120000, intervalMs = 800, settleMs = 1200 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastStatus = null;
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt += 1;
      let json;
      try {
        json = await this.json(
          `/api/v0/file/fetch_files?file_ids=${encodeURIComponent(fileId)}`,
          { method: "GET" },
        );
      } catch (error) {
        console.error(`[upload] fetch_files attempt ${attempt} failed: ${error.message}`);
        throw error;
      }

      // Структура ответа: data.biz_data может быть массивом, объектом с files,
      // или одиночным объектом — пробуем все варианты.
      const biz = json?.data?.biz_data;
      const file = this._findFileInBizData(biz, fileId);
      const status = file?.status;
      lastStatus = status;
      const audit = file?.audit_result;
      const errCode = file?.error_code;
      console.log(
        `[upload] poll #${attempt} ${fileId}: status=${status ?? "?"}`
          + (audit != null ? ` audit=${audit}` : "")
          + (errCode != null ? ` error_code=${errCode}` : ""),
      );

      if (isDeepSeekFileFailedStatus(status, file)) {
        throw new Error(formatDeepSeekFileFailure(file, fileId));
      }

      if (this._isFileReadyStatus(status)) {
        if (settleMs > 0) {
          console.log(`[upload] status=${status}, settle ${settleMs}ms before ref_file_ids…`);
          await new Promise((resolve) => setTimeout(resolve, settleMs));
        }
        return status;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    if (isDeepSeekFileFailedStatus(lastStatus)) {
      throw new Error(formatDeepSeekFileFailure({ status: lastStatus }, fileId));
    }
    throw new Error(
      `Файл ${fileId} не стал готов за ${Math.round(timeoutMs / 1000)} с (последний status=${lastStatus || "unknown"}). ` +
        `Если status завис на PARSING — подожди и повтори; если CONTENT_EMPTY — смени изображение.`,
    );
  }

  // Completion с ref_file_ids: при biz_code 9 повторно ждём готовность файлов и ретраим.
  async complete(args) {
    const refFileIds = Array.isArray(args?.refFileIds) ? args.refFileIds.filter(Boolean) : [];
    if (!refFileIds.length) {
      return await this._withReauth(() => this._completeOnce(args));
    }
    return await this._withReauth(() => this._completeOnceWithRefRetry(args, refFileIds));
  }

  async _completeOnceWithRefRetry(args, refFileIds, { maxAttempts = 4 } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (attempt > 1) {
        console.log(`[upload] ref_file retry ${attempt}/${maxAttempts} — re-check file readiness…`);
        for (const fileId of refFileIds) {
          await this.waitForFileReady(fileId, { timeoutMs: 120000, intervalMs: 800, settleMs: 1500 });
        }
      }
      try {
        return await this._completeOnce(args);
      } catch (error) {
        lastError = error;
        if (!DeepSeekChatClient._isInvalidRefFileError(error) || attempt >= maxAttempts) {
          throw error;
        }
        console.log(`[upload] completion got invalid ref_file_id, will retry after wait…`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    throw lastError;
  }

async _completeOnce({
     sessionId,
     prompt,
     parentMessageId = null,
     modelType = null,
     thinkingEnabled = false,
     searchEnabled = false,
     onText = null,
     refFileIds = [],
   }) {
     const pow = await this.createPowHeader(COMPLETION_PATH);
     const body = {
       chat_session_id: sessionId,
       parent_message_id: parentMessageId,
       preempt: false, // отдаёт прерывание предыдущего стрима; их фронт шлёт всегда
       prompt,
       ref_file_ids: Array.isArray(refFileIds) ? refFileIds : [],
       thinking_enabled: thinkingEnabled,
       search_enabled: searchEnabled,
     };
     if (modelType != null) body.model_type = modelType;

    // Безусловный лог флагов — чтоб видеть, что реально уходит в API.
    // Полезно для отладки «почему режимы не работают».
    console.log(
      `[complete] model_type=${modelType} thinking=${thinkingEnabled} search=${searchEnabled} ref_files=${body.ref_file_ids.length}`,
    );

    const res = await fetch(`${BASE_URL}${COMPLETION_PATH}`, {
      method: "POST",
      headers: {
        ...baseHeaders(this.cookieHeader, this.token),
        "X-DS-PoW-Response": pow,
      },
      body: JSON.stringify(body),
    });

    const contentType = String(res.headers.get("content-type") || "");
    if (!res.ok || !contentType.includes("text/event-stream")) {
      const text = await res.text();
      if (res.status === 401 || res.status === 403) {
        const err = new Error(`Auth required during completion: HTTP ${res.status}`);
        err.isAuthError = true;
        throw err;
      }
      try {
        const parsed = JSON.parse(text);
        if (parsed && (parsed.code === 40002 || parsed.code === 40003)) {
          const err = new Error(`Auth required during completion: code ${parsed.code}`);
          err.isAuthError = true;
          throw err;
        }
        const bizCode = parsed?.data?.biz_code;
        const bizMsg = parsed?.data?.biz_msg || "";
        if (bizCode === 9 || /invalid ref file id/i.test(bizMsg)) {
          throw new Error(
            `Изображение ещё не готово для распознавания (biz_code 9: invalid ref file id). ` +
              `Подожди несколько секунд и отправь сообщение снова, или прикрепи картинку заново. ` +
              `ref_files=${JSON.stringify(refFileIds)}`,
          );
        }
        if (bizCode !== undefined && bizCode !== 0) {
          throw new Error(`Completion rejected: biz_code ${bizCode}, ${bizMsg}: ${text.slice(0, 500)}`);
        }
      } catch (parseError) {
        if (parseError?.isAuthError) throw parseError;
        if (parseError?.message?.includes("biz_code") || parseError?.message?.includes("ref file")) {
          throw parseError;
        }
      }
      throw new Error(`Completion failed: HTTP ${res.status}: ${text.slice(0, 1000)}`);
    }

    return streamSse(res, this.debug, onText);
  }
}
