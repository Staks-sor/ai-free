// Credentials (email + password) для авто-заполнения формы при re-login.
// Хранятся в ~/.deepseek-cli/credentials.json. На Unix — mode 0o600, на Windows — ACL.
// Это plaintext (сознательный выбор простоты). См. README про риски.

import fs from "node:fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AUTH_DIR, CREDENTIALS_FILE } from "../config.mjs";

export function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_FILE)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf8"));
    if (!raw?.email || !raw?.password) return null;
    return { email: String(raw.email), password: String(raw.password) };
  } catch {
    return null;
  }
}

export function saveCredentials({ email, password }) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const payload = { email, password, savedAt: new Date().toISOString() };
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(payload, null, 2));
  try {
    fs.chmodSync(CREDENTIALS_FILE, 0o600);
  } catch {}
}

// Интерактивный ввод email + пароля. Кросс-платформенно: работает в Terminal/iTerm,
// gnome-terminal, Windows Terminal, PowerShell, CMD.
export async function saveCredentialsInteractive() {
  console.log("Setting up auto-login credentials.");
  console.log(`File: ${CREDENTIALS_FILE}`);
  console.log("⚠️  Пароль будет сохранён в открытом виде. Это твой выбор. См. README.\n");

  const rl = readline.createInterface({ input, output });
  let email = "";
  try {
    email = (await rl.question("DeepSeek email: ")).trim();
  } finally {
    rl.close();
  }
  if (!email) throw new Error("Email cannot be empty.");

  const password = await readSecret("DeepSeek password (input hidden): ");
  if (!password) throw new Error("Password cannot be empty.");

  saveCredentials({ email, password });
  console.log(`✅ Saved credentials to ${CREDENTIALS_FILE}`);
  console.log("Следующий re-login будет полностью автоматическим.");
}

// Чтение строки без эха. Кросс-платформа через raw mode TTY.
export async function readSecret(prompt) {
  return await new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      // Fallback для не-TTY (pipe, IDE без raw mode): обычный ввод с эхом.
      const rl = readline.createInterface({ input, output });
      rl.question(prompt).then((answer) => { rl.close(); resolve(answer); });
      return;
    }
    process.stdout.write(prompt);
    const wasRaw = !!stdin.isRaw;
    try { stdin.setRawMode(true); } catch (error) { return reject(error); }
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const cleanup = () => {
      stdin.removeListener("data", onData);
      try { if (!wasRaw) stdin.setRawMode(false); } catch {}
      stdin.pause();
    };
    const onData = (key) => {
      for (const ch of key) {
        if (ch === "\r" || ch === "\n") {
          cleanup();
          process.stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\x03") { cleanup(); return reject(new Error("Cancelled")); }
        if (ch === "\x04") { cleanup(); process.stdout.write("\n"); return resolve(value); }
        if (ch === "\x7f" || ch === "\b") {
          value = value.slice(0, -1);
        } else {
          value += ch;
        }
      }
    };
    stdin.on("data", onData);
  });
}
