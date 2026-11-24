// Chromium нужен отдельным компонентам. Проверяем только выбранный ими движок.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..", "..");
let ensurePromise = null;

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
  if (!quiet && ensurePromise) return ensurePromise;
  const run = ensureBrowserBinariesOnce({ quiet });
  if (quiet) return run;
  ensurePromise = run.then((result) => {
    if (!result?.ok) ensurePromise = null;
    return result;
  }, (error) => {
    ensurePromise = null;
    throw error;
  });
  return ensurePromise;
}

async function ensureBrowserBinariesOnce({ quiet = false } = {}) {
  try {
    const { getChatGPTChromium, getChatGPTEngineName } = await import("../providers/chatgpt/engine.mjs");
    const chromium = await getChatGPTChromium();
    return ensureChromiumBinary({ name: getChatGPTEngineName(), chromium }, { quiet });
  } catch (error) {
    return { ok: false, engine: "none", error: `Chromium engine unavailable: ${error.message}` };
  }
}

export function ensureChromiumBinary({ name, chromium }, { quiet = false, install = runInstall } = {}) {
  if (chromiumLooksInstalled(chromium)) return { ok: true, engine: name };
  if (quiet) return { ok: false, engine: name, error: `Chromium not installed for: ${name}` };

  const installed = install(`Ставлю Chromium для ${name}`, [name, "install", "chromium"]);
  if (!installed || !chromiumLooksInstalled(chromium)) {
    return { ok: false, engine: name,
      error: `Не удалось установить Chromium для ${name}. Запустите: npx ${name} install chromium` };
  }
  return { ok: true, engine: name, installed: [name] };
}
