import { browserRequestPolicies } from "../browser-request-policy.mjs";
import { backgroundBrowserPool } from "../../browser/session-pool.mjs";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { captureBrowserDiagnosticScreenshot, summarizeBrowserDiagnosticError } from "../browser-diagnostics.mjs";
import {
  GOOGLE_AI_BASE_URL,
  GOOGLE_AI_CAMOUFOX_PROFILE,
  GOOGLE_AI_FINGERPRINT_STATE,
  GOOGLE_AI_STORAGE_STATE,
} from "./config.mjs";

const NAV_TIMEOUT_MS = Number(process.env.GOOGLE_AI_NAV_TIMEOUT_MS || 90_000);
const READY_TIMEOUT_MS = Number(process.env.GOOGLE_AI_READY_TIMEOUT_MS || 45_000);
const GENERATION_TIMEOUT_MS = Number(process.env.GOOGLE_AI_GENERATION_TIMEOUT_MS || 5 * 60_000);
const FIRST_TEXT_TIMEOUT_MS = Number(process.env.GOOGLE_AI_FIRST_TEXT_TIMEOUT_MS || 120_000);
const FIRST_IMAGE_TEXT_TIMEOUT_MS = Number(process.env.GOOGLE_AI_FIRST_IMAGE_TEXT_TIMEOUT_MS || 90_000);
const POLL_MS = 500;
const MIN_TURN_INTERVAL_MS = 8_000;
const STABLE_POLLS = 3;
const SIGNED_OUT_POLLS = 6;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const GOOGLE_IMAGE_MIME_TYPES = new Set([
  "image/avif",
  "image/bmp",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const proxies = new Map();

export function buildGoogleAIQueryUrl(prompt) {
  const url = new URL(GOOGLE_AI_BASE_URL);
  url.searchParams.set("q", String(prompt || ""));
  return url.toString();
}

export function normalizeGoogleAIAnswer(value) {
  return String(value || "")
    .replace(/(?:^|\n)Ответ от режима ИИ готов\.?/giu, "")
    .replace(/(?:^|\n)(?:В ответах искусственного интеллекта могут быть ошибки|Generative AI is experimental|AI responses may include mistakes)[^\n]*/giu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeGoogleAIImages(images = []) {
  const normalized = [];
  for (const image of Array.isArray(images) ? images : []) {
    const mimeType = String(image?.mimeType || "").toLowerCase();
    if (!GOOGLE_IMAGE_MIME_TYPES.has(mimeType) || !image?.dataBase64) continue;
    const buffer = Buffer.from(String(image.dataBase64), "base64");
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) continue;
    const fallbackExtension = mimeType === "image/jpeg" ? "jpg" : mimeType.slice("image/".length);
    const requestedName = String(image.name || "").split(/[\\/]/).at(-1) || `image.${fallbackExtension}`;
    normalized.push({ name: requestedName, mimeType, buffer });
  }
  return normalized;
}

export function selectGoogleAIAnswerText({ responseContainerText = "", directTexts = [] } = {}) {
  const containerText = normalizeGoogleAIAnswer(responseContainerText);
  if (containerText) return containerText;
  return normalizeGoogleAIAnswer(directTexts.filter(Boolean).join("\n"));
}

export function isFreshGoogleAIAnswer(previousText, currentText) {
  const current = normalizeGoogleAIAnswer(currentText);
  return Boolean(current) && current !== normalizeGoogleAIAnswer(previousText);
}

export function isGoogleAIAnswerReady({ bodyText = "", copyButtonCount = 0 } = {}) {
  return copyButtonCount > 0 || /Ответ от режима ИИ готов|AI response is ready/i.test(String(bodyText));
}

export function summarizeGoogleAIAnswerDiagnostics({
  directTextCount = 0,
  copyButtonCount = 0,
  previewImageCount = 0,
  readyMarkerPresent = false,
} = {}) {
  return {
    directTextCount: Number(directTextCount) || 0,
    copyButtonCount: Number(copyButtonCount) || 0,
    previewImageCount: Number(previewImageCount) || 0,
    readyMarkerPresent: Boolean(readyMarkerPresent),
  };
}

export async function saveGoogleAIAnswerTimeoutScreenshot(page, {
  ...options
} = {}) {
  return captureBrowserDiagnosticScreenshot(page, "google-ai-timeout", options);
}

export function classifyGoogleAIPageState({ hasComposer = false, hasAccount = false, hasSignIn = false } = {}) {
  if (hasAccount && hasComposer) return "ready";
  if (!hasAccount && hasSignIn) return "signed_out";
  return "loading";
}

export function getGoogleAIBrowserLaunchConfig({ profileDir = GOOGLE_AI_CAMOUFOX_PROFILE, storageStatePath = GOOGLE_AI_STORAGE_STATE, fingerprintStatePath = GOOGLE_AI_FINGERPRINT_STATE } = {}) {
  return {
    engine: "camoufox",
    viewport: { width: 1280, height: 900 },
    storageStatePath,
    profileDir,
    fingerprintStatePath,
  };
}

export function getGoogleAITurnDelayMs({ lastTurnStartedAt = 0, now = Date.now() } = {}) {
  return lastTurnStartedAt ? Math.max(0, MIN_TURN_INTERVAL_MS - (now - lastTurnStartedAt)) : 0;
}

export async function closeGoogleAIBrowserProxy(accountId = "default") {
  const current = proxies.get(accountId); proxies.delete(accountId);
  if (current) await current.close();
}

export function resetGoogleAIBrowserProxy(accountId = "default") {
  return closeGoogleAIBrowserProxy(accountId);
}

export function getGoogleAIBrowserProxy(options = {}) {
  const accountId = options.accountId || "default";
  if (!proxies.has(accountId)) {
    const key = accountId === "default" ? "googleai" : "googleai:" + accountId;
    proxies.set(accountId, backgroundBrowserPool.proxy(key, () => createProxy(options), ["sendChat"]));
  }
  return Promise.resolve(proxies.get(accountId));
}

async function createProxy(options) {
  const { debug = false } = options;
  const launch = getGoogleAIBrowserLaunchConfig(options);
  const { launchCamoufoxSession } = await import("../../browser/camoufox-runtime.mjs");
  const session = await launchCamoufoxSession({
    viewport: launch.viewport,
    storageStatePath: launch.storageStatePath,
    profileDir: launch.profileDir,
    fingerprintStatePath: launch.fingerprintStatePath,
  });
  try {
  const { context, page } = session;
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  let queue = Promise.resolve();
  let lastTurnStartedAt = 0;

  const close = async () => {
    process.removeListener("exit", onExit);
    await queue.catch(() => {});
    await session.close().catch(() => {});
  };
  const onExit = () => { close(); };
  process.once("exit", onExit);

  const sendChat = (options) => {
    const run = queue.then(async () => {
      const waitMs = getGoogleAITurnDelayMs({ lastTurnStartedAt });
      if (waitMs) await delay(waitMs, undefined, options.signal ? { signal: options.signal } : undefined);
      options.signal?.throwIfAborted();
      lastTurnStartedAt = Date.now();
      return sendGoogleAIChatOnce(page, options, debug);
    });
    queue = run.catch(() => {});
    return run;
  };

  return { sendChat, close };
  } catch (error) {
    await session.close().catch(() => {});
    throw error;
  }
}

export async function sendGoogleAIChatOnce(page, {
  prompt,
  conversationId = null,
  images = [],
  onText = null,
  signal = null,
  accountId = "default",
}, debug) {
  return browserRequestPolicies.googleai.observe(page, { accountId, signal }, async check => {
  const emitText = onText;
  onText = text => { check.onText(text); emitText?.(text); };
  let promptSubmitted = false;
  try {
    signal?.throwIfAborted();
    const text = String(prompt || "").trim();
    if (!text) throw new Error("Google AI prompt is empty.");
    const normalizedImages = normalizeGoogleAIImages(images);
    let previousAnswer = "";

    if (!conversationId) {
      if (!normalizedImages.length && text.length <= 1500) {
        check.beforeSend();
        promptSubmitted = true;
        await page.goto(buildGoogleAIQueryUrl(text), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      } else {
        await page.goto(GOOGLE_AI_BASE_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
        await waitForGoogleAIReady(page, signal, check);
        await attachGoogleAIImages(page, normalizedImages, signal);
        const composer = getGoogleAIComposer(page);
        await composer.waitFor({ state: "visible", timeout: 30_000 });
        await composer.fill(text);
        check.beforeSend();
        promptSubmitted = true;
        await submitGoogleAIComposer(page, composer);
      }
    } else {
      if (page.url() !== conversationId) {
        await page.goto(conversationId, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
        await waitForGoogleAIReady(page, signal, check);
      }
      previousAnswer = (await readGoogleAIAnswerSnapshot(page)).text;
      await attachGoogleAIImages(page, normalizedImages, signal);
      const composer = getGoogleAIComposer(page);
      await composer.waitFor({ state: "visible", timeout: 30_000 });
      await composer.fill(text);
      check.beforeSend();
      promptSubmitted = true;
      await submitGoogleAIComposer(page, composer);
    }

    await waitForGoogleAIReady(page, signal, check);
    const answer = await waitForGoogleAIAnswer(
      page,
      onText,
      debug,
      previousAnswer,
      signal,
      normalizedImages.length ? FIRST_IMAGE_TEXT_TIMEOUT_MS : FIRST_TEXT_TIMEOUT_MS,
      check,
    );
    return {
      text: answer,
      conversationId: page.url() || `google-ai-${randomUUID()}`,
      lastMessageId: null,
    };
  } catch (error) {
    error.promptSubmitted = promptSubmitted;
    error.delivery ||= promptSubmitted ? 'unknown' : 'not_sent';
    throw error;
  }
  });
}

async function clickGoogleAISend(page) {
  const sendButton = page.getByRole("button", { name: /Отправить|Send/i })
    .filter({ visible: true })
    .first();
  await sendButton.waitFor({ state: "visible", timeout: 15_000 });
  await sendButton.click();
}

export async function submitGoogleAIComposer(page, _composer) {
  await clickGoogleAISend(page);
}

async function attachGoogleAIImages(page, images, signal = null) {
  if (!images.length) return;
  signal?.throwIfAborted();
  const imageCountBefore = await page.locator('img[src^="blob:"], img[src^="data:image/"]').count();
  const addButton = page.getByRole("button", { name: /Добавить файлы и инструменты|Add files and tools/i }).last();
  await addButton.waitFor({ state: "visible", timeout: 15_000 });
  await addButton.click();
  const fileInput = page.locator('input[type="file"][accept*="image/"]').last();
  await fileInput.waitFor({ state: "attached", timeout: 15_000 });
  await fileInput.setInputFiles(images);

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const imageCount = await page.locator('img[src^="blob:"], img[src^="data:image/"]').count();
    if (imageCount >= imageCountBefore + images.length) return;
    await delay(POLL_MS, undefined, signal ? { signal } : undefined);
  }
  throw new Error("Google AI: изображение не прикрепилось к сообщению.");
}

function getGoogleAIComposer(page) {
  return page.locator('textarea[placeholder*="Задайте вопрос"], textarea[placeholder*="Ask"], [role="textbox"][aria-label*="Задайте вопрос"], [role="textbox"][aria-label*="Ask"]')
    .filter({ visible: true })
    .first();
}

export async function readGoogleAIPageState(page) {
  return page.evaluate(() => ({
    hasComposer: [...document.querySelectorAll('textarea, [role="textbox"]')].some((item) => {
      const style = getComputedStyle(item);
      const label = `${item.getAttribute("aria-label") || ""} ${item.getAttribute("placeholder") || ""}`;
      return style.display !== "none" && style.visibility !== "hidden" && /Задайте вопрос|Ask anything|Ask a question/i.test(label);
    }),
    hasAccount: [...document.querySelectorAll('a, button')]
      .some((item) => /Аккаунт Google|Google Account/i.test(item.getAttribute("aria-label") || "")),
    hasSignIn: [...document.querySelectorAll('a, button')]
      .some((item) => /^(Войти|Sign in)$/i.test((item.getAttribute("aria-label") || item.textContent || "").trim())),
  }));
}

async function waitForGoogleAIReady(page, signal = null, check = () => {}) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let signedOutPolls = 0;

  while (Date.now() < deadline) {
    check();
    signal?.throwIfAborted();
    const state = classifyGoogleAIPageState(await readGoogleAIPageState(page));
    if (state === "ready") return;
    signedOutPolls = state === "signed_out" ? signedOutPolls + 1 : 0;
    if (signedOutPolls >= SIGNED_OUT_POLLS) {
      throw new Error("Google AI не авторизован. Подключите Google AI в окне нового чата и завершите вход.");
    }
    await delay(POLL_MS, undefined, signal ? { signal } : undefined);
  }

  throw new Error("Google AI: интерфейс режима ИИ не загрузился. Проверьте доступность Google AI Mode и повторите запрос.");
}

export function getGoogleAIAnswerTimeoutError({
  elapsedMs,
  hasText,
  firstTextTimeoutMs = FIRST_TEXT_TIMEOUT_MS,
  generationTimeoutMs = GENERATION_TIMEOUT_MS,
} = {}) {
  if (!hasText && elapsedMs >= firstTextTimeoutMs) {
    return new Error("Google AI не начал формировать ответ. Запрос мог быть принят; проверьте чат перед повтором.");
  }
  if (elapsedMs >= generationTimeoutMs) {
    return new Error("Google AI не вернул текст ответа до истечения таймаута.");
  }
  return null;
}

async function waitForGoogleAIAnswer(
  page,
  onText,
  debug,
  previousAnswer = "",
  signal = null,
  firstTextTimeoutMs = FIRST_TEXT_TIMEOUT_MS,
  check = () => {},
) {
  const startedAt = Date.now();
  let lastText = "";
  let stable = 0;

  for (;;) {
    check();
    signal?.throwIfAborted();
    const timeoutError = getGoogleAIAnswerTimeoutError({
      elapsedMs: Date.now() - startedAt,
      hasText: Boolean(lastText),
      firstTextTimeoutMs,
    });
    if (timeoutError) {
      if (lastText) return lastText;
      if (debug) {
        const diagnostics = await readGoogleAIAnswerDiagnostics(page).catch(() => null);
        if (diagnostics) console.log(`[google-ai] answer observer ${JSON.stringify(diagnostics)}`);
        try {
          const screenshot = await saveGoogleAIAnswerTimeoutScreenshot(page);
          console.log(`[google-ai] answer observer screenshot ${screenshot}`);
        } catch (error) {
          console.log(`[google-ai] answer observer screenshot failed ${summarizeBrowserDiagnosticError(error)}`);
        }
      }
      throw timeoutError;
    }
    const snapshot = await readGoogleAIAnswerSnapshot(page);
    if (!isFreshGoogleAIAnswer(previousAnswer, snapshot.text)) {
      await delay(POLL_MS, undefined, signal ? { signal } : undefined);
      continue;
    }
    if (snapshot.text && snapshot.text !== lastText) {
      lastText = snapshot.text;
      stable = 0;
      onText?.(lastText);
      if (debug) console.log(`[google-ai] response ${lastText.length} char(s)`);
    } else if (lastText) {
      stable += 1;
    }
    if (lastText && snapshot.ready && stable >= STABLE_POLLS) return lastText;
    await delay(POLL_MS, undefined, signal ? { signal } : undefined);
  }
}

async function readGoogleAIAnswerDiagnostics(page) {
  const snapshot = await page.evaluate(() => {
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getBoundingClientRect().height > 0;
    };
    const bodyText = document.body?.innerText || "";
    return {
      directTextCount: [...document.querySelectorAll(".n6owBd")].filter(visible).length,
      copyButtonCount: [...document.querySelectorAll('button[aria-label*="Скопировать текст"], button[aria-label*="Copy text"]')].filter(visible).length,
      previewImageCount: [...document.querySelectorAll('img[src^="blob:"], img[src^="data:image/"]')].filter(visible).length,
      readyMarkerPresent: /Ответ от режима ИИ готов|AI response is ready/i.test(bodyText),
    };
  });
  return summarizeGoogleAIAnswerDiagnostics(snapshot);
}

async function readGoogleAIAnswerSnapshot(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getBoundingClientRect().height > 0;
    };
    const directTexts = [...document.querySelectorAll(".n6owBd")]
      .filter(visible)
      .map((element) => (element.innerText || element.textContent || "").trim())
      .filter(Boolean);

    const copyButtons = [...document.querySelectorAll('button[aria-label*="Скопировать текст"], button[aria-label*="Copy text"]')]
      .filter(visible);
    let responseContainerText = "";
    let node = copyButtons.at(-1)?.parentElement || null;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      if (!node.querySelector(".n6owBd")) continue;
      responseContainerText = (node.innerText || node.textContent || "").trim();
      break;
    }

    const bodyText = document.body?.innerText || "";
    return {
      responseContainerText,
      directTexts,
      bodyText: /Ответ от режима ИИ готов|AI response is ready/i.test(bodyText) ? "AI response is ready" : "",
      copyButtonCount: copyButtons.length,
    };
  }).then((snapshot) => ({
    ...snapshot,
    ready: isGoogleAIAnswerReady(snapshot),
    text: selectGoogleAIAnswerText(snapshot),
  }));
}
