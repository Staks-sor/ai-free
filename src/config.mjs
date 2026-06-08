// Глобальные константы и пути.
// Всё, что хранится у юзера, лежит под ~/.deepseek-cli/ — единое место для всех версий.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export const BASE_URL = "https://chat.deepseek.com";

function readPackageVersion() {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// Версия проекта (наша, отображается юзеру). НЕ путать с APP_VERSION ниже,
// который имитирует фронт DeepSeek для их API.
export const AI_FREE_VERSION = readPackageVersion();

// Версия фронта DeepSeek — используется в X-App-Version заголовке.
export const APP_VERSION = "2.0.0";
export const COMPLETION_PATH = "/api/v0/chat/completion";
export const DEEPSEEK_SHA3_WASM =
  "https://fe-static.deepseek.com/chat/static/sha3_wasm_bg.7b9ca65ddd.wasm";

// Версия формата state.json. При смене формата увеличиваем — старый файл
// нормализуется в новый при загрузке.
export const STATE_VERSION = 2;

// Все юзер-данные в одном месте.
export const AUTH_DIR = path.join(os.homedir(), ".deepseek-cli");
export const DEFAULT_AUTH_FILE = path.join(AUTH_DIR, "auth.json");
export const DEFAULT_BROWSER_PROFILE = path.join(AUTH_DIR, "browser-profile");
export const CREDENTIALS_FILE = path.join(AUTH_DIR, "credentials.json");
export const SETTINGS_FILE = path.join(AUTH_DIR, "settings.json");

// Legacy fallback. Пустая строка означает «нет дефолтного cookie-файла»;
// раньше тут был жёсткий путь, что неправильно — теперь только из .env при необходимости.
export const DEFAULT_COOKIE_FILE = "";
