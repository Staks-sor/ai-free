// Live-панель общего браузера (Web) — MJPEG + клики, тот же Playwright, что читают модели.

import {
  APP_BROWSER_VIEWPORT,
  captureAppBrowserSnapshot,
  getAppBrowserPage,
  getAppBrowserViewport,
  navigateAppBrowser,
  resetAppBrowserSession,
  setAppBrowserViewport,
  validateAppBrowserUrl,
} from "./app-browser.mjs";
import { createLiveMjpegHub } from "./live-mjpeg-hub.mjs";
import { captureWebBrowserJpeg } from "./web-browser.mjs";
import { browserRecoverBlockedSearch } from "../browser/service.mjs";

const MJPEG_BOUNDARY = "app-browser-live-frame";

const webLiveHub = createLiveMjpegHub({
  boundary: MJPEG_BOUNDARY,
  minIntervalMs: 90,
  forceIntervalMs: 1000,
  captureFrame: async () => {
    const page = await getAppBrowserPage();
    return captureWebBrowserJpeg(page);
  },
});

export async function prepareAppBrowserPanelPage() {
  return getAppBrowserPage();
}

export async function handleAppBrowserNavigate(body = {}) {
  const url = validateAppBrowserUrl(body.url);
  const result = await navigateAppBrowser(url);
  return result;
}

export async function handleAppBrowserSnapshot() {
  const snapshot = await captureAppBrowserSnapshot();
  return snapshot;
}

export async function handleAppBrowserReset() {
  await resetAppBrowserSession();
  webLiveHub.reset();
  return {
    ok: true,
    hint: "Общий браузер перезапущен. Откройте URL — DeepSeek/Qwen увидят страницу в следующем сообщении.",
  };
}

export async function handleAppBrowserLiveInput(body = {}) {
  const page = await prepareAppBrowserPanelPage();
  const { width: vw, height: vh } = getAppBrowserViewport();

  const type = String(body.type || "");
  if (type === "click") {
    const x = Math.max(0, Math.min(vw, Number(body.x) || 0));
    const y = Math.max(0, Math.min(vh, Number(body.y) || 0));
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
  } else if (type === "wheel") {
    const x = Number(body.x) || vw / 2;
    const y = Number(body.y) || vh / 2;
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, Number(body.deltaY) || 0);
  } else if (type === "type") {
    await page.keyboard.insertText(String(body.text || ""));
  } else if (type === "key") {
    await page.keyboard.press(String(body.key || "Enter"));
  } else {
    throw new Error(`Unknown live input type: ${type || "(empty)"}`);
  }
  const shouldCheck = (
    type === "key" && String(body.key || "").toLowerCase() === "enter"
  ) || (
    type === "click" && /(^|\.)google\.(com|ru)$/i.test(new URL(page.url()).hostname)
  );
  if (shouldCheck) {
    await page.waitForTimeout(700);
    return { ok: true, ...(await browserRecoverBlockedSearch(page)) };
  }
  return { ok: true, recovered: false };
}

