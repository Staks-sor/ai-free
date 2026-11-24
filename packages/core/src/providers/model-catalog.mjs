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
    media: { imageInput: true, audioInput: "transcription" },
    modes: [
      {
        id: "fast",
        title: "DeepSeek · Flash",
        sub: "быстрый обычный чат",
        model: "deepseek-v4-flash",
      },
      {
        id: "expert",
        title: "DeepSeek · Expert",
        sub: "модель Expert веб-сервиса",
        model: "deepseek-v4-pro",
        reasoning: true,
      },
      {
        id: "vision",
        title: "DeepSeek · Vision",
        sub: "распознавание изображений",
        model: "deepseek-v4-vision",
        vision: true,
      },
    ],
    models: [
      { id: "deepseek-v4-flash", label: "DeepSeek · Flash", apiModel: null },
      { id: "deepseek-v4-pro", label: "DeepSeek · Expert", apiModel: "expert", reasoning: true },
      { id: "deepseek-v4-vision", label: "DeepSeek · Vision", apiModel: "vision", vision: true, media: { imageInput: true } },
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
    defaultModel: "qwen3.8-max",
    media: { imageInput: true, audioInput: "transcription" },
    modes: [
      {
        id: "default",
        title: "Qwen Chat",
        sub: "выбор модели в шапке чата",
        model: "qwen3.8-max",
      },
    ],
    models: [
      { id: "qwen3.8-max", label: "Qwen3.8 Max", sub: "актуальная флагманская модель", reasoning: true, vision: true, search: true },
      { id: "qwen3.8-omni-flash", label: "Qwen3.8 Omni Flash", sub: "мультимодальная модель Qwen", vision: true },
      { id: "qwen3.7-plus", label: "Qwen3.7 Plus", sub: "предыдущая модель Plus" },
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
      { id: "qwen3-max-2026-01-23", label: "Qwen3 Max", sub: "предыдущая модель Qwen3 Max" },
      { id: "qwen3-coder-plus", label: "Qwen3 Coder", sub: "coding model", media: { imageInput: false } },
    ],
  },
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT",
    icon: "GP",
    sub: "chatgpt.com",
    defaultMode: "default",
    defaultModel: "chatgpt-default",
    media: { imageInput: true, imageOutput: true, audioInput: "transcription" },
    modes: [
      {
        id: "default",
        title: "ChatGPT Web",
        sub: "модели chatgpt.com сессии",
        model: "chatgpt-default",
      },
      {
        id: "codex",
        title: "Codex CLI",
        sub: "чат через официальный Codex CLI · стабильный ChatGPT login",
        provider: "codex",
        model: "codex",
      },
    ],
    models: [
      // Web selects modes rather than API model versions. The site owns the actual model.
      { id: "chatgpt-default", label: "ChatGPT · Модель сайта", apiModel: "chatgpt-default", useSessionModel: true },
      { id: "chatgpt-instant", label: "ChatGPT · Instant", apiModel: "chatgpt-instant", webLabels: ["Instant", "Мгновенный"] },
      { id: "chatgpt-thinking", label: "ChatGPT · Thinking / Medium", apiModel: "chatgpt-thinking", webLabels: ["Medium", "Средний", "Thinking", "Reasoning", "Рассуждения"], reasoning: true },
      { id: "chatgpt-thinking-high", label: "ChatGPT · Thinking / High", apiModel: "chatgpt-thinking-high", webLabels: ["High", "Высокий"], reasoning: true },
      { id: "chatgpt-thinking-extra-high", label: "ChatGPT · Thinking / Extra High", apiModel: "chatgpt-thinking-extra-high", webLabels: ["Extra High", "Очень высокий"], reasoning: true },
      { id: "chatgpt-pro", label: "ChatGPT · Pro / Standard", apiModel: "chatgpt-pro", webLabels: ["Pro Standard", "Pro стандартный", "Pro"], reasoning: true },
      { id: "chatgpt-pro-extended", label: "ChatGPT · Pro / Extended", apiModel: "chatgpt-pro-extended", webLabels: ["Pro Extended", "Pro расширенный"], reasoning: true },
      // Keep saved/API IDs as aliases for the same web mode, without claiming a version.
      { id: "gpt-5.5-instant", label: "ChatGPT · Instant", apiModel: "chatgpt-instant", canonicalId: "chatgpt-instant", webLabels: ["Instant", "Мгновенный"], legacy: true },
      { id: "gpt-5.6-sol-medium", label: "ChatGPT · Thinking / Medium", apiModel: "chatgpt-thinking", canonicalId: "chatgpt-thinking", webLabels: ["Medium", "Средний", "Thinking", "Reasoning", "Рассуждения"], reasoning: true, legacy: true },
      { id: "gpt-5.6-sol-high", label: "ChatGPT · Thinking / High", apiModel: "chatgpt-thinking-high", canonicalId: "chatgpt-thinking-high", webLabels: ["High", "Высокий"], reasoning: true, legacy: true },
      { id: "gpt-5.6-sol-extra-high", label: "ChatGPT · Thinking / Extra High", apiModel: "chatgpt-thinking-extra-high", canonicalId: "chatgpt-thinking-extra-high", webLabels: ["Extra High", "Очень высокий"], reasoning: true, legacy: true },
      { id: "gpt-5.6-sol-pro-standard", label: "ChatGPT · Pro / Standard", apiModel: "chatgpt-pro", canonicalId: "chatgpt-pro", webLabels: ["Pro Standard", "Pro стандартный", "Pro"], reasoning: true, legacy: true },
      { id: "gpt-5.6-sol-pro-extended", label: "ChatGPT · Pro / Extended", apiModel: "chatgpt-pro-extended", canonicalId: "chatgpt-pro-extended", webLabels: ["Pro Extended", "Pro расширенный"], reasoning: true, legacy: true },
      { id: "gpt-5.5", label: "ChatGPT · Instant", apiModel: "chatgpt-instant", canonicalId: "chatgpt-instant", webLabels: ["Instant", "Мгновенный"], legacy: true },
      { id: "gpt-4o", label: "GPT-4o", apiModel: "gpt-4o", webLabels: ["GPT-4o", "4o", "ChatGPT"], legacy: true },
      { id: "gpt-4o-mini", label: "GPT-4o mini", apiModel: "gpt-4o-mini", webLabels: ["GPT-4o mini", "4o mini", "ChatGPT"], legacy: true },
      { id: "o1-mini", label: "o1 mini", apiModel: "o1-mini", webLabels: ["o1-mini", "o1 mini", "o1"], reasoning: true, legacy: true },
      { id: "o3-mini", label: "o3 mini", apiModel: "o3-mini", webLabels: ["o3-mini", "o3 mini", "o3"], reasoning: true, legacy: true },
    ],
  },
  codex: {
    id: "codex",
    compatibleApi: false,
    label: "OpenAI Codex",
    icon: "CX",
    sub: "Codex CLI · вход через ChatGPT",
    hiddenInProviderPicker: true,
    defaultMode: "codex",
    defaultModel: "codex",
    media: { imageInput: true, audioInput: "transcription" },
    modes: [
      { id: "codex", title: "Codex CLI", sub: "чат через официальный Codex CLI · стабильный ChatGPT login", model: "codex" },
    ],
    models: [
      { id: "codex", label: "Codex · Модель CLI по умолчанию", sub: "модель выбирает установленный Codex CLI", reasoning: true },
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", sub: "Codex CLI · доступ зависит от аккаунта и версии CLI", reasoning: true },
      { id: "gpt-6-astra", label: "GPT-6 Astra", sub: "Codex CLI · доступ зависит от аккаунта и версии CLI", reasoning: true },
      { id: "gpt-6-sol", label: "GPT-6 Sol", sub: "Codex CLI · предыдущий Sol", reasoning: true },
      { id: "gpt-6-luna", label: "GPT-6 Luna", sub: "Codex CLI · быстрые задачи", reasoning: true },
    ],
  },
  antigravity: {
    id: "antigravity",
    compatibleApi: false,
    label: "Google Antigravity",
    icon: "AG",
    sub: "Antigravity CLI · вход через Google",
    defaultMode: "default",
    defaultModel: "gemini-3.8-flash-medium",
    modes: [
      { id: "default", title: "Antigravity CLI", sub: "Gemini через официальный CLI", model: "gemini-3.8-flash-medium" },
    ],
    models: [
      { id: "gemini-3.8-flash-medium", label: "Gemini 3.8 Flash (Medium)", reasoning: true },
      { id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)", reasoning: true },
    ],
  },
  googleai: {
    id: "googleai",
    label: "Google AI",
    icon: "GA",
    sub: "Google Search AI Mode",
    defaultMode: "default",
    defaultModel: "google-ai-mode",
    media: { imageInput: true, audioInput: "transcription" },
    modes: [
      {
        id: "default",
        title: "Google AI Mode",
        sub: "поиск и ответы через личную Google-сессию",
        model: "google-ai-mode",
      },
    ],
    models: [
      {
        id: "google-ai-mode",
        label: "Google AI Mode",
        sub: "актуальная модель Google Search",
        search: true,
      },
    ],
  },
  glm: {
    id: "glm",
    label: "GLM",
    icon: "GL",
    sub: "Z.ai · личная браузерная сессия",
    defaultMode: "flash",
    defaultModel: "glm-5.3-flash",
    media: { imageInput: true, audioInput: "transcription" },
    modes: [
      {
        id: "flash",
        title: "GLM 5.3 Flash",
        sub: "быстрая модель, доступная в обычной Z.ai-сессии",
        model: "glm-5.3-flash",
        reasoning: true,
      },
      {
        id: "pro",
        title: "GLM 5.3",
        sub: "максимальное качество; доступность зависит от аккаунта",
        model: "glm-5.3",
        reasoning: true,
      },
      {
        id: "long",
        title: "GLM 5.2",
        sub: "длинные агентские задачи; доступность зависит от аккаунта",
        model: "glm-5.2",
        reasoning: true,
      },
      {
        id: "turbo",
        title: "GLM 5 Turbo",
        sub: "ускоренная модель; доступность зависит от аккаунта",
        model: "glm-5-turbo",
        reasoning: true,
      },
    ],
    models: [
      {
        id: "glm-5.3-flash",
        label: "GLM 5.3 Flash",
        sub: "быстрая браузерная модель Z.ai",
        reasoning: true,
      },
      {
        id: "glm-5.3",
        label: "GLM 5.3",
        sub: "флагманская модель Z.ai",
        reasoning: true,
      },
      {
        id: "glm-5.2",
        label: "GLM 5.2",
        sub: "модель для длинных задач",
        reasoning: true,
      },
      {
        id: "glm-5-turbo",
        label: "GLM 5 Turbo",
        sub: "ускоренная модель Z.ai",
        reasoning: true,
      },
    ],
  },
};

