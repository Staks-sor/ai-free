import fs from 'node:fs';
import path from 'node:path';
import { QWEN_HOME } from './config.mjs';
import { loadAccounts } from "./account-store.mjs";

function routingFile() {
  return process.env.QWEN_ROUTING_FILE || path.join(QWEN_HOME, 'qwen-routing.json');
}

let routingMap = {};
let initialized = false;

function loadRouting() {
  if (initialized) return;
  if (fs.existsSync(routingFile())) {
    const raw = fs.readFileSync(routingFile(), 'utf8');
    routingMap = JSON.parse(raw);
  }
  initialized = true;
}

function saveRouting() {
  fs.mkdirSync(path.dirname(routingFile()), { recursive: true });
  fs.writeFileSync(routingFile(), JSON.stringify(routingMap, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(routingFile(), 0o600);
}

export function resolveAccountForUser(telegramUserId) {
  loadRouting();
  const userId = telegramUserId ? String(telegramUserId) : 'default';
  if (routingMap[userId]) {
    const now = Date.now();
    const acc = loadAccounts().find((a) =>
      a.id === routingMap[userId]
      && Boolean(a.token)
      && a.disabled !== true && a.limited !== true
      && a.invalid !== true
      && (!a.resetAt || new Date(a.resetAt).getTime() <= now));
    if (acc) {
      return acc;
    }
    delete routingMap[userId];
    saveRouting();
  }
  const now = Date.now();
  const activeAccounts = loadAccounts().filter((a) =>
    Boolean(a.token) && a.invalid !== true && a.disabled !== true && a.limited !== true && (!a.resetAt || new Date(a.resetAt).getTime() <= now));
  if (activeAccounts.length === 0) return null;
  activeAccounts.sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));
  const selected = activeAccounts[0];
  routingMap[userId] = selected.id;
  saveRouting();
  return selected;
}

export function getRoutingTable() {
  loadRouting();
  return { ...routingMap };
}
