// Единое graceful-shutdown: фоновые задачи, браузеры ChatGPT/Qwen, HTTP-сервер.

import { APP_WINDOW_PROFILE } from "./window-app/app-window.mjs";
import { CHATGPT_BROWSER_PROFILE } from "./providers/chatgpt/config.mjs";
import { QWEN_BROWSER_PROFILE } from "./providers/qwen/config.mjs";
import { killStaleChromeForProfile } from "./providers/chatgpt/browser-login.mjs";

const PHASES = {
  idle: "idle",
  stopping_tasks: "stopping_tasks",
  closing_browsers: "closing_browsers",
  closing_server: "closing_server",
  stopped: "stopped",
};

let state = {
  active: false,
  phase: PHASES.idle,
  source: null,
  startedAt: null,
};

let shutdownPromise = null;
let onServerClose = null;

export function getShutdownStatus() {
  return { ...state };
}

export function registerShutdownServerCloser(fn) {
  onServerClose = fn;
}

function setPhase(phase) {
  state.phase = phase;
}

function logStep(message) {
  console.log(message);
}

async function abortAllTasks() {
  const { stopAllTasks, waitForAllTasks } = await import("./window-app/task-runner.mjs");
  const count = stopAllTasks({ shutdown: true });
  if (count > 0) logStep(`   • остановлено задач: ${count}`);
  if (!await waitForAllTasks()) logStep("   • задачи ещё завершаются; закрываем их transports");
}

async function closeBrowserSessions() {
  const { closeChatGPTBrowserProxy } = await import("./providers/chatgpt/browser-proxy.mjs");
  const { closeQwenBrowserProxy } = await import("./providers/qwen/browser-proxy.mjs");
  const { closeGoogleAIBrowserProxy } = await import("./providers/google-ai/browser-proxy.mjs");
  const { closeGLMBrowserProxy } = await import("./providers/glm/browser-proxy.mjs");
  const { closeInAppBrowser } = await import("./window-app/in-app-browser.mjs");
  const { closeWebBrowser } = await import("./window-app/web-browser.mjs");
  const { closeAppWindowShell } = await import("./window-app/app-window.mjs");
  const closed = await Promise.allSettled([
    closeChatGPTBrowserProxy(),
    closeQwenBrowserProxy(),
    closeGoogleAIBrowserProxy(),
    closeGLMBrowserProxy(),
    closeInAppBrowser(),
    closeWebBrowser(),
    closeAppWindowShell(),
  ]);
  for (const result of closed) if (result.status === "rejected") logStep(`⚠️ Закрытие браузера: ${result.reason?.message || result.reason}`);
  const { backgroundBrowserPool } = await import("./browser/session-pool.mjs");
  await backgroundBrowserPool.closeAll();
  await sleep(300);
  const killedChat = killStaleChromeForProfile(CHATGPT_BROWSER_PROFILE);
  const killedQwen = killStaleChromeForProfile(QWEN_BROWSER_PROFILE);
  const killedShell = killStaleChromeForProfile(APP_WINDOW_PROFILE);
  if (killedChat || killedQwen || killedShell) {
    logStep("   • завершены оставшиеся процессы Chrome");
  }
  await sleep(400);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function requestAppShutdown({ source = "unknown" } = {}) {
  if (shutdownPromise) return shutdownPromise;
  state = {
    active: true,
    phase: PHASES.stopping_tasks,
    source,
    startedAt: Date.now(),
  };

  shutdownPromise = (async () => {
    logStep("⏹ Останавливаем ai-free…");
    for (const [phase, close] of [
      [PHASES.stopping_tasks, abortAllTasks],
      [PHASES.closing_browsers, closeBrowserSessions],
      [PHASES.closing_server, async () => {
        if (typeof onServerClose === "function") await new Promise((resolve, reject) => {
          try { Promise.resolve(onServerClose(resolve)).catch(reject); } catch (error) { reject(error); }
        });
      }],
    ]) {
      setPhase(phase);
      try { await close(); }
      catch (error) { logStep(`⚠️ Ошибка при остановке: ${error.message}`); }
    }
    setPhase(PHASES.stopped);
    logStep("✅ Остановлено.");
  })();

  return shutdownPromise;
}
