// Общий браузер приложения: Web (для DeepSeek/Qwen) + ChatGPT (закреплён) + файлы workspace.

export function renderEmbedBrowserHtml({ root = "", defaultTab = "chatgpt" } = {}) {
  const safeRoot = JSON.stringify(String(root || ""));
  const safeDefault = JSON.stringify(defaultTab === "files" ? "files" : (defaultTab === "web" ? "web" : "chatgpt"));
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Browser</title>
  <style>
    :root { color-scheme: dark; --bg:#0e1116; --panel:#161a23; --line:rgba(255,255,255,.1); --text:#edf1f7; --muted:#8b96a7; --accent:#4d7cff; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; background: var(--bg); color: var(--text); overflow: hidden; }
    body { display: grid; grid-template-rows: auto minmax(0, 1fr); }
    .browserBar {
      display: flex; gap: 4px; align-items: center; padding: 6px 8px;
      border-bottom: 1px solid var(--line); background: var(--panel);
    }
    .tab {
      border: 1px solid var(--line); background: #1a1f27; color: var(--muted);
      border-radius: 6px 6px 0 0; padding: 6px 12px; font-size: 11px; font-weight: 700;
      cursor: pointer; white-space: nowrap;
    }
    .tab.active { color: var(--text); border-color: rgba(77,124,255,.45); background: rgba(77,124,255,.12); }
    .tab.pinned::before { content: "📌 "; font-size: 10px; }
    .tabSpacer { flex: 1; min-width: 8px; }
    .iconBtn {
      border: 1px solid var(--line); background: #1a1f27; color: var(--text);
      border-radius: 6px; padding: 5px 10px; cursor: pointer; font-size: 12px;
    }
    .iconBtn:hover { border-color: var(--accent); }
    iframe { width: 100%; height: 100%; min-height: 0; border: 0; background: var(--bg); display: block; }
    .frameWrap { min-height: 0; overflow: hidden; }
  </style>
</head>
<body>
  <header class="browserBar">
    <button type="button" class="tab pinned" id="tabChatgpt" data-tab="chatgpt">ChatGPT</button>
    <button type="button" class="tab" id="tabWeb" data-tab="web">🌐 Web</button>
    <button type="button" class="tab" id="tabFiles" data-tab="files">📁 Файлы</button>
    <span class="tabSpacer"></span>
    <button type="button" class="iconBtn" id="reloadBtn" title="Reload">↻</button>
  </header>
  <div class="frameWrap">
    <iframe id="browserFrame" title="Browser"></iframe>
  </div>
  <script>
    let workspaceRoot = ${safeRoot};
    const WEB_LIVE = "/embed/web-live";
    const CHATGPT_LIVE = "/embed/chatgpt-live";
    const frame = document.getElementById("browserFrame");
    const tabWeb = document.getElementById("tabWeb");
    const tabChatgpt = document.getElementById("tabChatgpt");
    const tabFiles = document.getElementById("tabFiles");
    let currentTab = ${safeDefault};
    let userPickedTab = false;

    function tabSrc(tab) {
      if (tab === "web") return WEB_LIVE;
      if (tab === "chatgpt") return CHATGPT_LIVE;
      const root = workspaceRoot || "/";
      return "/embed/workspace?root=" + encodeURIComponent(root);
    }

    function setTab(tab, { forceReload = false } = {}) {
      if (!["web", "chatgpt", "files"].includes(tab)) tab = "chatgpt";
      const nextSrc = tabSrc(tab);
      const sameTab = tab === currentTab;
      if (sameTab && !forceReload && frame.src && frame.src.includes(nextSrc.split("?")[0])) {
        tabWeb.classList.toggle("active", tab === "web");
        tabChatgpt.classList.toggle("active", tab === "chatgpt");
        tabFiles.classList.toggle("active", tab === "files");
        return;
      }
      currentTab = tab;
      tabWeb.classList.toggle("active", tab === "web");
      tabChatgpt.classList.toggle("active", tab === "chatgpt");
      tabFiles.classList.toggle("active", tab === "files");
      if (tab === "chatgpt") {
        fetch("/api/chatgpt/warm", { method: "POST" }).catch(() => {});
      }
      if (tab === "web") {
        fetch("/api/browser/warm", { method: "POST" }).catch(() => {});
      }
      frame.src = nextSrc;
    }

    function pickTab(tab) {
      userPickedTab = true;
      setTab(tab);
    }

    tabWeb.addEventListener("click", () => pickTab("web"));
    tabChatgpt.addEventListener("click", () => pickTab("chatgpt"));
    tabFiles.addEventListener("click", () => pickTab("files"));
    document.getElementById("reloadBtn").addEventListener("click", () => setTab(currentTab, { forceReload: true }));

    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "setWorkspaceRoot") {
        workspaceRoot = String(data.root || "");
        if (currentTab === "files") setTab("files", { forceReload: true });
      }
      if (data.type === "focusBrowserTab" && data.tab) {
        if (data.force || !userPickedTab) setTab(String(data.tab));
      }
      if (data.type === "syncLiveViewport") {
        frame.contentWindow?.postMessage({ type: "syncLiveViewport" }, "*");
      }
    });

    setTab(currentTab);
  </script>
</body>
</html>`;
}
