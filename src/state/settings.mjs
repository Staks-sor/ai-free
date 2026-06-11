// Whitelist разрешённых команд для /code run_command.
// Каталог COMMAND_CATALOG — единый источник правды: что доступно, чем рискованно,
// какие точечные опасные паттерны блокировать (rm -rf, git push --force и т.п.).
// Юзерский выбор (галочки в UI) хранится в ~/.deepseek-cli/settings.json,
// бэкенд читает loadSettings() на каждый run_command вызов — без рестарта.

import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { AUTH_DIR, SETTINGS_FILE } from "../config.mjs";
import { getProviderIds } from "../providers/model-catalog.mjs";

export const COMMAND_CATALOG = {
  node:    { description: "Запуск JS-файлов через Node",                       risk: "low",    enabledByDefault: true },
  npm:     { description: "npm-скрипты (install/add/publish заблокированы)",   risk: "low",    enabledByDefault: true },
  python3: { description: "Запуск Python-файлов",                              risk: "low",    enabledByDefault: true },
  python:  { description: "Алиас для python3",                                 risk: "low",    enabledByDefault: true },
  ls:      { description: "Листинг файлов и папок",                            risk: "low",    enabledByDefault: true },
  cat:     { description: "Печать содержимого файла",                          risk: "low",    enabledByDefault: true },
  pwd:     { description: "Текущая рабочая папка",                             risk: "low",    enabledByDefault: true },

  mkdir:   { description: "Создание папок",                                    risk: "low",    enabledByDefault: false },
  rmdir: {
    description: "Удаление пустых папок без рекурсивных флагов",
    risk: "low", enabledByDefault: false,
    validateArgs: (args) => {
      for (const arg of args) {
        if (arg.startsWith("-")) {
          throw new Error(`rmdir: флаг ${arg} заблокирован. Удалять можно только явно указанную пустую папку.`);
        }
      }
    },
  },
  cp:      { description: "Копирование файлов",                                risk: "low",    enabledByDefault: false },
  touch:   { description: "Создание пустого файла / обновление mtime",         risk: "low",    enabledByDefault: false },
  grep:    { description: "Поиск по тексту",                                   risk: "low",    enabledByDefault: false },
  head:    { description: "Первые N строк файла",                              risk: "low",    enabledByDefault: false },
  tail:    { description: "Последние N строк файла",                           risk: "low",    enabledByDefault: false },
  wc:      { description: "Подсчёт строк / слов / байт",                       risk: "low",    enabledByDefault: false },

  find: {
    description: "Поиск файлов (-exec / -delete заблокированы)",
    risk: "medium", enabledByDefault: false,
    validateArgs: (args) => {
      for (const arg of args) {
        if (arg === "-exec" || arg === "-execdir" || arg === "-delete" || arg === "-ok") {
          throw new Error(`find: опция ${arg} заблокирована (потенциальный RCE).`);
        }
      }
    },
  },
  git: {
    description: "git status/log/diff/add/commit/checkout/branch (clone, push --force, remote add — заблокированы)",
    risk: "medium", enabledByDefault: false,
    validateArgs: (args) => {
      const sub = (args[0] || "").toLowerCase();
      if (sub === "clone") throw new Error("git clone заблокирован (сетевая операция).");
      if (sub === "fetch" || sub === "pull") throw new Error(`git ${sub} заблокирован (сетевая операция).`);
      if (sub === "push" && (args.includes("--force") || args.includes("-f") || args.includes("+"))) {
        throw new Error("git push --force заблокирован.");
      }
      if (sub === "remote" && args[1] === "add") {
        throw new Error("git remote add заблокирован (добавление чужого репо).");
      }
      if (sub === "submodule" && args[1] === "add") {
        throw new Error("git submodule add заблокирован.");
      }
    },
  },
  mv: { description: "Перемещение/переименование", risk: "medium", enabledByDefault: false },
  sed: {
    description: "Замена/обработка текста",
    risk: "medium", enabledByDefault: false,
  },
  chmod: {
    description: "Изменение прав (777, +x на всё — заблокированы)",
    risk: "medium", enabledByDefault: false,
    validateArgs: (args) => {
      for (const arg of args) {
        if (arg === "777" || arg === "a+rwx" || arg === "ugo+rwx") {
          throw new Error(`chmod ${arg} заблокирован.`);
        }
      }
    },
  },
  make: {
    description: "Сборка по Makefile (выполняет команды из Makefile — будь осторожен)",
    risk: "medium", enabledByDefault: false,
  },

  pio: {
    description: "PlatformIO: поиск плат, сборка, upload и monitor для ESP/Arduino",
    risk: "high", enabledByDefault: false,
    validateArgs: (args) => {
      const sub = String(args[0] || "").toLowerCase();
      if (!["device", "run", "boards"].includes(sub)) {
        throw new Error("pio: разрешены только device, run и boards.");
      }
      if (sub === "device") {
        const action = String(args[1] || "list").toLowerCase();
        if (!["list", "monitor"].includes(action)) {
          throw new Error("pio device: разрешены только list и monitor.");
        }
      }
      if (args.some((arg) => ["account", "home", "pkg", "remote", "upgrade", "update"].includes(String(arg).toLowerCase()))) {
        throw new Error("pio: сетевые/аккаунт операции заблокированы.");
      }
    },
  },

  "arduino-cli": {
    description: "Arduino CLI: board list, compile, upload и monitor",
    risk: "high", enabledByDefault: false,
    validateArgs: (args) => {
      const sub = String(args[0] || "").toLowerCase();
      if (!["board", "compile", "upload", "monitor"].includes(sub)) {
        throw new Error("arduino-cli: разрешены только board, compile, upload и monitor.");
      }
      if (args.some((arg) => ["core", "lib", "config", "daemon", "update", "upgrade"].includes(String(arg).toLowerCase()))) {
        throw new Error("arduino-cli: установка, обновление и daemon заблокированы.");
      }
    },
  },

  "esptool.py": {
    description: "esptool.py: диагностика и write_flash для ESP (erase_flash заблокирован)",
    risk: "high", enabledByDefault: false,
    validateArgs: (args) => {
      const lowered = args.map((arg) => String(arg).toLowerCase());
      if (lowered.includes("erase_flash")) {
        throw new Error("esptool.py erase_flash заблокирован.");
      }
      const command = lowered.find((arg) => ["chip_id", "read_mac", "flash_id", "write_flash"].includes(arg));
      if (!command) {
        throw new Error("esptool.py: разрешены только chip_id, read_mac, flash_id и write_flash.");
      }
    },
  },

  rm: {
    description: "Удаление файлов (БЕЗ -r/-R/-rf)",
    risk: "high", enabledByDefault: false,
    validateArgs: (args) => {
      for (const arg of args) {
        if (arg === "--recursive" || arg === "--no-preserve-root") {
          throw new Error(`rm: ${arg} заблокирован.`);
        }
        const isShortFlag = arg.startsWith("-") && !arg.startsWith("--") && arg.length >= 2;
        if (isShortFlag && /[rR]/.test(arg)) {
          throw new Error(`rm: рекурсивные флаги (${arg}) заблокированы.`);
        }
      }
    },
  },
};

