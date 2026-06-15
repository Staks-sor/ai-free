// Единый каталог моделей для desktop и расширения VS Code.
// Здесь храним и OpenAI-compatible id, и UI-метаданные, чтобы API, ACP и webview
// не расходились между собой после очередного обновления списка моделей.

export const PROVIDER_CATALOG = {
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    icon: "DS",
    sub: "chat.deepseek.com",
    defaultMode: "fast",
    defaultModel: "deepseek-v4-flash",
    modes: [
      {
        id: "fast",
        title: "DeepSeek v4 Flash",
        sub: "быстрый обычный чат",
        model: "deepseek-v4-flash",
      },
      {
        id: "expert",
        title: "DeepSeek v4 Pro",
        sub: "reasoning / R1",
        model: "deepseek-v4-pro",
        reasoning: true,
      },
      {
        id: "vision",
        title: "DeepSeek v4 Vision",
        sub: "распознавание изображений",
        model: "deepseek-v4-vision",
        vision: true,
      },
    ],
    models: [
      { id: "deepseek-v4-flash", label: "DeepSeek v4 Flash", apiModel: null },
      { id: "deepseek-v4-pro", label: "DeepSeek v4 Pro", apiModel: "expert", reasoning: true },
      { id: "deepseek-v4-vision", label: "DeepSeek v4 Vision", apiModel: "vision", vision: true },
      { id: "deepseek-chat", label: "DeepSeek Chat", apiModel: null, legacy: true },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner", apiModel: "expert", reasoning: true, legacy: true },
    ],
  },
  qwen: {
    id: "qwen",
    label: "Qwen",
    icon: "QW",
    sub: "chat.qwen.ai",
    defaultMode: "default",
    defaultModel: "qwen3.7-plus",
    modes: [
      {
        id: "default",
        title: "Qwen Chat",
        sub: "выбор модели в шапке чата",
        model: "qwen3.7-plus",
      },
    ],
    models: [
      { id: "qwen3.7-plus", label: "Qwen3.7 Plus", sub: "default, актуальный web-default" },
      { id: "qwen3.7-max", label: "Qwen3.7 MAX", sub: "мощнее, может требовать доступ" },
      { id: "qwen-latest-series-invite-beta-v24", label: "Qwen3.7 Max Preview", sub: "актуальный preview max" },
      { id: "qwen-latest-series-invite-beta-v16", label: "Qwen3.7 Plus Preview", sub: "актуальный preview plus" },
      { id: "qwen3.6-plus", label: "Qwen3.6 Plus", sub: "стабильный быстрый чат" },
      { id: "qwen3.6-max-preview", label: "Qwen3.6 Max Preview", sub: "предыдущий preview max" },
      { id: "qwen3.6-27b", label: "Qwen3.6 27B", sub: "быстрая средняя модель" },
      { id: "qwen3.6-35b-a3b", label: "Qwen3.6 35B A3B", sub: "MoE-модель" },
      { id: "qwen3.5-plus", label: "Qwen3.5 Plus", sub: "стабильный fallback" },
      { id: "qwen3.5-27b", label: "Qwen3.5 27B", sub: "стабильный fallback" },
      { id: "qwen3.5-35b-a3b", label: "Qwen3.5 35B A3B", sub: "стабильный fallback MoE" },
      { id: "qwen3-max-2026-01-23", label: "Qwen3 Max", sub: "актуальный Qwen3 Max" },
      { id: "qwen3-coder-plus", label: "Qwen3 Coder", sub: "coding model" },
    ],
  },
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT",
    icon: "GP",
    sub: "chatgpt.com",
    defaultMode: "default",
    defaultModel: "gpt-5.5",
    modes: [
      {
        id: "default",
        title: "ChatGPT Web",
        sub: "модели chatgpt.com сессии",
        model: "gpt-5.5",
      },
    ],
    models: [
      { id: "gpt-5.5", label: "GPT-5.5", apiModel: "gpt-5.5" },
      { id: "gpt-4o", label: "GPT-4o", apiModel: "gpt-4o" },
      { id: "gpt-4o-mini", label: "GPT-4o mini", apiModel: "gpt-4o-mini" },
      { id: "o1-mini", label: "o1 mini", apiModel: "o1-mini", reasoning: true },
      { id: "o3-mini", label: "o3 mini", apiModel: "o3-mini", reasoning: true },
    ],
  },
};

export const OPENAI_COMPAT_MODELS = Object.values(PROVIDER_CATALOG).flatMap((provider) =>
  provider.models.map((model) => ({
    name: model.id,
    provider: provider.id,
    model: model.apiModel === undefined ? model.id : model.apiModel,
    label: model.label,
    reasoning: model.reasoning === true,
    vision: model.vision === true,
    legacy: model.legacy === true,
  })),
);

export function getProviderCatalog(providerId) {
  return PROVIDER_CATALOG[providerId] || null;
}

export function getProviderIds() {
  return Object.keys(PROVIDER_CATALOG);
}

export function getProviderDefaultModel(providerId, modeId = null) {
  const provider = getProviderCatalog(providerId);
  if (!provider) return null;
  if (modeId) {
    const mode = provider.modes.find((item) => item.id === modeId);
    if (mode?.model) return mode.model;
  }
  return provider.defaultModel || provider.models[0]?.id || null;
}

export function findProviderModel(providerId, modelId) {
  const provider = getProviderCatalog(providerId);
  if (!provider) return null;
  return provider.models.find((model) => model.id === modelId) || null;
}

export function findModel(name) {
  return OPENAI_COMPAT_MODELS.find((model) => model.name === name);
}

export function modelsList() {
  return {
    object: "list",
    data: OPENAI_COMPAT_MODELS.map((model) => ({
      id: model.name,
      object: "model",
      created: 1700000000,
      owned_by: model.provider,
    })),
  };
}

export function uiModelCatalog(overrides = {}) {
  return {
    providers: Object.fromEntries(
      Object.entries(PROVIDER_CATALOG).map(([providerId, provider]) => [
        providerId,
        (() => {
          const override = overrides[providerId] || {};
          const modes = override.modes || provider.modes;
          const models = override.models || provider.models;
          return {
            label: provider.label,
            icon: provider.icon,
            sub: provider.sub,
            defaultMode: provider.defaultMode,
            defaultModel: override.defaultModel || provider.defaultModel,
            modes: modes.map((mode) => ({ ...mode })),
            models: models
              .filter((model) => model.legacy !== true)
              .map((model) => ({ ...model })),
          };
        })(),
      ]),
    ),
  };
}
