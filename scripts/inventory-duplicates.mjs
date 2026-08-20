import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Известные модули с намеренными платформенными различиями
export const KNOWN_PLATFORM_SPECIFIC = new Map([
  [
    "src/state/window-state.mjs",
    "Desktop поддерживает поле mainAgentId в нормализации пайплайнов для мультиагентных команд (agent-team)",
  ],
  [
    "src/window-app/web-browser.mjs",
    "VS Code запускает headed Chrome за пределами экрана (-32000,-32000) для работы внутри webview редактора",
  ],
]);

// Модули, присутствующие только в Desktop-версии
export const KNOWN_DESKTOP_ONLY = new Set([
  "src/agent-team/index.mjs",
  "src/agent-team/roles.mjs",
  "src/agent-team/team-manager.mjs",
  "src/agent-team/team-runner.mjs",
]);

// Модули, присутствующие только в VS Code расширении
export const KNOWN_VSCODE_ONLY = new Set([
  "plugin-for-vscode/api/README.md",
]);

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function listTrackedFiles(baseDir) {
  const output = execFileSync("git", ["ls-files", "-z", "--", baseDir], {
    cwd: root,
    encoding: "utf8",
  });
  const prefix = `${baseDir}/`;
  return output
    .split("\0")
    .filter((file) => file.startsWith(prefix))
    .map((file) => file.slice(prefix.length));
}

function scanFiles(baseDir) {
  const result = new Map();
  const absBase = path.join(root, baseDir);
  if (!fs.existsSync(absBase)) return result;

  for (const rel of listTrackedFiles(baseDir)) {
    const fullPath = path.join(absBase, rel);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;
    const content = fs.readFileSync(fullPath);
    result.set(rel, {
      relPath: `${baseDir}/${rel}`,
      subPath: rel,
      size: content.length,
      hash: hashContent(content),
    });
  }
  return result;
}

function isCoreReExport(filePath) {
  try {
    const full = path.join(root, filePath);
    if (!fs.existsSync(full)) return false;
    const content = fs.readFileSync(full, "utf8");
    return content.includes("packages/core/") || content.includes("@ai-free/core");
  } catch {
    return false;
  }
}

export function getDuplicateInventory() {
  const pairs = [
    { name: "src", desktop: "src", vscode: "plugin-for-vscode/src" },
    { name: "api", desktop: "api", vscode: "plugin-for-vscode/api" },
  ];

  const identical = [];
  const coreShared = [];
  const platformSpecific = [];
  const divergent = [];
  const desktopOnly = [];
  const vscodeOnly = [];

  for (const pair of pairs) {
    const desktopFiles = scanFiles(pair.desktop);
    const vscodeFiles = scanFiles(pair.vscode);
    const allKeys = new Set([...desktopFiles.keys(), ...vscodeFiles.keys()]);

    for (const key of [...allKeys].sort()) {
      const d = desktopFiles.get(key);
      const v = vscodeFiles.get(key);
      const desktopRel = `${pair.desktop}/${key}`;
      const vscodeRel = `${pair.vscode}/${key}`;

      if (d && v) {
        if (isCoreReExport(desktopRel) && isCoreReExport(vscodeRel)) {
          coreShared.push({
            subPath: key,
            desktopPath: desktopRel,
            vscodePath: vscodeRel,
            corePath: `packages/core/src/${key}`,
          });
        } else if (d.hash === v.hash) {
          identical.push({
            subPath: key,
            desktopPath: desktopRel,
            vscodePath: vscodeRel,
            size: d.size,
            hash: d.hash,
          });
        } else if (KNOWN_PLATFORM_SPECIFIC.has(desktopRel)) {
          platformSpecific.push({
            subPath: key,
            desktopPath: desktopRel,
            vscodePath: vscodeRel,
            desktopSize: d.size,
            vscodeSize: v.size,
            reason: KNOWN_PLATFORM_SPECIFIC.get(desktopRel),
          });
        } else {
          divergent.push({
            subPath: key,
            desktopPath: desktopRel,
            vscodePath: vscodeRel,
            desktopSize: d.size,
            vscodeSize: v.size,
            desktopHash: d.hash,
            vscodeHash: v.hash,
          });
        }
      } else if (d && !v) {
        if (KNOWN_DESKTOP_ONLY.has(desktopRel)) {
          desktopOnly.push({ path: desktopRel, subPath: key, size: d.size });
        } else {
          divergent.push({
            subPath: key,
            desktopPath: desktopRel,
            vscodePath: null,
            reason: "Present in desktop, missing in VS Code without KNOWN_DESKTOP_ONLY registration",
          });
        }
      } else if (!d && v) {
        if (KNOWN_VSCODE_ONLY.has(vscodeRel)) {
          vscodeOnly.push({ path: vscodeRel, subPath: key, size: v.size });
        } else {
          divergent.push({
            subPath: key,
            desktopPath: null,
            vscodePath: vscodeRel,
            reason: "Present in VS Code, missing in desktop without KNOWN_VSCODE_ONLY registration",
          });
        }
      }
    }
  }

  const totalDuplicateBytes = identical.reduce((acc, f) => acc + f.size, 0);

  return {
    identical,
    coreShared,
    platformSpecific,
    desktopOnly,
    vscodeOnly,
    divergent,
    summary: {
      identicalCount: identical.length,
      coreSharedCount: coreShared.length,
      platformSpecificCount: platformSpecific.length,
      desktopOnlyCount: desktopOnly.length,
      vscodeOnlyCount: vscodeOnly.length,
      divergentCount: divergent.length,
      totalDuplicateBytes,
      totalDuplicateKilobytes: Math.round((totalDuplicateBytes / 1024) * 10) / 10,
    },
  };
}

