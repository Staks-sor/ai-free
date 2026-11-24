import { createWebAccountManager } from "./web-account-manager.mjs";
import { createWebAccountAdapters } from "./web-account-adapters.mjs";
// Единый реестр AI-провайдеров.
// Каждый провайдер — { id, name, description, hasAuth(), login(args) }.
// hasAuth — синхронная проверка наличия auth-файла/сессии.
// login — запускает provider-специфичный логин.

import { DEFAULT_AUTH_FILE } from "../config.mjs";
import { QWEN_AUTH_FILE } from "./qwen/config.mjs";
import { hasAvailableAccounts, hasRestorableQwenSession, isQwenTokenExpired } from "./qwen/account-store.mjs";
import { readQwenAuth } from "./qwen/auth-files.mjs";
import { CHATGPT_AUTH_FILE } from "./chatgpt/config.mjs";
import { getCodexAuthStatus, isCodexAuthenticated, loginCodex } from "./codex/auth.mjs";
import { GOOGLE_AI_AUTH_FILE } from "./google-ai/config.mjs";
import { GLM_AUTH_FILE } from "./glm/config.mjs";
import { getAntigravityStatus } from "./antigravity/runtime.mjs";

const accountManager = createWebAccountManager({ adapters: createWebAccountAdapters() });

export const PROVIDERS = {
  antigravity: {
    id: "antigravity",
    name: "Google Antigravity",
    description: "Gemini через официальный Antigravity CLI и личный Google-аккаунт",
    authFile: null,
    hasAuth: () => getAntigravityStatus().authenticated,
    getStatus: getAntigravityStatus,
    async login() {
      throw new Error("Откройте терминал, запустите agy и войдите в свой Google-аккаунт. Затем обновите список провайдеров.");
    },
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    description: "chat.deepseek.com — основная модель + Code Agent + поиск",
    authFile: DEFAULT_AUTH_FILE,
    hasAuth: () => accountManager.hasAuth("deepseek"),
    async login(args = {}) {
      const { loginAndSaveAuth } = await import("../browser/login.mjs");
      await loginAndSaveAuth(args.authFile || DEFAULT_AUTH_FILE);
    },
  },
  qwen: {
    id: "qwen",
    name: "Qwen",
    description: "chat.qwen.ai — альтернатива от Alibaba (free, mongo щедрые лимиты)",
    authFile: QWEN_AUTH_FILE,
    hasAuth: () => {
      if (hasAvailableAccounts() || hasRestorableQwenSession()) return true;
      const auth = readQwenAuth(QWEN_AUTH_FILE);
      return Boolean(auth?.token && !isQwenTokenExpired(auth.token)) || hasRestorableQwenSession(auth ? [auth] : []);
    },
    async login() {
      const { loginQwenAndSave } = await import("./qwen/browser-login.mjs");
      await loginQwenAndSave();
    },
  },
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT",
    description: "chatgpt.com — бесплатный веб-интерфейс OpenAI",
    authFile: CHATGPT_AUTH_FILE,
    hasAuth: () => accountManager.hasAuth("chatgpt"),
    async login(options = {}) {
      const { loginChatGPTAndSave } = await import("./chatgpt/browser-login.mjs");
      await loginChatGPTAndSave(CHATGPT_AUTH_FILE, options);
    },
  },
  codex: {
    id: "codex",
    name: "OpenAI Codex",
    description: "Codex CLI — отдельный coding backend с авторизацией через ChatGPT",
    authFile: null,
    hasAuth: () => isCodexAuthenticated(),
    getStatus: () => getCodexAuthStatus(),
    async login() {
      await loginCodex();
    },
  },
  googleai: {
    id: "googleai",
    name: "Google AI",
    description: "Google Search AI Mode — поиск через личную Google-сессию",
    authFile: GOOGLE_AI_AUTH_FILE,
    hasAuth: () => accountManager.hasAuth("googleai"),
    async login() {
      const { resetGoogleAIBrowserProxy } = await import("./google-ai/browser-proxy.mjs");
      const { loginGoogleAIAndSave } = await import("./google-ai/browser-login.mjs");
      await resetGoogleAIBrowserProxy();
      await loginGoogleAIAndSave();
    },
  },
  glm: {
    id: "glm",
    name: "GLM",
    description: "chat.z.ai — модели GLM через личную браузерную сессию",
    authFile: GLM_AUTH_FILE,
    hasAuth: () => accountManager.hasAuth("glm"),
    async login() {
      const { resetGLMBrowserProxy } = await import("./glm/browser-proxy.mjs");
      const { loginGLMAndSave } = await import("./glm/browser-login.mjs");
      await resetGLMBrowserProxy();
      await loginGLMAndSave();
    },
  },
};

export function listProviders() {
  return Object.values(PROVIDERS);
}

export function getProvider(id) {
  return PROVIDERS[id] || null;
}

export function configuredCount() {
  return Object.values(PROVIDERS).filter((p) => p.hasAuth()).length;
}

export function configuredProviders() {
  return Object.values(PROVIDERS).filter((p) => p.hasAuth());
}
