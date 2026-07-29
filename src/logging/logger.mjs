import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;
const DEFAULT_MAX_STRING_LENGTH = 16_000;
const LEVEL_PRIORITY = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
const SENSITIVE_KEY = /^(?:api[-_]?key|authorization|cookie|credentials?|password|refresh[-_]?token|secret|session[-_]?token|access[-_]?token)$/i;

export function resolveLogDirectory({ homeDir = os.homedir(), env = process.env } = {}) {
  const configured = String(env.AI_FREE_LOG_DIR || "").trim();
  return configured ? path.resolve(configured) : path.join(homeDir, ".ai-free", "logs");
}

export function createFileLogger({
  component = "app",
  surface = process.env.AI_FREE_LOG_SURFACE || "desktop",
  logDir = resolveLogDirectory(),
  fileName = "ai-free.log",
  maxBytes = positiveInteger(process.env.AI_FREE_LOG_MAX_BYTES, DEFAULT_MAX_BYTES),
  maxFiles = positiveInteger(process.env.AI_FREE_LOG_MAX_FILES, DEFAULT_MAX_FILES),
  level = process.env.AI_FREE_LOG_LEVEL || "debug",
  baseData = {},
  now = () => new Date(),
} = {}) {
  const resolvedLevel = LEVEL_PRIORITY[level] == null ? "debug" : level;
  const filePath = path.join(logDir, fileName);
  let directoryReady = false;

  const ensureDirectory = () => {
    if (directoryReady) return true;
    try {
      fs.mkdirSync(logDir, { recursive: true });
      directoryReady = true;
      return true;
    } catch {
      return false;
    }
  };

  const write = (entryLevel, event, data = {}, error = null) => {
    if (LEVEL_PRIORITY[entryLevel] < LEVEL_PRIORITY[resolvedLevel]) return false;
    if (!ensureDirectory()) return false;

    const entry = {
      timestamp: now().toISOString(),
      level: entryLevel,
      surface,
      component,
      event: String(event || "log"),
      pid: process.pid,
      data: redactLogData({ ...baseData, ...normalizeData(data) }),
    };
    if (error) entry.error = serializeError(error);

    try {
      const line = `${JSON.stringify(entry)}\n`;
      rotateIfNeeded(filePath, Buffer.byteLength(line), { maxBytes, maxFiles });
      fs.appendFileSync(filePath, line, { encoding: "utf8", mode: 0o600 });
      return true;
    } catch {
      return false;
    }
  };

  const logger = {
    filePath,
    debug: (event, data) => write("debug", event, data),
    info: (event, data) => write("info", event, data),
    warn: (event, data) => write("warn", event, data),
    error(event, error, data = {}) {
      if (!(error instanceof Error) && !looksLikeError(error)) {
        return write("error", event, error || {}, null);
      }
      return write("error", event, data, error);
    },
    child(childComponent, childBaseData = {}) {
      return createFileLogger({
        component: `${component}.${childComponent}`,
        surface,
        logDir,
        fileName,
        maxBytes,
        maxFiles,
        level: resolvedLevel,
        baseData: { ...baseData, ...childBaseData },
        now,
      });
    },
  };
  return Object.freeze(logger);
}

export function withLogSpan(logger, event, operation, { details = null } = {}) {
  if (typeof operation !== "function") throw new TypeError("operation must be a function");
  return async function loggedOperation(...args) {
    const startedAt = performance.now();
    const startData = typeof details === "function" ? details(...args) : (details || {});
    logger.debug(`${event}.start`, startData);
    try {
      const result = await operation.apply(this, args);
      logger.info(`${event}.success`, {
        ...normalizeData(startData),
        durationMs: elapsedMilliseconds(startedAt),
      });
      return result;
    } catch (error) {
      logger.error(`${event}.error`, error, {
        ...normalizeData(startData),
        durationMs: elapsedMilliseconds(startedAt),
      });
      throw error;
    }
  };
}

