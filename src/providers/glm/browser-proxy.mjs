import { browserRequestPolicies } from "../browser-request-policy.mjs";
import { backgroundBrowserPool } from "../../browser/session-pool.mjs";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { captureBrowserDiagnosticScreenshot, summarizeBrowserDiagnosticError } from "../browser-diagnostics.mjs";
import {
  GLM_BASE_URL,
  GLM_BROWSER_PROFILE,
  GLM_DEFAULT_MODEL,
  GLM_STORAGE_STATE,
} from "./config.mjs";
import { hasGLMAuthCookie, isGLMUserToken } from "./auth-files.mjs";
import { launchPersistentDeepSeekContext } from "../../browser/launch.mjs";
import { readInitialStorageState, restoreInitialStorageState } from "../../browser/storage-bootstrap.mjs";
import { parseGLMNativeSseCompletion, summarizeGLMNativeSse } from "./stream.mjs";

const NAV_TIMEOUT_MS = Number(process.env.GLM_NAV_TIMEOUT_MS || 90_000);
const READY_TIMEOUT_MS = Number(process.env.GLM_READY_TIMEOUT_MS || 45_000);
const GENERATION_TIMEOUT_MS = Number(process.env.GLM_GENERATION_TIMEOUT_MS || 5 * 60_000);
const POLL_MS = 500;
const STABLE_POLLS = 3;
const proxies = new Map();

function isGLMCompletionRequest(request, responseUrl) {
  try {
    const url = new URL(responseUrl);
    return url.origin === new URL(GLM_BASE_URL).origin && request?.method?.() === 'POST'
      && /^\/api\/(?:v\d+\/)?chat\/completions(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

function sanitizeGLMDiagnosticIdentifier(value) {
  const identifier = String(value || '').trim();
  return /^[A-Za-z0-9._:-]{1,120}$/.test(identifier) ? identifier : null;
}

function getGLMRequestModel(requestBody, fallback) {
  try {
    const request = JSON.parse(String(requestBody || ''));
    return sanitizeGLMDiagnosticIdentifier(request?.model || request?.data?.model)
      || sanitizeGLMDiagnosticIdentifier(fallback);
  } catch {
    return sanitizeGLMDiagnosticIdentifier(fallback);
  }
}

function addGLMDiagnosticKey(target, value) {
  const key = sanitizeGLMDiagnosticIdentifier(value);
  if (key) target.add(key);
}

function countGLMCompletionText(value, totals) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'content' && typeof child === 'string') totals.content += child.length;
    else if ((key === 'reasoning_content' || key === 'reasoningContent') && typeof child === 'string') totals.reasoning += child.length;
    else countGLMCompletionText(child, totals);
  }
}

function summarizeGLMSse(responseText) {
  const eventNames = new Set(), topLevelKeys = new Set(), dataKeys = new Set(), choiceKeys = new Set(), errorCodes = new Set();
  const totals = { content: 0, reasoning: 0 };
  let terminal = false;
  let eventName = null;
  for (const line of String(responseText || '').split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      addGLMDiagnosticKey(eventNames, eventName);
      continue;
    }
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') {
      terminal = true;
      continue;
    }
    let payload;
    try { payload = JSON.parse(data); } catch { continue; }
    for (const key of Object.keys(payload || {})) addGLMDiagnosticKey(topLevelKeys, key);
    addGLMDiagnosticKey(eventNames, payload?.event || payload?.type || eventName);
    const responseData = payload?.data;
    if (responseData && typeof responseData === 'object' && !Array.isArray(responseData)) {
      for (const key of Object.keys(responseData)) addGLMDiagnosticKey(dataKeys, key);
      addGLMDiagnosticKey(eventNames, responseData.event || responseData.type);
    }
    const choices = responseData?.choices || payload?.choices;
    if (Array.isArray(choices)) {
      for (const choice of choices) {
        if (!choice || typeof choice !== 'object') continue;
        for (const key of Object.keys(choice)) addGLMDiagnosticKey(choiceKeys, key);
        if (typeof choice.finish_reason === 'string' && choice.finish_reason.trim()) terminal = true;
      }
    }
    const error = responseData?.error || payload?.error;
    if (error && typeof error === 'object') addGLMDiagnosticKey(errorCodes, error.code);
    countGLMCompletionText(payload, totals);
  }
  return {
    eventNames: [...eventNames].sort(),
    topLevelKeys: [...topLevelKeys].sort(),
    dataKeys: [...dataKeys].sort(),
    choiceKeys: [...choiceKeys].sort(),
    finalContentChars: totals.content,
    reasoningChars: totals.reasoning,
    terminal,
    errorCodes: [...errorCodes].sort(),
  };
}

