// Интерактивное управление аккаунтами Qwen (аналог accountSetup.js FreeQwenAPI),
// но вход через существующий login-flow ai-free: Playwright + стелс-скрипты +
// автовайтер JWT в cookies. Пользователю НЕ нужно нажимать ENTER — окно
// закрывается само, как в текущем npm run login-qwen.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { QWEN_HOME, QWEN_AUTH_FILE, QWEN_BROWSER_PROFILE } from "./config.mjs";
import {
  loadAccounts, addAccount, removeAccount, markValid,
  formatAccountStatus, getAccountProfileDir, setAccountLabel,
} from "./account-store.mjs";

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); }));
}

function printDivider() {
  console.log("======================================================");
}

function printAccounts(accounts) {
  console.log("\nСписок аккаунтов:");
  if (!accounts.length) {
    console.log("  (пусто)");
    return;
  }
  accounts.forEach((account, index) => {
    const status = formatAccountStatus(account);
    const label = account.label ? ` | ${account.label}` : "";
    console.log(`${String(index + 1).padStart(2, " ")} | ${account.id}${label} | ${status.label}`);
  });
}

function handleList(accounts) {
  printAccounts(accounts);
  const active = accounts.filter((a) => formatAccountStatus(a).code === 2);
  console.log(`\nАктивных аккаунтов: ${active.length} из ${accounts.length}`);
}

// Добавление аккаунта: видимый браузер с СОБСТВЕННЫМ профилем
// browser-profile-<id> и auth.json внутри него. Внутри — существующий
// login-flow ai-free (стелс + автовайтер JWT), никакой миграции не нужно.
export async function addAccountInteractive() {
  printDivider();
  console.log("Добавление нового аккаунта Qwen");
  printDivider();
  console.log("Браузер откроется, войдите в систему, затем вернитесь к консоли.");

  const id = "acc_" + Date.now();
  const profileDir = getAccountProfileDir(id);
  const authFile = path.join(profileDir, "auth.json");
  const { loginQwenAndSave } = await import("./browser-login.mjs");
  const loginResult = await loginQwenAndSave(authFile, { profileDir });

  // Метка слота — почта, которой залогинились. Спрашиваем ПОСЛЕ логина:
  // пользователь только что видел её в окне (инцидент 2026-09-25: по
  // acc_<timestamp> невозможно вспомнить, какая почта в каком слоте).
  const label = await prompt(`Почта этого аккаунта для метки (Enter = без метки): `);

  addAccount({
    id,
    token: loginResult.token,
    cookies: loginResult.cookies,
    cookieHeader: loginResult.cookieHeader,
    userId: loginResult.userId,
    profileDir,
    ...(label ? { label } : {}),
  });

  const total = loadAccounts().length;
  console.log(`Аккаунт '${id}' добавлен. Всего аккаунтов: ${total}`);
  printDivider();
  return id;
}

// Перелогин аккаунта с истекшим токеном: сначала пытаемся автологин из
// logins.txt (headless) для ВСЕХ мёртвых аккаунтов; оставшиеся без пароля
// предлагаем перелогинить вручную.
export async function reloginAccountInteractive() {
  const accounts = loadAccounts();
  const invalids = accounts.filter((a) => a.invalid);
  if (!invalids.length) {
    console.log("Нет аккаунтов, требующих повторного входа.");
    await prompt("Нажмите ENTER чтобы вернуться в меню...");
    return;
  }

  // --- Автологин из logins.txt (batch, headless) ---
  const { loadQwenLogins, resolveQwenAutoLogin, autoLoginQwenAccount } = await import("./auto-login.mjs");
  const logins = loadQwenLogins();
  let autoOk = 0;
  let autoFail = 0;
  const manualLeft = [];

  if (logins && logins.size) {
    console.log(`\n🤖 Пытаюсь автологин для ${invalids.length} мёртвых аккаунтов из logins.txt...`);
    for (const acc of invalids) {
      const plan = resolveQwenAutoLogin({ account: acc, logins, enabled: true });
      if (!plan.allowed) {
        manualLeft.push(acc);
        continue;
      }
      try {
        await autoLoginQwenAccount(acc, { headless: true });
        autoOk++;
        console.log(`  ✅ ${acc.id} (${acc.label || plan.email}): автологин успешен`);
      } catch (err) {
        autoFail++;
        manualLeft.push(acc);
        console.log(`  ⚠️ ${acc.id} (${acc.label || plan.email}): автологин не прошёл (${err?.message?.slice(0, 80)})`);
      }
    }
    console.log(`\nИтог автологина: ✅ ${autoOk} успех, ⚠️ ${autoFail} неудач.`);
  } else {
    console.log("\nℹ️ logins.txt пуст или отсутствует — пропускаю автологин.");
    manualLeft.push(...invalids);
  }

  // --- Ручной перелогин для оставшихся ---
  if (!manualLeft.length) {
    console.log("Все аккаунты восстановлены автоматически.");
    await prompt("Нажмите ENTER чтобы вернуться в меню...");
    return;
  }

  console.log("\nАккаунты, требующие ручного входа:");
  manualLeft.forEach((a, idx) => {
    const label = a.label ? ` (${a.label})` : "";
    console.log(`${idx + 1} - ${a.id}${label}`);
  });
  const choice = await prompt("Выберите номер аккаунта для ручного входа (Enter = пропустить): ");
  if (!choice) return;
  const num = parseInt(choice, 10);
  if (isNaN(num) || num < 1 || num > manualLeft.length) {
    console.log("Неверный выбор.");
    return;
  }
  const account = manualLeft[num - 1];

  printDivider();
  console.log(`Повторная авторизация для ${account.id}${account.label ? ` (${account.label})` : ""}`);
  printDivider();
  const profileDir = account.profileDir || getAccountProfileDir(account.id);
  const authFile = path.join(profileDir, "auth.json");
  const { loginQwenAndSave } = await import("./browser-login.mjs");
  const result = await loginQwenAndSave(authFile, { clearSession: true, profileDir });
  markValid(account.id, {
    token: result.token,
    cookies: result.cookies,
    cookieHeader: result.cookieHeader,
    userId: result.userId,
  });
  const newLabel = await prompt(`Почта для метки (сейчас: ${account.label || "нет"}; Enter = оставить): `);
  if (newLabel) setAccountLabel(account.id, newLabel);
  console.log(`Токен обновлён для ${account.id}`);
}

