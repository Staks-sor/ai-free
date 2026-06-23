// Whitelist разрешённых команд для /code run_command.
// Каталог COMMAND_CATALOG — единый источник правды: что доступно, чем рискованно,
// какие точечные опасные паттерны блокировать (rm -rf, git push --force и т.п.).
// Юзерский выбор (галочки в UI) хранится в ~/.deepseek-cli/settings.json,
// бэкенд читает loadSettings() на каждый run_command вызов — без рестарта.

import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { AUTH_DIR, SETTINGS_FILE } from "../config.mjs";
import { DEFAULT_LANGUAGE, normalizeLanguage } from "../i18n/index.mjs";
import { getProviderIds } from "../providers/model-catalog.mjs";

export const COMMAND_CATALOG = {
  node:    { description: "Запуск JS-файлов через Node",                       risk: "low",    enabledByDefault: true },
  npm:     { description: "npm install/ci/run/test и скрипты (publish/login заблокированы)", risk: "low",    enabledByDefault: true },
  python3: { description: "Python на macOS, Linux, Windows и из .venv проекта", risk: "low", enabledByDefault: true },
  python:  { description: "Алиас для python3",                                 risk: "low",    enabledByDefault: true },
  ls:      { description: "Листинг файлов и папок",                            risk: "low",    enabledByDefault: true },
  cat:     { description: "Печать содержимого файла",                          risk: "low",    enabledByDefault: true },
  pwd:     { description: "Текущая рабочая папка",                             risk: "low",    enabledByDefault: true },

  mkdir:   { description: "Создание папок",                                    risk: "low",    enabledByDefault: true },
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
  cp:      { description: "Копирование файлов",                                risk: "low",    enabledByDefault: true },
  touch:   { description: "Создание пустого файла / обновление mtime",         risk: "low",    enabledByDefault: true },
  grep:    { description: "Поиск по тексту (regex с | в аргументах — ок)",              risk: "low",    enabledByDefault: true },
  rg:      { description: "ripgrep — быстрый поиск по проекту",                risk: "low",    enabledByDefault: true },
  head:    { description: "Первые N строк файла",                              risk: "low",    enabledByDefault: true },
  tail:    { description: "Последние N строк файла",                           risk: "low",    enabledByDefault: true },
  wc:      { description: "Подсчёт строк / слов / байт",                       risk: "low",    enabledByDefault: true },
  diff:    { description: "Сравнение файлов",                                  risk: "low",    enabledByDefault: true },
  jq:      { description: "JSON из командной строки",                          risk: "low",    enabledByDefault: true },
  yq:      { description: "YAML из командной строки",                          risk: "low",    enabledByDefault: true },
  env:     { description: "Переменные окружения",                              risk: "low",    enabledByDefault: true },
  which:   { description: "Где лежит бинарник в PATH",                         risk: "low",    enabledByDefault: true },
  file:    { description: "Тип файла",                                         risk: "low",    enabledByDefault: true },
  basename:{ description: "Имя файла из пути",                                   risk: "low",    enabledByDefault: true },
  dirname: { description: "Папка из пути",                                     risk: "low",    enabledByDefault: true },
  realpath:{ description: "Канонический путь",                                   risk: "low",    enabledByDefault: true },
  readlink:{ description: "Ссылка на файл",                                    risk: "low",    enabledByDefault: true },
  stat:    { description: "Метаданные файла",                                    risk: "low",    enabledByDefault: true },
  du:      { description: "Размер каталогов",                                  risk: "low",    enabledByDefault: true },
  df:      { description: "Свободное место на дисках",                         risk: "low",    enabledByDefault: true },
  npx:     { description: "Запуск npm-пакетов без глобальной установки",         risk: "low",    enabledByDefault: true },
  pnpm:    { description: "pnpm scripts и install",                              risk: "low",    enabledByDefault: true },
  yarn:    { description: "yarn scripts и install",                              risk: "low",    enabledByDefault: true },
  bun:     { description: "Bun runtime и пакеты",                              risk: "low",    enabledByDefault: true },
  deno:    { description: "Deno runtime",                                      risk: "low",    enabledByDefault: true },

  find: {
    description: "Поиск файлов (-exec / -delete заблокированы)",
    risk: "medium", enabledByDefault: true,
    validateArgs: (args) => {
      for (const arg of args) {
        if (arg === "-exec" || arg === "-execdir" || arg === "-delete" || arg === "-ok") {
          throw new Error(`find: опция ${arg} заблокирована (потенциальный RCE).`);
        }
      }
    },
  },
  git: {
    description: "git: status, diff, commit, clone, pull, push (push --force заблокирован)",
    risk: "medium", enabledByDefault: true,
    validateArgs: (args) => {
      const sub = (args[0] || "").toLowerCase();
      if (sub === "push" && (args.includes("--force") || args.includes("-f") || args.some((a) => String(a).startsWith("+")))) {
        throw new Error("git push --force заблокирован.");
      }
    },
  },
  mv: { description: "Перемещение/переименование", risk: "medium", enabledByDefault: true },
  sed: {
    description: "Замена/обработка текста",
    risk: "medium", enabledByDefault: true,
  },
  chmod: {
    description: "Изменение прав (777, +x на всё — заблокированы)",
    risk: "medium", enabledByDefault: true,
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
    risk: "medium", enabledByDefault: true,
  },

  pip:     { description: "pip install/list (в venv или --user)",              risk: "medium", enabledByDefault: true },
  pip3:    { description: "Алиас pip для Python 3",                            risk: "medium", enabledByDefault: true },
  uv:      { description: "uv — быстрый Python/pip",                           risk: "medium", enabledByDefault: true },
  poetry:  { description: "Poetry: зависимости и venv",                        risk: "medium", enabledByDefault: true },
  cargo:   { description: "Rust: build, test, run",                            risk: "medium", enabledByDefault: true },
  rustc:   { description: "Компилятор Rust",                                   risk: "medium", enabledByDefault: true },
  go:      { description: "Go build, test, run",                               risk: "medium", enabledByDefault: true },
  cmake:   { description: "CMake configure/build",                             risk: "medium", enabledByDefault: true },
  ninja:   { description: "Ninja build",                                       risk: "medium", enabledByDefault: true },
  java:    { description: "Запуск JVM",                                        risk: "medium", enabledByDefault: true },
  javac:   { description: "Компиляция Java",                                   risk: "medium", enabledByDefault: true },
  mvn:     { description: "Maven",                                             risk: "medium", enabledByDefault: true },
  gradle:  { description: "Gradle",                                              risk: "medium", enabledByDefault: true },

  curl:    { description: "HTTP-запросы",                                      risk: "medium", enabledByDefault: true },
  wget:    { description: "Скачивание по URL",                                 risk: "medium", enabledByDefault: true },
  ssh:     { description: "SSH на удалённый сервер",                           risk: "high",   enabledByDefault: true },
  scp:     { description: "Копирование по SSH",                                risk: "high",   enabledByDefault: true },
  rsync:   { description: "Синхронизация файлов (локально и по SSH)",          risk: "high",   enabledByDefault: true },
  sftp:    { description: "SFTP-сессия",                                       risk: "high",   enabledByDefault: true },

  docker: {
    description: "Docker: build, run, compose, ps, logs",
    risk: "high", enabledByDefault: true,
    validateArgs: (args) => {
      const joined = args.join(" ").toLowerCase();
      if (/\s-v\s+\/:\//.test(joined) || /\s--volume\s+\/:\//.test(joined)) {
        throw new Error("docker: монтирование корня / заблокировано.");
      }
    },
  },
  "docker-compose": { description: "Docker Compose v1",                       risk: "high",   enabledByDefault: true },
  podman:  { description: "Podman (альтернатива Docker)",                      risk: "high",   enabledByDefault: true },
  kubectl: { description: "Kubernetes CLI",                                    risk: "high",   enabledByDefault: true },
  helm:    { description: "Helm charts",                                       risk: "high",   enabledByDefault: true },
  terraform: { description: "Terraform plan/apply",                          risk: "high",   enabledByDefault: true },
  "ansible-playbook": { description: "Ansible playbooks",                    risk: "high",   enabledByDefault: true },

  brew:    { description: "Homebrew (macOS/Linux)",                            risk: "high",   enabledByDefault: true },
  gh:      { description: "GitHub CLI",                                        risk: "medium", enabledByDefault: true },
  sqlite3: { description: "SQLite shell",                                      risk: "medium", enabledByDefault: true },
  psql:    { description: "PostgreSQL client",                                 risk: "medium", enabledByDefault: true },
  "redis-cli": { description: "Redis client",                                    risk: "medium", enabledByDefault: true },

  tar:     { description: "Архивы tar",                                        risk: "medium", enabledByDefault: true },
  zip:     { description: "Архив zip",                                         risk: "low",    enabledByDefault: true },
  unzip:   { description: "Распаковка zip",                                    risk: "low",    enabledByDefault: true },
  gzip:    { description: "Сжатие gzip",                                       risk: "low",    enabledByDefault: true },
  gunzip:  { description: "Распаковка gzip",                                   risk: "low",    enabledByDefault: true },

  ps:      { description: "Список процессов",                                  risk: "medium", enabledByDefault: true },
  pgrep:   { description: "Поиск PID по имени",                                risk: "medium", enabledByDefault: true },
  lsof:    { description: "Открытые файлы/порты",                              risk: "medium", enabledByDefault: true },
  kill:    { description: "Завершение процесса по PID",                        risk: "high",   enabledByDefault: true },
  ping:    { description: "Проверка сети",                                     risk: "medium", enabledByDefault: true },
  nc:      { description: "netcat",                                            risk: "high",   enabledByDefault: true },

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
    risk: "high", enabledByDefault: true,
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

function normalizeCommandPermissions(rawPermissions = {}) {
  return {
    allowPythonModuleAndEval: rawPermissions?.allowPythonModuleAndEval !== false,
    allowShell: rawPermissions?.allowShell !== false,
  };
}

function mergeDefaultAllowedCommands(allowed) {
  const set = new Set(Array.isArray(allowed) ? allowed : []);
  for (const [cmd, meta] of Object.entries(COMMAND_CATALOG)) {
    if (meta.enabledByDefault) set.add(cmd);
  }
  return [...set];
}

export function loadSettings() {
  const fallback = {
    allowedCommands: Object.keys(COMMAND_CATALOG).filter(
      (cmd) => COMMAND_CATALOG[cmd].enabledByDefault,
    ),
    openAICompat: { apiKeys: emptyProviderApiKeys() },
    commandPermissions: normalizeCommandPermissions(),
    ui: {
      language: normalizeLanguage(process.env.AI_FREE_LANG || DEFAULT_LANGUAGE),
      webSearchDefault: true,
    },
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
      allowedCommands: mergeDefaultAllowedCommands(allowed),
      openAICompat: {
        apiKeys: normalizeProviderApiKeys(apiKeys, legacyKey),
      },
      commandPermissions: normalizeCommandPermissions(raw?.commandPermissions),
      ui: {
        language: normalizeLanguage(raw?.ui?.language || fallback.ui.language),
        webSearchDefault: raw?.ui?.webSearchDefault !== false,
      },
    };
  } catch {
    return fallback;
  }
}

export function saveSettings(settings) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const current = loadSettings();
  const rawAllowed = Array.isArray(settings?.allowedCommands)
    ? settings.allowedCommands
    : current.allowedCommands;
  const valid = rawAllowed.filter((cmd) => COMMAND_CATALOG[cmd]);
  const requestedKeys = settings?.openAICompat?.apiKeys || {};
  const currentKeys = current.openAICompat?.apiKeys || {};
  const commandPermissions = normalizeCommandPermissions({
    ...(current.commandPermissions || {}),
    ...(settings?.commandPermissions || {}),
  });
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
    commandPermissions,
    ui: {
      language: normalizeLanguage(settings?.ui?.language || current.ui?.language || DEFAULT_LANGUAGE),
      webSearchDefault: settings?.ui?.webSearchDefault === undefined
        ? current.ui?.webSearchDefault !== false
        : settings.ui.webSearchDefault !== false,
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