export function summarizeGLMCompletionResponse({ model = null, imageFileIds = [], requestBody = '', status = 0,
  contentType = '', responseText = '', completionCount = 0 } = {}) {
  const isSse = /text\/event-stream/i.test(contentType);
  const expectedIds = imageFileIds.filter(id => typeof id === 'string' && id);
  const summary = {
    model: getGLMRequestModel(requestBody, model),
    imageRefIdsMatch: expectedIds.every(id => String(requestBody).includes(id)),
    expectedImageCount: expectedIds.length,
    completionCount: Number(completionCount) || 0,
    HTTPstatus: Number(status) || 0,
    contentType: String(contentType || ''),
    ...summarizeGLMRequestBinding(requestBody, null, expectedIds),
  };
  if (isSse) {
    summary.streamBytes = Buffer.byteLength(String(responseText || ''));
    summary.knownResponseError = isGLMTransientErrorText(responseText);
    Object.assign(summary, summarizeGLMSse(responseText));
    Object.assign(summary, summarizeGLMNativeSse(responseText));
  }
  return summary;
}

export function observeGLMCompletionDebug(page, { debug = false, model = null, imageFileIds = [], log = console.log } = {}) {
  if (!debug) return null;
  let completionCount = 0;
  const response = async value => {
    try {
      const request = value.request?.();
      if (!isGLMCompletionRequest(request, value.url?.())) return;
      completionCount += 1;
      const contentType = String(value.headers?.()['content-type'] || '');
      const responseText = /text\/event-stream/i.test(contentType) ? await value.text().catch(() => '') : '';
      log(summarizeGLMCompletionResponse({ model, imageFileIds,
        requestBody: request?.postData?.() || '', status: value.status?.(), contentType, responseText, completionCount }));
    } catch {}
  };
  page.on?.('response', response);
  return () => page.off?.('response', response);
}

function countExactGLMRequestValues(value, expected) {
  if (value === expected) return 1;
  if (!value || typeof value !== 'object') return 0;
  return Object.values(value).reduce((count, child) => count + countExactGLMRequestValues(child, expected), 0);
}

function getGLMLastUserContent(request) {
  const messages = Array.isArray(request?.messages) ? request.messages : [];
  const message = [...messages].reverse().find(item => item?.role === 'user');
  const content = message?.content;
  if (typeof content === 'string') return { type: 'string', text: content };
  if (Array.isArray(content)) {
    const textParts = [];
    let hasImage = false;
    for (const part of content) {
      if (part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
        textParts.push(part.text);
      } else if (part && typeof part === 'object' && (part.type === 'image_url' || part.type === 'input_image')) {
        hasImage = true;
      } else {
        return { type: 'unknown', text: null };
      }
    }
    return { type: hasImage ? 'multimodal_parts' : 'text_parts', text: textParts.join('') };
  }
  return { type: 'unknown', text: null };
}

export function summarizeGLMRequestBinding(requestBody, prompt, imageFileIds = []) {
  let request;
  try { request = JSON.parse(String(requestBody || '')); } catch {
    return { promptOccurrences: 0, imageIdOccurrences: 0, lastUserContentType: 'unknown', lastUserTextMatch: false };
  }
  const lastUser = getGLMLastUserContent(request);
  const expectedIds = imageFileIds.filter(id => typeof id === 'string' && id);
  const imageOccurrences = expectedIds.map(id => countExactGLMRequestValues(request, id));
  return {
    promptOccurrences: typeof prompt === 'string' ? countExactGLMRequestValues(request, prompt) : 0,
    imageIdOccurrences: imageOccurrences.reduce((total, count) => total + count, 0),
    lastUserContentType: lastUser.type,
    lastUserTextMatch: typeof prompt === 'string' && lastUser.text === prompt,
  };
}

function hasExactGLMCompletionBinding(requestBody, prompt, imageFileIds) {
  const summary = summarizeGLMRequestBinding(requestBody, prompt, imageFileIds);
  if (!summary.lastUserTextMatch) return false;
  let request;
  try { request = JSON.parse(String(requestBody || '')); } catch { return false; }
  const expectedIds = imageFileIds.filter(id => typeof id === 'string' && id);
  return new Set(expectedIds).size === expectedIds.length
    && expectedIds.every(id => countExactGLMRequestValues(request, id) > 0);
}

/**
 * Watches only the one current POST completion request. It intentionally
 * exposes a result only after one exactly-bound, terminal native SSE response.
 */
