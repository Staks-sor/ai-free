// Patchright и Playwright используют разные бинарники Chromium — ставим оба при первом запуске.

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
  const engines = [];
  try {
    const mod = await import("patchright");
    engines.push({
      name: "patchright",
      chromium: mod.chromium,
      installLabel: "Ставлю Chromium для Patchright",
      installArgs: ["patchright", "install", "chromium"],
    });
  } catch {}
  try {
    const mod = await import("playwright");
    engines.push({
      name: "playwright",
      chromium: mod.chromium,
      installLabel: "Ставлю Chromium для Playwright",
      installArgs: ["playwright", "install", "chromium"],
    });
  } catch {}

  if (!engines.length) {
    return { ok: false, engine: "none", error: "Playwright/Patchright packages are not installed" };
  }

  const missing = engines.filter((engine) => !chromiumLooksInstalled(engine.chromium));
  if (!missing.length) return { ok: true, engine: engines.map((engine) => engine.name).join("+") };

  if (quiet) {
    return {
      ok: false,
      engine: missing.map((engine) => engine.name).join("+"),
      error: `Chromium not installed for: ${missing.map((engine) => engine.name).join(", ")}`,
    };
  }

  const installed = [];
  for (const engine of missing) {
    const ok = runInstall(engine.installLabel, engine.installArgs);
    if (ok && chromiumLooksInstalled(engine.chromium)) installed.push(engine.name);
  }

  const stillMissing = engines.filter((engine) => !chromiumLooksInstalled(engine.chromium));
  if (stillMissing.length) {
    return {
      ok: false,
      engine: stillMissing.map((engine) => engine.name).join("+"),
      error: `Не удалось установить Chromium для: ${stillMissing.map((engine) => engine.name).join(", ")}. Запустите: npx playwright install chromium`,
    };
  }

  return { ok: true, engine: engines.map((engine) => engine.name).join("+"), installed };
}