export const OPENAI_COMPAT_MODELS = Object.values(PROVIDER_CATALOG)
  .filter((provider) => provider.compatibleApi !== false).flatMap((provider) =>
  provider.models.map((model) => ({
    name: model.id,
    provider: provider.id,
    model: model.apiModel === undefined ? model.id : model.apiModel,
    label: model.label,
    reasoning: model.reasoning === true,
    vision: resolveModelMediaCapabilities(provider.id, model.id).imageInput,
    media: resolveModelMediaCapabilities(provider.id, model.id),
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

export function resolveModelMediaCapabilities(providerId, modelId) {
  const provider = getProviderCatalog(providerId);
  const model = findProviderModel(providerId, modelId);
  const media = { ...(provider?.media || {}), ...(model?.media || {}) };
  return {
    imageInput: media.imageInput === true,
    imageOutput: media.imageOutput === true,
    audioInput: media.audioInput === "transcription" ? "transcription" : media.audioInput === true,
    audioOutput: media.audioOutput === true,
  };
}

export function findModel(name) {
  return OPENAI_COMPAT_MODELS.find((model) => model.name === name);
}

export function modelsList(overrides = {}) {
  const models = Object.entries(PROVIDER_CATALOG).flatMap(([providerId, provider]) => {
    if (provider.compatibleApi === false) return [];
    const providerModels = overrides[providerId]?.models || provider.models;
    return providerModels.map((model) => ({
      name: model.id,
      provider: providerId,
    }));
  });
  return {
    object: "list",
    data: models.map((model) => ({
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
            hiddenInProviderPicker: provider.hiddenInProviderPicker === true,
            defaultMode: provider.defaultMode,
            defaultModel: override.defaultModel || provider.defaultModel,
            media: { ...(provider.media || {}) },
            modelAliases: Object.fromEntries(provider.models
              .filter((model) => model.canonicalId && models.some((item) => item.id === model.canonicalId))
              .map((model) => [model.id, model.canonicalId])),
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