export function installProcessErrorLogging(logger, details = {}) {
  logger.info("process.start", {
    version: details.version || null,
    argv: process.argv.slice(2),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    ...details,
  });

  const onUncaughtExceptionMonitor = (error, origin) => {
    logger.error("process.uncaught_exception", error, { origin });
  };
  const onUnhandledRejection = (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logger.error("process.unhandled_rejection", error);
  };
  const onExit = (code) => logger.info("process.exit", { code });

  process.on("uncaughtExceptionMonitor", onUncaughtExceptionMonitor);
  process.on("unhandledRejection", onUnhandledRejection);
  process.on("exit", onExit);

  return () => {
    process.off("uncaughtExceptionMonitor", onUncaughtExceptionMonitor);
    process.off("unhandledRejection", onUnhandledRejection);
    process.off("exit", onExit);
  };
}

export function redactLogData(value, options = {}) {
  const maxStringLength = positiveInteger(options.maxStringLength, DEFAULT_MAX_STRING_LENGTH);
  return redactValue(value, { maxStringLength, seen: new WeakSet(), depth: 0 });
}

function redactValue(value, state, key = "") {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "string") return redactString(value, state.maxStringLength);
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (value instanceof Error) return serializeError(value);
  if (state.depth >= 8) return "[MAX_DEPTH]";
  if (typeof value !== "object") return String(value);
  if (state.seen.has(value)) return "[CIRCULAR]";
  state.seen.add(value);

  const nextState = { ...state, depth: state.depth + 1 };
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redactValue(item, nextState));
  }

  const result = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, 200)) {
    result[childKey] = redactValue(childValue, nextState, childKey);
  }
  return result;
}

function redactString(value, maxLength) {
  let result = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(cookie|set-cookie)\s*[:=]\s*[^\s,]+/gi, "$1=[REDACTED]")
    .replace(/\b(access_token|refresh_token|api_key|password|secret)=([^&\s]+)/gi, "$1=[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]");
  if (result.length > maxLength) {
    result = `${result.slice(0, maxLength)}…[TRUNCATED ${result.length - maxLength} chars]`;
  }
  return result;
}

function serializeError(error, depth = 0) {
  if (!error || depth > 3) return null;
  const serialized = {
    name: String(error.name || "Error"),
    message: redactString(String(error.message || error), DEFAULT_MAX_STRING_LENGTH),
    stack: redactString(String(error.stack || ""), DEFAULT_MAX_STRING_LENGTH),
  };
  for (const key of ["code", "status", "statusCode", "errno", "syscall", "address", "port"]) {
    if (error[key] != null) serialized[key] = redactValue(error[key], { maxStringLength: DEFAULT_MAX_STRING_LENGTH, seen: new WeakSet(), depth: 0 }, key);
  }
  if (error.cause) serialized.cause = serializeError(error.cause, depth + 1);
  return serialized;
}

function rotateIfNeeded(filePath, incomingBytes, { maxBytes, maxFiles }) {
  let currentSize = 0;
  try {
    currentSize = fs.statSync(filePath).size;
  } catch {}
  if (currentSize === 0 || currentSize + incomingBytes <= maxBytes) return;

  const rotatedCount = Math.max(0, maxFiles - 1);
  if (rotatedCount === 0) {
    try { fs.unlinkSync(filePath); } catch {}
    return;
  }
  try { fs.rmSync(`${filePath}.${rotatedCount}`, { force: true }); } catch {}
  for (let index = rotatedCount - 1; index >= 1; index -= 1) {
    const source = `${filePath}.${index}`;
    const target = `${filePath}.${index + 1}`;
    try { fs.renameSync(source, target); } catch {}
  }
  try { fs.renameSync(filePath, `${filePath}.1`); } catch {}
}

function normalizeData(value) {
  if (value == null) return {};
  return typeof value === "object" && !Array.isArray(value) ? value : { value };
}

function looksLikeError(value) {
  return value && typeof value === "object" && (typeof value.message === "string" || typeof value.stack === "string");
}

function elapsedMilliseconds(startedAt) {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}
