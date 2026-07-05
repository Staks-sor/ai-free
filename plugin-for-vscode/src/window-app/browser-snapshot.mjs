// Снимок Web-браузера → контекст для DeepSeek/Qwen (чат и /code).

import { captureAppBrowserSnapshot } from "./app-browser.mjs";
import { formatSnapshotForPrompt } from "../browser/snapshot-build.mjs";

export async function getBrowserSnapshotForModels(options = {}) {
  try {
    return await captureAppBrowserSnapshot(options);
  } catch (error) {
    return { ok: false, empty: true, error: error.message, url: "", title: "", text: "", tree: "", refs: [] };
  }
}

export function formatBrowserContextBlock(snapshot) {
  return formatSnapshotForPrompt(snapshot);
}

export async function buildBrowserContextSection(options = {}) {
  const snapshot = await getBrowserSnapshotForModels(options);
  return formatBrowserContextBlock(snapshot);
}

export async function appendBrowserContextToPrompt(prompt, options = {}) {
  // Codex-style: browser context goes to the browser agent loop, not regular chat.
  void options;
  return String(prompt || "");
}

export async function warmBrowserForAgentTask(task) {
  try {
    const browserTask = shouldAutoRunBrowserTask(task) || await shouldAutoRunBrowserTaskWithSnapshot(task);
    if (!browserTask) return;
    const { browserWarm } = await import("../browser/service.mjs");
    await browserWarm();
  } catch {}
}

export function shouldAutoRunBrowserTask(prompt) {
  const text = String(prompt || "").trim();
  if (!text || text === "/code" || text.startsWith("/code ") || text.startsWith("/skill ")) return false;
  const normalized = text.toLowerCase();

  const clickVerb = /(нажми|кликни|кликн|нажмите|кликните|нажать|кликнуть|\bclick\b|\bpress\b|\btap\b)/u.test(normalized);
  const typeVerb = /(введи|ввести|напиши в|\btype\b|enter text|\bfill\b)/u.test(normalized);
  const navVerb = /(открой|перейди|зайди|загрузи|открыть|перейти|\bopen\b|\bvisit\b|\bnavigate\b|browser_navigate|browser_snapshot|browser_click)/u.test(normalized);
  const searchVerb = /(найди|найти|поиск|search|ищи|lookup|найди мне|загугли|узнай|выясни|собери|погугли)/u.test(normalized);
  const browserNoun = /(браузер|browser|\bweb\b|google|гугл|страниц|сайт|cookie|cookies|кнопк|consent|вкладк|http|\.com|интернет|online)/u.test(normalized);
  const dialogAction = /(принять все|принять|отклонить все|отклонить|accept all|reject all|dismiss|закрой диалог)/u.test(normalized);
  const readPage = /(что на странице|что видишь|прочитай страниц|покажи страниц|what(?:'s| is) on the page|read the page)/u.test(normalized);

  if (clickVerb && (browserNoun || dialogAction)) return true;
  if (typeVerb && browserNoun) return true;
  if (navVerb) return true;
  if (searchVerb) return true;
  if (readPage) return true;
  if (dialogAction) return true;
  return false;
}

export function isBrowserActionTask(prompt) {
  return shouldAutoRunBrowserTask(prompt);
}

export async function shouldPreferBrowserOverProviderSearch(prompt) {
  if (shouldAutoRunBrowserTask(prompt)) return true;
  try {
    const snap = await getBrowserSnapshotForModels({ maxTextChars: 300 });
    return snap.ok && !snap.empty;
  } catch {
    return false;
  }
}

export async function shouldAutoRunBrowserTaskWithSnapshot(prompt) {
  if (shouldAutoRunBrowserTask(prompt)) return true;
  const text = String(prompt || "").trim().toLowerCase();
  if (!text) return false;
  const actionHint = /(найди|найти|поиск|search|ищи|открой|нажми|кликн|что на|прочитай|покажи|accept|принять|образовательн|учрежден)/u.test(text);
  if (!actionHint) return false;
  try {
    const snap = await getBrowserSnapshotForModels({ maxTextChars: 400 });
    return snap.ok && !snap.empty;
  } catch {
    return false;
  }
}
