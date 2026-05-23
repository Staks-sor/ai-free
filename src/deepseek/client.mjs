// HTTP-клиент к chat.deepseek.com.
// На каждый запрос — подписи (cookies + Bearer), PoW для completion, SSE-парсинг.
// _withReauth: до двух retry на запрос — после silent refresh и после visible re-login.

import { BASE_URL, COMPLETION_PATH } from "../config.mjs";
import { baseHeaders } from "./headers.mjs";
import { solvePow } from "./pow.mjs";
import { streamSse } from "./sse.mjs";

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

  async complete(args) {
    return await this._withReauth(() => this._completeOnce(args));
  }

  // Загрузка файла на DeepSeek для использования в vision-режиме.
  // Endpoint и формат — реконструированы из network log'а:
  // POST /api/v0/file/upload_file с multipart/form-data, PoW обязателен,
  // возвращает file_id с префиксом "file-". Этот id потом идёт в ref_file_ids
  // массиве запроса completion.
  async uploadFile(buffer, mimeType, filename) {
    return await this._withReauth(() => this._uploadFileOnce(buffer, mimeType, filename));
  }

  async _uploadFileOnce(buffer, mimeType, filename) {
    const path = "/api/v0/file/upload_file";
    const pow = await this.createPowHeader(path);

    const form = new FormData();
    const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
    form.append("file", blob, filename || "upload.bin");

    const headers = baseHeaders(this.cookieHeader, this.token);
    // FormData сама проставит Content-Type с boundary — наш дефолтный убираем.
    delete headers["Content-Type"];
    headers["X-DS-PoW-Response"] = pow;

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

    // file_id может лежать в нескольких местах — ищем во всех типичных.
    const biz = json?.data?.biz_data;
    const candidates = [
      biz?.file_id,
      biz?.id,
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

    // КРИТИЧНО: upload возвращает file_id сразу, но статус "PENDING" — файл ещё
    // обрабатывается асинхронно. Если шлём его в completion слишком рано, получаем
    // biz_code 9 "invalid ref file id". Ждём, пока статус сменится на READY/SUCCESS.
    const initialStatus = biz?.status;
    if (initialStatus === "PENDING") {
      console.log(`[upload] file ${fileId} is PENDING — waiting for DeepSeek to process...`);
      const finalStatus = await this.waitForFileReady(fileId);
      console.log(`[upload] file ${fileId} ready (status=${finalStatus})`);
    }

    return fileId;
  }

  // Polling статуса файла после upload. DeepSeek обрабатывает картинки 1-3 сек.
  // Делаем GET /api/v0/file/fetch_files?file_ids=<id>, ждём пока status уйдёт из PENDING.
  // Возвращает финальный статус (для логирования наверх).
  async waitForFileReady(fileId, { timeoutMs = 60000, intervalMs = 600 } = {}) {
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
      let file = null;
      if (Array.isArray(biz)) file = biz[0];
      else if (biz?.files && Array.isArray(biz.files)) file = biz.files[0];
      else if (biz?.id) file = biz;

      const status = file?.status;
      lastStatus = status;
      if (this.debug) {
        console.error(`[upload] poll #${attempt} ${fileId}: status=${status} audit=${file?.audit_result}`);
      }

      if (status && status !== "PENDING") {
        if (status === "FAILED" || status === "ERROR" || file?.error_code) {
          throw new Error(
            `File processing failed: status=${status}, error_code=${file?.error_code}, audit=${file?.audit_result}`,
          );
        }
        // SUCCESS / READY / DONE / etc — годится.
        return status;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`File ${fileId} still ${lastStatus || "PENDING"} after ${timeoutMs}ms (timeout)`);
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
      } catch (parseError) {
        if (parseError?.isAuthError) throw parseError;
      }
      throw new Error(`Completion failed: HTTP ${res.status}: ${text.slice(0, 1000)}`);
    }

    return streamSse(res, this.debug, onText);
  }
}
