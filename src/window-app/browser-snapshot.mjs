// Снимок Web-браузера → контекст для браузерного агента.
// Обычные чаты и агенты ищут информацию через встроенный provider web search.

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
  // Состояние браузера не подмешивается в обычный чат: это провоцирует модель
  // ходить по странице вместо дешёвого provider web search.
  void options;
  return String(prompt || "");
}

export async function warmBrowserForAgentTask(task) {
  try {
    if (!shouldAutoRunBrowserTask(task)) return;
    const { browserWarm } = await import("../browser/service.mjs");
    await browserWarm();
  } catch {}
}

export function shouldAutoRunBrowserTask(prompt) {
  const text = String(prompt || "").trim();
  if (!text || text === "/code" || text.startsWith("/code ") || text.startsWith("/skill ")) return false;
  const normalized = text.toLowerCase();

  // Браузер включается только для явной работы со страницей: навигации,
  // кликов, заполнения форм или извлечения/парсинга конкретной страницы.
  // Обычные «найди», «узнай», новости, цены и актуальные сведения сюда
  // намеренно не входят — их должен обслуживать provider web search.
  const explicitBrowser = /(браузер|browser|browser_navigate|browser_snapshot|browser_click)/u.test(normalized);
  const urlOrSite = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(?:ru|com|net|org|io|dev|рф)\b|сайт(?:е|а|ом)?|страниц(?:а|е|у|ы))/u.test(normalized);
  const clickVerb = /(нажми|кликни|кликн|нажмите|кликните|нажать|кликнуть|\bclick\b|\bpress\b|\btap\b)/u.test(normalized);
  const typeVerb = /(введи|ввести|напиши в|заполни|\btype\b|enter text|\bfill\b)/u.test(normalized);
  const navVerb = /(открой|перейди|зайди|загрузи|открыть|перейти|\bopen\b|\bvisit\b|\bnavigate\b)/u.test(normalized);
  const parseVerb = /(спарси|парсинг|распарси|извлеки|собери со страницы|прочитай страниц|что на странице|что видишь на странице|покажи страницу|parse|scrape|extract from|read the page)/u.test(normalized);
  const dialogAction = /(принять все|отклонить все|accept all|reject all|закрой диалог|dismiss)/u.test(normalized);

  if (explicitBrowser && (clickVerb || typeVerb || navVerb || parseVerb || dialogAction)) return true;
  if (urlOrSite && (clickVerb || typeVerb || navVerb || parseVerb || dialogAction)) return true;
  if (dialogAction) return true;
  return false;
}

export function isBrowserActionTask(prompt) {
  return shouldAutoRunBrowserTask(prompt);
}

export async function shouldPreferBrowserOverProviderSearch(prompt) {
  // Не отключаем web search из-за того, что в Web-панели случайно открыта страница.
  // Приоритет браузеру даёт только явная команда пользователя.
  return shouldAutoRunBrowserTask(prompt);
}

export async function shouldAutoRunBrowserTaskWithSnapshot(prompt) {
  // Наличие снимка само по себе больше не переводит чат в браузерный режим.
  return shouldAutoRunBrowserTask(prompt);
}
