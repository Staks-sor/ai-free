// Парсинг CLI-аргументов + загрузка переменных из .env.
// Аргументы перебивают .env, .env перебивает дефолты.

import fs from "node:fs";
import { DEFAULT_AUTH_FILE, DEFAULT_COOKIE_FILE } from "./config.mjs";
import { normalizeToken } from "./auth/files.mjs";

export function parseArgs(argv) {
  const args = {
    cookies: process.env.DEEPSEEK_COOKIE_FILE || DEFAULT_COOKIE_FILE,
    token: normalizeToken(process.env.DEEPSEEK_CHAT_TOKEN || ""),
    authFile: process.env.DEEPSEEK_AUTH_FILE || DEFAULT_AUTH_FILE,
    model: process.env.DEEPSEEK_MODEL_TYPE || null,
    workspace: process.env.DEEPSEEK_WORKSPACE || process.cwd(),
    check: false,
    debug: false,
    login: false,
    stream: false,
    window: false,
    noWindow: false,
    api: false,
    acp: false,
    port: Number(process.env.DEEPSEEK_WINDOW_PORT || 4317),
    apiPort: Number(process.env.API_PORT || 4318),
    thinking: false,
    search: false,
    saveCreds: false,
    loginQwen: false,
    importQwenFile: null,
    forceWelcome: false,
    prompt: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cookies") args.cookies = argv[++i];
    else if (arg === "--token") args.token = normalizeToken(argv[++i]);
    else if (arg === "--token-file") args.token = normalizeToken(readTokenFile(argv[++i]));
    else if (arg === "--auth-file") args.authFile = argv[++i];
    else if (arg === "--model") args.model = argv[++i];
    else if (arg === "--workspace") args.workspace = argv[++i];
    else if (arg === "--thinking") args.thinking = true;
    else if (arg === "--search") args.search = true;
    else if (arg === "--check") args.check = true;
    else if (arg === "--debug") args.debug = true;
    else if (arg === "--stream") args.stream = true;
    else if (arg === "--window") args.window = true;
    else if (arg === "--no-window") {
      args.window = true;
      args.noWindow = true;
    }
    else if (arg === "--api") args.api = true;
    else if (arg === "--acp") args.acp = true;
    else if (arg === "--login") args.login = true;
    else if (arg === "--save-creds") args.saveCreds = true;
    else if (arg === "--login-qwen") args.loginQwen = true;
    else if (arg === "--import-qwen") args.importQwenFile = argv[++i];
    else if (arg === "--welcome") args.forceWelcome = true;
    else if (arg === "--port") args.port = Number(argv[++i]);
    else if (arg === "--api-port") args.apiPort = Number(argv[++i]);
    else if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else args.prompt.push(arg);
  }

  args.prompt = args.prompt.join(" ").trim();
  return args;
}

// .env читаем при старте — но НЕ перебиваем уже выставленные process.env переменные.
// Это даёт правильную последовательность приоритетов: CLI > shell > .env > defaults.
export function loadDotEnv(file = ".env") {
  if (!fs.existsSync(file)) return;

  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = parseEnvValue(rawValue);
  }
}

export function parseEnvValue(rawValue) {
  let value = rawValue.trim();
  const quote = value[0];
  if ((quote === "'" || quote === '"') && value.endsWith(quote)) {
    value = value.slice(1, -1);
  }
  return value;
}

export function printHelp() {
  console.log(`Usage:
  ai-free --cookies cookies.json --token TOKEN "message"
  ai-free --cookies cookies.json --token TOKEN
  ai-free --check --cookies cookies.json --token TOKEN
  ai-free --login

Options:
  --cookies FILE      Browser cookie export JSON
  --token TOKEN       DeepSeek localStorage userToken value
  --token-file FILE   File containing the token
  --auth-file FILE    Saved auth file, default ~/.deepseek-cli/auth.json
  --login             Open a remembered browser profile and save cookies/token
  --login-qwen        Same but for chat.qwen.ai (separate profile, separate auth)
  --import-qwen FILE  Import Qwen cookies from a Chrome JSON export (bypasses anti-bot)
  --welcome           Force show welcome screen (for adding new provider or testing)
  --save-creds        Save email + password for autofill on re-login
  --thinking          Enable thinking mode
  --search            Enable web search mode
  --model VALUE       Optional model_type value
  --workspace DIR     Folder available to /code file tools
  --stream            Print response while it is generated
  --window            Open local multi-chat window (default for npm start)
  --no-window         Start the same chat server/API without opening Chromium
  --port PORT         Port for --window (default 4317)
  --api               Start OpenAI-compatible API server
  --api-port PORT     Port for --api (default 4318)
  --acp               Start ACP agent server over stdio for JetBrains IDEs
  --check             Test auth and session creation
  --debug             Print API event diagnostics`);
}

export function readTokenFile(file) {
  return fs.readFileSync(file, "utf8").trim();
}
