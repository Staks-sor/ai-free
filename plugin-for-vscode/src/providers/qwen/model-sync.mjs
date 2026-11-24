import { QWEN_AUTH_FILE, QWEN_BASE_URL } from "./config.mjs";
import { readQwenAuth } from "./auth-files.mjs";
import { loadAccounts } from "./account-store.mjs";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
let cache = null;

export function selectQwenCatalogCookie(accounts, legacyAuth) {
  const ready = (Array.isArray(accounts) ? accounts : []).filter((account) =>
    account?.cookieHeader && account.disabled !== true && account.invalid !== true
    && account.limited !== true && (!account.resetAt || new Date(account.resetAt).getTime() <= Date.now()));
  return (ready.find((account) => account.primary) || ready[0])?.cookieHeader
    || legacyAuth?.cookieHeader || null;
}

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
        search: capabilities.search === true || meta.auto_search === true,
        live: true,
      };
    });
}

export async function fetchQwenWebModels({ timeoutMs = 8000 } = {}) {
  let accounts = [];
  try { accounts = loadAccounts(); } catch { /* Use legacy auth if the account store is unavailable. */ }
  const cookieHeader = selectQwenCatalogCookie(accounts, readQwenAuth(QWEN_AUTH_FILE));
  if (!cookieHeader) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${QWEN_BASE_URL}/api/v2/models/`, {
      headers: {
        Accept: "application/json, text/plain, */*",
        source: "web",
        Cookie: cookieHeader,
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

export function selectQwenDefaultModel(models) {
  return ["qwen3.8-max", "qwen3.7-plus"].find((id) => models.some((model) => model.id === id))
    || models[0]?.id || null;
}

export async function getQwenLiveCatalogOverride(options = {}) {
  const models = await getQwenLiveModels(options);
  if (!models.length) return null;
  const defaultModel = selectQwenDefaultModel(models);
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

export function qwenLiveModelSupportsThinking(catalog, modelId) {
  return catalog?.models?.find((item) => item.id === modelId)?.reasoning === true;
}
