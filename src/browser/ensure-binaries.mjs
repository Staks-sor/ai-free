// Patchright и Playwright используют разные бинарники Chromium — ставим оба при первом запуске.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..", "..");

function runInstall(label, args) {
  console.log(`📦 ${label}…`);
  const npmCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(npmCmd, args, { cwd: projectRoot, stdio: "inherit" });
  return result.status === 0;
}

function chromiumLooksInstalled(chromium) {
  try {
    const p = chromium.executablePath();
    return Boolean(p && fs.existsSync(p));
  } catch {
    return false;
  }
}

export async function ensureBrowserBinaries({ quiet = false } = {}) {
  let chromium;
  let engine = "playwright";
  try {
    const mod = await import("patchright");
    chromium = mod.chromium;
    engine = "patchright";
  } catch {
    const mod = await import("playwright");
    chromium = mod.chromium;
  }

  if (chromiumLooksInstalled(chromium)) return { ok: true, engine };

  if (quiet) return { ok: false, engine, error: "Chromium not installed" };

  const okPatch = runInstall("Ставлю Chromium для Patchright", ["patchright", "install", "chromium"]);
  const okPw = runInstall("Ставлю Chromium для Playwright", ["playwright", "install", "chromium"]);
  if (!okPatch && !okPw) {
    return { ok: false, engine, error: "Не удалось установить Chromium. Запустите: npx patchright install chromium" };
  }
  return { ok: chromiumLooksInstalled(chromium), engine };
}
