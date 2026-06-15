// Загрузчик браузерного движка для ChatGPT.
//
// Используем Patchright — drop-in замену Playwright с убранными CDP-утечками
// (Runtime.enable, Console.enable, изолированные миры и т.д.), по которым
// Cloudflare/анти-бот определяют автоматизацию. Это позволяет работать в новом
// headless-режиме невидимо на всех ОС и проходить Cloudflare без видимого окна.
//
// Если patchright по какой-то причине недоступен — откатываемся на обычный
// playwright, чтобы ChatGPT всё равно работал (пусть и с меньшей скрытностью).

let cachedChromium = null;
let cachedEngineName = null;

export async function getChatGPTChromium() {
  if (cachedChromium) return cachedChromium;
  try {
    const mod = await import("patchright");
    cachedChromium = mod.chromium;
    cachedEngineName = "patchright";
  } catch {
    const mod = await import("playwright");
    cachedChromium = mod.chromium;
    cachedEngineName = "playwright";
  }
  return cachedChromium;
}

export function getChatGPTEngineName() {
  return cachedEngineName;
}
