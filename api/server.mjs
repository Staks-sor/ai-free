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
//     -d '{"model":"qwen3.6-plus","messages":[{"role":"user","content":"привет"}]}' | jq
//
// Тест из Continue.dev / Cursor:
//   baseURL: http://127.0.0.1:4318/v1
//   apiKey:  anything (не проверяется в прототипе)
//   model:   qwen3.6-plus  (или любая из /v1/models)

import http from "node:http";
import { handleRequest } from "./openai-handler.mjs";

const PORT = Number(process.env.API_PORT) || 4318;
const HOST = "127.0.0.1"; // намеренно НЕ слушаем на 0.0.0.0 — только локально

const server = http.createServer(async (req, res) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
   // CORS — на всякий случай, для веб-клиентов на localhost.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  try {
    await handleRequest(req, res);
  } catch (e) {
    console.error("[api]", e);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: { message: e.message, type: "internal_error" } }));
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`OpenAI-compat API: http://${HOST}:${PORT}`);
  console.log(`Models:    GET  http://${HOST}:${PORT}/v1/models`);
  console.log(`Chat:      POST http://${HOST}:${PORT}/v1/chat/completions`);
});

// Graceful shutdown.
process.once("SIGINT", () => { server.close(() => process.exit(0)); });
process.once("SIGTERM", () => { server.close(() => process.exit(0)); });