export function observeGLMNativeCompletion(page, { prompt, imageFileIds = [], signal = null } = {}) {
  let completionCount = 0;
  let invalid = false;
  let result = null;
  let disposed = false;
  const response = async value => {
    try {
      const request = value.request?.();
      if (!isGLMCompletionRequest(request, value.url?.())) return;
      if (Number(value.status?.()) < 200 || Number(value.status?.()) >= 300) return;
      const contentType = String(value.headers?.()['content-type'] || '');
      if (!/text\/event-stream/i.test(contentType)) return;
      const requestBody = request?.postData?.() || '';
      if (!hasExactGLMCompletionBinding(requestBody, prompt, imageFileIds)) return;
      completionCount += 1;
      const parsed = parseGLMNativeSseCompletion(await value.text().catch(() => ''));
      const text = parsed.ok ? normalizeGLMAnswer(parsed.text) : '';
      if (!text) invalid = true;
      else result = { ...parsed, text };
    } catch {
      invalid = true;
    }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    page.off?.('response', response);
    signal?.removeEventListener?.('abort', dispose);
  };
  page.on?.('response', response);
  signal?.addEventListener?.('abort', dispose, { once: true });
  return {
    getResult: () => !disposed && !invalid && completionCount === 1 ? result : null,
    dispose,
  };
}

export function normalizeGLMAnswer(value) {
  const normalized = String(value || "")
    .replace(/^\s*Thought Process[\s\S]*?(?=^(?:RES(?:ULT)?|Итог|Result):?)/gimu, "")
    .replace(/^\s*Thought Process[ \t]*(?:(?:\r?\n)+|$)/iu, "")
    .replace(/(?:^|\n)(?:Copy|Regenerate|Good response|Bad response|Read aloud|Share)(?=\n|$)/giu, "")
    .replace(/(?:^|\n)(?:Generated by AI\. For reference only\.|GLM can make mistakes\. Check important info\.)[^\n]*/giu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return isGLMAnswerPlaceholder(normalized) || isGLMTransientErrorText(normalized) ? "" : normalized;
}

function isGLMAnswerPlaceholder(value) {
  return /^thinking(?:\.{3}|…)?$/i.test(String(value || "").trim());
}

export function isGLMAnswerSnapshotChanged(before, current) {
  if (!current.text) return false;
  return Boolean((current.lastMessageId && current.lastMessageId !== before.lastMessageId)
    || current.assistantCount > (before.assistantCount ?? current.assistantCount)
    || current.text !== normalizeGLMAnswer(before.text));
}

export function selectGLMAnswerText({ assistantTexts = [] } = {}) {
  return normalizeGLMAnswer(assistantTexts.filter(Boolean).at(-1) || "");
}

export function isGLMTransientErrorText(value) {
  const text = String(value || "").trim();
  return /No response,\s*Please try again later/i.test(text)
    || /SyntaxError:\s*JSON\.parse:\s*unexpected character/i.test(text);
}

const GLM_MODEL_LABELS = new Map([
  ["glm-5.3-flash", "GLM-5.3-Flash"],
  ["glm-5.3", "GLM-5.3"],
  ["glm-5.2", "GLM-5.2"],
  ["glm-5-turbo", "GLM-5-Turbo"],
]);

export function normalizeGLMModelId(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[‐‑‒–—−_]/g, "-")
    .replace(/\s+/g, "-");
  if (/glm-?5(?:\.|-)?3.*flash/i.test(normalized)) return "glm-5.3-flash";
  if (/glm-?5(?:\.|-)?3/i.test(normalized)) return "glm-5.3";
  if (/glm-?5(?:\.|-)?2/i.test(normalized)) return "glm-5.2";
  if (/glm-?5.*turbo/i.test(normalized)) return "glm-5-turbo";
  return "";
}

export function getGLMModelLabelPattern(model) {
  const normalized = normalizeGLMModelId(model) || GLM_DEFAULT_MODEL;
  if (normalized === "glm-5.3-flash") return /GLM[\s‐‑‒–—−_-]*5(?:\.|[\s-])*3[\s‐‑‒–—−_-]*Flash/i;
  if (normalized === "glm-5.3") return /GLM[\s‐‑‒–—−_-]*5(?:\.|[\s-])*3(?![\s‐‑‒–—−_-]*Flash)/i;
  if (normalized === "glm-5.2") return /GLM[\s‐‑‒–—−_-]*5(?:\.|[\s-])*2/i;
  return /GLM[\s‐‑‒–—−_-]*5[\s‐‑‒–—−_-]*Turbo/i;
}

export function findGLMModelLabel(labels, targetModel) {
  const normalizedTarget = normalizeGLMModelId(targetModel) || GLM_DEFAULT_MODEL;
  return labels.find((label) => normalizeGLMModelId(label) === normalizedTarget) || "";
}

export function findGLMNativeModelOption(options, targetModel) {
  const normalizedTarget = normalizeGLMModelId(targetModel) || GLM_DEFAULT_MODEL;
  return options.find((option) => normalizeGLMModelId(option?.label || option?.value) === normalizedTarget) || null;
}

