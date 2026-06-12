import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  STT_CACHE_DIR,
  STT_DIR,
  STT_HELPER_FILE,
  STT_MODEL_DIR,
  STT_RUNTIME_DIR,
} from "../config.mjs";

export const DEFAULT_STT_MODEL = "parakeet-v3";
const MAX_AUDIO_BYTES = 30 * 1024 * 1024;

export function resolveSttHelper() {
  return String(process.env.AI_FREE_STT_BIN || STT_HELPER_FILE).trim();
}

export function getVoiceStatus() {
  const helper = resolveSttHelper();
  const helperAvailable = commandExists(helper);
  return {
    enabled: true,
    provider: "parakeet-v3",
    helper,
    helperAvailable,
    configuredByEnv: Boolean(process.env.AI_FREE_STT_BIN),
    sttDir: STT_DIR,
    runtimeDir: STT_RUNTIME_DIR,
    modelDir: STT_MODEL_DIR,
    cacheDir: STT_CACHE_DIR,
    modelAvailable: fs.existsSync(STT_MODEL_DIR) && hasAnyFile(STT_MODEL_DIR),
    installHint:
      `Install an ai-free-stt helper with Parakeet V3 support at ${STT_HELPER_FILE} ` +
      "or set AI_FREE_STT_BIN to an executable helper path.",
  };
}

export async function transcribeAudio({ dataBase64, mimeType = "audio/webm", language = "auto" } = {}) {
  const status = getVoiceStatus();
  if (!status.helperAvailable) {
    const error = new Error(status.installHint);
    error.code = "stt_helper_missing";
    error.status = status;
    throw error;
  }
  const cleanBase64 = String(dataBase64 || "").replace(/^data:[^,]+,/, "").trim();
  if (!cleanBase64) throw new Error("Audio payload is empty.");
  const audio = Buffer.from(cleanBase64, "base64");
  if (!audio.length) throw new Error("Audio payload is empty.");
  if (audio.length > MAX_AUDIO_BYTES) {
    throw new Error(`Audio is too large: ${Math.round(audio.length / 1024 / 1024)} MB. Limit is 30 MB.`);
  }

  fs.mkdirSync(STT_CACHE_DIR, { recursive: true });
  const ext = extensionForMime(mimeType);
  const input = path.join(STT_CACHE_DIR, `${Date.now()}-${randomUUID()}.${ext}`);
  fs.writeFileSync(input, audio);
  try {
    return await runHelper(status.helper, input, {
      model: DEFAULT_STT_MODEL,
      language: String(language || "auto"),
    });
  } finally {
    try { fs.rmSync(input, { force: true }); } catch {}
  }
}

function runHelper(helper, input, { model, language }) {
  return new Promise((resolve, reject) => {
    const child = spawn(helper, [
      "transcribe",
      "--input", input,
      "--model", model,
      "--language", language,
      "--json",
    ], {
      env: { ...process.env, AI_FREE_STT_DIR: STT_DIR },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Speech transcription timed out."));
    }, 180_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error((stderr || stdout || `STT helper exited with code ${code}`).trim()));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve({
          text: String(parsed.text || "").trim(),
          language: parsed.language || language,
          durationMs: parsed.durationMs ?? null,
        });
      } catch {
        resolve({ text: stdout.trim(), language, durationMs: null });
      }
    });
  });
}

function commandExists(command) {
  if (!command) return false;
  if (command.includes("/") || command.includes(path.sep)) return isExecutable(command);
  const paths = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  return paths.some((dir) => isExecutable(path.join(dir, command)));
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function hasAnyFile(dir) {
  try {
    return fs.readdirSync(dir).some((entry) => !entry.startsWith("."));
  } catch {
    return false;
  }
}

function extensionForMime(mimeType) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}
