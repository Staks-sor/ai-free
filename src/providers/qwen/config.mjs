// Константы для Qwen-провайдера (chat.qwen.ai).
// Архитектурно параллельны deepseek — одна структура, но СВОЯ папка данных.

import os from "node:os";
import path from "node:path";
import { getProviderCatalog } from "../model-catalog.mjs";

export const QWEN_BASE_URL = "https://chat.qwen.ai";

// Отдельная папка для Qwen — НЕ смешиваем с ~/.deepseek-cli/.
// Так юзер может удалить ~/.qwen-cli/ независимо от DeepSeek и наоборот.
export const QWEN_HOME = path.join(os.homedir(), ".qwen-cli");
export const QWEN_AUTH_FILE = path.join(QWEN_HOME, "auth.json");

// Persistent Chromium-профиль для Qwen.
export const QWEN_BROWSER_PROFILE = path.join(QWEN_HOME, "browser-profile");

// Ключ JWT-токена в localStorage / cookies. Qwen хранит токен в куке "token" под
// доменом .qwen.ai (httpOnly: true), но фронт также читает его в JS — значит
// либо есть в localStorage, либо извлекается из cookie через document.cookie не получится
// (httpOnly блокирует JS-доступ). Но мы читаем через context.cookies() — это API
// Playwright, не браузерный JS, httpOnly его не ограничивает.
export const QWEN_TOKEN_COOKIE_NAME = "token";

// Имена ключевых cookies, которые должны быть после логина.
// Минимум: token. Желательно: cnaui (user UUID), aui.
export const QWEN_REQUIRED_COOKIES = ["token"];

export const QWEN_MODELS = getProviderCatalog("qwen").models;

export const QWEN_DEFAULT_MODEL = getProviderCatalog("qwen").defaultModel;