export function classifyGLMPageState({
  hasComposer = false,
  hasAuthToken = false,
  hasSignIn = false,
  hasVerification = false,
} = {}) {
  if (hasVerification) return "verification";
  if (hasComposer && hasAuthToken) return "ready";
  if (hasSignIn && !hasAuthToken) return "signed_out";
  return "loading";
}

export function getGLMBrowserLaunchConfig({ profileDir = GLM_BROWSER_PROFILE } = {}) {
  return {
    engine: "chromium-persistent",
    profileDir,
    headless: false,
    channel: null,
    viewport: { width: 1280, height: 900 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--start-minimized",
      "--window-position=-32000,-32000",
    ],
  };
}

export async function minimizeGLMBrowserWindow(page) {
  let session = null;
  try {
    session = await page.context().newCDPSession(page);
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "minimized" },
    });
    return true;
  } catch {
    return false;
  } finally {
    await session?.detach?.().catch(() => {});
  }
}

export async function submitGLMPrompt(page, text, onSubmit = () => {}) {
  await dismissGLMBlockingDialog(page);
  const composer = page.locator("#chat-input").first();
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  await composer.fill(text);

  const sendButton = page.locator("#send-message-button").first();
  if (await sendButton.count() > 0) {
    onSubmit();
    await clickGLMControl(page, sendButton, true);
    return;
  }
  onSubmit();
  await composer.press("Enter");
}

function extractGLMUploadFileIds(value) {
  const candidates = [
    value?.file_id,
    value?.fileId,
    value?.id,
    value?.file?.id,
    value?.file?.file_id,
    value?.data?.file_id,
    value?.data?.fileId,
    value?.data?.id,
    value?.data?.file?.id,
  ];
  return [...new Set(candidates.filter((id) => typeof id === "string" && id.trim()))];
}

function matchingGLMUploadIndexes(response, images) {
  const request = response.request?.();
  if (!request || request.method?.() !== "POST") return [];
  let url;
  try { url = new URL(response.url()); } catch { return []; }
  if (url.origin !== new URL(GLM_BASE_URL).origin) return [];
  const contentType = String(request.headers?.()["content-type"] || "");
  if (!/multipart\/form-data/i.test(contentType)) return [];
  const body = request.postDataBuffer?.();
  if (!Buffer.isBuffer(body)) return [];
  return images.flatMap((image, index) =>
    body.includes(Buffer.from(image.name)) && body.includes(image.buffer) ? [index] : []);
}

function attachmentFailure(message) {
  return Object.assign(new Error(message), { delivery: "not_sent" });
}

export async function attachGLMImages(page, images, signal = null, { timeoutMs = 45_000 } = {}) {
  if (!images.length) return;
  signal?.throwIfAborted();
  const fileInput = page.locator('input[type="file"][multiple]').first();
  let resolveAck;
  let rejectAck;
  const acknowledged = new Promise((resolve, reject) => { resolveAck = resolve; rejectAck = reject; });
  const fileIdsByImage = new Map();
  const seenFileIds = new Set();
  const response = async (value) => {
    const matchedIndexes = matchingGLMUploadIndexes(value, images);
    if (!matchedIndexes.length) return;
    if (value.status?.() < 200 || value.status?.() >= 300) {
      rejectAck(attachmentFailure(`GLM attachment upload failed: HTTP ${value.status()}.`));
      return;
    }
    try {
      const ids = extractGLMUploadFileIds(await value.json());
      const pendingIndexes = matchedIndexes.filter((index) => !fileIdsByImage.has(index));
      if (!pendingIndexes.length) return;
      if (!ids.length || ids.length !== pendingIndexes.length || new Set(ids).size !== ids.length) {
        rejectAck(attachmentFailure("GLM attachment acknowledgment did not include a file id."));
        return;
      }
      if (ids.some((id) => seenFileIds.has(id))) return;
      for (let index = 0; index < pendingIndexes.length; index += 1) {
        fileIdsByImage.set(pendingIndexes[index], ids[index]);
        seenFileIds.add(ids[index]);
      }
      if (fileIdsByImage.size === images.length) {
        resolveAck(images.map((_, index) => fileIdsByImage.get(index)));
      }
    } catch (error) {
      rejectAck(attachmentFailure(`GLM attachment acknowledgment could not be read: ${error.message}`));
    }
  };
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(attachmentFailure("GLM attachment acknowledgment timed out before sending the prompt.")),
      timeoutMs,
    );
  });
  let abort;
  const aborted = signal
    ? new Promise((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
    })
    : null;
  const uploadAcknowledged = Promise.race([acknowledged, timeout, ...(aborted ? [aborted] : [])]);
  // The listener can reject while Playwright is still waiting for the hidden
  // input. Mark it handled immediately, then await the same promise below.
  uploadAcknowledged.catch(() => {});
  page.on?.("response", response);
  const inputSelected = (async () => {
    await fileInput.waitFor({ state: "attached", timeout: 15_000 });
    await fileInput.setInputFiles(images);
    signal?.throwIfAborted();
  })();
  const inputSelectedOrStopped = Promise.race([inputSelected, ...(aborted ? [aborted] : [])]);
  inputSelectedOrStopped.catch(() => {});
  try {
    await inputSelectedOrStopped;
    return await uploadAcknowledged;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error?.delivery === "not_sent") throw error;
    throw attachmentFailure(`GLM attachment acknowledgment failed: ${error.message}`);
  } finally {
    clearTimeout(timeoutId);
    if (abort) signal.removeEventListener("abort", abort);
    page.off?.("response", response);
  }
}

