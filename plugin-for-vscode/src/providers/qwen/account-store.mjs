// Хранилище мультиаккаунтных токенов Qwen (аналог tokenManager.js из FreeQwenAPI).
// accounts.json живёт в ~/.qwen-cli/ рядом с auth.json и browser-profile.
// Модель статусов как в FreeQwenAPI:
//   invalid !== true && (!resetAt || resetAt <= now) -> доступен
//   resetAt > now -> rate-limited, invalid -> протухший

import fs from "node:fs";
import path from "node:path";
import { QWEN_HOME } from "./config.mjs";

const ACCOUNTS_FILE = path.join(QWEN_HOME, "accounts.json");

// Путь к хранилищу: env-override (тесты/мультиинстансы) -> дефолт ~/.qwen-cli/.
function accountsFile() {
  return process.env.QWEN_ACCOUNTS_FILE || ACCOUNTS_FILE;
}

let pointer = 0;

function isAvailableAccount(account, now = Date.now()) {
  return Boolean(account?.token)
    && account.invalid !== true
    && (!account.resetAt || new Date(account.resetAt).getTime() <= now);
}

function ensureDir() {
  if (!fs.existsSync(QWEN_HOME)) fs.mkdirSync(QWEN_HOME, { recursive: true });
}

export function loadAccounts() {
  if (!fs.existsSync(accountsFile())) return [];
  const raw = fs.readFileSync(accountsFile(), 'utf8');
  return JSON.parse(raw);
}

export function saveAccounts(accounts) {
  ensureDir();
  fs.writeFileSync(accountsFile(), JSON.stringify(accounts, null, 2), 'utf8');
}

// Round-robin по доступным аккаунтам (как getAvailableToken в FreeQwenAPI).
export async function getAvailableAccount() {
  const accounts = loadAccounts();
  const now = Date.now();
  const valid = accounts.filter((a) => isAvailableAccount(a, now));
  if (!valid.length) return null;
  const account = valid[pointer % valid.length];
  pointer = (pointer + 1) % valid.length;
  return account;
}

export function getAccountById(id) {
  if (!id) return null;
  const account = loadAccounts().find((a) => a.id === id);
  return isAvailableAccount(account) ? account : null;
}

// Найти аккаунт ЛЮБОГО статуса (в т.ч. invalid/кулдаун) — для тихого
// refresh из профиля: обновлять надо и протухшие, фильтр — забота ротации.
export function getAccountAnyStatus(id) {
  if (!id) return null;
  return loadAccounts().find((a) => a.id === id) || null;
}

export function hasAvailableAccounts() {
  const accounts = loadAccounts();
  const now = Date.now();
  return accounts.some((a) => isAvailableAccount(a, now));
}

export function markRateLimited(id, hours = 24) {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx !== -1) {
    accounts[idx].resetAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
    saveAccounts(accounts);
  }
}

// Короткий per-account кулдаун в миллисекундах — для Baxia punish
// (минутный масштаб вместо часового markRateLimited). Аккаунт выпадает
// из ротации до resetAt, остальные продолжают работать.
export function markAccountCooldown(id, cooldownMs) {
  if (!id || !(cooldownMs > 0)) return;
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx !== -1) {
    accounts[idx].resetAt = new Date(Date.now() + cooldownMs).toISOString();
    saveAccounts(accounts);
  }
}

export function markInvalid(id) {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx !== -1) { accounts[idx].invalid = true; saveAccounts(accounts); }
}

// Разбор exp из JWT без проверки подписи (клиентская сторона trusts issuer).
// null -> не JWT/мусор.
export function decodeQwenTokenExp(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return Number.isFinite(payload?.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// 401 при ЖИВОМ JWT — это не смерть токена, а риск-флаг провайдера
// (инцидент 2026-09-25: RGV587 — пачка свежих логинов с одного IP; чтение
// /chats работает, записи запрещены на часы). Такой аккаунт уходит в
// кулдаун и сам возвращается. 401 при просроченном JWT — честный invalid,
// лечится только перелогином.
export function markQwenAuthFailure(id, { cooldownMs = 6 * 3600 * 1000, now = Date.now() } = {}) {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  const expMs = decodeQwenTokenExp(accounts[idx].token);
  if (expMs !== null && expMs > now) {
    // токен жив — риск-флаг: cooldown, из ротации временно
    accounts[idx].invalid = false;
    accounts[idx].resetAt = new Date(now + cooldownMs).toISOString();
  } else {
    accounts[idx].invalid = true;
    accounts[idx].resetAt = null;
  }
  saveAccounts(accounts);
  return true;
}

export function markValid(id, updates = {}) {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx !== -1) {
    accounts[idx].invalid = false;
    accounts[idx].resetAt = null;
    Object.assign(accounts[idx], updates);
    saveAccounts(accounts);
  }
}

export function removeAccount(id) {
  saveAccounts(loadAccounts().filter((a) => a.id !== id));
}

// Человекочитаемая метка слота (обычно почта аккаунта). Ставится при
// добавлении/перелогине; переживает все mark*-циклы. Задача — не гадать
// по acc_<timestamp>, какая почта в каком слоте (инцидент 2026-09-25).
export function setAccountLabel(id, label) {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  accounts[idx].label = String(label ?? "");
  saveAccounts(accounts);
  return true;
}

export function addAccount(account) {
  const accounts = loadAccounts();
  accounts.push({ resetAt: null, invalid: false, ...account });
  saveAccounts(accounts);
  return account;
}

export function listAccounts() {
  return loadAccounts();
}

export function getAccountProfileDir(id) {
  return path.join(QWEN_HOME, "browser-profile-" + id);
}

// Обновить token/cookies у pool-аккаунта из его persistent-профиля.
// 2026-09-29: access-JWT живёт 1 час, refresh_token — в куках профиля.
// SPA при загрузке сам делает refresh и кладёт свежий JWT в localStorage.
export function updateAccountFromProfile(accountId, { token, cookies } = {}) {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === accountId);
  if (idx === -1) return false;
  if (token) {
    accounts[idx].token = token;
    // refresh из живого профиля = сессия жива: снимаем auth-invalid, иначе
    // ротация навсегда пропускает аккаунт и пул вырождается в default
    // (инцидент 2026-09-29 «пул вымер»). Антибот-кулдаун (resetAt) НЕ трогаем.
    accounts[idx].invalid = false;
  }
  if (cookies) {
    accounts[idx].cookies = cookies;
    accounts[idx].cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }
  saveAccounts(accounts);
  return true;
}

// Статус для меню (как formatStatus в scripts/auth.js FreeQwenAPI).
export function formatAccountStatus(account) {
  const now = Date.now();
  if (account.invalid) return { code: 0, label: '❌ Недействителен' };
  if (account.resetAt && new Date(account.resetAt).getTime() > now) {
    const mins = Math.ceil((new Date(account.resetAt).getTime() - now) / 60000);
    return { code: 1, label: `⏳ Кулдаун ~${mins} мин` };
  }
  return { code: 2, label: '✅ OK' };
}
