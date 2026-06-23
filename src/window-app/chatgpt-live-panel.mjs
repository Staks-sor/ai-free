// Живой просмотр ChatGPT из той же Playwright-сессии, что и sendChat.
// MJPEG-стрим + клики/клавиатура — без reverse-proxy iframe.

import { CHATGPT_BASE_URL, CHATGPT_BROWSER_PROFILE } from "../providers/chatgpt/config.mjs";
import { createLiveViewportState } from "./live-viewport.mjs";

export const CHATGPT_PANEL_VIEWPORT = { width: 580, height: 900 };
const chatGPTLiveViewport = createLiveViewportState(CHATGPT_PANEL_VIEWPORT);

export function getChatGPTPanelViewport() {
  return chatGPTLiveViewport.get();
}

export async function setChatGPTPanelViewport(body = {}) {
  const next = chatGPTLiveViewport.set(body.width, body.height);
  try {
    const { getChatGPTBrowserProxy } = await import("../providers/chatgpt/browser-proxy.mjs");
    const proxy = await getChatGPTBrowserProxy();
    await proxy.getPage().setViewportSize(next);
  } catch {}
  return { ok: true, ...next };
}
const LIVE_FRAME_INTERVAL_MS = 500;
const MJPEG_BOUNDARY = "chatgpt-live-frame";
const STUCK_RELOAD_AFTER_MS = 12_000;
const AUTO_RELOAD_COOLDOWN_MS = 30_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let authSyncTimer = null;
let notReadySince = 0;
let lastAutoReloadAt = 0;
let recoveryPromise = null;

function scheduleAuthSync() {
  if (authSyncTimer) clearTimeout(authSyncTimer);
  authSyncTimer = setTimeout(async () => {
    authSyncTimer = null;
    try {
      await handleChatGPTSyncSession();
    } catch {}
  }, 1500);
}

export async function warmChatGPTInAppBrowser() {
  const { startChatGPTBrowserProxy } = await import("../providers/chatgpt/browser-proxy.mjs");
  startChatGPTBrowserProxy();
  return { ok: true };
}

