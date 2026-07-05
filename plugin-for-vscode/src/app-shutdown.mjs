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
  const { stopAllTasks } = await import("./window-app/task-runner.mjs");
  const count = stopAllTasks();
  if (count > 0) logStep(`   • остановлено задач: ${count}`);
}

async function closeBrowserSessions() {
  const { closeChatGPTBrowserProxy } = await import("./providers/chatgpt/browser-proxy.mjs");
  const { closeQwenBrowserProxy } = await import("./providers/qwen/browser-proxy.mjs");
  const { closeInAppBrowser } = await import("./window-app/in-app-browser.mjs");
  const { closeWebBrowser } = await import("./window-app/web-browser.mjs");
  const { closeAppWindowShell } = await import("./window-app/app-window.mjs");
  await Promise.all([closeChatGPTBrowserProxy(), closeQwenBrowserProxy(), closeInAppBrowser(), closeWebBrowser(), closeAppWindowShell()]);
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
    try {
      logStep("⏹ Останавливаем ai-free…");
      setPhase(PHASES.stopping_tasks);
      logStep("   • останавливаем фоновые задачи…");
      await abortAllTasks();

      setPhase(PHASES.closing_browsers);
      logStep("   • закрываем Chrome (ChatGPT / Qwen)…");
      await closeBrowserSessions();

      setPhase(PHASES.stopped);
      logStep("✅ Остановлено.");
      await sleep(1200);

      setPhase(PHASES.closing_server);
      logStep("   • останавливаем сервер чата…");
      if (typeof onServerClose === "function") {
        await new Promise((resolve) => {
          onServerClose(() => resolve());
        });
      }
    } catch (error) {
      logStep(`⚠️ Ошибка при остановке: ${error.message}`);
      setPhase(PHASES.stopped);
    }
  })();

  return shutdownPromise;
}
