// Хранилище мультиаккаунтных токенов Qwen (аналог tokenManager.js из FreeQwenAPI).
// accounts.json живёт в ~/.qwen-cli/ рядом с auth.json и browser-profile.
// Модель статусов как в FreeQwenAPI:
//   invalid !== true && (!resetAt || resetAt <= now) -> доступен
//   resetAt > now -> rate-limited, invalid -> протухший

import fs from "node:fs";
import { writeAtomicJsonSync } from "../../state/state-writer.mjs";
import path from "node:path";
import { QWEN_HOME } from "./config.mjs";

const ACCOUNTS_FILE = path.join(QWEN_HOME, "accounts.json");

// Путь к хранилищу: env-override (тесты/мультиинстансы) -> дефолт ~/.qwen-cli/.
function accountsFile() {
  return process.env.QWEN_ACCOUNTS_FILE || ACCOUNTS_FILE;
}

let pointer = 0;

export function isQwenTokenExpired(token, now = Date.now()) {
  try {
    const { exp } = JSON.parse(Buffer.from(String(token || '').split('.')[1], 'base64url').toString('utf8'));
    return Number.isFinite(exp) && exp * 1000 <= now;
  } catch { return false; }
}

function isAvailableAccount(account, now = Date.now()) {
  return Boolean(account?.token)
    && account.disabled !== true && account.limited !== true
    && account.invalid !== true
    && !isQwenTokenExpired(account.token, now)
    && (!account.resetAt || new Date(account.resetAt).getTime() <= now);
}

function ensureDir() {
  const dir = path.dirname(accountsFile());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadAccounts() {
  if (!fs.existsSync(accountsFile())) return [];
  const raw = fs.readFileSync(accountsFile(), 'utf8');
  return JSON.parse(raw);
}

export function saveAccounts(accounts) {
  ensureDir();
  writeAtomicJsonSync(accountsFile(), accounts);
  fs.chmodSync(accountsFile(), 0o600);
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

export function hasAvailableAccounts() {
  const accounts = loadAccounts();
  const now = Date.now();
  return accounts.some((a) => isAvailableAccount(a, now));
}

// A short-lived access JWT can expire while the saved browser login is valid.
// This allows the worker's silent renewal; it does not make the JWT leasable.
export function hasRestorableQwenSession(accounts = loadAccounts()) {
  const now = Date.now();
  return accounts.some(account => !account.disabled && account.cookies?.some(cookie =>
    cookie.name === 'refresh_token' && cookie.value
    && (!Number.isFinite(cookie.expires) || cookie.expires <= 0 || cookie.expires * 1000 > now)));
}

export function markRateLimited(id, hours = 24) {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx !== -1) {
    accounts[idx].resetAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
    saveAccounts(accounts);
  }
}

export function markInvalid(id) {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx !== -1) { accounts[idx].invalid = true; saveAccounts(accounts); }
}

export function markValid(id, updates = {}) {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx !== -1) {
    accounts[idx].invalid = false;
    accounts[idx].limited = false;
    accounts[idx].resetAt = null;
    Object.assign(accounts[idx], updates);
    saveAccounts(accounts);
  }
}

export function removeAccount(id) {
  saveAccounts(loadAccounts().filter((a) => a.id !== id));
}

export function addAccount(account) {
  const accounts = loadAccounts();
  if (accounts.length >= 10) throw new Error("Можно подключить до 10 аккаунтов Qwen");
  accounts.push({ resetAt: null, invalid: false, ...account });
  saveAccounts(accounts);
  return account;
}

export function listAccounts() {
  return loadAccounts();
}

export function getAccountProfileDir(id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error("Неверный идентификатор аккаунта Qwen");
  return path.join(QWEN_HOME, "browser-profile-" + id);
}

// Статус для меню (как formatStatus в scripts/auth.js FreeQwenAPI).
export function formatAccountStatus(account) {
  const now = Date.now();
  if (account.invalid || isQwenTokenExpired(account.token, now)) return { code: 0, label: '❌ Недействителен' };
  if (account.resetAt && new Date(account.resetAt).getTime() > now) {
    return { code: 1, label: '⏳ Ожидание сброса' };
  }
  return { code: 2, label: '✅ OK' };
}
