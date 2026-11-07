import { repairToolCallJson, normalizeToolCallsForSchemas } from "./tool-calls.mjs";

// Opt-in LLM-фолбэк ремонта tool-call JSON через OpenRouter (2026-09-07).
// Детерминированная ладдерка (repairToolCallJson) остаётся первой линией:
// сюда попадаем, только когда все офлайн-ремонты не смогли спасти блок.
// Включается переменной окружения OPENROUTER_API_KEY (см. .env.example):
//   OPENROUTER_API_KEY            — ключ OpenRouter (пусто = фолбэк выключен)
//   OPENROUTER_TOOL_REPAIR_MODELS — цепочка моделей через запятую (приоритет)
//   OPENROUTER_TOOL_REPAIR_MODEL  — одна модель (если MODELS не задан)
//   OPENROUTER_TOOL_REPAIR_TIMEOUT_MS  — таймаут одного запроса (по умолчанию 20000)
//   OPENROUTER_TOOL_REPAIR_ITERATIONS  — итераций на модель с фидбеком (по умолчанию 2)
//   OPENROUTER_BASE_URL           — базовый URL (по умолчанию https://openrouter.ai/api/v1)

// Цепочка free-моделей по умолчанию (проверена по живому каталогу 2026-09-11;
// ID free-вариантов на OpenRouter ротируются каждые несколько дней —
// переопределяется через OPENROUTER_TOOL_REPAIR_MODELS). Порядок — по
// способности к точному JSON-ремонту: крупные instruct/кодовые модели
// сверху; крошечные модели (laguna/lfm/inkling-small) сознательно НЕ в
// цепочке — они дают деградированные ответы в несколько токенов.
const DEFAULT_MODELS = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nex-agi/nex-n2.5-pro:free",
  "cohere/north-mini-code:free",
  "google/gemma-4-31b-it:free",
];
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_ITERATIONS = 2;
const MAX_ITERATIONS_CAP = 5;
// Потолок размера сломанного блока: нет смысла гнать мегабайты в free-модель.
const MAX_RAW_LENGTH = 20_000;

