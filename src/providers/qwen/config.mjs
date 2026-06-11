// Константы для Qwen-провайдера (chat.qwen.ai).
// Архитектурно параллельны deepseek — одна структура, но СВОЯ папка данных.

import os from "node:os";
import path from "node:path";

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

// Доступные модели Qwen для UI-picker'а.
// id — то, что шлём в body.models[]; label/sub — для отображения в выпадающем меню.
// Сверял по реальному chat.qwen.ai на 2026-06-11.
export const QWEN_MODELS = [
  { id: "qwen3.7-plus",  label: "Qwen3.7 Plus",  sub: "default · актуальный web-default" },
  { id: "qwen3.7-max",   label: "Qwen3.7 MAX",   sub: "мощнее, может требовать доступ" },
  { id: "qwen3.6-plus",  label: "Qwen3.6 Plus",  sub: "быстро, баланс качества" },
  { id: "qwen3-max",     label: "Qwen3 Max",     sub: "мощнее, медленнее" },
  { id: "qwen2.5-plus",  label: "Qwen 2.5 Plus", sub: "legacy, стабильный" },
  { id: "qwq-32b",       label: "QwQ-32B",       sub: "reasoning, для сложных задач" },
  { id: "qwen-vl-max",   label: "Qwen-VL Max",   sub: "vision, картинки + текст" },
];

export const QWEN_DEFAULT_MODEL = "qwen3.7-plus";
