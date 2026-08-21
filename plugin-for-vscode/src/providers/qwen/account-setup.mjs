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
  formatAccountStatus, getAccountProfileDir,
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
    console.log(`${String(index + 1).padStart(2, " ")} | ${account.id} | ${status.label}`);
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

  addAccount({
    id,
    token: loginResult.token,
    cookies: loginResult.cookies,
    cookieHeader: loginResult.cookieHeader,
    userId: loginResult.userId,
    profileDir,
  });

  const total = loadAccounts().length;
  console.log(`Аккаунт '${id}' добавлен. Всего аккаунтов: ${total}`);
  printDivider();
  return id;
}

// Перелогин аккаунта с истекшим токеном: тот же flow, профиль переиспользуется.
export async function reloginAccountInteractive() {
  const accounts = loadAccounts();
  const invalids = accounts.filter((a) => a.invalid);
  if (!invalids.length) {
    console.log("Нет аккаунтов, требующих повторного входа.");
    await prompt("Нажмите ENTER чтобы вернуться в меню...");
    return;
  }

  console.log("\nАккаунты с истекшим токеном:");
  invalids.forEach((a, idx) => console.log(`${idx + 1} - ${a.id}`));
  const choice = await prompt("Выберите номер аккаунта для повторного входа: ");
  const num = parseInt(choice, 10);
  if (isNaN(num) || num < 1 || num > invalids.length) {
    console.log("Неверный выбор.");
    return;
  }
  const account = invalids[num - 1];

  printDivider();
  console.log(`Повторная авторизация для ${account.id}`);
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
    console.log("5 - Выход");
    const choice = await prompt("Ваш выбор (Enter = 5): ");
    const normalized = choice || "5";

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
      console.log("Выход из скрипта.");
      break;
    }
  }
}