async function clickGLMControl(page, control, submission = false) {
  try {
    await control.click({ timeout: 5_000 });
  } catch (error) {
    if (submission && !/intercepts pointer events/i.test(String(error?.message || error))) throw error;
    if (!/Timeout|intercepts pointer events|dialog overlay/i.test(String(error?.message || error))) throw error;
    const dismissed = await dismissGLMBlockingDialog(page);
    if (submission && !dismissed) throw error;
    await control.click({ timeout: 15_000 });
  }
}

async function dismissGLMBlockingDialog(page) {
  const overlay = page.locator([
    '[data-dialog-overlay][data-state="open"]',
    '._modal-overlay[data-state="open"]',
    '.driver-overlay',
  ].join(",")).first();
  const overlayVisible = typeof overlay.isVisible === "function"
    && await overlay.isVisible().catch(() => false);
  if (await overlay.count().catch(() => 0) === 0 || !overlayVisible) return false;

  await page.keyboard.press("Escape").catch(() => {});
  if (await waitForGLMOverlayToClose(overlay)) return true;

  const closeButton = page.locator([
    '[role="dialog"] button[aria-label*="close" i]',
    '[role="dialog"] button[title*="close" i]',
    '[role="dialog"] button[aria-label*="закры" i]',
    '[data-dialog-content] button[aria-label*="close" i]',
    '.driver-popover-close-btn',
  ].join(",")).first();
  if (await closeButton.count().catch(() => 0) > 0 && await closeButton.isVisible().catch(() => false)) {
    await closeButton.click().catch(() => {});
  }
  if (await waitForGLMOverlayToClose(overlay)) return true;
  throw new Error("GLM blocking dialog overlay did not close before #send-message-button click.");
}

async function waitForGLMOverlayToClose(overlay) {
  try {
    await overlay.waitFor({ state: "hidden", timeout: 2_000 });
    return true;
  } catch {
    return !await overlay.isVisible().catch(() => false);
  }
}

export async function inspectGLMModelMenu(page) {
  const selector = await waitForGLMModelSelector(page);
  if (!selector) return { currentLabel: "", availableLabels: [] };
  const state = await readGLMModelSelectorState(selector);
  if (state.native) {
    return {
      currentLabel: state.currentLabel,
      availableLabels: state.options.map((option) => option.label).filter(Boolean),
    };
  }
  const currentLabel = state.currentLabel;
  await clickGLMControl(page, selector);
  const availableLabels = await readVisibleGLMModelLabels(page);
  await page.keyboard.press("Escape").catch(() => {});
  return { currentLabel, availableLabels };
}

export async function closeGLMBrowserProxy(accountId = "default") {
  const current = proxies.get(accountId); proxies.delete(accountId);
  if (current) await current.close();
}

export function resetGLMBrowserProxy(accountId = "default") {
  return closeGLMBrowserProxy(accountId);
}

export function getGLMBrowserProxy(options = {}) {
  const accountId = options.accountId || "default";
  if (!proxies.has(accountId)) {
    const key = accountId === "default" ? "glm" : "glm:" + accountId;
    proxies.set(accountId, backgroundBrowserPool.proxy(key, () => createProxy(options), ["sendChat"]));
  }
  return Promise.resolve(proxies.get(accountId));
}