export function formatInventoryReport(inventory = getDuplicateInventory()) {
  const lines = [
    "# Отчёт инвентаризации дублирования модулей (AI Free)",
    "",
    `Дата формирования: ${new Date().toISOString().split("T")[0]}`,
    "",
    `- **Вынесено в @ai-free/core (Unified Shared Core):** ${inventory.summary.coreSharedCount} файлов`,
    `- **Полностью идентичные модули:** ${inventory.summary.identicalCount} файлов (${inventory.summary.totalDuplicateKilobytes} KB)`,
    `- **Платформенно-специфичные модули:** ${inventory.summary.platformSpecificCount} файла`,
    `- **Модули только для Desktop:** ${inventory.summary.desktopOnlyCount} файла`,
    `- **Модули только для VS Code:** ${inventory.summary.vscodeOnlyCount} файл`,
    `- **Случайно разошедшиеся модули (Divergent):** ${inventory.summary.divergentCount} файлов`,
    "",
    "## Модули общего ядра (@ai-free/core)",
    "",
  ];

  for (const item of inventory.coreShared) {
    lines.push(`- \`${item.corePath}\` (re-exported in Desktop and VS Code)`);
  }
  lines.push("");

  lines.push("## Платформенно-специфичные модули (Намеренные различия)");
  lines.push("");

  for (const item of inventory.platformSpecific) {
    lines.push(`### \`${item.desktopPath}\``);
    lines.push(`- **Причина:** ${item.reason}`);
    lines.push(`- **Размеры:** Desktop (${item.desktopSize} bytes) vs VS Code (${item.vscodeSize} bytes)`);
    lines.push("");
  }

  lines.push("## Модули только для Desktop");
  lines.push("");
  for (const item of inventory.desktopOnly) {
    lines.push(`- \`${item.path}\` (${item.size} bytes)`);
  }
  lines.push("");

  lines.push("## Модули только для VS Code");
  lines.push("");
  for (const item of inventory.vscodeOnly) {
    lines.push(`- \`${item.path}\` (${item.size} bytes)`);
  }
  lines.push("");

  lines.push("## Первые кандидаты на перенос в packages/core");
  lines.push("");
  const priorityGroups = [
    { title: "Каталог моделей и абстракции провайдеров", filter: (p) => p.startsWith("providers/model-catalog") || p.startsWith("providers/registry") },
    { title: "Локализация и языковые ресурсы", filter: (p) => p.startsWith("i18n/") },
    { title: "Алгоритмы памяти и поиска (FTS5 / Vector / Hybrid)", filter: (p) => p.startsWith("memory/search/") || p.startsWith("memory/markdown") },
    { title: "Парсеры и утилиты кодового агента", filter: (p) => p.startsWith("code-agent/parser") || p.startsWith("code-agent/tool-log") || p.startsWith("code-agent/loop-helpers") },
    { title: "Сервис распознавания речи (STT)", filter: (p) => p.startsWith("stt/") },
  ];

  for (const group of priorityGroups) {
    const matching = inventory.identical.filter((item) => group.filter(item.subPath));
    lines.push(`### ${group.title} (${matching.length} файлов)`);
    for (const item of matching) {
      lines.push(`- \`${item.subPath}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function assertInventoryInvariants() {
  const inventory = getDuplicateInventory();
  if (inventory.divergent.length > 0) {
    const messages = inventory.divergent.map((d) => {
      if (d.desktopHash && d.vscodeHash) {
        return `Divergence detected in ${d.subPath} (hashes differ: desktop=${d.desktopHash.slice(0, 8)} vs vscode=${d.vscodeHash.slice(0, 8)})`;
      }
      return `${d.subPath}: ${d.reason}`;
    });
    throw new Error(`Duplicate inventory check failed (${inventory.divergent.length} errors):\n- ${messages.join("\n- ")}`);
  }
  return inventory;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = process.argv[2] || "--report";
  if (arg === "--check") {
    try {
      const inventory = assertInventoryInvariants();
      console.log(`✓ Duplicate inventory check passed (${inventory.summary.identicalCount} identical modules synchronized, 0 divergent)`);
      process.exit(0);
    } catch (error) {
      console.error(`✗ ${error.message}`);
      process.exit(1);
    }
  } else if (arg === "--json") {
    console.log(JSON.stringify(getDuplicateInventory(), null, 2));
  } else {
    console.log(formatInventoryReport());
  }
}