export function resolveLlmRepairConfig(env = process.env) {
  const apiKey = String(env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) return null;
  const chain = String(env.OPENROUTER_TOOL_REPAIR_MODELS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const single = String(env.OPENROUTER_TOOL_REPAIR_MODEL || "").trim();
  const timeoutMs = Number.parseInt(env.OPENROUTER_TOOL_REPAIR_TIMEOUT_MS || "", 10);
  const iterations = Number.parseInt(env.OPENROUTER_TOOL_REPAIR_ITERATIONS || "", 10);
  return {
    apiKey,
    baseUrl: String(env.OPENROUTER_BASE_URL || "").trim() || DEFAULT_BASE_URL,
    models: chain.length ? chain : single ? [single] : DEFAULT_MODELS,
    timeoutMs: timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
    maxIterations: iterations > 0 ? Math.min(iterations, MAX_ITERATIONS_CAP) : DEFAULT_MAX_ITERATIONS,
  };
}

function buildRepairPrompt(rawText, previousError) {
  const lines = [
    "The block below is a damaged JSON array of tool calls produced by another model.",
    "Typical defects: unescaped double quotes inside string values, missing closing quotes before line breaks, missing brackets, interleaved prose.",
    "Return ONLY the repaired JSON array. No markdown fences, no explanations.",
    'Every element must be an object {"name": string, "arguments": object}.',
    'Escape every double quote inside JSON string values (\\"). Preserve commands and file content exactly as given.',
  ];
  if (previousError) lines.push(`The previous repair attempt was rejected: ${previousError}. Fix that problem.`);
  lines.push("---", rawText);
  return lines.join("\n");
}

// LLM любит оборачивать ответ в ```json ... ``` — срезаем.
function stripMarkdownFences(text) {
  const s = String(text || "").trim();
  const fence = s.match(/^```[a-z]*\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1].trim() : s;
}

// Плаузибилити-гейт: имена должны быть строками, при наличии схем — из списка
// тулов; обязательные аргументы проверяются через normalizeToolCallsForSchemas.
// lenientRequired: на последней попытке отсутствие обязательных аргументов
// не отвергаем — salvage-вызов лучше полной потери хода (клиентский валидатор
// всё равно вернёт модели понятную ошибку).
function validateCalls(parsed, tools, { lenientRequired = false } = {}) {
  const list = (Array.isArray(parsed) ? parsed.flat(Infinity) : [parsed])
    .filter((call) => call && typeof call === "object" && !Array.isArray(call));
  if (!list.length) return { calls: null, error: "no tool call objects in output" };
  if (list.some((call) => typeof call.name !== "string" || !call.name.trim())) {
    return { calls: null, error: 'element without string "name"' };
  }
  const schemas = Array.isArray(tools) ? tools : [];
  const allowed = new Set(schemas.map((tool) => tool?.function?.name || tool?.name).filter(Boolean));
  if (allowed.size) {
    const unknown = [...new Set(list.map((call) => call.name).filter((name) => !allowed.has(name)))];
    if (unknown.length) return { calls: null, error: `unknown tool names: ${unknown.join(", ")}` };
  }
  const candidates = list.map((call) => ({
    name: call.name,
    arguments: call.arguments ?? call.args ?? call.input ?? {},
  }));
  const { calls, errors } = normalizeToolCallsForSchemas(candidates, schemas);
  if (errors.length && !lenientRequired) {
    return { calls: null, error: `missing required arguments: ${errors.map((e) => e.name).join(", ")}` };
  }
  if (errors.length) {
    console.warn(`[API] OpenRouter tool-call repair accepted with missing required arguments: ${errors.map((e) => e.name).join(", ")}`);
  }
  return { calls, error: null };
}

async function callOpenRouterChat(config, model, prompt, fetchImpl, outerSignal) {
  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      // Атрибуция в дашборде OpenRouter: отличаем ремонт-трафик ai-free
      // от прямых обращений клиентских приложений.
      "HTTP-Referer": "https://github.com/Staks-sor/ai-free",
      "X-Title": "ai-free tool-call repair",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: outerSignal ?? AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("no message content in response");
  return content;
}

// Мульти-модельная цепочка фолбэков с итерациями: каждая модель получает до
// maxIterations попыток с фидбеком об ошибках (мусор вместо JSON, неизвестное
// имя тула, отсутствие обязательных аргументов); ошибка сети/HTTP или исчерп
// итераций — переходим к следующей модели. Возвращает {name, arguments}[] или null.
export async function repairToolCallJsonWithLlm(rawText, options = {}) {
  const config = options.config ?? resolveLlmRepairConfig(options.env ?? process.env);
  if (!config) return null;
  const raw = String(rawText || "");
  if (!raw.trim() || raw.length > MAX_RAW_LENGTH) return null;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") return null;

  let lastError = null;
  const lastModelIndex = config.models.length - 1;
  for (let modelIndex = 0; modelIndex < config.models.length; modelIndex += 1) {
    const model = config.models[modelIndex];
    for (let attempt = 1; attempt <= config.maxIterations; attempt += 1) {
      // Последняя попытка последней модели — мягкий гейт по обязательным
      // аргументам: лучше вернуть salvage-вызов, чем дамп ошибки.
      const lenientRequired = modelIndex === lastModelIndex && attempt === config.maxIterations;
      let content;
      try {
        content = await callOpenRouterChat(config, model, buildRepairPrompt(raw, lastError), fetchImpl, options.signal);
      } catch (error) {
        // Ошибка запроса к этой модели — пробуем следующую модель цепочки.
        console.error(`[API] OpenRouter tool-call repair ${model} failed: ${error.message}`);
        lastError = null;
        break;
      }
      const parsed = repairToolCallJson(stripMarkdownFences(content));
      if (!parsed) {
        lastError = "output was not valid JSON";
        continue;
      }
      const { calls, error } = validateCalls(parsed, options.tools, { lenientRequired });
      if (calls) {
        console.log(`[API] OpenRouter tool-call repair (${model}) recovered ${calls.length} call(s) on attempt ${attempt}`);
        return calls;
      }
      lastError = error;
    }
  }
  console.error("[API] OpenRouter tool-call repair gave up: all models in the chain failed");
  return null;
}