async function createProxy(options) {
  const { debug = false } = options;
  const launch = getGLMBrowserLaunchConfig(options);
  const { ensureBrowserBinaries } = await import("../../browser/ensure-binaries.mjs");
  const browserReady = await ensureBrowserBinaries();
  if (!browserReady.ok) {
    throw new Error(browserReady.error || "Chromium browser binaries are not installed.");
  }
  const { getChatGPTChromium } = await import("../chatgpt/engine.mjs");
  const chromium = await getChatGPTChromium();
  const initialStorageState = readInitialStorageState(launch.profileDir, options.storageStatePath || GLM_STORAGE_STATE);
  const context = await launchPersistentDeepSeekContext(chromium, launch.profileDir, launch.headless, {
    viewport: launch.viewport,
    args: launch.args,
    channel: launch.channel,
  });
  try {
  await restoreInitialStorageState(context, initialStorageState);
  const page = context.pages()[0] || await context.newPage();
  await minimizeGLMBrowserWindow(page);
  let queue = Promise.resolve();

  const close = async () => {
    process.removeListener("exit", onExit);
    await queue.catch(() => {});
    await context.close().catch(() => {});
  };
  const onExit = () => { close(); };
  process.once("exit", onExit);

  const sendChat = (options) => {
    const run = queue.then(() => sendGLMChatOnce(page, options, debug));
    queue = run.catch(() => {});
    return run;
  };

  return { sendChat, close };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

export async function sendGLMChatOnce(page, {
  prompt,
  model = GLM_DEFAULT_MODEL,
  conversationId = null,
  images = [],
  onText = null,
  signal = null,
  accountId = "default",
}, debug) {
  return browserRequestPolicies.glm.observe(page, { accountId, signal }, async check => {
  const emitText = onText;
  onText = text => { check.onText(text); emitText?.(text); };
  let promptSubmitted = false;
  try {
    signal?.throwIfAborted();
    const text = String(prompt || "").trim();
    if (!text) throw new Error("GLM prompt is empty.");

    if (!conversationId || !/^https:\/\/chat\.z\.ai\/c\//i.test(conversationId)) {
      await page.goto(GLM_BASE_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    } else if (page.url() !== conversationId) {
      await page.goto(conversationId, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    }

    await waitForGLMReady(page, signal, check);
    await dismissGLMBlockingDialog(page);
    const activeModel = await selectGLMModel(page, model, { conversationId, signal });
    const imageFileIds = await attachGLMImages(page, images, signal) || [];
    const before = await readGLMAnswerSnapshot(page);
    const disposeCompletionDebug = observeGLMCompletionDebug(page, { debug, model: activeModel, imageFileIds });
    const nativeCompletion = observeGLMNativeCompletion(page, { prompt: text, imageFileIds, signal });
    let answer;
    try {
      await submitGLMPrompt(page, text, () => { check.beforeSend(); promptSubmitted = true; });
      answer = await waitForGLMAnswer(page, before, onText, debug, signal, check, nativeCompletion);
    } finally {
      disposeCompletionDebug?.();
      nativeCompletion.dispose();
    }
    return {
      text: answer,
      conversationId: /^https:\/\/chat\.z\.ai\/c\//i.test(page.url())
        ? page.url()
        : `glm-${randomUUID()}`,
      lastMessageId: null,
      model: activeModel,
    };
  } catch (error) {
    error.promptSubmitted = promptSubmitted;
    error.delivery ||= promptSubmitted ? 'unknown' : 'not_sent';
    throw error;
  }
  });
}

async function readGLMPageState(page) {
  const state = await page.evaluate(() => ({
    hasComposer: Boolean(document.querySelector("#chat-input")),
    authToken: localStorage.getItem("token") || localStorage.getItem("access_token") || "",
    hasSignIn: [...document.querySelectorAll("button, a")]
      .some((item) => /^(Sign in|Log in|Войти)$/i.test((item.textContent || item.getAttribute("aria-label") || "").trim())),
    hasVerification: /security verification|drag the slider|验证码|проверку безопасности/i
      .test(document.body?.innerText || ""),
  }));
  const cookies = await page.context().cookies(GLM_BASE_URL);
  return {
    ...state,
    hasAuthToken: isGLMUserToken(state.authToken) || hasGLMAuthCookie(cookies),
  };
}

async function waitForGLMReady(page, signal = null, check = () => {}) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    check();
    signal?.throwIfAborted();
    const state = classifyGLMPageState(await readGLMPageState(page));
    if (state === "ready") return;
    if (state === "verification") {
      throw new Error("GLM запросил защитную проверку. Повторно подключите GLM и завершите проверку в окне Z.ai.");
    }
    if (state === "signed_out") {
      throw new Error("GLM не авторизован. Подключите GLM в окне нового чата и завершите вход в Z.ai.");
    }
    await delay(POLL_MS, undefined, signal ? { signal } : undefined);
  }
  throw new Error("GLM: интерфейс Z.ai не загрузился. Проверьте соединение и повторите запрос.");
}

export async function selectGLMModel(page, requestedModel, { conversationId = null, signal = null } = {}) {
  signal?.throwIfAborted();
  const targetModel = normalizeGLMModelId(requestedModel) || GLM_DEFAULT_MODEL;
  const selector = await waitForGLMModelSelector(page, signal);
  if (!selector) throw new Error("Z.ai не отобразил селектор моделей после загрузки чата.");
  const selectorState = await readGLMModelSelectorState(selector);
  const currentLabel = selectorState.currentLabel;
  const currentModel = normalizeGLMModelId(currentLabel);
  if (currentModel === targetModel || conversationId) return currentModel || targetModel;
  if (await selector.isDisabled().catch(() => false)) {
    throw new Error(`GLM: модель нельзя переключить в текущей Z.ai-сессии (выбрано: ${currentLabel || "неизвестно"}).`);
  }
  if (selectorState.native) {
    const option = findGLMNativeModelOption(selectorState.options, targetModel);
    const available = selectorState.options.map((item) => item.label).filter(Boolean);
    if (!option) {
      const suffix = available.length ? ` Доступны: ${available.join(", ")}.` : "";
      throw new Error(`${GLM_MODEL_LABELS.get(targetModel)} не найден в текущем меню моделей Z.ai.${suffix}`);
    }
    if (option.disabled) {
      throw new Error(`${option.label} недоступен для текущего аккаунта Z.ai.`);
    }
    await selector.selectOption(option.value);
    await waitForGLMModelSelection(page, targetModel, option.label);
    return targetModel;
  }
  await selector.click();
  const targetLabel = GLM_MODEL_LABELS.get(targetModel);
  await waitForGLMModelMenu(page, targetModel);
  const availableLabels = await readVisibleGLMModelLabels(page);
  const option = await findVisibleGLMModelOption(page, targetModel);
  if (!option) {
    await page.keyboard.press("Escape").catch(() => {});
    const available = availableLabels.length ? ` Доступны: ${availableLabels.join(", ")}.` : "";
    throw new Error(`${targetLabel} не найден в текущем меню моделей Z.ai.${available}`);
  }
  if (await option.isDisabled().catch(() => false)) {
    await page.keyboard.press("Escape").catch(() => {});
    throw new Error(`${targetLabel} недоступен для текущего аккаунта Z.ai. Выберите GLM 5.3 Flash или подключите подходящий тариф.`);
  }
  await option.click();
  await waitForGLMModelSelection(page, targetModel, targetLabel);
  return targetModel;
}

async function waitForGLMModelMenu(page, targetModel) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const labels = await readVisibleGLMModelLabels(page);
    if (findGLMModelLabel(labels, targetModel)) return;
    await delay(100);
  }
}