export async function handleAppBrowserLiveStream(req, res) {
  try {
    await prepareAppBrowserPanelPage();
  } catch (error) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Browser: ${error.message}`);
    return;
  }
  webLiveHub.attach(req, res);
}

export async function setAppBrowserLiveViewport(body = {}) {
  return setAppBrowserViewport(body);
}

export function renderEmbedAppBrowserLiveHtml() {
  const defaults = APP_BROWSER_VIEWPORT;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Web</title>
  <style>
    :root { color-scheme: dark; --bg:#0e1116; --panel:#161a23; --line:rgba(255,255,255,.1); --text:#edf1f7; --muted:#8b96a7; --accent:#4d7cff; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; background: var(--bg); color: var(--text); overflow: hidden; }
    body { display: grid; grid-template-rows: auto minmax(0, 1fr); }
    .bar {
      display: flex; gap: 6px; align-items: center; padding: 8px 10px;
      border-bottom: 1px solid var(--line); background: var(--panel); font-size: 11px;
    }
    .bar span.label { color: var(--muted); flex: 0 0 auto; }
    .urlInput {
      flex: 1; min-width: 0; border: 1px solid var(--line); background: #10141a; color: var(--text);
      border-radius: 6px; padding: 6px 8px; font-size: 11px;
    }
    .btn {
      border: 1px solid var(--line); background: #1a1f27; color: var(--text);
      border-radius: 6px; padding: 5px 10px; cursor: pointer; font-size: 11px; font-weight: 600;
    }
    .btn:hover { border-color: var(--accent); }
    .viewport {
      position: relative;
      min-height: 0;
      height: 100%;
      overflow: hidden;
      background: #080a0e;
    }
    .screen { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
    #live {
      width: 100%; height: 100%; object-fit: contain; object-position: top center;
      user-select: none; display: block; pointer-events: none; background: #0e1116;
      position: relative; z-index: 2; image-rendering: auto;
    }
    #placeholder {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      padding: 20px; text-align: center; color: var(--muted); font-size: 12px; line-height: 1.5;
      background: #0e1116; z-index: 1; pointer-events: none;
    }
    #placeholder.hidden { display: none; }
    #clickLayer { position: absolute; inset: 0; z-index: 2; cursor: crosshair; touch-action: none; }
    .hint { position: absolute; bottom: 10px; left: 10px; right: 10px; padding: 8px 10px; border-radius: 8px; background: rgba(0,0,0,.55); font-size: 11px; color: var(--muted); pointer-events: none; opacity: .85; }
    .hint.active { color: #b8d4ff; border: 1px solid rgba(77,124,255,.35); }
  </style>
</head>
<body>
  <header class="bar">
    <span class="label">Web</span>
    <input id="urlInput" class="urlInput" type="url" placeholder="https://yandex.ru" spellcheck="false">
    <button type="button" class="btn" id="goBtn">Открыть</button>
    <button type="button" class="btn" id="resetBtn">Сброс</button>
    <button type="button" class="btn" id="reloadBtn">↻</button>
  </header>
  <div class="viewport" id="viewport">
    <div class="screen" id="screen">
      <div id="placeholder">Запуск браузера…</div>
      <img id="live" src="/api/browser/live-stream" alt="Web live" decoding="async">
      <div id="clickLayer"></div>
    </div>
    <div class="hint" id="hint">URL в строке выше или в чате: «найди новости Мурманска»</div>
  </div>
  <script>
    let VW = ${defaults.width};
    let VH = ${defaults.height};
    let lastSyncedW = 0;
    let lastSyncedH = 0;
    const live = document.getElementById("live");
    const clickLayer = document.getElementById("clickLayer");
    const screen = document.getElementById("screen");
    const viewportEl = document.getElementById("viewport");
    const hintEl = document.getElementById("hint");
    const placeholder = document.getElementById("placeholder");
    const urlInput = document.getElementById("urlInput");
    let captureKeys = false;
    let streamNonce = Date.now();
    let viewportSyncTimer = null;
    let wheelTimer = null;
    let wheelDelta = 0;
    let wheelPt = null;

    function applyViewportSize(w, h) {
      if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return;
      VW = w;
      VH = h;
    }

    function targetViewportSize() {
      const cw = Math.max(280, Math.round(viewportEl.clientWidth));
      const ch = Math.max(200, Math.round(viewportEl.clientHeight));
      const w = cw >= 520 ? Math.max(960, cw) : cw;
      return { w, h: ch };
    }

    async function syncViewportSize() {
      const { w, h } = targetViewportSize();
      if (Math.abs(w - lastSyncedW) < 20 && Math.abs(h - lastSyncedH) < 20) return;
      lastSyncedW = w;
      lastSyncedH = h;
      try {
        const r = await fetch("/api/browser/live-viewport", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ width: w, height: h }),
        });
        const data = await r.json().catch(() => ({}));
        if (data.width && data.height) applyViewportSize(data.width, data.height);
      } catch {}
    }

    function scheduleViewportSync() {
      if (viewportSyncTimer) clearTimeout(viewportSyncTimer);
      viewportSyncTimer = setTimeout(() => {
        viewportSyncTimer = null;
        syncViewportSize();
      }, 350);
    }

    if (viewportEl && typeof ResizeObserver !== "undefined") {
      new ResizeObserver(scheduleViewportSync).observe(viewportEl);
    }
    window.addEventListener("load", scheduleViewportSync);
    scheduleViewportSync();
    window.addEventListener("message", (event) => {
      if (event.data?.type === "syncLiveViewport") scheduleViewportSync();
    });

    function hidePlaceholder() {
      placeholder?.classList.add("hidden");
    }

    function restartStream() {
      streamNonce = Date.now();
      live.classList.remove("ready");
      if (placeholder) {
        placeholder.classList.remove("hidden");
        placeholder.textContent = "Подключение к стриму…";
      }
      live.src = "/api/browser/live-stream?t=" + streamNonce;
      setTimeout(hidePlaceholder, 1500);
    }

    live.addEventListener("load", () => {
      live.classList.add("ready");
      hidePlaceholder();
    });
    live.addEventListener("error", () => {
      live.classList.remove("ready");
      if (placeholder) {
        placeholder.classList.remove("hidden");
        placeholder.textContent = "Стрим недоступен. Нажмите ↻ или «Сброс».";
      }
    });

    fetch("/api/browser/warm", { method: "POST" })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (data.url && urlInput && !urlInput.value) urlInput.placeholder = data.url.startsWith("data:") ? "https://yandex.ru" : data.url;
        setTimeout(hidePlaceholder, 500);
      })
      .catch(() => {});

    async function navigateTo(input) {
      let url = String(input || "").trim();
      if (!url) return;
      if (!/^https?:\\/\\//i.test(url)) url = "https://" + url;
      hintEl.textContent = "Открываю " + url + "…";
      try {
        const r = await fetch("/api/browser/navigate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || r.statusText);
        if (urlInput) urlInput.value = data.url || url;
        hintEl.textContent = data.title || data.url || "Готово";
      } catch (err) {
        hintEl.textContent = "Ошибка: " + err.message;
      }
    }

    document.getElementById("goBtn").addEventListener("click", () => navigateTo(urlInput?.value));
    urlInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); navigateTo(urlInput.value); }
    });

    function mapCoords(e) {
      const rect = screen.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width * VW;
      const y = (e.clientY - rect.top) / rect.height * VH;
      if (x < 0 || y < 0 || x > VW || y > VH) return null;
      return { x: Math.round(x), y: Math.round(y) };
    }

    async function sendInput(payload) {
      try {
        const response = await fetch("/api/browser/live-input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (data.recovered) {
          if (urlInput) urlInput.value = data.url || "";
          hintEl.textContent = data.hint || "Google запросил проверку — открыт другой поисковик.";
        }
        return data;
      } catch {
        return {};
      }
    }

    function flushWheel() {
      wheelTimer = null;
      if (!wheelPt || !wheelDelta) return;
      sendInput({ type: "wheel", x: wheelPt.x, y: wheelPt.y, deltaY: wheelDelta });
      wheelDelta = 0;
    }

    clickLayer.addEventListener("click", (e) => {
      const pt = mapCoords(e);
      if (!pt) return;
      captureKeys = true;
      hintEl.classList.add("active");
      hintEl.textContent = "Клавиатура активна";
      sendInput({ type: "click", x: pt.x, y: pt.y });
    });

    clickLayer.addEventListener("wheel", (e) => {
      e.preventDefault();
      wheelPt = mapCoords(e) || { x: Math.round(VW / 2), y: Math.round(VH / 2) };
      wheelDelta += e.deltaY;
      if (!wheelTimer) wheelTimer = setTimeout(flushWheel, 40);
    }, { passive: false });

    document.addEventListener("keydown", (e) => {
      if (!captureKeys) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Enter") { e.preventDefault(); sendInput({ type: "key", key: "Enter" }); return; }
      if (e.key === "Backspace") { e.preventDefault(); sendInput({ type: "key", key: "Backspace" }); return; }
      if (e.key === "Tab") { e.preventDefault(); sendInput({ type: "key", key: "Tab" }); return; }
      if (e.key.length === 1) { e.preventDefault(); sendInput({ type: "type", text: e.key }); }
    });

    document.getElementById("resetBtn").addEventListener("click", async () => {
      await fetch("/api/browser/reset", { method: "POST" });
      if (urlInput) urlInput.value = "";
      restartStream();
    });

    document.getElementById("reloadBtn").addEventListener("click", () => restartStream());
  </script>
</body>
</html>`;
}