export async function prepareChatGPTPanelPage() {
  const { getChatGPTBrowserProxy } = await import("../providers/chatgpt/browser-proxy.mjs");
  const proxy = await getChatGPTBrowserProxy();
  const page = proxy.getPage();
  await page.setViewportSize(getChatGPTPanelViewport());
  // Только открыть chatgpt.com — без ожидания Cloudflare (вход вручную в панели).
  if (!/chatgpt\.com/i.test(page.url())) {
    await page.goto(`${CHATGPT_BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: 90_000 }).catch(() => {});
  }
  return proxy;
}

export async function handleChatGPTSyncSession() {
  const {
    getChatGPTBrowserProxy,
    getChatGPTBrowserProxyStatus,
    startChatGPTBrowserProxy,
    syncChatGPTAuthFromActiveProxy,
  } = await import("../providers/chatgpt/browser-proxy.mjs");
  const { isChatGPTAuthUsable, readChatGPTAuth } = await import("../providers/chatgpt/auth-files.mjs");
  const { CHATGPT_AUTH_FILE } = await import("../providers/chatgpt/config.mjs");

  const before = readChatGPTAuth(CHATGPT_AUTH_FILE);
  const beforeUsable = isChatGPTAuthUsable(before);

  const proxyStatus = getChatGPTBrowserProxyStatus();
  if (proxyStatus.state === "idle") {
    startChatGPTBrowserProxy();
    return {
      ok: true,
      hasAuth: beforeUsable,
      saved: false,
      ready: false,
      challenge: false,
      initializing: true,
      recovering: false,
    };
  }
  if (proxyStatus.state === "starting") {
    return {
      ok: true,
      hasAuth: beforeUsable,
      saved: false,
      ready: false,
      challenge: false,
      initializing: true,
      recovering: false,
    };
  }
  if (proxyStatus.state === "error") {
    return {
      ok: false,
      hasAuth: beforeUsable,
      saved: false,
      ready: false,
      challenge: false,
      initializing: false,
      recovering: false,
      error: proxyStatus.error || "Не удалось запустить Chrome. Нажмите «Сброс».",
    };
  }

  const proxy = await getChatGPTBrowserProxy();
  const auth = await syncChatGPTAuthFromActiveProxy();
  const fresh = auth || readChatGPTAuth(CHATGPT_AUTH_FILE);
  const hasAuth = isChatGPTAuthUsable(fresh);
  const saved = hasAuth && (!beforeUsable || JSON.stringify(before?.cookies || []) !== JSON.stringify(fresh?.cookies || []));
  const pageState = typeof proxy.getPageState === "function"
    ? await proxy.getPageState()
    : { hasComposer: false, challenge: false, url: proxy.getPage().url() };
  const ready = hasAuth && pageState.hasComposer === true;

  if (ready || pageState.challenge || !hasAuth) {
    notReadySince = 0;
  } else if (!notReadySince) {
    notReadySince = Date.now();
  }

  const stuckForMs = notReadySince ? Date.now() - notReadySince : 0;
  const canRecover = (
    hasAuth
    && !ready
    && !pageState.challenge
    && stuckForMs >= STUCK_RELOAD_AFTER_MS
    && Date.now() - lastAutoReloadAt >= AUTO_RELOAD_COOLDOWN_MS
  );
  if (canRecover && !recoveryPromise) {
    lastAutoReloadAt = Date.now();
    recoveryPromise = proxy.navigateHome()
      .catch(() => {})
      .finally(() => {
        recoveryPromise = null;
        notReadySince = Date.now();
      });
  }

  return {
    ok: true,
    hasAuth,
    saved: Boolean(saved),
    ready,
    challenge: pageState.challenge === true,
    initializing: false,
    recovering: Boolean(recoveryPromise),
    stuckForMs,
  };
}

export async function reloadChatGPTLivePage() {
  const { getChatGPTBrowserProxy } = await import("../providers/chatgpt/browser-proxy.mjs");
  const proxy = await getChatGPTBrowserProxy();
  await proxy.navigateHome();
  notReadySince = Date.now();
  const state = typeof proxy.getPageState === "function"
    ? await proxy.getPageState()
    : { hasComposer: false, challenge: false };
  return {
    ok: true,
    ready: state.hasComposer === true,
    challenge: state.challenge === true,
  };
}

export async function resetChatGPTLiveSession() {
  const { closeChatGPTBrowserProxy } = await import("../providers/chatgpt/browser-proxy.mjs");
  const { resetInAppBrowser } = await import("./in-app-browser.mjs");

  await closeChatGPTBrowserProxy();
  const result = await resetInAppBrowser();
  await prepareChatGPTPanelPage();
  notReadySince = Date.now();
  lastAutoReloadAt = 0;
  return {
    ok: true,
    engine: result.engine,
    hint: "In-app браузер перезапущен. Дождитесь загрузки ChatGPT в этой панели.",
  };
}

export async function handleChatGPTLiveInput(body = {}) {
  const { getChatGPTBrowserProxy } = await import("../providers/chatgpt/browser-proxy.mjs");
  const proxy = await getChatGPTBrowserProxy();
  const page = proxy.getPage();
  const vp = getChatGPTPanelViewport();
  await page.setViewportSize(vp);

  const type = String(body.type || "");
  if (type === "click") {
    const x = Math.max(0, Math.min(vp.width, Number(body.x) || 0));
    const y = Math.max(0, Math.min(vp.height, Number(body.y) || 0));
    const { tryAssistCloudflareClick } = await import("../providers/chatgpt/browser-login.mjs");
    await tryAssistCloudflareClick(page, x, y);
  } else if (type === "wheel") {
    const x = Number(body.x) || vp.width / 2;
    const y = Number(body.y) || vp.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, Number(body.deltaY) || 0);
  } else if (type === "type") {
    await page.keyboard.insertText(String(body.text || ""));
  } else if (type === "key") {
    await page.keyboard.press(String(body.key || "Enter"));
  } else {
    throw new Error(`Unknown live input type: ${type || "(empty)"}`);
  }

  scheduleAuthSync();
  try {
    const { waitForCloudflareClearance } = await import("../providers/chatgpt/cloudflare-challenge.mjs");
    await waitForCloudflareClearance(page, { maxMs: 45_000 });
  } catch {}
  return { ok: true };
}

export async function handleChatGPTLiveStream(req, res) {
  res.writeHead(200, {
    "Content-Type": `multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`,
    "Cache-Control": "no-cache, no-store",
    Connection: "keep-alive",
  });

  let closed = false;
  const onClose = () => { closed = true; };
  req.on("close", onClose);
  req.on("aborted", onClose);

  let proxy;
  try {
    proxy = await prepareChatGPTPanelPage();
  } catch {
    try { res.end(); } catch {}
    return;
  }

  const page = proxy.getPage();
  while (!closed) {
    try {
      const buf = await page.screenshot({ type: "jpeg", quality: 60, timeout: 15_000 });
      res.write(`--${MJPEG_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`);
      res.write(buf);
      res.write("\r\n");
    } catch {
      if (closed) break;
      await sleep(400);
    }
    await sleep(LIVE_FRAME_INTERVAL_MS);
  }

  try { res.end(); } catch {}
}

export function renderEmbedChatGPTLiveHtml() {
  const defaults = CHATGPT_PANEL_VIEWPORT;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ChatGPT</title>
  <style>
    :root { color-scheme: dark; --bg:#0e1116; --panel:#161a23; --line:rgba(255,255,255,.1); --text:#edf1f7; --muted:#8b96a7; --accent:#4d7cff; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; background: var(--bg); color: var(--text); overflow: hidden; }
    body { display: grid; grid-template-rows: auto minmax(0, 1fr); }
    .bar {
      display: flex; gap: 8px; align-items: center; padding: 8px 10px;
      border-bottom: 1px solid var(--line); background: var(--panel); font-size: 11px;
    }
    .bar span { color: var(--muted); flex: 1; min-width: 0; }
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
    .screen {
      position: absolute;
      inset: 0;
    }
    #live {
      width: 100%; height: 100%; object-fit: fill;
      user-select: none; display: block; pointer-events: none;
    }
    #clickLayer {
      position: absolute; inset: 0; z-index: 2;
      cursor: crosshair; touch-action: none;
    }
    #live.err { opacity: .35; }
    .hint {
      position: absolute; bottom: 10px; left: 10px; right: 10px;
      padding: 8px 10px; border-radius: 8px; background: rgba(0,0,0,.55);
      font-size: 11px; color: var(--muted); pointer-events: none;
    }
    .hint.active { color: #b8d4ff; border: 1px solid rgba(77,124,255,.35); }
  </style>
</head>
<body>
  <header class="bar">
    <span id="status">Google Chrome внутри ai-free — кликните в экран и войдите вручную</span>
    <button type="button" class="btn" id="resetBtn">Сброс</button>
    <button type="button" class="btn" id="syncBtn">Синхронизировать</button>
    <button type="button" class="btn" id="reloadBtn">↻</button>
  </header>
  <div class="viewport" id="viewport">
    <div class="screen" id="screen">
      <img id="live" src="/api/chatgpt/live-stream" alt="ChatGPT live">
      <div id="clickLayer" title="Клик для фокуса"></div>
    </div>
    <div class="hint" id="hint">Настоящий Chrome (скрыт за экраном). Войдите и пройдите Cloudflare здесь — сессия сохранится в ~/.chatgpt-cli/auth.json</div>
  </div>
  <script>
    let VW = ${defaults.width};
    let VH = ${defaults.height};
    const live = document.getElementById("live");
    const clickLayer = document.getElementById("clickLayer");
    const screen = document.getElementById("screen");
    const viewportEl = document.getElementById("viewport");
    const statusEl = document.getElementById("status");
    const hintEl = document.getElementById("hint");
    let captureKeys = false;
    let streamNonce = Date.now();
    let viewportSyncTimer = null;

    function applyViewportSize(w, h) {
      if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return;
      VW = w;
      VH = h;
    }

    async function syncViewportSize() {
      const w = Math.max(280, Math.round(viewportEl.clientWidth));
      const h = Math.max(200, Math.round(viewportEl.clientHeight));
      if (w < 2 || h < 2) return;
      try {
        const r = await fetch("/api/chatgpt/live-viewport", {
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
      }, 120);
    }

    if (viewportEl && typeof ResizeObserver !== "undefined") {
      new ResizeObserver(scheduleViewportSync).observe(viewportEl);
    }
    window.addEventListener("load", scheduleViewportSync);
    scheduleViewportSync();
    window.addEventListener("message", (event) => {
      if (event.data?.type === "syncLiveViewport") scheduleViewportSync();
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
        const r = await fetch("/api/chatgpt/live-input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || data.ok === false) throw new Error(data.error || r.statusText);
        return data;
      } catch (err) {
        statusEl.textContent = "Ошибка ввода: " + err.message;
      }
    }

    clickLayer.addEventListener("click", (e) => {
      const pt = mapCoords(e);
      if (!pt) return;
      captureKeys = true;
      hintEl.classList.add("active");
      hintEl.textContent = "Клавиатура активна — печатайте, Enter — отправить";
      statusEl.textContent = "Клик (" + pt.x + ", " + pt.y + ")…";
      sendInput({ type: "click", x: pt.x, y: pt.y }).then(() => {
        statusEl.textContent = "Клик отправлен";
      });
    });

    clickLayer.addEventListener("wheel", (e) => {
      e.preventDefault();
      const pt = mapCoords(e) || { x: Math.round(VW / 2), y: Math.round(VH / 2) };
      sendInput({ type: "wheel", x: pt.x, y: pt.y, deltaY: e.deltaY });
    }, { passive: false });

    document.addEventListener("keydown", (e) => {
      if (!captureKeys) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Enter") {
        e.preventDefault();
        sendInput({ type: "key", key: "Enter" });
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        sendInput({ type: "key", key: "Backspace" });
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        sendInput({ type: "key", key: "Tab" });
        return;
      }
      if (e.key.length === 1) {
        e.preventDefault();
        sendInput({ type: "type", text: e.key });
      }
    });

    async function syncSession() {
      statusEl.textContent = "Синхронизация…";
      try {
        const r = await fetch("/api/chatgpt/sync-session", { method: "POST" });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || r.statusText);
        if (data.initializing) {
          statusEl.textContent = "Запускаю Chrome внутри панели…";
          hintEl.textContent = "Обычно 5–15 секунд. Отдельное окно Chrome не должно появляться.";
        } else if (data.ready) {
          statusEl.textContent = "Готово — сессия сохранена, можно писать в чат ai-free";
          hintEl.textContent = "Cookies и токен в ~/.chatgpt-cli/auth.json";
        } else if (data.challenge) {
          statusEl.textContent = "Cloudflare — отметьте «I'm human» кликом в экран";
          hintEl.textContent = "Кликните в чёрную область, затем по чекбоксу на скрине.";
        } else if (data.recovering) {
          statusEl.textContent = "ChatGPT завис при загрузке — перезапускаю страницу…";
          hintEl.textContent = "Авторизация есть, интерфейс ещё не загрузился.";
        } else if (data.hasAuth) {
          statusEl.textContent = "Вход есть — жду интерфейс ChatGPT…";
          hintEl.textContent = "Если зависло — нажмите ↻ или «Синхронизировать».";
        } else {
          statusEl.textContent = "Войдите в ChatGPT в экране ниже";
          hintEl.textContent = "Google / email — как в обычном браузере. Сессия сохранится сама.";
        }
      } catch (err) {
        statusEl.textContent = "Sync: " + err.message;
      }
    }

    async function syncSessionQuiet() {
      try {
        const r = await fetch("/api/chatgpt/sync-session", { method: "POST" });
        const data = await r.json().catch(() => ({}));
        if (data.initializing) {
          statusEl.textContent = "Запускаю Chrome внутри панели…";
        } else if (!r.ok || data.ok === false) {
          statusEl.textContent = "Chrome: " + (data.error || "ошибка запуска — нажмите «Сброс»");
        } else if (data.ready) {
          statusEl.textContent = "ChatGPT готов — можно писать в чат";
          hintEl.textContent = "Авторизация и интерфейс ChatGPT готовы.";
        } else if (data.challenge) {
          statusEl.textContent = "Cloudflare ещё не пройден — завершите проверку";
        } else if (data.recovering) {
          statusEl.textContent = "ChatGPT завис при загрузке — перезапускаю страницу…";
        } else if (data.hasAuth) {
          statusEl.textContent = "Авторизация есть, жду интерфейс ChatGPT…";
        }
      } catch {}
    }

    syncSessionQuiet();
    setInterval(() => { syncSessionQuiet(); }, 4000);

    fetch("/api/chatgpt/warm", { method: "POST" }).catch(() => {});

    async function resetLiveSession() {
      statusEl.textContent = "Перезапуск…";
      try {
        const r = await fetch("/api/chatgpt/reset-live", { method: "POST" });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || r.statusText);
        statusEl.textContent = data.hint || "Готово";
        streamNonce = Date.now();
        live.src = "/api/chatgpt/live-stream?t=" + streamNonce;
      } catch (err) {
        statusEl.textContent = "Сброс: " + err.message;
      }
    }

    document.getElementById("resetBtn").addEventListener("click", resetLiveSession);
    document.getElementById("syncBtn").addEventListener("click", syncSession);
    document.getElementById("reloadBtn").addEventListener("click", async () => {
      statusEl.textContent = "Перезагружаю страницу ChatGPT…";
      try {
        const r = await fetch("/api/chatgpt/reload-live", { method: "POST" });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || r.statusText);
        statusEl.textContent = data.ready ? "ChatGPT готов" : "Страница перезагружена, ожидаю интерфейс…";
      } catch (err) {
        statusEl.textContent = "Перезагрузка: " + err.message;
      }
      streamNonce = Date.now();
      live.classList.remove("err");
      live.src = "/api/chatgpt/live-stream?t=" + streamNonce;
    });

    live.addEventListener("error", () => {
      live.classList.add("err");
      statusEl.textContent = "Стрим недоступен — нажмите ↻";
    });
  </script>
</body>
</html>`;
}
