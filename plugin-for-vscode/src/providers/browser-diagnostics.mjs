import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function captureBrowserDiagnosticScreenshot(page, label, {
  tmpDir = os.tmpdir(),
  id = randomUUID,
  writeFile = fs.writeFile,
} = {}) {
  const safeLabel = String(label || "browser").replace(/[^a-z0-9-]/gi, "") || "browser";
  const file = path.join(tmpDir, `ai-free-${safeLabel}-${id()}.png`);
  let image;
  try {
    image = await page.screenshot({ type: "png", timeout: 15_000 });
  } catch (screenshotError) {
    try {
      image = await captureChromiumScreenshot(page);
    } catch (cdpError) {
      throw new Error(`screenshot failed (${summarizeBrowserDiagnosticError(screenshotError)}); CDP fallback failed (${summarizeBrowserDiagnosticError(cdpError)})`);
    }
  }
  await writeFile(file, image, { mode: 0o600, flag: "wx" });
  return file;
}

async function captureChromiumScreenshot(page) {
  let session = null;
  let closed = false;
  try {
    return await withScreenshotTimeout((async () => {
      session = await page.context().newCDPSession(page);
      if (closed) {
        await session.detach?.().catch(() => {});
        throw new Error("CDP screenshot session closed");
      }
      const result = await session.send("Page.captureScreenshot", { format: "png" });
      return Buffer.from(result.data, "base64");
    })());
  } finally {
    closed = true;
    await session?.detach?.().catch(() => {});
  }
}

function withScreenshotTimeout(operation) {
  let timeoutId;
  return new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error("CDP screenshot timed out")), 15_000);
    operation.then(resolve, reject).finally(() => clearTimeout(timeoutId));
  });
}

export function summarizeBrowserDiagnosticError(error) {
  const name = String(error?.name || "Error").split(/\r?\n/, 1)[0].slice(0, 80);
  const message = String(error?.message || error || "unknown error")
    .split(/\r?\n/, 1)[0]
    .replace(/https?:\/\/\S+/giu, "<url>")
    .replace(/\b(token|access_?token|authorization|cookie|session_?token|api_?key)\s*[=:]\s*\S+/giu, "$1=<redacted>")
    .slice(0, 240);
  return `${name}: ${message}`;
}
