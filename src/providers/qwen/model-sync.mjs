import { QWEN_AUTH_FILE, QWEN_BASE_URL } from "./config.mjs";
import { readQwenAuth } from "./auth-files.mjs";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
let cache = null;

function normalizeLabel(name, id) {
  return String(name || id || "").replace(/-/g, " ").replace(/\bqwen/i, "Qwen").trim();
}

export function normalizeQwenWebModels(rawModels) {
  if (!Array.isArray(rawModels)) return [];
  return rawModels
    .filter((model) => {
      const info = model?.info || {};
      const meta = info.meta || {};
      const chatTypes = Array.isArray(meta.chat_type) ? meta.chat_type : [];
      const modality = Array.isArray(meta.modality) ? meta.modality : [];
      return (
        model?.id
        && /^qwen[a-z0-9._-]+$/i.test(String(model.id))
        && info.is_active === true
        && info.is_visitor_active === true
        && chatTypes.includes("t2t")
        && modality.includes("text")
      );
    })
    .map((model) => {
      const meta = model.info?.meta || {};
      const capabilities = meta.capabilities || {};
      return {
        id: String(model.id),
        label: normalizeLabel(model.name, model.id),
        sub: String(meta.short_description || meta.description || "Qwen Web model").slice(0, 160),
        reasoning: capabilities.thinking === true,
        vision: capabilities.vision === true,
        search: capabilities.search === true,
        live: true,
      };
    });
}

export async function fetchQwenWebModels({ timeoutMs = 8000 } = {}) {
  const auth = readQwenAuth(QWEN_AUTH_FILE);
  if (!auth?.cookieHeader) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${QWEN_BASE_URL}/api/v2/models/`, {
      headers: {
        Accept: "application/json, text/plain, */*",
        source: "web",
        Cookie: auth.cookieHeader,
      },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = await res.json();
    return normalizeQwenWebModels(json?.data?.data || []);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function getQwenLiveModels({ force = false, ttlMs = DEFAULT_TTL_MS } = {}) {
  const now = Date.now();
  if (!force && cache && now - cache.at < ttlMs) return cache.models;
  const models = await fetchQwenWebModels();
  if (models.length) {
    cache = { at: now, models };
    return models;
  }
  return cache?.models || [];
}

export async function getQwenLiveCatalogOverride(options = {}) {
  const models = await getQwenLiveModels(options);
  if (!models.length) return null;
  const defaultModel = models.find((model) => model.id === "qwen3.7-plus")?.id || models[0].id;
  return {
    defaultModel,
    modes: [
      {
        id: "default",
        title: "Qwen Chat",
        sub: "live model list from chat.qwen.ai",
        model: defaultModel,
      },
    ],
    models,
  };
}

export function qwenLiveModelSupportsSearch(catalog, modelId) {
  const model = catalog?.models?.find((item) => item.id === modelId);
  return model ? model.search === true : true;
}