async function waitForGLMModelSelection(page, targetModel, targetLabel) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const selector = await findGLMModelSelector(page);
    const { currentLabel } = await readGLMModelSelectorState(selector);
    if (normalizeGLMModelId(currentLabel) === targetModel) return;
    await delay(100);
  }
  throw new Error(`Z.ai не подтвердил переключение на ${targetLabel}.`);
}

async function waitForGLMModelSelector(page, signal = null) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const selector = await findGLMModelSelector(page);
    if (await selector.count() > 0 && await selector.isVisible().catch(() => false)) return selector;
    await delay(250, undefined, signal ? { signal } : undefined);
  }
  return null;
}

async function findVisibleGLMModelOption(page, targetModel) {
  const semanticOptions = page.locator([
    'button[aria-label="model-item"]',
    '[role="option"]',
    '[role="menuitem"]',
    '[data-slot="command-item"]',
    '[data-slot="dropdown-menu-item"]',
  ].join(","));
  const semanticLabels = await semanticOptions.allInnerTexts().catch(() => []);
  const semanticIndex = semanticLabels.findIndex((label) => normalizeGLMModelId(label) === targetModel);
  if (semanticIndex >= 0) {
    const option = semanticOptions.nth(semanticIndex);
    if (await option.isVisible().catch(() => false)) return option;
  }

  const candidates = page.locator([
    "button",
  ].join(","));
  for (let index = 0, count = await candidates.count(); index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (!await candidate.isVisible().catch(() => false)) continue;
    const label = (await candidate.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    const ariaLabel = await candidate.getAttribute("aria-label").catch(() => "");
    if (/select a model|выбрать модель/i.test(ariaLabel || "")) continue;
    if (normalizeGLMModelId(label) === targetModel) return candidate;
  }
  return null;
}

async function findGLMModelSelector(page) {
  const nativeSelector = page.locator([
    'select[aria-label*="model" i]',
    'select[id*="model-selector" i]',
  ].join(",")).first();
  if (await nativeSelector.count() > 0) return nativeSelector;

  const byAccessibleName = page.getByRole("button", {
    name: /select a model|выбрать модель|model selector|модель/i,
  }).first();
  if (await byAccessibleName.count() > 0) return byAccessibleName;

  const byCurrentModel = page.locator("button").filter({
    hasText: /GLM[\s‐‑‒–—−_-]*5/i,
  }).first();
  return byCurrentModel;
}

async function readGLMModelSelectorState(selector) {
  return selector.evaluate((element) => {
    const native = element.tagName === "SELECT";
    const options = native
      ? [...element.options].map((option) => ({
        value: option.value,
        label: (option.textContent || "").replace(/\s+/g, " ").trim(),
        disabled: option.disabled,
      }))
      : [];
    const currentLabel = native
      ? (element.selectedOptions?.[0]?.textContent || "")
      : (element.innerText || element.textContent || "");
    return {
      native,
      currentLabel: currentLabel.replace(/\s+/g, " ").trim(),
      options,
    };
  }).catch(async () => ({
    native: false,
    currentLabel: (await selector.innerText().catch(() => "")).replace(/\s+/g, " ").trim(),
    options: [],
  }));
}

async function readVisibleGLMModelLabels(page) {
  const candidates = page.locator([
    '[role="option"]',
    '[role="menuitem"]',
    '[data-slot="command-item"]',
    '[data-slot="dropdown-menu-item"]',
    "button",
  ].join(","));
  const labels = [];
  for (let index = 0, count = await candidates.count(); index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (!await candidate.isVisible().catch(() => false)) continue;
    const label = (await candidate.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (!normalizeGLMModelId(label) || labels.includes(label)) continue;
    labels.push(label);
  }
  return labels;
}

export async function waitForGLMAnswer(page, before, onText, debug, signal = null, check = () => {}, nativeCompletion = null) {
  const startedAt = Date.now();
  let lastText = "";
  let stable = 0;

  for (;;) {
    check();
    signal?.throwIfAborted();
    const nativeResult = nativeCompletion?.getResult();
    if (nativeResult?.ok) {
      onText?.(nativeResult.text);
      return nativeResult.text;
    }
    const pageState = classifyGLMPageState(await readGLMPageState(page));
    if (pageState === "verification") {
      throw new Error("GLM запросил защитную проверку. Повторно подключите GLM и завершите проверку в окне Z.ai.");
    }
    if (pageState === "signed_out") {
      throw new Error("Сессия GLM истекла. Повторно подключите GLM и войдите в Z.ai.");
    }
    const snapshot = await readGLMAnswerSnapshot(page);
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= GENERATION_TIMEOUT_MS) {
      if (debug) console.log(`[glm] generation timeout responseCount=${snapshot.assistantCount} copyControls=${snapshot.copyControlCount} loading=${snapshot.loading}`);
      if (debug) {
        try {
          const screenshot = await captureBrowserDiagnosticScreenshot(page, "glm-timeout");
          console.log(`[glm] generation timeout screenshot ${screenshot}`);
        } catch (error) {
          console.log(`[glm] generation timeout screenshot failed ${summarizeBrowserDiagnosticError(error)}`);
        }
      }
      if (lastText) return lastText;
      throw new Error("GLM не вернул текст ответа до истечения таймаута.");
    }
    if (isGLMTransientErrorText(snapshot.rawText)) {
      throw new Error("GLM temporary response failure: Z.ai returned an invalid empty response.");
    }
    if (!isGLMAnswerSnapshotChanged(before, snapshot)) {
      await delay(POLL_MS, undefined, signal ? { signal } : undefined);
      continue;
    }
    if (snapshot.text !== lastText) {
      lastText = snapshot.text;
      stable = 0;
      onText?.(lastText);
      if (debug) console.log(`[glm] response ${lastText.length} char(s)`);
    } else {
      stable += 1;
    }
    if (lastText && snapshot.ready && stable >= STABLE_POLLS) return lastText;
    await delay(POLL_MS, undefined, signal ? { signal } : undefined);
  }
}

export async function readGLMAnswerSnapshot(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getBoundingClientRect().height > 0;
    };
    const selector = '#messages-container .assistant-message, #messages-container .chat-assistant, #messages-container [id^="message-"]';
    const assistantNodes = [...document.querySelectorAll(selector)].filter((element) => visible(element)
      && !element.classList.contains("user-message")
      && !element.id.endsWith("-start")
      && !element.closest(".user-message")
      && !element.parentElement?.closest(selector));
    const assistantTexts = assistantNodes.map((element) => {
      const content = element.querySelector(".markdown-prose") || element;
      return (content.innerText || content.textContent || "").trim();
    }).filter(Boolean);
    const controls = [...document.querySelectorAll('button, [aria-label]')];
    const isGenerating = controls
      .some((item) => /^(Stop|Остановить)$/i.test((item.getAttribute("aria-label") || item.textContent || "").trim()));
    const last = assistantNodes.at(-1);
    return { assistantTexts, rawText: assistantTexts.filter(Boolean).at(-1) || "", ready: !isGenerating, assistantCount: assistantNodes.length,
      lastMessageId: last?.id || last?.getAttribute("data-message-id") || "",
      copyControlCount: controls.filter((item) => /^(Copy|Копировать)$/i.test((item.getAttribute("aria-label") || item.textContent || "").trim())).length,
      loading: isGenerating };
  }).then((snapshot) => ({ ...snapshot, text: selectGLMAnswerText(snapshot) }));
}