function emptyProviderApiKeys() {
  return Object.fromEntries(getProviderIds().map((providerId) => [providerId, ""]));
}

function normalizeProviderApiKeys(rawKeys = {}, legacyKey = "") {
  const normalized = emptyProviderApiKeys();
  for (const providerId of Object.keys(normalized)) {
    normalized[providerId] = typeof rawKeys[providerId] === "string" ? rawKeys[providerId] : "";
  }
  if (!normalized.deepseek && legacyKey) normalized.deepseek = legacyKey;
  return normalized;
}

export function loadSettings() {
  const fallback = {
    allowedCommands: Object.keys(COMMAND_CATALOG).filter(
      (cmd) => COMMAND_CATALOG[cmd].enabledByDefault,
    ),
    openAICompat: { apiKeys: emptyProviderApiKeys() },
  };
  if (!fs.existsSync(SETTINGS_FILE)) return fallback;
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    const allowed = Array.isArray(raw?.allowedCommands)
      ? raw.allowedCommands.filter((cmd) => typeof cmd === "string" && COMMAND_CATALOG[cmd])
      : fallback.allowedCommands;
    const legacyKey = typeof raw?.openAICompat?.apiKey === "string" ? raw.openAICompat.apiKey : "";
    const apiKeys = raw?.openAICompat?.apiKeys || {};
    return {
      allowedCommands: allowed,
      openAICompat: {
        apiKeys: normalizeProviderApiKeys(apiKeys, legacyKey),
      },
    };
  } catch {
    return fallback;
  }
}

export function saveSettings(settings) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const valid = (settings?.allowedCommands || []).filter((cmd) => COMMAND_CATALOG[cmd]);
  const current = loadSettings();
  const requestedKeys = settings?.openAICompat?.apiKeys || {};
  const currentKeys = current.openAICompat?.apiKeys || {};
  const nextKeys = emptyProviderApiKeys();
  for (const providerId of Object.keys(nextKeys)) {
    nextKeys[providerId] = typeof requestedKeys[providerId] === "string"
      ? requestedKeys[providerId]
      : currentKeys[providerId] || "";
  }
  const payload = {
    allowedCommands: Array.from(new Set(valid)),
    openAICompat: {
      apiKeys: nextKeys,
    },
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(payload, null, 2));
  try { fs.chmodSync(SETTINGS_FILE, 0o600); } catch {}
  return payload;
}

export function ensureOpenAICompatApiKey(provider) {
  if (!getProviderIds().includes(provider)) {
    throw new Error(`Unknown OpenAI-compatible API provider: ${provider}`);
  }
  const current = loadSettings();
  const existing = current.openAICompat?.apiKeys?.[provider];
  if (existing) return existing;

  const apiKey = `sk-${randomBytes(32).toString("base64url")}`;
  const apiKeys = { ...emptyProviderApiKeys(), ...(current.openAICompat?.apiKeys || {}), [provider]: apiKey };
  saveSettings({
    allowedCommands: current.allowedCommands,
    openAICompat: { apiKeys },
  });
  return apiKey;
}

export function resolveOpenAICompatApiKey(req) {
  const keys = loadSettings().openAICompat?.apiKeys || {};
  const configured = Object.entries(keys).filter(([, key]) => key);
  if (!configured.length) return { ok: true, provider: null };

  const auth = String(req.headers.authorization || "");
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const apiKey = String(req.headers["x-api-key"] || "").trim();
  const provided = bearer || apiKey;
  const match = configured.find(([, key]) => key === provided);
  if (!match) return { ok: false, provider: null };
  return { ok: true, provider: match[0] };
}
