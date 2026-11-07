import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAccounts } from "./account-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../../data');
const ROUTING_FILE = path.join(DATA_DIR, 'qwen-routing.json');

let routingMap = {};
let initialized = false;

function loadRouting() {
  if (initialized) return;
  if (fs.existsSync(ROUTING_FILE)) {
    const raw = fs.readFileSync(ROUTING_FILE, 'utf8');
    routingMap = JSON.parse(raw);
  }
  initialized = true;
}

function saveRouting() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ROUTING_FILE, JSON.stringify(routingMap, null, 2), 'utf8');
}

export function resolveAccountForUser(telegramUserId) {
  loadRouting();
  const userId = telegramUserId ? String(telegramUserId) : 'default';
  if (routingMap[userId]) {
    const acc = loadAccounts().find((a) => a.id === routingMap[userId] && a.invalid !== true);
    if (acc) {
      return acc;
    }
    delete routingMap[userId];
    saveRouting();
  }
  const now = Date.now();
  const activeAccounts = loadAccounts().filter((a) =>
    a.invalid !== true && (!a.resetAt || new Date(a.resetAt).getTime() <= now));
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
