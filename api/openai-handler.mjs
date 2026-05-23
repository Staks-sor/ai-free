// Прототип OpenAI-совместимого /v1/chat/completions.
//
// Поддерживает:
//   - POST /v1/chat/completions с body { model, messages, stream:true/false }
//   - GET  /v1/models
//
// НЕ поддерживает (пока):
//   - tools / function calling (TODO)
//   - logprobs, n>1, seed, и прочие OpenAI-параметры
//   - API-ключи (TODO: добавить после прототипа)
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
import { readQwenAuth } from "../src/providers/qwen/auth-files.mjs";
import { QWEN_AUTH_FILE } from "../src/providers/qwen/config.mjs";
import { QwenChatClient } from "../src/providers/qwen/client.mjs";
import { DEFAULT_AUTH_FILE } from "../src/config.mjs";
import { readSavedAuth } from "../src/auth/files.mjs";
import { DeepSeekChatClient } from "../src/deepseek/client.mjs";

// Ленивый singleton Qwen-клиента — переиспользуем через все вызовы API.
let qwenClient = null;
// Ленивый singleton DeepSeek-клиента — переиспользуем через все вызовы API.
let deepseekClient = null;
async function getQwenClient() {
  if (qwenClient) return qwenClient;
  const auth = readQwenAuth(QWEN_AUTH_FILE);
  if (!auth?.token) {
    throw new Error("Qwen не подключён. Запусти: npm run login-qwen");
  }
  qwenClient = new QwenChatClient({
    token: auth.token,
    cookieHeader: auth.cookieHeader,
    debug: Boolean(process.env.API_DEBUG),
  });
  return qwenClient;
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
    debug: Boolean(process.env.API_DEBUG),
  });
  return deepseekClient;
}

export async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/v1/models") {
    return sendJson(res, modelsList());
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    return handleChatCompletions(req, res);
  }

  if (req.method === "GET" && url.pathname === "/") {
    return sendJson(res, {
      name: "deepseek-cli openai-compat",
      version: "0.1.0-prototype",
      endpoints: ["GET /v1/models", "POST /v1/chat/completions"],
      docs: "see README.md in api/",
    });
  }

  res.statusCode = 404;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: { message: "Not found", type: "not_found_error" } }));
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

  const mapping = findModel(modelName);
  if (!mapping) return sendError(res, 404, `Unknown model: ${modelName}`);

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length) return sendError(res, 400, "Missing 'messages' array");

  // OpenAI присылает ВСЮ историю каждый раз. Мы её сжимаем в один prompt —
  // конкатенируем с лейблами ролей. Это упрощение прототипа; для качества контекста
  // потом сделаем proper multi-turn через persistent sessionId + parent_id chain.
  const prompt = messages
    .map((m) => `${(m.role || "user").toUpperCase()}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`)
    .join("\n\n");

  try {
    if (mapping.provider === "qwen") {
      const client = await getQwenClient();
      // Свежий чат на каждый запрос — простейший stateless flow.
      const chatId = await client.createChat({ model: mapping.model, title: "API request" });

      if (body.stream === true) {
        return handleQwenStream(client, chatId, prompt, modelName, mapping.model, res);
      }

      const result = await client.complete({
        chatId,
        prompt,
        thinking: false,
        search: false,
        model: mapping.model,
      });
      return sendJson(res, toOpenAIResponse(modelName, result.text));
    }
    if (mapping.provider === "deepseek") {
      const client = await getDeepSeekClient();
      // DeepSeek: создаём сессию и отправляем completion.
      const sessionId = await client.createSession();

      if (body.stream === true) {
        return handleDeepSeekStream(client, sessionId, prompt, modelName, mapping.model, res);
      }

      const result = await client.complete({
        sessionId,
        prompt,
        modelType: mapping.model,
      });
      return sendJson(res, toOpenAIResponse(modelName, result.text));
    }
    return sendError(res, 500, `Unknown provider: ${mapping.provider}`);
  } catch (e) {
    return sendError(res, 500, `Upstream error: ${e.message}`);
  }
}

// Отправка SSE-события в OpenAI формате.
function sendSseEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
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
async function handleQwenStream(client, chatId, prompt, modelName, model, res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let first = true;
  try {
    await client.complete({
      chatId,
      prompt,
      thinking: false,
      search: false,
      model,
      onText: (textDelta) => {
        if (first) {
          sendSseEvent(res, toOpenAIStreamChunk(modelName, "", true));
          first = false;
        }
        sendSseEvent(res, toOpenAIStreamChunk(modelName, textDelta));
        if (res.flush) res.flush();
      },
    });
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
}

// Обработка streaming-запроса к DeepSeek.
async function handleDeepSeekStream(client, sessionId, prompt, modelName, model, res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let first = true;
  try {
    await client.complete({
      sessionId,
      prompt,
      modelType: model,
      onText: (textDelta) => {
        if (first) {
          sendSseEvent(res, toOpenAIStreamChunk(modelName, "", true));
          first = false;
        }
        sendSseEvent(res, toOpenAIStreamChunk(modelName, textDelta));
        if (res.flush) res.flush();
      },
    });
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
}

// Формат OpenAI chat completion response.
function toOpenAIResponse(model, text) {
  const ts = Math.floor(Date.now() / 1000);
  return {
    id: `chatcmpl-${ts}${Math.random().toString(36).slice(2, 10)}`,
    object: "chat.completion",
    created: ts,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    // Реальные usage-метрики у нас не доступны, ставим заглушку.
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
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
