// Standalone OpenAI-совместимый сервер (прототип).
//
// Запуск:
//   node api/server.mjs
//   # или с debug
//   API_DEBUG=1 node api/server.mjs
//
// По умолчанию слушает 127.0.0.1:4318 (UI-сервер живёт на 4317 — не конфликтуют).
//
// Тест из терминала:
//   curl http://127.0.0.1:4318/v1/models | jq
//
//   curl http://127.0.0.1:4318/v1/chat/completions \
//     -H 'Content-Type: application/json' \
//     -d '{"model":"qwen3.7-max","messages":[{"role":"user","content":"привет"}]}' | jq
//
// Тест из Continue.dev / Cursor:
//   baseURL: http://127.0.0.1:4318/v1
//   apiKey:  ключ из Settings, если он создан
//   model:   qwen3.7-max  (или любая из /v1/models)

import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../src/args.mjs";
import { resolveOpenAICompatApiKey } from "../src/state/settings.mjs";
import { createFileLogger } from "../src/logging/logger.mjs";

loadDotEnv();

// Запускаем proactive refresh timer СРАЗУ при старте сервера, а не при
// первом запросе. Если auth.json уже существует — QwenAuthManager создастся
// и timer начнёт тикать. Если нет (юзер ещё не логинился) — ничего не
// произойдёт, timer запустится после первого `npm run login-qwen`.
//
// Это исправляет сценарий «сервер запущен, юзер не делал запросов час,
// потом делает первый запрос — а токен уже протух». Без этого фикса
// proactive timer запускается только в getQwenClient(), а getQwenClient()
// ленивый — он не вызывается без запроса.
(async () => {
  try {
    const QWEN_AUTH_FILE = path.join(os.homedir(), ".qwen-cli", "auth.json");
    if (fs.existsSync(QWEN_AUTH_FILE)) {
      const { getQwenAuthManager } = await import("../src/providers/qwen/auth-manager.mjs");
      getQwenAuthManager();
    }
  } catch (err) {
    console.warn(`[api] could not pre-start Qwen proactive refresh: ${err.message}`);
  }
})();

let handleRequestFn;
async function resolveRequestHandler() {
  if (!handleRequestFn) ({ handleRequest: handleRequestFn } = await import("./openai-handler.mjs"));
  return handleRequestFn;
}

export const DEFAULT_API_PORT = 4318;
export const DEFAULT_API_HOST = "127.0.0.1"; // намеренно НЕ слушаем на 0.0.0.0 — только локально
const apiLogger = createFileLogger({ component: "openai-api" });

export function createOpenAICompatServer() {
  return http.createServer(async (req, res) => {
    const startedAt = Date.now();
    const requestPath = String(req.url || "/").split("?", 1)[0];
    res.once("finish", () => {
      apiLogger.info("api.request.complete", {
        method: req.method,
        path: requestPath,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        provider: req.openAICompatProvider || null,
      });
    });
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    // CORS — на всякий случай, для веб-клиентов на localhost.
    setOpenAICorsHeaders(res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }
    const apiAuth = resolveOpenAICompatApiKey(req);
    if (!apiAuth.ok) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({
        error: { message: "Invalid OpenAI-compatible API key", type: "authentication_error" },
      }));
    }
    req.openAICompatProvider = apiAuth.provider;
    try {
      const handleRequest = await resolveRequestHandler();
      await handleRequest(req, res);
    } catch (e) {
      apiLogger.error("api.request.error", e, {
        method: req.method,
        path: requestPath,
        durationMs: Date.now() - startedAt,
      });
      console.error("[api]", e);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: { message: e.message, type: "internal_error" } }));
      }
    }
  });
}

export function setOpenAICorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Api-Key, x-api-key, Anthropic-Version, Anthropic-Beta");
}

export function startOpenAICompatServer({
  port = Number(process.env.API_PORT) || DEFAULT_API_PORT,
  host = process.env.API_HOST || DEFAULT_API_HOST,
} = {}) {
  const server = createOpenAICompatServer();
  server.listen(port, host, () => {
    apiLogger.info("api.server.started", { host, port });
    console.log(`OpenAI-compat API: http://${host}:${port}`);
    console.log(`Models:    GET  http://${host}:${port}/v1/models`);
    console.log(`Chat:      POST http://${host}:${port}/v1/chat/completions`);
    console.log(`Responses: POST http://${host}:${port}/v1/responses`);
    console.log(`Messages:  POST http://${host}:${port}/v1/messages`);
  });

  return server;
}

const isDirectRun = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  const server = startOpenAICompatServer();

  // Graceful shutdown.
  process.once("SIGINT", () => { server.close(() => process.exit(0)); });
  process.once("SIGTERM", () => { server.close(() => process.exit(0)); });
}
