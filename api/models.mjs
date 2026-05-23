// Таблица моделей, которые отдаём наружу как OpenAI-совместимые.
//
// "name" — то, что внешняя программа шлёт в body.model.
// "provider" — на какой наш клиент маршрутизируется ("qwen" или "deepseek").
// "model" — внутреннее имя модели у провайдера (для DeepSeek это model_type).
//
// Если хочешь добавить — просто допиши строку. UI Settings (когда будет) сможет
// показать этот же список.

export const MODELS = [
  // Qwen — через browser-proxy (chat.qwen.ai)
  { name: "qwen3.6-plus",   provider: "qwen",     model: "qwen3.6-plus" },
  { name: "qwen3-max",      provider: "qwen",     model: "qwen3-max" },
  { name: "qwen2.5-plus",   provider: "qwen",     model: "qwen2.5-plus" },
  { name: "qwq-32b",        provider: "qwen",     model: "qwq-32b" },
  { name: "qwen-vl-max",    provider: "qwen",     model: "qwen-vl-max" },

  // DeepSeek — через прямой API (chat.deepseek.com)
  // model_type: null = chat (по умолчанию), "expert" = reasoner, "vision" = vision
  { name: "deepseek-chat",      provider: "deepseek", model: null },
  { name: "deepseek-reasoner",  provider: "deepseek", model: "expert" },
];

export function findModel(name) {
  return MODELS.find((m) => m.name === name);
}

// Список в формате OpenAI /v1/models response.
export function modelsList() {
  return {
    object: "list",
    data: MODELS.map((m) => ({
      id: m.name,
      object: "model",
      created: 1700000000,
      owned_by: m.provider,
    })),
  };
}