export async function removeAccountInteractive() {
  const accounts = loadAccounts();
  if (!accounts.length) {
    console.log("Нет сохранённых аккаунтов.");
    await prompt("ENTER чтобы вернуться...");
    return;
  }

  console.log("\nДоступные аккаунты:");
  accounts.forEach((a, idx) => console.log(`${idx + 1} - ${a.id}`));
  const choice = await prompt("Номер аккаунта, который нужно удалить (или ENTER для отмены): ");
  if (!choice) return;
  const num = parseInt(choice, 10);
  if (isNaN(num) || num < 1 || num > accounts.length) {
    console.log("Неверный выбор.");
    await prompt("ENTER чтобы вернуться...");
    return;
  }

  const acc = accounts[num - 1];
  const confirm = await prompt(`Точно удалить ${acc.id}? (y/N): `);
  if (confirm.toLowerCase() !== "y") return;

  removeAccount(acc.id);
  const dir = acc.profileDir || getAccountProfileDir(acc.id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });

  console.log(`Аккаунт ${acc.id} удалён.`);
  await prompt("ENTER чтобы вернуться...");
}

// Health-check всех аккаунтов: ping через browser-proxy, обновление статусов.
async function healthCheckInteractive() {
  console.log("\nПроверяю аккаунты (ping chat.qwen.ai)...");
  const { testQwenAccounts } = await import("./account-health.mjs");
  const { closeQwenBrowserProxy } = await import("./browser-proxy.mjs");
  try {
    const results = await testQwenAccounts();
    console.log("\nРезультаты:");
    for (const r of results) {
      const label = r.verdict === "OK" ? "✅ OK"
        : r.verdict === "RATELIMIT" ? `⏳ Rate-limited (${r.hours}ч)`
        : r.verdict === "UNAUTHORIZED" ? "❌ Недействителен (нужен перелогин)"
        : `⚠️ ${r.verdict}${r.reason ? `: ${r.reason}` : ""}`;
      console.log(`  ${r.id} | ${label}`);
    }
  } finally {
    await closeQwenBrowserProxy(null);
  }
  await prompt("\nНажмите Enter, чтобы вернуться в меню...");
}

// Главное меню (как scripts/auth.js FreeQwenAPI: 1-add/2-relogin/3-remove/4-list/5-exit).
export async function interactiveAccountMenu() {
  while (true) {
    const accounts = loadAccounts();
    printDivider();
    printAccounts(accounts);
    printDivider();
    console.log("Меню:");
    console.log("1 - Добавить новый аккаунт");
    console.log("2 - Перелогинить аккаунт с истекшим токеном");
    console.log("3 - Удалить аккаунт");
    console.log("4 - Показать список и статусы");
    console.log("5 - Проверить все аккаунты (health-check)");
    console.log("6 - Выход");
    const choice = await prompt("Ваш выбор (Enter = 6): ");
    const normalized = choice || "6";

    if (normalized === "1") {
      await addAccountInteractive();
    } else if (normalized === "2") {
      await reloginAccountInteractive();
    } else if (normalized === "3") {
      await removeAccountInteractive();
    } else if (normalized === "4") {
      handleList(accounts);
      await prompt("\nНажмите Enter, чтобы вернуться в меню...");
    } else if (normalized === "5") {
      await healthCheckInteractive();
    } else if (normalized === "6") {
      console.log("Выход из скрипта.");
      break;
    }
  }
}
