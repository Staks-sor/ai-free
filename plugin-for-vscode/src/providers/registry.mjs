// Единый реестр AI-провайдеров.
// Каждый провайдер — { id, name, description, hasAuth(), login(args) }.
// hasAuth — синхронная проверка наличия auth-файла.
// login — запускает provider-специфичный логин (Playwright + sаве).
//
// DeepSeek и Qwen ленивые импорты — не грузим их код, пока не нужно.

import fs from "node:fs";
import { DEFAULT_AUTH_FILE } from "../config.mjs";
import { QWEN_AUTH_FILE } from "./qwen/config.mjs";

export const PROVIDERS = {
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    description: "chat.deepseek.com — основная модель + Code Agent + поиск",
    authFile: DEFAULT_AUTH_FILE,
    hasAuth: () => fs.existsSync(DEFAULT_AUTH_FILE),
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
    hasAuth: () => fs.existsSync(QWEN_AUTH_FILE),
    async login() {
      const { loginQwenAndSave } = await import("./qwen/browser-login.mjs");
      await loginQwenAndSave();
    },
  },
};

export function listProviders() {
  return Object.values(PROVIDERS);
}

export function getProvider(id) {
  return PROVIDERS[id] || null;
}

// Сколько провайдеров уже залогинены.
export function configuredCount() {
  return Object.values(PROVIDERS).filter((p) => p.hasAuth()).length;
}

export function configuredProviders() {
  return Object.values(PROVIDERS).filter((p) => p.hasAuth());
}
