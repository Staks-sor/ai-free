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
let installPromise = null;

export function resolveSttHelper() {
  return String(process.env.AI_FREE_STT_BIN || STT_HELPER_FILE).trim();
}

export function getVoiceStatus() {
  const helper = resolveSttHelper();
  const helperAvailable = commandExists(helper);
  const parakeetPath = findCommand("parakeet");
  const configuredByEnv = Boolean(process.env.AI_FREE_STT_BIN);
  const bundledModelAvailable = fs.existsSync(STT_MODEL_DIR) && hasAnyFile(STT_MODEL_DIR);
  return {
    enabled: true,
    provider: "parakeet-v3",
    helper,
    helperAvailable,
    parakeetAvailable: Boolean(parakeetPath),
    parakeetPath,
    configuredByEnv,
    sttDir: STT_DIR,
    runtimeDir: STT_RUNTIME_DIR,
    modelDir: STT_MODEL_DIR,
    cacheDir: STT_CACHE_DIR,
    modelAvailable: configuredByEnv ? helperAvailable : bundledModelAvailable,
    installHint:
      "Click Voice to install Parakeet V3 automatically, or set AI_FREE_STT_BIN to an executable helper path.",
  };
}

export async function installSttRuntime({ onLog } = {}) {
  if (installPromise) return installPromise;
  installPromise = installSttRuntimeOnce({ onLog }).finally(() => {
    installPromise = null;
  });
  return installPromise;
}

async function installSttRuntimeOnce({ onLog } = {}) {
  const log = (message) => {
    if (typeof onLog === "function") onLog(message);
  };
  fs.mkdirSync(STT_RUNTIME_DIR, { recursive: true });
  fs.mkdirSync(STT_MODEL_DIR, { recursive: true });
  fs.mkdirSync(STT_CACHE_DIR, { recursive: true });

  let parakeetPath = findCommand("parakeet");
  if (!parakeetPath) {
    const brewPath = findCommand("brew");
    const cargoPath = findCommand("cargo");
    if (brewPath && process.platform === "darwin") {
      log("Installing parakeet-cli with Homebrew...");
      await runCommand(brewPath, ["install", "lucataco/tap/parakeet-cli"], { timeoutMs: 20 * 60_000 });
    } else if (cargoPath) {
      log("Installing parakeet-cli with Cargo...");
      await runCommand(cargoPath, [
        "install",
        "--git",
        "https://github.com/lucataco/parakeet-cli.git",
        "--bin",
        "parakeet",
      ], { timeoutMs: 30 * 60_000 });
    } else {
      throw new Error(
        "Could not install Parakeet automatically: Homebrew or Cargo is required. " +
        "Install parakeet-cli manually or set AI_FREE_STT_BIN.",
      );
    }
    parakeetPath = findCommand("parakeet");
  }
  if (!parakeetPath) throw new Error("parakeet was installed, but the binary was not found in PATH.");

  log("Downloading Parakeet V3 INT8 model...");
  await runCommand(parakeetPath, ["download", "--model-dir", STT_MODEL_DIR], { timeoutMs: 60 * 60_000 });
  writeParakeetShim(parakeetPath);
  return getVoiceStatus();
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

function writeParakeetShim(parakeetPath) {
  const content = `#!/bin/sh
set -eu
INPUT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    transcribe|--json) shift ;;
    --input) INPUT="$2"; shift 2 ;;
    --model|--language) shift 2 ;;
    *) shift ;;
  esac
done
if [ -z "$INPUT" ]; then
  echo "Missing --input" >&2
  exit 2
fi
exec ${shellQuote(parakeetPath)} transcribe "$INPUT" --model-dir "${STT_MODEL_DIR}" --format json
`;
  fs.mkdirSync(path.dirname(STT_HELPER_FILE), { recursive: true });
  fs.writeFileSync(STT_HELPER_FILE, content, { mode: 0o755 });
  try { fs.chmodSync(STT_HELPER_FILE, 0o755); } catch {}
}

function runCommand(command, args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${path.basename(command)} timed out.`));
    }, timeoutMs);
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
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout || `${command} exited with code ${code}`).trim()));
    });
  });
}

function commandExists(command) {
  return Boolean(findCommand(command));
}

function findCommand(command) {
  if (!command) return false;
  if (command.includes("/") || command.includes(path.sep)) return isExecutable(command) ? command : "";
  const paths = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of paths) {
    const candidate = path.join(dir, command);
    if (isExecutable(candidate)) return candidate;
  }
  return "";
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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
