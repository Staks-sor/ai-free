// Огромный HTML-шаблон окна чатов: layout и фронтенд JS.
// Стили вынесены в ./ui-styles.mjs.
// Самодостаточный — никаких внешних зависимостей и шаблонизации.
//
// При изменении: тест — открыть localhost:4317, проверить, что сайдбар, чат,
// модалки (Settings, New chat, файловый браузер) рендерятся и работают.

import { STYLES } from "./ui-styles.mjs";
import { AI_FREE_VERSION } from "../config.mjs";
import { createTranslator, resolveUserLanguage } from "../i18n/index.mjs";
import { COMMAND_DESCRIPTIONS } from "../i18n/command-descriptions.mjs";

export function renderWindowHtml({ language: requestedLanguage = "", ui = {} } = {}) {
  const { language, messages, t } = createTranslator(resolveUserLanguage(requestedLanguage));
  const i18nPayload = JSON.stringify({ language, messages, ui, commandDescriptions: COMMAND_DESCRIPTIONS });
  return `<!doctype html>
<html lang="${language.code}" dir="${language.dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI Free v${AI_FREE_VERSION}</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="sideHead">
        <div class="brand">${t("app.workspace")}</div>
        <button id="refreshBtn" class="iconBtn" title="${t("app.refresh")}">↻</button>
      </div>
      <button id="openNewChat" class="iconBtn newChatBtn" type="button">${t("app.newChat")}</button>

      <div id="newChatOverlay" class="settingsOverlay hidden" aria-hidden="true">
        <div class="settingsPanel" role="dialog" aria-modal="true" aria-labelledby="newChatTitle">
          <div class="settingsHead">
             <h2 id="newChatTitle">${t("newChat.title")}</h2>
             <button id="newChatClose" class="iconBtn" type="button" aria-label="${t("app.close")}">✕</button>
          </div>
          <form id="newForm" class="newForm" autocomplete="off">
            <div class="formField">
              <span>${t("newChat.provider")}</span>
              <div class="providerPicker" id="newChatProvider">
                <!-- кнопки рендерятся динамически по ответу /api/providers -->
              </div>
            </div>

            <div class="formField">
              <span>${t("newChat.mode")}</span>
              <div class="modePicker" id="newChatMode">
                <!-- кнопки режимов рендерятся динамически в зависимости от выбранного провайдера -->
              </div>
              <div class="modeHint">${t("newChat.modeHint")}</div>
            </div>

            <label class="formField">
              <span>${t("newChat.chatTitle")}</span>
              <input id="newTitle" placeholder="${t("newChat.chatTitlePlaceholder")}" autocomplete="off">
            </label>

            <div class="formField">
              <span>${t("newChat.workspace")}</span>
              <div class="pathRow">
                <input id="newWorkspace" placeholder="${t("newChat.workspacePlaceholder")}" autocomplete="off">
                <button type="button" id="browseBtn" class="iconBtn">${t("newChat.browse")}</button>
              </div>
            </div>

            <div id="browseSection" class="browseSection hidden">
              <div class="browsePath" id="browsePath"></div>
              <div class="browseControls">
                <button type="button" id="browseUp" class="iconBtn">${t("newChat.up")}</button>
                <button type="button" id="browseHome" class="iconBtn">${t("newChat.home")}</button>
                <button type="button" id="browseNewFolder" class="iconBtn">${t("newChat.newFolder")}</button>
                <label class="checkboxRow inline">
                  <input type="checkbox" id="browseShowHidden">
                  <span>${t("newChat.hidden")}</span>
                </label>
                <button type="button" id="browsePick" class="iconBtn primaryBtn">${t("newChat.pickFolder")}</button>
              </div>
              <div id="createFolderRow" class="createFolderRow hidden">
                <input id="createFolderInput" placeholder="${t("newChat.newFolderPlaceholder")}" autocomplete="off">
                <button type="button" id="createFolderConfirm" class="iconBtn primaryBtn">${t("newChat.create")}</button>
                <button type="button" id="createFolderCancel" class="iconBtn">${t("newChat.cancel")}</button>
              </div>
              <div id="createFolderError" class="formError hidden"></div>
              <div id="browseCount" class="browseCount hidden"></div>
              <div id="browseList" class="browseList">${t("app.loading")}</div>
              <div id="browseTruncated" class="browseTruncated hidden">${t("newChat.truncated")}</div>
            </div>

            <div id="recentProjects" class="recentProjects"></div>

            <label class="checkboxRow">
              <input id="newCreateFolder" type="checkbox">
              <span>${t("newChat.createFolder")}</span>
            </label>

            <div class="formActions">
              <button type="submit" class="iconBtn primaryBtn">${t("newChat.submit")}</button>
            </div>
            <div id="newFormError" class="formError hidden"></div>
          </form>
        </div>
      </div>
      <div id="chatList" class="chatList"></div>
    </aside>
      <div id="sidebarResizer" class="sidebarResizer" title="${t("app.resizeChats")}"></div>
    <main class="main">
      <header class="topbar">
        <div id="activeTitleRow" class="titleRow topbarTitle">
          <div id="activeTitle" class="title">${t("app.noChat")}</div>
          <div id="workspace" class="workspace"></div>
        </div>
        <div class="topbarControls">
          <span id="activeMode" class="modeBadge hidden"></span>
          <select id="modelPicker" class="modelPicker hidden" title="${t("topbar.model")}"></select>
          <select id="rolePicker" class="rolePicker hidden" title="${t("topbar.role")}"></select>
          <button id="coderToggle" class="coderToggle hidden" type="button" title="${t("topbar.coderTitle")}">🛠 Coder</button>
          <button id="hardwareToggle" class="coderToggle hardwareToggle hidden" type="button" title="${t("topbar.hardwareTitle")}">ESP</button>
          <button id="pipelineToggle" class="coderToggle pipelineToggle hidden" type="button" title="${t("topbar.pipelineTitle")}">${t("topbar.pipeline")}</button>
          <button id="pipelinePanelBtn" class="iconBtn pipelinePanelBtn" type="button" title="${t("topbar.flowTitle")}">${t("topbar.flow")}</button>
        </div>
        <div class="topbarActions">
          <button id="themeBtn" class="iconBtn themeBtn" type="button" title="${t("topbar.theme")}">◐</button>
          <button id="settingsBtn" class="iconBtn settingsBtn" type="button" title="${t("topbar.settings")}">⚙</button>
          <button id="quitBtn" class="iconBtn quitBtn" type="button" title="${t("topbar.quit")}">⏻</button>
        </div>
      </header>

      <div id="shutdownOverlay" class="shutdownOverlay hidden" aria-hidden="true">
        <div class="shutdownPanel">
          <div id="shutdownTitle" class="shutdownTitle">${t("shutdown.gracefulTitle")}</div>
          <div id="shutdownSub" class="shutdownSub">${t("shutdown.stoppingTasks")}</div>
        </div>
      </div>

      <div id="settingsOverlay" class="settingsOverlay hidden" aria-hidden="true">
        <div class="settingsPanel" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
          <div class="settingsHead">
            <h2 id="settingsTitle">${t("settings.title")}</h2>
            <button id="settingsClose" class="iconBtn" type="button" aria-label="${t("app.close")}">✕</button>
          </div>
          <div id="settingsBody" class="settingsBody">${t("app.loading")}</div>
        </div>
      </div>
      <div id="pipelinePanel" class="pipelinePanel hidden" aria-hidden="true">
        <div class="pipelineHead">
          <div>
            <div class="pipelineTitle">${t("pipeline.title")}</div>
            <div class="pipelineSub">${t("pipeline.sub")}</div>
          </div>
          <button id="pipelineClose" class="iconBtn" type="button" aria-label="${t("app.close")}">✕</button>
        </div>
        <div id="pipelineBody" class="pipelineBody"></div>
      </div>
      <section id="messages" class="messages">
        <div class="empty">${t("app.createChatHint")}</div>
      </section>
      <div id="composerResizer" class="composerResizer" title="${t("app.resizeComposer")}"></div>
      <div class="bottomBar">
        <form id="composer" class="composer">
          <div id="attachmentList" class="attachmentList"></div>
          <textarea id="messageInput" placeholder="${t("composer.chooseChat")}" disabled></textarea>
          <input type="file" id="fileInput" multiple style="display:none">
          <div class="composerControls">
            <button type="button" id="toggleThinking" class="togglePill" title="${t("composer.thinkingTitle")}">${t("composer.thinking")}</button>
            <button type="button" id="toggleSearch" class="togglePill" title="${t("composer.searchTitle")}">${t("composer.search")}</button>
            <button type="button" id="attachBtn" class="togglePill attachBtn" title="${t("composer.attachTitle")}">${t("composer.attach")}</button>
            <button type="button" id="voiceBtn" class="togglePill voiceBtn" title="${t("composer.voiceTitle")}">${t("composer.voice")}</button>
            <div class="composerSpacer"></div>
            <button type="button" id="stopBtn" class="stopBtn hidden" title="${t("composer.stopTitle")}">${t("composer.stop")}</button>
            <button id="sendBtn" class="sendBtn" type="submit" disabled>↑</button>
          </div>
        </form>
        <div id="status" class="status"></div>
      </div>
    </main>
  </div>

  <script>
    const I18N = ${i18nPayload};
    function t(key, vars = {}) {
      const template = (I18N.messages && I18N.messages[key]) || key;
      return String(template).replace(/\\{([a-zA-Z0-9_]+)\\}/g, (match, name) => (
        Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
      ));
    }
    // alert в webview может быть заблокирован, поэтому дублируем его в status bar.
    window.alert = function(msg) {
      console.warn("[Alert override]:", msg);
      const el = document.getElementById("status");
      if (el) {
        el.textContent = msg;
        el.className = "status error";
      }
    };

    // Безопасная обёртка для localStorage в условиях песочницы VS Code Webview
    const safeStorage = {
      _data: {},
      getItem(key) {
        try {
          return window.localStorage.getItem(key);
        } catch (e) {
          return this._data[key] || null;
        }
      },
      setItem(key, value) {
        try {
          window.localStorage.setItem(key, value);
        } catch (e) {
          this._data[key] = String(value);
        }
      }
    };
    const localStorage = safeStorage;

    let appState = { conversations: [], activeConversationId: null, workspaceRoot: "" };
    let activeConversation = null;
    let sending = false;

    const chatList = document.getElementById("chatList");
    const appShell = document.querySelector(".app");
    const sidebarResizer = document.getElementById("sidebarResizer");
    const messages = document.getElementById("messages");
    const activeTitle = document.getElementById("activeTitle");
    const workspace = document.getElementById("workspace");
    const statusEl = document.getElementById("status");
    const messageInput = document.getElementById("messageInput");
    const sendBtn = document.getElementById("sendBtn");
    const stopBtn = document.getElementById("stopBtn");
    if (stopBtn) stopBtn.addEventListener("click", () => stopActiveConversation());
    const pipelinePanel = document.getElementById("pipelinePanel");
    const pipelineBody = document.getElementById("pipelineBody");
    const pipelinePanelBtn = document.getElementById("pipelinePanelBtn");
    const pipelineClose = document.getElementById("pipelineClose");
    const SIDEBAR_WIDTH_KEY = "deepseek.sidebarWidth";
    const COMPOSER_HEIGHT_KEY = "deepseek.composerHeight";
    const THEME_KEY = "deepseek.theme";
    const THEMES = [
      { id: "dark", label: t("theme.dark"), icon: "◐" },
      { id: "light", label: t("theme.light"), icon: "☼" },
      { id: "contrast", label: t("theme.contrast"), icon: "◑" },
    ];

    setupTheme();
    applySavedSidebarWidth();
    setupSidebarResize();
    applySavedComposerHeight();
    setupComposerResize();

    document.getElementById("refreshBtn").addEventListener("click", loadState);
    // ---- New chat modal ----
    const newChatOverlay = document.getElementById("newChatOverlay");
    const openNewChatBtn = document.getElementById("openNewChat");
    const newChatClose = document.getElementById("newChatClose");
    const newTitleInput = document.getElementById("newTitle");
    const newWorkspaceInput = document.getElementById("newWorkspace");
    const newCreateFolder = document.getElementById("newCreateFolder");
    const newFormError = document.getElementById("newFormError");
    const recentProjects = document.getElementById("recentProjects");
    let browseDefaultPath = "";

    openNewChatBtn.addEventListener("click", openNewChatModal);
    newChatClose.addEventListener("click", closeNewChatModal);
    newChatOverlay.addEventListener("click", (e) => {
      if (e.target === newChatOverlay) closeNewChatModal();
    });

    async function openNewChatModal() {
      await refreshModelCatalog();
      await refreshAvailableProviders();
      renderProviderPicker();
      renderModePickerForProvider();
      newFormError.classList.add("hidden");
      newFormError.textContent = "";
      newTitleInput.value = "";
      newCreateFolder.checked = false;
      recentProjects.innerHTML = "";
      newChatOverlay.classList.remove("hidden");
      newChatOverlay.setAttribute("aria-hidden", "false");
      // Подтягиваем список ранее использованных проектов.
      try {
        const data = await api("/api/projects");
        browseDefaultPath = data.defaultWorkspace || data.home || "";
        newWorkspaceInput.value = browseDefaultPath;
        for (const project of data.projects || []) {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "chip" + (project.exists ? "" : " missing");
          chip.title = project.path + (project.isDefault ? " (" + t("newChat.defaultProject") + ")" : "");
          chip.textContent = project.name + (project.isDefault ? " ★" : "");
          chip.addEventListener("click", () => { newWorkspaceInput.value = project.path; });
          recentProjects.appendChild(chip);
        }
      } catch {
        // не критично — просто не покажем список
      }
      newTitleInput.focus();
    }
    function closeNewChatModal() {
      newChatOverlay.classList.add("hidden");
      newChatOverlay.setAttribute("aria-hidden", "true");
    }

    // ---- Folder browser inside new chat modal ----
    const browseBtn = document.getElementById("browseBtn");
    const browseSection = document.getElementById("browseSection");
    const browsePath = document.getElementById("browsePath");
    const browseUp = document.getElementById("browseUp");
    const browseHome = document.getElementById("browseHome");
    const browsePick = document.getElementById("browsePick");
    const browseList = document.getElementById("browseList");
    const browseShowHidden = document.getElementById("browseShowHidden");
    const browseTruncated = document.getElementById("browseTruncated");
    const browseCount = document.getElementById("browseCount");

    let currentBrowsePath = null;
    let currentBrowseParent = null;
    let browseHome_ = null;

    browseBtn.addEventListener("click", async () => {
      if (browseSection.classList.contains("hidden")) {
        browseSection.classList.remove("hidden");
        // Стартуем с пути в поле, иначе — workspace по умолчанию (cwd при запуске CLI).
        const start = newWorkspaceInput.value.trim() || browseDefaultPath || null;
        await navigateBrowse(start);
      } else {
        browseSection.classList.add("hidden");
      }
    });

    browseUp.addEventListener("click", () => {
      if (currentBrowseParent) navigateBrowse(currentBrowseParent);
    });
    browseHome.addEventListener("click", () => navigateBrowse(browseHome_));
    browsePick.addEventListener("click", () => {
      if (currentBrowsePath) {
        newWorkspaceInput.value = currentBrowsePath;
        browseSection.classList.add("hidden");
      }
    });
    browseShowHidden.addEventListener("change", () => {
      if (currentBrowsePath) navigateBrowse(currentBrowsePath);
    });

    // ---- Create new folder inline ----
    const browseNewFolder = document.getElementById("browseNewFolder");
    const createFolderRow = document.getElementById("createFolderRow");
    const createFolderInput = document.getElementById("createFolderInput");
    const createFolderConfirm = document.getElementById("createFolderConfirm");
    const createFolderCancel = document.getElementById("createFolderCancel");
    const createFolderError = document.getElementById("createFolderError");

    function showCreateFolderRow() {
      createFolderError.classList.add("hidden");
      createFolderError.textContent = "";
      createFolderInput.value = "";
      createFolderRow.classList.remove("hidden");
      createFolderInput.focus();
    }
    function hideCreateFolderRow() {
      createFolderRow.classList.add("hidden");
      createFolderError.classList.add("hidden");
    }

    browseNewFolder.addEventListener("click", showCreateFolderRow);
    createFolderCancel.addEventListener("click", hideCreateFolderRow);
    createFolderInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        createFolderConfirm.click();
      } else if (e.key === "Escape") {
        hideCreateFolderRow();
      }
    });

    createFolderConfirm.addEventListener("click", async () => {
      const name = createFolderInput.value.trim();
      if (!name) {
        createFolderError.textContent = t("newChat.emptyFolderName");
        createFolderError.classList.remove("hidden");
        return;
      }
      if (!currentBrowsePath) return;
      createFolderError.classList.add("hidden");
      try {
        const data = await api("/api/browse/mkdir", {
          method: "POST",
          body: { parent: currentBrowsePath, name },
        });
        hideCreateFolderRow();
        // Сразу заходим в созданную папку — обычно юзер хочет именно это.
        await navigateBrowse(data.path);
      } catch (err) {
        createFolderError.textContent = err.message;
        createFolderError.classList.remove("hidden");
      }
    });

    async function navigateBrowse(targetPath) {
      browseList.textContent = t("app.loadingShort");
      browseTruncated.classList.add("hidden");
      browseCount.classList.add("hidden");
      try {
        const params = new URLSearchParams();
        if (targetPath) params.set("path", targetPath);
        params.set("hidden", browseShowHidden.checked ? "1" : "0");
        const data = await api("/api/browse?" + params.toString());
        currentBrowsePath = data.path;
        currentBrowseParent = data.parent;
        browseHome_ = data.home;
        if (data.defaultWorkspace && !browseDefaultPath) {
          browseDefaultPath = data.defaultWorkspace;
        }
        browsePath.textContent = data.path;
        browseUp.disabled = !data.parent;
        browseList.innerHTML = "";
        const total = data.totalDirectories ?? data.entries.length;
        const shown = data.entries.length;
        if (total > 0) {
          browseCount.textContent = shown === total
            ? t("newChat.folderCount", { total, suffix: browseShowHidden.checked ? "" : t("newChat.hiddenSuffix") })
            : t("newChat.folderShown", { shown, total });
          browseCount.classList.remove("hidden");
        }
        if (!data.entries.length) {
          const empty = document.createElement("div");
          empty.className = "browseEmpty";
          empty.textContent = total > 0 && data.truncated
            ? t("newChat.tooManyFolders")
            : t("newChat.noSubfolders");
          browseList.appendChild(empty);
        } else {
          for (const entry of data.entries) {
            const row = document.createElement("button");
            row.type = "button";
            row.className = "browseRow";
            row.textContent = "📁  " + entry.name;
            row.title = entry.path;
            row.addEventListener("click", () => navigateBrowse(entry.path));
            browseList.appendChild(row);
          }
        }
        if (data.truncated) {
          browseTruncated.textContent =
            t("newChat.truncatedInline", { shown, total });
          browseTruncated.classList.remove("hidden");
        }
      } catch (err) {
        browseList.textContent = t("app.error", { message: err.message });
      }
    }

    document.getElementById("newForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const title = newTitleInput.value.trim();
      const workspace = newWorkspaceInput.value.trim();
      const createFolder = newCreateFolder.checked;
      newFormError.classList.add("hidden");
      newFormError.textContent = "";
      if (!availableProviders.includes(newChatSelectedProvider)) {
        await connectProvider(newChatSelectedProvider);
        if (!availableProviders.includes(newChatSelectedProvider)) {
          newFormError.textContent = t("provider.tokenMissing", { id: newChatSelectedProvider });
          newFormError.classList.remove("hidden");
          return;
        }
      }
      setStatus(t("newChat.creating"));
      try {
        const data = await api("/api/conversations", {
          method: "POST",
          body: {
            title,
            workspace,
            createFolder,
            mode: newChatSelectedMode,
            provider: newChatSelectedProvider,
            model: defaultModelForProviderMode(newChatSelectedProvider, newChatSelectedMode),
          },
        });
        activeConversation = data.conversation;
        await loadState(activeConversation.id);
        renderConversation(activeConversation);
        closeNewChatModal();
        setStatus("");
      } catch (err) {
        newFormError.textContent = err.message;
        newFormError.classList.remove("hidden");
        setStatus("");
      }
    });

    // ---- Toggle pills (Глубокое мышление / Умный поиск) ----
    // Тумблеры — per-message, sticky через localStorage.
    // Mode (Fast/Expert/Vision) теперь выбирается ТОЛЬКО при создании чата —
    // переключать посреди разговора нельзя (DeepSeek API завязывает chain на одну модель).
    const THINKING_KEY = "deepseek.composer.thinking";
    const SEARCH_KEY = "deepseek.composer.search.v2";
    const NEWCHAT_MODE_KEY = "deepseek.newchat.mode";

    const toggleThinking = document.getElementById("toggleThinking");
    const toggleSearch = document.getElementById("toggleSearch");

    let thinkingActive = localStorage.getItem(THINKING_KEY) === "1";
    const savedSearch = localStorage.getItem(SEARCH_KEY);
    let searchActive = savedSearch === null ? I18N.ui?.webSearchDefault !== false : savedSearch === "1";

    function applyToggleUI() {
      toggleThinking.classList.toggle("active", thinkingActive);
      toggleSearch.classList.toggle("active", searchActive);
    }
    applyToggleUI();

    toggleThinking.addEventListener("click", () => {
      thinkingActive = !thinkingActive;
      localStorage.setItem(THINKING_KEY, thinkingActive ? "1" : "0");
      applyToggleUI();
    });

    toggleSearch.addEventListener("click", () => {
      searchActive = !searchActive;
      localStorage.setItem(SEARCH_KEY, searchActive ? "1" : "0");
      applyToggleUI();
    });

    // ---- File attachments ----
    // Стратегия: читаем КАК ТЕКСТ всё, что приходит. Бинари (изображения, PDF, exe)
    // дают мусор в декодировке — определяем по доле непечатных символов и null-байтов.
    // Если файл реально текст любого происхождения (.config, без расширения,
    // кириллица в имени, кастомное расширение) — пропускаем.
    const MAX_FILE_BYTES = 500 * 1024; // 500 КБ — чтоб не утопить контекст
    // Заведомо бинарные форматы — отказываем сразу, без чтения.
    const BINARY_EXTENSIONS = new Set([
      "png","jpg","jpeg","gif","webp","bmp","tiff","tif","heic","heif","svg",
      "mp3","wav","ogg","flac","m4a","aac",
      "mp4","mov","avi","mkv","webm","wmv",
      "pdf","doc","docx","xls","xlsx","ppt","pptx","odt","ods","odp",
      "zip","tar","gz","7z","rar","bz2","xz",
      "exe","dll","so","dylib","bin","class","jar","war","apk","ipa",
      "psd","ai","sketch","fig",
      "ttf","otf","woff","woff2","eot",
    ]);

    let attachments = []; // [{ name, size, content }]
    const fileInput = document.getElementById("fileInput");
    const attachBtn = document.getElementById("attachBtn");
    const voiceBtn = document.getElementById("voiceBtn");
    const attachmentList = document.getElementById("attachmentList");

    attachBtn.addEventListener("click", () => fileInput.click());

    let voiceAudioContext = null;
    let voiceSource = null;
    let voiceProcessor = null;
    let voiceStream = null;
    let voiceChunks = [];
    let voiceSampleRate = 44100;
    let voiceRecording = false;

    voiceBtn.addEventListener("click", () => {
      if (voiceRecording) {
        stopVoiceRecording();
      } else {
        startVoiceRecording().catch((error) => setStatus(error.message, true));
      }
    });

    async function startVoiceRecording() {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!navigator.mediaDevices?.getUserMedia || !AudioContextClass) {
        throw new Error(t("composer.voiceUnsupported"));
      }
      let status = await api("/api/voice/status");
      if (!status.helperAvailable || !status.modelAvailable) {
        setStatus(t("composer.voiceInstalling"));
        status = await api("/api/voice/install", { method: "POST" });
        if (!status.helperAvailable || !status.modelAvailable) {
          throw new Error(t("composer.voiceMissing", { path: status.helper || "" }));
        }
      }
      voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceChunks = [];
      voiceAudioContext = new AudioContextClass();
      voiceSampleRate = voiceAudioContext.sampleRate || 44100;
      voiceSource = voiceAudioContext.createMediaStreamSource(voiceStream);
      voiceProcessor = voiceAudioContext.createScriptProcessor(4096, 1, 1);
      voiceProcessor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        voiceChunks.push(new Float32Array(input));
      };
      voiceSource.connect(voiceProcessor);
      voiceProcessor.connect(voiceAudioContext.destination);
      voiceRecording = true;
      voiceBtn.classList.add("active");
      voiceBtn.textContent = t("composer.voiceStop");
      setStatus(t("composer.voiceRecording"));
    }

    function stopVoiceRecording() {
      if (!voiceRecording) return;
      finishVoiceRecording().catch((error) => setStatus(error.message, true));
    }

    async function finishVoiceRecording() {
      voiceRecording = false;
      voiceBtn.classList.remove("active");
      voiceBtn.textContent = t("composer.voice");
      if (voiceProcessor) {
        voiceProcessor.disconnect();
        voiceProcessor.onaudioprocess = null;
      }
      if (voiceSource) voiceSource.disconnect();
      if (voiceStream) {
        for (const track of voiceStream.getTracks()) track.stop();
      }
      if (voiceAudioContext) await voiceAudioContext.close().catch(() => {});
      voiceProcessor = null;
      voiceSource = null;
      voiceStream = null;
      voiceAudioContext = null;
      const blob = encodeWavBlob(voiceChunks, voiceSampleRate);
      voiceChunks = [];
      if (!blob.size) {
        setStatus(t("composer.voiceNoSpeech"), true);
        return;
      }
      setStatus(t("composer.voiceTranscribing"));
      const dataBase64 = await blobToBase64(blob);
      const result = await api("/api/voice/transcribe", {
        method: "POST",
        body: {
          dataBase64,
          mimeType: blob.type || "audio/wav",
          language: "auto",
        },
      });
      const text = String(result.text || "").trim();
      if (!text) {
        setStatus(t("composer.voiceNoSpeech"), true);
        return;
      }
      insertComposerText(text);
      setStatus("");
    }

    function encodeWavBlob(chunks, sampleRate) {
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const pcm = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        pcm.set(chunk, offset);
        offset += chunk.length;
      }
      const buffer = new ArrayBuffer(44 + pcm.length * 2);
      const view = new DataView(buffer);
      writeAscii(view, 0, "RIFF");
      view.setUint32(4, 36 + pcm.length * 2, true);
      writeAscii(view, 8, "WAVE");
      writeAscii(view, 12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeAscii(view, 36, "data");
      view.setUint32(40, pcm.length * 2, true);
      let pos = 44;
      for (let i = 0; i < pcm.length; i += 1) {
        const sample = Math.max(-1, Math.min(1, pcm[i]));
        view.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        pos += 2;
      }
      return new Blob([buffer], { type: "audio/wav" });
    }

    function writeAscii(view, offset, text) {
      for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
    }

    function blobToBase64(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const value = String(reader.result || "");
          const comma = value.indexOf(",");
          resolve(comma >= 0 ? value.slice(comma + 1) : value);
        };
        reader.onerror = () => reject(reader.error || new Error("FileReader error"));
        reader.readAsDataURL(blob);
      });
    }

    function insertComposerText(text) {
      const current = messageInput.value;
      const separator = current.trim() ? "\\n" : "";
      messageInput.value = current + separator + text;
      messageInput.focus();
      autoGrowInput();
    }

    // Прочитать файл как base64 без падений на больших размерах (через FileReader).
    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          // result = "data:<mime>;base64,XXXX" — берём только base64-часть.
          const url = String(reader.result);
          const comma = url.indexOf(",");
          resolve(comma >= 0 ? url.slice(comma + 1) : url);
        };
        reader.onerror = () => reject(reader.error || new Error("FileReader error"));
        reader.readAsDataURL(file);
      });
    }

    fileInput.addEventListener("change", async (event) => {
      for (const file of event.target.files) {
        const ext = (file.name.split(".").pop() || "").toLowerCase();
        const visionImageExts = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
        const isImage = (file.type.startsWith("image/") && file.type !== "image/svg+xml")
          || visionImageExts.includes(ext);

        if (file.type === "image/svg+xml" || ext === "svg") {
          alert(t("file.svgUnsupported", { name: file.name }));
          continue;
        }

        if (isImage) {
          // Картинки — заливаем на DeepSeek. Рекомендуем ≤4 МБ (большие PNG часто дают CONTENT_EMPTY).
          if (file.size > 10 * 1024 * 1024) {
            alert(t("file.imageTooLarge", { name: file.name, mb: Math.round(file.size/1024/1024) }));
            continue;
          }
          if (file.size > 4 * 1024 * 1024) {
            const ok = confirm(
              t("file.largeImageConfirm", { name: file.name, mb: Math.round(file.size / 1024 / 1024) }),
            );
            if (!ok) continue;
          }
          try {
            const dataBase64 = await fileToBase64(file);
            attachments.push({
              name: file.name,
              size: file.size,
              kind: "image",
              mimeType: file.type || "image/png",
              dataBase64,
            });
          } catch (err) {
            alert(t("file.readFailed", { name: file.name, message: err.message }));
          }
          continue;
        }

        if (BINARY_EXTENSIONS.has(ext)) {
          alert(t("file.binaryUnsupported", { name: file.name, ext }));
          continue;
        }

        // Текстовый файл — читаем как UTF-8 и инлайним в промпт.
        if (file.size > MAX_FILE_BYTES) {
          alert(t("file.textTooLarge", { name: file.name, kb: Math.round(file.size/1024), limitKb: MAX_FILE_BYTES/1024 }));
          continue;
        }
        try {
          const content = await file.text();
          const sample = content.slice(0, 1000);
          let nonPrintable = 0;
          for (let i = 0; i < sample.length; i += 1) {
            const code = sample.charCodeAt(i);
            if (code === 0) { nonPrintable = sample.length; break; }
            if (code < 32 && code !== 9 && code !== 10 && code !== 13) nonPrintable += 1;
          }
          if (sample.length > 0 && nonPrintable / sample.length > 0.1) {
            alert(t("file.looksBinary", { name: file.name }));
            continue;
          }
          attachments.push({ name: file.name, size: file.size, kind: "text", content });
        } catch (err) {
          alert(t("file.readFailed", { name: file.name, message: err.message }));
        }
      }
      fileInput.value = "";
      renderAttachments();
    });

    function renderAttachments() {
      attachmentList.innerHTML = "";
      attachments.forEach((att, index) => {
        const chip = document.createElement("span");
        chip.className = "attachChip";
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = "📎 " + att.name;
        const size = document.createElement("span");
        size.className = "size";
        size.textContent = t("file.sizeKb", { kb: Math.round(att.size / 1024) });
        const remove = document.createElement("button");
        remove.className = "remove";
        remove.type = "button";
        remove.title = t("file.remove");
        remove.textContent = "✕";
        remove.addEventListener("click", () => {
          attachments.splice(index, 1);
          renderAttachments();
        });
        chip.append(name, size, remove);
        attachmentList.appendChild(chip);
      });
    }

    // Префикс из ТЕКСТОВЫХ файлов в начало промпта. Картинки идут через ref_file_ids,
    // их инлайнить в текст не надо.
    function buildAttachmentsPrefix(textAttachments) {
      if (!textAttachments.length) return "";
      const filePlural = textAttachments.length > 1
        ? (I18N.language.code === "ru" ? "ы" : "s")
        : "";
      const parts = [t("file.promptPrefix", { plural: filePlural })];
      for (const att of textAttachments) {
        const ext = (att.name.split(".").pop() || "").toLowerCase();
        parts.push("\\n--- " + t("file.promptHeader", { name: att.name, kb: Math.round(att.size/1024) }) + \` ---\\n\\\`\\\`\\\`\${ext}\\n\${att.content}\\n\\\`\\\`\\\`\`);
      }
      parts.push("\\n---\\n\\n" + t("file.promptQuestion"));
      return parts.join("\\n");
    }

    // Provider picker + Mode picker — оба зависят от провайдера, рендерятся динамически.
    // Provider определяет, какие модели доступны (DeepSeek: Fast/Expert/Vision;
    // Qwen: выбор модели в picker (см. QWEN_MODELS в config.mjs).
    const PROVIDER_PICK_KEY = "deepseek.newchat.provider";

    let PROVIDER_INFO = {
      deepseek: {
        label: "DeepSeek",
        sub: "chat.deepseek.com",
        defaultMode: "fast",
        modes: [
          { id: "fast", title: "DeepSeek v4 Flash", sub: t("provider.deepseekFast"), model: "deepseek-v4-flash" },
          { id: "expert", title: "DeepSeek v4 Pro", sub: t("provider.deepseekExpert"), model: "deepseek-v4-pro", reasoning: true },
          { id: "vision", title: "DeepSeek v4 Vision", sub: t("provider.deepseekVision"), model: "deepseek-v4-vision", vision: true },
        ],
        models: [
          { id: "deepseek-v4-flash", label: "DeepSeek v4 Flash" },
          { id: "deepseek-v4-pro", label: "DeepSeek v4 Pro", reasoning: true },
          { id: "deepseek-v4-vision", label: "DeepSeek v4 Vision" },
        ],
        defaultModel: "deepseek-v4-flash",
      },
      qwen: {
        label: "Qwen",
        sub: "chat.qwen.ai",
        defaultMode: "default",
        modes: [
          { id: "default", title: "Qwen Chat", sub: t("provider.qwenDefault"), model: "qwen3.7-plus" },
        ],
        models: [
          { id: "qwen3.7-plus",  label: "Qwen3.7 Plus" },
          { id: "qwen3.7-max",   label: "Qwen3.7 MAX" },
          { id: "qwen3.6-plus",  label: "Qwen3.6 Plus" },
          { id: "qwen3-max",     label: "Qwen3 Max" },
          { id: "qwen2.5-plus",  label: "Qwen 2.5 Plus" },
          { id: "qwq-32b",       label: "QwQ-32B (reasoning)" },
          { id: "qwen-vl-max",   label: "Qwen-VL Max (vision)" },
        ],
        defaultModel: "qwen3.7-plus",
      },
    };

    async function refreshModelCatalog() {
      try {
        const r = await fetch("/api/model-catalog");
        if (!r.ok) return;
        const j = await r.json();
        if (j && j.providers && typeof j.providers === "object") {
          PROVIDER_INFO = j.providers;
        }
      } catch {}
    }

    function defaultModelForProviderMode(providerId, modeId) {
      const info = PROVIDER_INFO[providerId] || PROVIDER_INFO.deepseek;
      const mode = (info.modes || []).find((item) => item.id === modeId);
      return mode?.model || info.defaultModel || info.models?.[0]?.id || "";
    }

    function findModelInfo(providerId, modelId) {
      const info = PROVIDER_INFO[providerId] || PROVIDER_INFO.deepseek;
      return (info.models || []).find((item) => item.id === modelId) || null;
    }

    const newChatProviderPicker = document.getElementById("newChatProvider");
    const newChatModePicker = document.getElementById("newChatMode");

    let availableProviders = ["deepseek"]; // подтянем с сервера через /api/providers
    let AGENT_ROLES = [
      { id: "assistant", label: t("role.assistant"), description: t("role.assistantDescription") },
    ];
    let newChatSelectedProvider = localStorage.getItem(PROVIDER_PICK_KEY) || "deepseek";
    let newChatSelectedMode = localStorage.getItem(NEWCHAT_MODE_KEY) || "fast";

    async function connectProvider(id) {
      const info = PROVIDER_INFO[id];
      if (!info) return;
      const label = info.label;
      if (!confirm(
        t("provider.connectConfirm", { label }),
      )) return;
      try {
        const r = await fetch("/api/providers/" + id + "/login", { method: "POST" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
        await refreshAvailableProviders();
        if (availableProviders.includes(id)) {
          newChatSelectedProvider = id;
          localStorage.setItem(PROVIDER_PICK_KEY, id);
          renderProviderPicker();
          renderModePickerForProvider();
          alert(t("provider.connectedAlert", { label }));
        } else {
          alert(t("provider.tokenMissing", { id }));
        }
      } catch (e) {
        alert(t("provider.connectFailed", { label, message: e.message }));
      }
    }

    async function refreshAvailableProviders() {
      try {
        const r = await fetch("/api/providers");
        if (r.ok) {
          const j = await r.json();
          availableProviders = (j.providers || []).filter((p) => p.hasAuth).map((p) => p.id);
        }
      } catch {}
    }

    function renderProviderPicker() {
      newChatProviderPicker.innerHTML = "";
      for (const id of Object.keys(PROVIDER_INFO)) {
        const info = PROVIDER_INFO[id];
        const isAuthed = availableProviders.includes(id);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "providerOption " + id
          + (id === newChatSelectedProvider && isAuthed ? " active" : "")
          + (!isAuthed ? " needsAuth" : "");
        btn.dataset.provider = id;
        btn.dataset.authed = isAuthed ? "1" : "0";
        btn.innerHTML =
          '<div class="providerOptionTitle"></div>' +
          '<div class="providerOptionSub"></div>' +
          (isAuthed 
            ? '<span class="reconnectLink success" title="' + t("provider.connectedTitle") + '">' + t("provider.connected") + '</span>'
            : '<span class="reconnectLink danger" title="' + t("provider.authorizeTitle") + '">' + t("provider.authorize") + '</span>');
        btn.querySelector(".providerOptionTitle").textContent = info.icon ? (info.icon + " " + info.label) : info.label;
        btn.querySelector(".providerOptionSub").textContent = info.sub;
        newChatProviderPicker.appendChild(btn);
      }
    }

    async function refreshAgentRoles() {
      try {
        const r = await fetch("/api/agent-roles");
        const j = await r.json();
        if (Array.isArray(j.roles) && j.roles.length) AGENT_ROLES = j.roles;
      } catch {}
    }

    function roleLabel(roleId) {
      return (AGENT_ROLES.find((role) => role.id === roleId) || AGENT_ROLES[0]).label;
    }

    function renderModePickerForProvider() {
      const info = PROVIDER_INFO[newChatSelectedProvider] || PROVIDER_INFO.deepseek;
      // Если текущий режим не подходит провайдеру — сбросим на первый.
      if (!info.modes.find((m) => m.id === newChatSelectedMode)) {
        newChatSelectedMode = info.defaultMode || info.modes[0].id;
      }
      newChatModePicker.innerHTML = "";
      for (const m of info.modes) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "modeOption" + (m.id === newChatSelectedMode ? " active" : "");
        btn.dataset.mode = m.id;
        btn.innerHTML =
          '<div class="modeOptionTitle"></div><div class="modeOptionSub"></div>';
        btn.querySelector(".modeOptionTitle").textContent = m.title;
        btn.querySelector(".modeOptionSub").textContent = m.sub;
        newChatModePicker.appendChild(btn);
      }
    }

    newChatProviderPicker.addEventListener("click", async (event) => {
      const opt = event.target.closest(".providerOption");
      if (!opt) return;
      const id = opt.dataset.provider;

      // Запускаем авторизацию ТОЛЬКО если кликнули по кнопке НЕавторизованного провайдера.
      // Если провайдер уже подключен, клик по зеленому бейджу просто выбирает его!
      const reconnectBtn = event.target.closest(".reconnectLink");
      if (opt.dataset.authed !== "1") {
        event.stopPropagation();
        await connectProvider(id);
        return;
      }

      newChatSelectedProvider = id;
      localStorage.setItem(PROVIDER_PICK_KEY, newChatSelectedProvider);
      renderProviderPicker();
      renderModePickerForProvider();
    });

    newChatModePicker.addEventListener("click", (event) => {
      const opt = event.target.closest(".modeOption");
      if (!opt) return;
      newChatSelectedMode = opt.dataset.mode;
      localStorage.setItem(NEWCHAT_MODE_KEY, newChatSelectedMode);
      renderModePickerForProvider();
    });

    // На старте подтянем список доступных провайдеров и нарисуем picker'ы.
    (async () => {
      await refreshModelCatalog();
      await refreshAgentRoles();
      await refreshAvailableProviders();
      if (!availableProviders.includes(newChatSelectedProvider) && availableProviders.length) {
        newChatSelectedProvider = availableProviders[0];
      }
      renderProviderPicker();
      renderModePickerForProvider();
    })();

    document.getElementById("composer").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!activeConversation || sending) return;
      const rawUserMessage = messageInput.value.trim();
      if (!rawUserMessage && !attachments.length) return;

      const textFiles = attachments.filter((a) => a.kind === "text");
      const imageFiles = attachments.filter((a) => a.kind === "image");

      // Если юзер прикрепил картинку, но ничего не написал — подставляем дефолтный
      // промпт. DeepSeek API не принимает пустой prompt, и сам по себе file_id
      // ничего не значит без текстового вопроса.
      const userMessage = rawUserMessage || (imageFiles.length
        ? t("composer.defaultImageQuestion")
        : "");

      const attachPrefix = buildAttachmentsPrefix(textFiles);
      const contentForApi = attachPrefix ? attachPrefix + "\\n\\n" + userMessage : userMessage;
      // В UI чата показываем: оригинал юзера (если был) + список вложений.
      // Если юзер ничего не печатал — показываем placeholder про дефолтный вопрос.
      const displayParts = [];
      if (rawUserMessage) displayParts.push(rawUserMessage);
      if (!rawUserMessage && imageFiles.length) displayParts.push(t("composer.imageQuestionLabel"));
      if (attachments.length) {
        displayParts.push(attachments.map((a) => "📎 " + a.name).join("\\n"));
      }
      const displayForChat = displayParts.join("\\n\\n");

      sending = true;
      setComposerEnabled(false);
      const sentDraftText = messageInput.value;
      messageInput.value = "";
      // Сбросить авто-рост на исходную высоту (но если юзер тянул руками — оставить).
      if (!userResizedInput) messageInput.style.height = "";
      const sentAttachments = attachments;
      attachments = [];
      renderAttachments();
      activeConversation.messages.push({ role: "user", content: displayForChat });
      renderConversation(activeConversation);

      try {
        // Картинки. ChatGPT обрабатывает их сам через веб-сессию — передаём inline,
        // НЕ гоняя через DeepSeek. Для DeepSeek/Qwen — старый путь через /api/upload
        // (получаем file_id для vision-completion).
        const refFileIds = [];
        let inlineImages = [];
        const sendProvider = activeConversation.provider || "deepseek";
        if (imageFiles.length) {
          if (sendProvider === "chatgpt") {
            inlineImages = imageFiles.map((img) => ({
              name: img.name,
              mimeType: img.mimeType,
              dataBase64: img.dataBase64,
            }));
          } else {
            for (let i = 0; i < imageFiles.length; i += 1) {
              const img = imageFiles[i];
              const num = imageFiles.length > 1 ? \` (\${i + 1}/\${imageFiles.length})\` : "";
              setStatus(t("composer.uploadingImage", { num, name: img.name }));
              const result = await api("/api/upload", {
                method: "POST",
                body: {
                  name: img.name,
                  mimeType: img.mimeType,
                  dataBase64: img.dataBase64,
                  chatSessionId: activeConversation.sessionId,
                },
              });
              if (!result.fileId) throw new Error(t("file.uploadMissingId"));
              refFileIds.push(result.fileId);
            }
          }
        }

        setStatus(t("composer.thinkingStatus"));
        const sentConvId = activeConversation.id;
        const data = await api("/api/conversations/" + sentConvId + "/messages", {
          method: "POST",
          body: {
            content: contentForApi,
            thinking: thinkingActive,
            search: searchActive,
            refFileIds,
            images: inlineImages,
          },
        });

        // Если сервер вернул running:true — это /code в фоне. Отпускаем UI,
        // даём юзеру переключаться по чатам. Polling сам подхватит результат.
        if (data.running) {
          activeConversation = data.conversation;
          await loadState(activeConversation.id);
          renderConversation(activeConversation);
          setStatus(t("composer.backgroundTask"));
          ensurePolling();
          return; // sending снимет в finally, polling завершит UI
        }

        activeConversation = data.conversation;
        await loadState(activeConversation.id);
        renderConversation(activeConversation);
        setStatus("");
      } catch (error) {
        if (!messageInput.value.trim()) {
          messageInput.value = sentDraftText;
          autoGrowInput();
        }
        // Возвращаем файлы юзеру — иначе он не поймёт, что они пропали.
        attachments = sentAttachments;
        renderAttachments();
        setStatus(error.message, true);
      } finally {
        sending = false;
        setComposerEnabled(true);
        messageInput.focus();
      }
    });

    messageInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        document.getElementById("composer").requestSubmit();
      }
    });

    // Авто-рост textarea по содержимому. Не мешает ручному resize:
    // как только пользователь перетащил угол — фиксированная высота
    // выставлена через inline style и больше не сбрасывается до отправки.
    let userResizedInput = false;
    const autoGrowInput = () => {
      if (userResizedInput) return;
      messageInput.style.height = "auto";
      const maxPx = Math.floor(window.innerHeight * 0.6);
      const next = Math.min(messageInput.scrollHeight, maxPx);
      messageInput.style.height = next + "px";
    };
    messageInput.addEventListener("input", autoGrowInput);
    // Если пользователь сам потянул за уголок — запоминаем и не трогаем.
    messageInput.addEventListener("mousedown", (e) => {
      const rect = messageInput.getBoundingClientRect();
      // нижний-правый угол ~16x16 — резайз-хэндл
      if (e.clientX > rect.right - 18 && e.clientY > rect.bottom - 18) {
        userResizedInput = true;
      }
    });

    async function loadState(nextActiveId = null) {
      appState = await api("/api/state");
      if (nextActiveId) appState.activeConversationId = nextActiveId;
      renderList();
      if (appState.activeConversationId) {
        const data = await api("/api/conversations/" + appState.activeConversationId);
        activeConversation = data.conversation;
        renderConversation(activeConversation);
      } else {
        activeConversation = null;
        renderNoConversation();
      }
      // Если есть фоновые задачи — запустить polling.
      if ((appState.runningTaskIds || []).length > 0) ensurePolling();
      if (activeConversation?.pendingInstallRequest?.status === "running") ensureInstallPolling();
      if (!pipelinePanel.classList.contains("hidden")) renderPipelinePanel();
    }

    // Polling для отслеживания фоновых /code-задач. Один setInterval на всю сессию,
    // запускается при наличии running tasks и автоматически останавливается, когда
    // их не остаётся. Тик — 1.5 сек.
    let pollTimer = null;
    function ensurePolling() {
      if (pollTimer) return;
      pollTimer = setInterval(pollTick, 1500);
    }
    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }
    let installPollTimer = null;
    function ensureInstallPolling() {
      if (installPollTimer) return;
      installPollTimer = setInterval(installPollTick, 1500);
    }
    function stopInstallPolling() {
      if (!installPollTimer) return;
      clearInterval(installPollTimer);
      installPollTimer = null;
    }
    async function installPollTick() {
      if (!activeConversation) return stopInstallPolling();
      try {
        const data = await api("/api/conversations/" + activeConversation.id);
        activeConversation = data.conversation;
        renderConversation(activeConversation);
        const status = activeConversation.pendingInstallRequest?.status;
        if (status !== "running") stopInstallPolling();
      } catch {}
    }
    async function pollTick() {
      let nextState;
      try {
        nextState = await api("/api/state");
      } catch {
        return; // сетевая ошибка — попробуем на следующем тике
      }
      const prevRunning = new Set(appState.runningTaskIds || []);
      const nextRunning = new Set(nextState.runningTaskIds || []);
      appState.conversations = nextState.conversations;
      appState.runningTaskIds = nextState.runningTaskIds;
      renderList();
      updateStopButton();

      // Если активный чат всё ещё в работе — подтягиваем его свежие сообщения
      // (могут добавляться tool-логи во время /code).
      if (activeConversation && nextRunning.has(activeConversation.id)) {
        try {
          const data = await api("/api/conversations/" + activeConversation.id);
          activeConversation = data.conversation;
          renderConversation(activeConversation);
        } catch {}
      }

      // Если активный чат ТОЛЬКО ЧТО завершился — финальный рендер + сброс статуса.
      if (activeConversation && prevRunning.has(activeConversation.id) && !nextRunning.has(activeConversation.id)) {
        try {
          const data = await api("/api/conversations/" + activeConversation.id);
          activeConversation = data.conversation;
          renderConversation(activeConversation);
          setStatus("");
        } catch {}
      }

      if (nextRunning.size === 0) stopPolling();
    }

    function renderList() {
      chatList.innerHTML = "";
      const running = new Set(appState.runningTaskIds || []);
      for (const conversation of appState.conversations) {
        const button = document.createElement("button");
        const isRunning = running.has(conversation.id);
        button.className =
          "chatItem"
          + (conversation.id === appState.activeConversationId ? " active" : "")
          + (isRunning ? " running" : "");
        button.innerHTML =
          '<div class="chatTitle"></div><div class="chatFolder"></div><div class="chatMeta"></div><button class="chatDelete" type="button" title="' + t("chat.delete") + '">×</button>';
        // Заголовок + спиннер (если задача в работе) + бейдж провайдера.
        const titleEl = button.querySelector(".chatTitle");
        if (isRunning) {
          const sp = document.createElement("span");
          sp.className = "taskSpinner";
          sp.title = t("chat.running");
          titleEl.appendChild(sp);
        }
        const titleText = document.createElement("span");
        titleText.className = "chatTitleText";
        titleText.textContent = conversation.title;
        titleEl.appendChild(titleText);
        const prov = conversation.provider || "deepseek";
        const pb = document.createElement("span");
        pb.className = "providerBadge " + prov;
        pb.textContent = prov;
        titleEl.appendChild(pb);
        // Папка проекта — короткое имя (basename) с полным путём в tooltip.
        const folderEl = button.querySelector(".chatFolder");
        const ws = conversation.workspace || "";
        if (ws) {
          const parts = ws.split("/").filter(Boolean);
          folderEl.textContent = "📁 " + (parts[parts.length - 1] || ws);
          folderEl.title = ws;
        } else {
          folderEl.style.display = "none";
        }
        button.querySelector(".chatMeta").textContent =
          t("chat.messages", { count: conversation.messageCount });
        button.querySelector(".chatDelete").addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!confirm(t("chat.deleteConfirm"))) return;
          await api("/api/conversations/" + conversation.id, { method: "DELETE" });
          if (activeConversation && activeConversation.id === conversation.id) {
            activeConversation = null;
          }
          await loadState();
          if (!appState.activeConversationId) renderNoConversation();
        });
        button.addEventListener("click", async () => {
          const data = await api("/api/conversations/" + conversation.id);
          appState.activeConversationId = conversation.id;
          activeConversation = data.conversation;
          renderList();
          renderConversation(activeConversation);
        });
        chatList.appendChild(button);
      }
    }

    const activeModeBadge = document.getElementById("activeMode");
    const modelPickerEl = document.getElementById("modelPicker");
    const rolePickerEl = document.getElementById("rolePicker");
    const coderToggleEl = document.getElementById("coderToggle");
    const hardwareToggleEl = document.getElementById("hardwareToggle");
    const pipelineToggleEl = document.getElementById("pipelineToggle");

    function renderNoConversation() {
      activeTitle.textContent = t("app.noChat");
      workspace.textContent = appState.workspaceRoot || "";
      activeModeBadge.classList.add("hidden");
      modelPickerEl.classList.add("hidden");
      rolePickerEl.classList.add("hidden");
      coderToggleEl.classList.add("hidden");
      hardwareToggleEl.classList.add("hidden");
      pipelineToggleEl.classList.add("hidden");
      messages.innerHTML = '<div class="empty">' + t("app.createChatHint") + '</div>';
      setComposerEnabled(false);
    }

    // Patch на сервере: обновить model / coderMode для активного чата.
    async function patchActiveConversation(payload) {
      if (!activeConversation) return;
      const data = await api("/api/conversations/" + activeConversation.id, {
        method: "PATCH",
        body: payload,
      });
      activeConversation = data.conversation;
      renderConversation(activeConversation);
      renderList();
    }

    modelPickerEl.addEventListener("change", () => {
      patchActiveConversation({ model: modelPickerEl.value }).catch((e) => setStatus(e.message, true));
    });
    rolePickerEl.addEventListener("change", () => {
      patchActiveConversation({ roleId: rolePickerEl.value }).catch((e) => setStatus(e.message, true));
    });
    coderToggleEl.addEventListener("click", () => {
      const next = !(activeConversation && activeConversation.coderMode === true);
      patchActiveConversation({
        coderMode: next,
        hardwareMode: next ? activeConversation?.hardwareMode === true : false,
      }).catch((e) => setStatus(e.message, true));
    });
    hardwareToggleEl.addEventListener("click", () => {
      const next = !(activeConversation && activeConversation.hardwareMode === true);
      patchActiveConversation({
        hardwareMode: next,
        coderMode: next ? true : activeConversation?.coderMode === true,
      }).catch((e) => setStatus(e.message, true));
    });
    pipelineToggleEl.addEventListener("click", () => {
      const next = !(activeConversation && activeConversation.pipelineMode === true);
      patchActiveConversation({ pipelineMode: next }).catch((e) => setStatus(e.message, true));
    });
    pipelinePanelBtn.addEventListener("click", () => {
      pipelinePanel.classList.remove("hidden");
      pipelinePanel.setAttribute("aria-hidden", "false");
      renderPipelinePanel();
    });
    pipelineClose.addEventListener("click", () => {
      pipelinePanel.classList.add("hidden");
      pipelinePanel.setAttribute("aria-hidden", "true");
    });

    function renderConversation(conversation) {
      activeTitle.textContent = conversation.title;
      workspace.textContent = conversation.workspace || appState.workspaceRoot;
      if (appState.stateFile) workspace.title = t("chat.history", { file: appState.stateFile });
      // Бейдж режима: показывает, какая модель привязана к этому чату.
      // Берём label из PROVIDER_INFO с учётом провайдера чата.
      const mode = conversation.mode || "fast";
      const prov = conversation.provider || "deepseek";
      const info = PROVIDER_INFO[prov] || PROVIDER_INFO.deepseek;
      const modeDef = info.modes.find((m) => m.id === mode) || info.modes[0];
      activeModeBadge.className = "modeBadge " + mode;
      activeModeBadge.textContent = modeDef?.title || mode;

      // Model picker — для провайдеров с поддержкой смены модели.
      // Скрываем статический бейдж, если доступен интерактивный выбор модели, чтобы не было путаницы.
      if (Array.isArray(info.models) && info.models.length > 1) {
        const currentModel = conversation.model || info.defaultModel || info.models[0].id;
        modelPickerEl.innerHTML = "";
        for (const m of info.models) {
          const opt = document.createElement("option");
          opt.value = m.id;
          opt.textContent = m.label;
          if (m.id === currentModel) opt.selected = true;
          modelPickerEl.appendChild(opt);
        }
        modelPickerEl.classList.remove("hidden");
        activeModeBadge.classList.add("hidden");
      } else {
        modelPickerEl.classList.add("hidden");
        activeModeBadge.classList.remove("hidden");
      }

      rolePickerEl.innerHTML = "";
      for (const roleDef of AGENT_ROLES) {
        const opt = document.createElement("option");
        opt.value = roleDef.id;
        opt.textContent = roleDef.label;
        if (roleDef.id === (conversation.roleId || "assistant")) opt.selected = true;
        rolePickerEl.appendChild(opt);
      }
      rolePickerEl.classList.remove("hidden");

      // Coder toggle — переключает coderMode для текущего чата.
      // Когда включён, каждое сообщение проходит через runCodeTask (без /code префикса).
      coderToggleEl.classList.remove("hidden");
      if (conversation.coderMode === true) {
        coderToggleEl.classList.add("active");
        coderToggleEl.textContent = t("topbar.coderOn");
      } else {
        coderToggleEl.classList.remove("active");
        coderToggleEl.textContent = t("topbar.coder");
      }
      hardwareToggleEl.classList.remove("hidden");
      if (conversation.hardwareMode === true) {
        hardwareToggleEl.classList.add("active");
        hardwareToggleEl.textContent = t("topbar.hardwareOn");
      } else {
        hardwareToggleEl.classList.remove("active");
        hardwareToggleEl.textContent = t("topbar.hardware");
      }
      pipelineToggleEl.classList.remove("hidden");
      if (conversation.pipelineMode === true) {
        pipelineToggleEl.classList.add("active");
        pipelineToggleEl.textContent = t("topbar.pipelineOn");
      } else {
        pipelineToggleEl.classList.remove("active");
        pipelineToggleEl.textContent = t("topbar.pipeline");
      }

      // Синхронизация и блокировка "Глубокого мышления" для моделей-рассуждалок (DeepSeek R1 / QwQ)
      const currentModel = conversation.model || info.defaultModel || (info.models && info.models[0]?.id);
      const isReasoningModel = findModelInfo(prov, currentModel)?.reasoning === true;
      if (isReasoningModel) {
        toggleThinking.classList.add("active");
        toggleThinking.disabled = true;
        toggleThinking.classList.add("disabled");
        toggleThinking.title = t("composer.thinkingRequired");
      } else {
        toggleThinking.disabled = false;
        toggleThinking.classList.remove("disabled");
        toggleThinking.classList.toggle("active", thinkingActive);
        toggleThinking.title = t("composer.thinkingTitle");
      }

      // Раньше я думал, что search не работает в Expert — но юзер подтвердил
      // что в реальном DeepSeek UI работает в Fast и Expert. Vision ещё не проверяли.
      toggleSearch.disabled = false;
      toggleSearch.classList.remove("disabled");
      toggleSearch.title = t("composer.searchTitle");
      setComposerEnabled(!sending);
      messages.innerHTML = "";

      if (!conversation.messages.length) {
        messages.innerHTML = '<div class="empty">' + t("app.firstMessage") + '</div>';
        return;
      }

      for (const message of conversation.messages) {
        const row = document.createElement("article");
        row.className = "msg " + message.role;
        const role = document.createElement("div");
        role.className = "role";
        // Подпись assistant'а — провайдер-специфичная.
        const assistantLabel = message.roleId
          ? roleLabel(message.roleId)
          : (({ deepseek: "DeepSeek", qwen: "Qwen" })[conversation.provider || "deepseek"] || t("chat.assistant"));
        role.textContent = message.role === "user" ? t("chat.you") : assistantLabel;
        const bubble = document.createElement("div");
        bubble.className = "bubble";
        if (message.content) {
          const textEl = document.createElement("div");
          textEl.textContent = message.content;
          bubble.appendChild(textEl);
        }
        // Сгенерированные ChatGPT картинки (data-URL) — рендерим как <img>.
        if (Array.isArray(message.images) && message.images.length) {
          for (const src of message.images) {
            if (typeof src !== "string" || !src) continue;
            const img = document.createElement("img");
            img.className = "chatImage";
            img.src = src;
            img.loading = "lazy";
            img.addEventListener("click", () => window.open(src, "_blank"));
            bubble.appendChild(img);
          }
        }
        row.append(role, bubble);
        messages.appendChild(row);
      }
      renderInstallRequest(conversation);
      renderQuestionRequest(conversation);
      renderPermissionRequest(conversation);
      messages.scrollTop = messages.scrollHeight;
    }

    async function updatePipelineEdges(edges) {
      const data = await api("/api/pipeline", { method: "PATCH", body: { edges } });
      appState.pipeline = data.pipeline;
      renderPipelinePanel();
    }

    function renderPipelinePanel() {
      const conversations = appState?.conversations || [];
      const edges = appState?.pipeline?.edges || [];
      const nextByFrom = new Map(edges.map((edge) => [edge.from, edge.to]));
      pipelineBody.innerHTML = "";
      if (!conversations.length) {
        pipelineBody.innerHTML = '<div class="empty smallEmpty">' + t("pipeline.empty") + '</div>';
        return;
      }
      for (const conversation of conversations) {
        const row = document.createElement("div");
        row.className = "pipelineRow";
        const meta = document.createElement("div");
        meta.className = "pipelineNodeMeta";
        const title = document.createElement("div");
        title.className = "pipelineNodeTitle";
        title.textContent = conversation.title;
        const sub = document.createElement("div");
        sub.className = "pipelineNodeSub";
        sub.textContent = (conversation.provider || "deepseek") + " · " + (conversation.model || conversation.mode || t("pipeline.model"));
        meta.append(title, sub);

        const roleSelect = document.createElement("select");
        roleSelect.className = "pipelineSelect";
        for (const roleDef of AGENT_ROLES) {
          const opt = document.createElement("option");
          opt.value = roleDef.id;
          opt.textContent = roleDef.label;
          if (roleDef.id === (conversation.roleId || "assistant")) opt.selected = true;
          roleSelect.appendChild(opt);
        }
        roleSelect.addEventListener("change", async () => {
          await api("/api/conversations/" + conversation.id, { method: "PATCH", body: { roleId: roleSelect.value } });
          await loadState(activeConversation?.id || conversation.id);
        });

        const nextSelect = document.createElement("select");
        nextSelect.className = "pipelineSelect";
        const none = document.createElement("option");
        none.value = "";
        none.textContent = t("pipeline.end");
        nextSelect.appendChild(none);
        for (const target of conversations) {
          if (target.id === conversation.id) continue;
          const opt = document.createElement("option");
          opt.value = target.id;
          opt.textContent = "→ " + target.title;
          if (target.id === nextByFrom.get(conversation.id)) opt.selected = true;
          nextSelect.appendChild(opt);
        }
        nextSelect.addEventListener("change", async () => {
          const nextEdges = edges.filter((edge) => edge.from !== conversation.id);
          if (nextSelect.value) nextEdges.push({ from: conversation.id, to: nextSelect.value });
          await updatePipelineEdges(nextEdges);
          await loadState(activeConversation?.id || conversation.id);
        });

        row.append(meta, roleSelect, nextSelect);
        pipelineBody.appendChild(row);
      }
    }

    function renderQuestionRequest(conversation) {
      const question = conversation.pendingQuestion;
      if (!question || question.status !== "pending") return;
      const row = document.createElement("article");
      row.className = "msg assistant questionRequest";
      const role = document.createElement("div");
      role.className = "role";
      role.textContent = t("chat.question");
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      const title = document.createElement("div");
      title.className = "installTitle";
      title.textContent = question.question;
      bubble.appendChild(title);
      if (question.details) {
        const details = document.createElement("div");
        details.className = "installText";
        details.textContent = question.details;
        bubble.appendChild(details);
      }
      const choices = Array.isArray(question.choices) ? question.choices : [];
      if (choices.length) {
        const actions = document.createElement("div");
        actions.className = "installActions";
        for (const choice of choices) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "iconBtn";
          btn.textContent = choice;
          btn.addEventListener("click", () => fillQuestionAnswer(choice));
          actions.appendChild(btn);
        }
        bubble.appendChild(actions);
      }
      row.append(role, bubble);
      messages.appendChild(row);
    }

    function fillQuestionAnswer(text) {
      messageInput.value = text;
      messageInput.focus();
      autoGrowInput();
    }

    function renderPermissionRequest(conversation) {
      const request = conversation.pendingPermissionRequest;
      if (!request || request.status !== "pending") return;
      const existing = document.getElementById("permissionRequestOverlay");
      if (existing) existing.remove();

      const overlay = document.createElement("div");
      overlay.id = "permissionRequestOverlay";
      overlay.className = "settingsOverlay";
      overlay.setAttribute("aria-hidden", "false");

      const panel = document.createElement("div");
      panel.className = "settingsPanel permissionPanel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");

      const head = document.createElement("div");
      head.className = "settingsHead";
      const title = document.createElement("h2");
      title.textContent = request.title || t("permission.title");
      const close = document.createElement("button");
      close.type = "button";
      close.className = "iconBtn";
      close.setAttribute("aria-label", t("app.close"));
      close.textContent = "✕";
      close.addEventListener("click", () => answerPermissionRequest("reject", overlay));
      head.append(title, close);

      const body = document.createElement("div");
      body.className = "settingsBody";
      const text = document.createElement("p");
      text.className = "settingsHint";
      text.textContent = request.description || t("permission.description");
      const hint = document.createElement("div");
      hint.className = "apiModels";
      hint.textContent = t("permission.settingsHint");
      const actions = document.createElement("div");
      actions.className = "installActions";
      const approve = document.createElement("button");
      approve.type = "button";
      approve.className = "iconBtn primaryBtn";
      approve.textContent = t("permission.approve");
      approve.addEventListener("click", () => answerPermissionRequest("approve", overlay));
      const reject = document.createElement("button");
      reject.type = "button";
      reject.className = "iconBtn";
      reject.textContent = t("permission.reject");
      reject.addEventListener("click", () => answerPermissionRequest("reject", overlay));
      actions.append(approve, reject);
      body.append(text, hint, actions);
      panel.append(head, body);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
    }

    async function answerPermissionRequest(action, overlay) {
      if (!activeConversation) return;
      const data = await api("/api/conversations/" + activeConversation.id + "/permission-request/" + action, { method: "POST" });
      activeConversation = data.conversation;
      if (overlay) overlay.remove();
      renderConversation(activeConversation);
      renderList();
      if (action === "approve") setStatus(t("permission.enabled"));
    }

    function renderInstallRequest(conversation) {
      const request = conversation.pendingInstallRequest;
      if (!request || request.status === "rejected" || request.status === "installed") return;
      const row = document.createElement("article");
      row.className = "msg assistant installRequest";
      const role = document.createElement("div");
      role.className = "role";
      role.textContent = t("chat.system");
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      const command = [request.command].concat(request.args || []).join(" ");
      bubble.innerHTML =
        '<div class="installTitle">' + escapeHtml(request.title || t("install.title")) + '</div>' +
        '<div class="installText">' + escapeHtml(request.description || "") + '</div>' +
        '<code>' + escapeHtml(command) + '</code>';
      if (request.status === "pending") {
        const actions = document.createElement("div");
        actions.className = "installActions";
        const approve = document.createElement("button");
        approve.type = "button";
        approve.className = "iconBtn primaryBtn";
        approve.textContent = t("install.approve");
        approve.addEventListener("click", () => answerInstallRequest("approve"));
        const reject = document.createElement("button");
        reject.type = "button";
        reject.className = "iconBtn";
        reject.textContent = t("install.reject");
        reject.addEventListener("click", () => answerInstallRequest("reject"));
        actions.append(approve, reject);
        bubble.appendChild(actions);
      } else {
        const status = document.createElement("div");
        status.className = "installText";
        status.textContent = request.status === "running" ? t("install.running") : t("install.failed");
        bubble.appendChild(status);
      }
      const logText = [request.stdout, request.stderr].filter(Boolean).join("\\n").trim();
      if (logText) {
        const log = document.createElement("pre");
        log.className = "installLog";
        log.textContent = logText.slice(-6000);
        bubble.appendChild(log);
      }
      if (request.status === "running") ensureInstallPolling();
      row.append(role, bubble);
      messages.appendChild(row);
    }

    async function answerInstallRequest(action) {
      if (!activeConversation) return;
      const data = await api("/api/conversations/" + activeConversation.id + "/install-request/" + action, { method: "POST" });
      activeConversation = data.conversation;
      renderConversation(activeConversation);
      renderList();
      if (activeConversation.pendingInstallRequest?.status === "running") ensureInstallPolling();
    }

    function escapeHtml(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function updateMessagePlaceholder() {
      if (!activeConversation) {
        messageInput.placeholder = t("composer.chooseChat");
        return;
      }
      const provider = activeConversation.provider || "deepseek";
      const label = ((PROVIDER_INFO[provider] || {}).label) || ({ deepseek: "DeepSeek", qwen: "Qwen" })[provider] || "AI";
      messageInput.placeholder = t("composer.message", { label });
    }

    function setComposerEnabled(enabled) {
      updateMessagePlaceholder();
      messageInput.disabled = !enabled || !activeConversation;
      sendBtn.disabled = !enabled || !activeConversation;
      updateStopButton();
    }

    // Кнопка «Стоп» видна, когда в активном чате идёт фоновая задача (code/pipeline).
    function isActiveConversationRunning() {
      if (!activeConversation) return false;
      const running = new Set(appState?.runningTaskIds || []);
      return running.has(activeConversation.id);
    }

    function updateStopButton() {
      if (!stopBtn) return;
      const running = isActiveConversationRunning();
      stopBtn.classList.toggle("hidden", !running);
      if (running) {
        sendBtn.classList.add("hidden");
      } else {
        sendBtn.classList.remove("hidden");
      }
    }

    async function stopActiveConversation() {
      if (!activeConversation) return;
      const id = activeConversation.id;
      stopBtn.disabled = true;
      try {
        const data = await api("/api/conversations/" + id + "/stop", { method: "POST" });
        if (data.stopped) setStatus(t("composer.stopTitle"));
        if (data.conversation && activeConversation && activeConversation.id === id) {
          activeConversation = data.conversation;
          renderConversation(activeConversation);
        }
        await loadState(id).catch(() => {});
      } catch (e) {
        setStatus(e.message, true);
      } finally {
        stopBtn.disabled = false;
        updateStopButton();
      }
    }

    function setupTheme() {
      const stored = localStorage.getItem(THEME_KEY);
      applyTheme(THEMES.some((theme) => theme.id === stored) ? stored : "dark");
      document.getElementById("themeBtn").addEventListener("click", () => {
        const current = document.body.dataset.theme || "dark";
        const idx = THEMES.findIndex((theme) => theme.id === current);
        const next = THEMES[(idx + 1) % THEMES.length];
        applyTheme(next.id);
      });
    }

    function applyTheme(themeId) {
      const theme = THEMES.find((item) => item.id === themeId) || THEMES[0];
      document.body.dataset.theme = theme.id;
      localStorage.setItem(THEME_KEY, theme.id);
      const themeBtn = document.getElementById("themeBtn");
      if (themeBtn) {
        themeBtn.textContent = theme.icon;
        themeBtn.title = t("theme.title", { label: theme.label });
      }
    }

    function setStatus(text, isError = false) {
      statusEl.textContent = text;
      statusEl.className = "status" + (isError ? " error" : "");
    }

    async function api(url, options = {}) {
      const fetchOptions = {
        method: options.method || "GET",
        headers: { "Content-Type": "application/json" },
      };
      if (options.body) fetchOptions.body = JSON.stringify(options.body);
      const res = await fetch(url, fetchOptions);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("app.requestFailed"));
      return data;
    }

    // ---- Heartbeat: закрываем окно при graceful shutdown или когда CLI мёртв (Ctrl+C в терминале).
    let heartbeatFailures = 0;
    let shutdownStarted = false;
    const shutdownOverlay = document.getElementById("shutdownOverlay");
    const shutdownTitle = document.getElementById("shutdownTitle");
    const shutdownSub = document.getElementById("shutdownSub");

    const SHUTDOWN_PHASE_KEYS = {
      stopping_tasks: "shutdown.stoppingTasks",
      closing_browsers: "shutdown.closingBrowsers",
      closing_server: "shutdown.closingServer",
      stopped: "shutdown.stoppedSub",
    };

    function showShutdownOverlay(phase) {
      shutdownOverlay.classList.remove("hidden");
      shutdownOverlay.setAttribute("aria-hidden", "false");
      shutdownTitle.textContent = phase === "stopped" ? t("shutdown.stopped") : t("shutdown.gracefulTitle");
      shutdownSub.textContent = t(SHUTDOWN_PHASE_KEYS[phase] || "shutdown.stoppingTasks");
    }

    function finishShutdownWindow() {
      if (shutdownStarted) return;
      shutdownStarted = true;
      showShutdownOverlay("stopped");
      setTimeout(() => {
        try { window.close(); } catch {}
      }, 800);
    }

    async function tickHeartbeat() {
      if (shutdownStarted) return;
      try {
        const res = await fetch("/api/heartbeat", { cache: "no-store" });
        if (!res.ok) throw new Error("heartbeat not ok");
        const data = await res.json().catch(() => ({}));
        heartbeatFailures = 0;
        if (data.shuttingDown) {
          showShutdownOverlay(data.phase || "stopping_tasks");
          if (data.phase === "stopped") finishShutdownWindow();
        }
      } catch {
        heartbeatFailures += 1;
        if (heartbeatFailures >= 3) {
          shutdownStarted = true;
          document.body.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:12px;color:#888;font-family:system-ui;background:#0a0a0a;text-align:center;padding:24px">' +
            '<div style="font-size:18px">' + t("shutdown.title") + '</div>' +
            '<div style="font-size:13px;color:#666">' + t("shutdown.sub") + '</div>' +
            "</div>";
          setTimeout(() => {
            try { window.close(); } catch {}
          }, 600);
        }
      }
    }
    setInterval(tickHeartbeat, 1000);

    document.getElementById("quitBtn").addEventListener("click", async () => {
      if (shutdownStarted) return;
      showShutdownOverlay("stopping_tasks");
      try {
        await fetch("/api/shutdown", { method: "POST" });
      } catch {}
    });

    // ---- Settings modal (разрешённые команды для /code) ----
    const settingsBtn = document.getElementById("settingsBtn");
    const settingsOverlay = document.getElementById("settingsOverlay");
    const settingsClose = document.getElementById("settingsClose");
    const settingsBody = document.getElementById("settingsBody");

    settingsBtn.addEventListener("click", openSettings);
    settingsClose.addEventListener("click", closeSettings);
    settingsOverlay.addEventListener("click", (e) => {
      if (e.target === settingsOverlay) closeSettings();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !settingsOverlay.classList.contains("hidden")) closeSettings();
    });

    async function openSettings() {
      settingsOverlay.classList.remove("hidden");
      settingsOverlay.setAttribute("aria-hidden", "false");
      settingsBody.textContent = t("app.loading");
      try {
        const data = await api("/api/settings");
        renderSettings(data);
      } catch (err) {
        settingsBody.textContent = t("settings.loadFailed", { message: err.message });
      }
    }
    function closeSettings() {
      settingsOverlay.classList.add("hidden");
      settingsOverlay.setAttribute("aria-hidden", "true");
    }

    function renderSettings({ catalog, allowedCommands, commandPermissions, openAICompat, ui }) {
      const allowed = new Set(allowedCommands || []);
      const groups = { low: [], medium: [], high: [] };
      for (const item of catalog) {
        (groups[item.risk] || groups.low).push(item);
      }
      const labels = { low: t("settings.low"), medium: t("settings.medium"), high: t("settings.high") };
      const order = ["low", "medium", "high"];
      settingsBody.innerHTML = "";
      const shell = document.createElement("div");
      shell.className = "settingsShell";
      const nav = document.createElement("div");
      nav.className = "settingsTabs";
      nav.setAttribute("role", "tablist");
      const content = document.createElement("div");
      content.className = "settingsTabContent";
      const tabs = [
        { id: "language", label: t("settings.tabLanguage") },
        { id: "update", label: t("settings.tabUpdate") },
        { id: "api", label: t("settings.tabApi") },
        { id: "permissions", label: t("settings.tabPermissions") },
      ];
      const panels = {};
      for (const tab of tabs) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "settingsTab";
        btn.textContent = tab.label;
        btn.dataset.tab = tab.id;
        btn.setAttribute("role", "tab");
        btn.addEventListener("click", () => selectSettingsTab(tab.id));
        nav.appendChild(btn);

        const panel = document.createElement("div");
        panel.className = "settingsTabPanel";
        panel.dataset.panel = tab.id;
        panel.setAttribute("role", "tabpanel");
        panels[tab.id] = panel;
        content.appendChild(panel);
      }
      shell.append(nav, content);
      settingsBody.appendChild(shell);

      renderUiSettings(panels.language, ui, allowedCommands || []);
      renderUpdateSettings(panels.update);
      renderOpenAISettings(panels.api, openAICompat);
      renderAgentPermissionSettings(panels.permissions, commandPermissions || {});
      for (const key of order) {
        const items = groups[key];
        if (!items.length) continue;
        const groupEl = document.createElement("div");
        groupEl.className = "settingsGroup";
        const heading = document.createElement("h3");
        heading.textContent = labels[key];
        groupEl.appendChild(heading);
        for (const item of items) {
          const row = document.createElement("label");
          row.className = "settingsItem";
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = allowed.has(item.name);
          cb.dataset.cmd = item.name;
          cb.addEventListener("change", onToggle);

          const textWrap = document.createElement("div");
          const nameEl = document.createElement("div");
          nameEl.className = "name";
          nameEl.textContent = item.name;
          const descEl = document.createElement("div");
          descEl.className = "desc";
          descEl.textContent = commandDescription(item.name, item.description);
          textWrap.appendChild(nameEl);
          textWrap.appendChild(descEl);

          const badge = document.createElement("span");
          badge.className = "riskBadge " + item.risk;
          badge.textContent = item.risk;

          row.appendChild(cb);
          row.appendChild(textWrap);
          row.appendChild(badge);
          groupEl.appendChild(row);
        }
        panels.permissions.appendChild(groupEl);
      }
      selectSettingsTab("language");
    }

    function selectSettingsTab(tabId) {
      const tabs = settingsBody.querySelectorAll(".settingsTab");
      const panels = settingsBody.querySelectorAll(".settingsTabPanel");
      for (const tab of tabs) {
        const active = tab.dataset.tab === tabId;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", active ? "true" : "false");
      }
      for (const panel of panels) {
        panel.classList.toggle("active", panel.dataset.panel === tabId);
      }
    }

    function commandDescription(command, fallback) {
      const code = String(I18N.language?.code || "en").toLowerCase();
      const descriptions = I18N.commandDescriptions || {};
      return descriptions[code]?.[command]
        || descriptions[code.split("-")[0]]?.[command]
        || descriptions.en?.[command]
        || fallback
        || "";
    }

    function renderUiSettings(target, ui, allowedCommands) {
      const groupEl = document.createElement("div");
      groupEl.className = "settingsGroup";
      const heading = document.createElement("h3");
      heading.textContent = t("settings.interface");
      groupEl.appendChild(heading);

      const languageRow = document.createElement("label");
      languageRow.className = "settingsItem";
      const languageText = document.createElement("div");
      const languageName = document.createElement("div");
      languageName.className = "name";
      languageName.textContent = t("settings.language");
      languageText.appendChild(languageName);
      const languageSelect = document.createElement("select");
      languageSelect.className = "modelPicker";
      for (const language of ui?.languages || []) {
        const opt = document.createElement("option");
        opt.value = language.code;
        opt.textContent = language.name;
        if (language.code === (ui?.language || I18N.language.code)) opt.selected = true;
        languageSelect.appendChild(opt);
      }
      languageSelect.addEventListener("change", async () => {
        await saveUiSettings({ language: languageSelect.value }, allowedCommands);
        setStatus(t("settings.languageSaved"));
        window.location.reload();
      });
      languageRow.append(languageText, languageSelect);
      groupEl.appendChild(languageRow);

      const searchRow = document.createElement("label");
      searchRow.className = "settingsItem";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = ui?.webSearchDefault !== false;
      const searchText = document.createElement("div");
      const searchName = document.createElement("div");
      searchName.className = "name";
      searchName.textContent = t("settings.webSearchDefault");
      searchText.appendChild(searchName);
      cb.addEventListener("change", async () => {
        await saveUiSettings({ webSearchDefault: cb.checked }, allowedCommands);
        localStorage.setItem(SEARCH_KEY, cb.checked ? "1" : "0");
        searchActive = cb.checked;
        applyToggleUI();
      });
      searchRow.append(cb, searchText);
      groupEl.appendChild(searchRow);

      target.appendChild(groupEl);
      renderVoiceSettings(target);
    }

    function renderVoiceSettings(target) {
      const groupEl = document.createElement("div");
      groupEl.className = "settingsGroup";
      const heading = document.createElement("h3");
      heading.textContent = t("settings.voiceTitle");
      groupEl.appendChild(heading);

      const card = document.createElement("div");
      card.className = "voiceStatusCard";
      const header = document.createElement("div");
      header.className = "voiceStatusHeader";
      const title = document.createElement("div");
      title.className = "name";
      title.textContent = "Parakeet V3";
      const badge = document.createElement("span");
      badge.className = "riskBadge medium";
      badge.textContent = "...";
      header.append(title, badge);
      const runtimeDesc = document.createElement("div");
      runtimeDesc.className = "voicePath";
      runtimeDesc.textContent = t("app.loadingShort");
      const hint = document.createElement("div");
      hint.className = "desc";
      hint.textContent = t("settings.voiceInstallHint");
      const installBtn = document.createElement("button");
      installBtn.type = "button";
      installBtn.className = "apiKeyBtn";
      installBtn.textContent = t("install.approve");
      installBtn.addEventListener("click", async () => {
        installBtn.disabled = true;
        badge.textContent = "...";
        runtimeDesc.textContent = t("composer.voiceInstalling");
        try {
          const status = await api("/api/voice/install", { method: "POST" });
          applyVoiceStatus(status);
        } catch (error) {
          runtimeDesc.textContent = error.message;
          badge.textContent = t("settings.voiceMissing");
          badge.className = "riskBadge medium";
        } finally {
          installBtn.disabled = false;
        }
      });
      card.append(header, runtimeDesc, hint, installBtn);
      groupEl.appendChild(card);
      target.appendChild(groupEl);

      function applyVoiceStatus(status) {
        runtimeDesc.textContent = status.helper || "";
        const ready = status.helperAvailable && status.modelAvailable;
        badge.textContent = ready ? t("settings.voiceReady") : t("settings.voiceMissing");
        badge.className = "riskBadge " + (ready ? "low" : "medium");
        installBtn.textContent = ready ? t("settings.voiceReady") : t("install.approve");
      }

      api("/api/voice/status")
        .then(applyVoiceStatus)
        .catch((error) => {
          runtimeDesc.textContent = error.message;
          badge.textContent = t("settings.voiceMissing");
          badge.className = "riskBadge medium";
        });
    }

    function renderAgentPermissionSettings(target, commandPermissions) {
      const groupEl = document.createElement("div");
      groupEl.className = "settingsGroup";
      const heading = document.createElement("h3");
      heading.textContent = t("settings.agentPermissions");
      groupEl.appendChild(heading);

      const rows = [
        {
          key: "allowShell",
          checked: commandPermissions.allowShell !== false,
          name: t("settings.allowShell"),
          desc: t("settings.allowShellDesc"),
          risk: "medium",
        },
        {
          key: "allowPythonModuleAndEval",
          checked: commandPermissions.allowPythonModuleAndEval !== false,
          name: t("settings.allowPythonModuleAndEval"),
          desc: t("settings.allowPythonModuleAndEvalDesc"),
          risk: "high",
        },
      ];

      for (const spec of rows) {
        const row = document.createElement("label");
        row.className = "settingsItem";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = spec.checked;

        const textWrap = document.createElement("div");
        const nameEl = document.createElement("div");
        nameEl.className = "name";
        nameEl.textContent = spec.name;
        const descEl = document.createElement("div");
        descEl.className = "desc";
        descEl.textContent = spec.desc;
        textWrap.append(nameEl, descEl);

        const badge = document.createElement("span");
        badge.className = "riskBadge " + spec.risk;
        badge.textContent = spec.risk;

        cb.addEventListener("change", async () => {
          try {
            await saveCommandPermissions({ [spec.key]: cb.checked });
          } catch (err) {
            cb.checked = !cb.checked;
            setStatus(t("settings.saveFailed", { message: err.message }), true);
          }
        });

        row.append(cb, textWrap, badge);
        groupEl.appendChild(row);
      }

      target.appendChild(groupEl);
    }

    function renderUpdateSettings(target) {
      const groupEl = document.createElement("div");
      groupEl.className = "settingsGroup updateSettings";

      const heading = document.createElement("h3");
      heading.textContent = t("update.title");
      groupEl.appendChild(heading);

      const status = document.createElement("div");
      status.className = "updateStatus";
      status.textContent = t("update.notChecked");
      groupEl.appendChild(status);

      const meta = document.createElement("div");
      meta.className = "updateMeta";
      groupEl.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "updateActions";

      const checkBtn = document.createElement("button");
      checkBtn.type = "button";
      checkBtn.className = "apiKeyBtn";
      checkBtn.textContent = t("update.check");

      const installBtn = document.createElement("button");
      installBtn.type = "button";
      installBtn.className = "apiKeyBtn primaryUpdateBtn";
      installBtn.textContent = t("update.install");
      installBtn.disabled = true;

      actions.append(checkBtn, installBtn);
      groupEl.appendChild(actions);

      const note = document.createElement("div");
      note.className = "apiModels";
      note.textContent = t("update.note");
      groupEl.appendChild(note);

      let lastCheck = null;

      function renderCheck(data) {
        lastCheck = data;
        meta.innerHTML = "";
        const rows = [
          [t("update.currentVersion"), data.currentVersion || "-"],
          [t("update.latestVersion"), data.latestVersion || "-"],
          [t("update.projectRoot"), data.projectRoot || "-"],
        ];
        for (const [label, value] of rows) {
          const row = document.createElement("div");
          row.className = "updateMetaRow";
          const labelEl = document.createElement("span");
          labelEl.textContent = label;
          const valueEl = document.createElement("code");
          valueEl.textContent = value;
          row.append(labelEl, valueEl);
          meta.appendChild(row);
        }
        if (data.error) {
          status.textContent = t("update.checkFailed", { message: data.error });
          status.className = "updateStatus error";
        } else if (data.updateAvailable) {
          status.textContent = t("update.available");
          status.className = "updateStatus ready";
        } else {
          status.textContent = t("update.upToDate");
          status.className = "updateStatus";
        }
        installBtn.disabled = !data.updateAvailable || !data.canUpdate;
        if (data.updateAvailable && !data.canUpdate) {
          status.textContent = t("update.gitRequired");
          status.className = "updateStatus error";
        }
      }

      async function check() {
        checkBtn.disabled = true;
        installBtn.disabled = true;
        status.textContent = t("update.checking");
        status.className = "updateStatus";
        try {
          renderCheck(await api("/api/update/check"));
        } catch (err) {
          status.textContent = t("update.checkFailed", { message: err.message });
          status.className = "updateStatus error";
        } finally {
          checkBtn.disabled = false;
        }
      }

      checkBtn.addEventListener("click", check);
      installBtn.addEventListener("click", async () => {
        if (!lastCheck?.updateAvailable) return;
        if (!confirm(t("update.confirm"))) return;
        checkBtn.disabled = true;
        installBtn.disabled = true;
        status.textContent = t("update.installing");
        status.className = "updateStatus";
        try {
          const result = await api("/api/update/run", { method: "POST" });
          renderCheck(result.after || lastCheck);
          status.textContent = result.message || t("update.installed");
          status.className = "updateStatus ready";
          setStatus(status.textContent, false);
        } catch (err) {
          status.textContent = t("update.installFailed", { message: err.message });
          status.className = "updateStatus error";
          setStatus(status.textContent, true);
        } finally {
          checkBtn.disabled = false;
        }
      });

      target.appendChild(groupEl);
      check().catch(() => {});
    }

    async function saveUiSettings(uiPatch, allowedCommands) {
      const currentUi = I18N.ui || {};
      const nextUi = { ...currentUi, ...uiPatch };
      const saved = await api("/api/settings", {
        method: "PUT",
        body: { allowedCommands, ui: nextUi },
      });
      I18N.ui = saved.ui || nextUi;
      return saved;
    }

    async function saveCommandPermissions(commandPermissions) {
      return api("/api/settings", {
        method: "PUT",
        body: {
          allowedCommands: collectAllowedCommands(),
          commandPermissions,
        },
      });
    }

    function renderOpenAISettings(target, info) {
      if (!info) return;
      const groupEl = document.createElement("div");
      groupEl.className = "settingsGroup apiSettings";

      const heading = document.createElement("h3");
      heading.textContent = t("settings.apiTitle");
      groupEl.appendChild(heading);

      const grid = document.createElement("div");
      grid.className = "apiSettingsGrid";

      grid.appendChild(makeApiField(t("settings.baseUrl"), info.embeddedBaseUrl));
      groupEl.appendChild(grid);

      const keyList = document.createElement("div");
      keyList.className = "apiKeyList";
      const keys = info.apiKeys || {};
      keyList.appendChild(makeApiKeyRow("deepseek", "DeepSeek", keys.deepseek || ""));
      keyList.appendChild(makeApiKeyRow("qwen", "Qwen", keys.qwen || ""));
      groupEl.appendChild(keyList);

      const note = document.createElement("div");
      note.className = "apiModels";
      note.textContent = t("settings.apiNote", { models: (info.models || []).join(", ") });
      groupEl.appendChild(note);

      target.appendChild(groupEl);
      renderAnthropicSettings(target, info);
    }

    function renderAnthropicSettings(target, info) {
      const groupEl = document.createElement("div");
      groupEl.className = "settingsGroup apiSettings";

      const heading = document.createElement("h3");
      heading.textContent = t("settings.anthropicApiTitle");
      groupEl.appendChild(heading);

      const grid = document.createElement("div");
      grid.className = "apiSettingsGrid";
      grid.appendChild(makeApiField(t("settings.anthropicBaseUrl"), info.anthropicBaseUrl || ""));
      grid.appendChild(makeApiField(t("settings.anthropicEndpoint"), info.anthropicMessagesUrl || ""));
      grid.appendChild(makeApiField(t("settings.anthropicAuth"), "x-api-key: <provider API key>"));
      groupEl.appendChild(grid);

      const note = document.createElement("div");
      note.className = "apiModels";
      note.textContent = t("settings.anthropicNote", { models: (info.models || []).join(", ") });
      groupEl.appendChild(note);

      target.appendChild(groupEl);
    }

    function makeApiKeyRow(provider, label, key) {
      const row = document.createElement("div");
      row.className = "apiKeyRow";

      const title = document.createElement("div");
      title.className = "apiKeyProvider";
      title.textContent = label;

      const code = document.createElement("code");
      code.textContent = key || t("settings.noKey");

      const createBtn = document.createElement("button");
      createBtn.type = "button";
      createBtn.className = "apiKeyBtn";
      createBtn.textContent = key ? t("settings.keyCreated") : t("settings.createKey");
      createBtn.disabled = Boolean(key);
      createBtn.addEventListener("click", async () => {
        try {
          await api("/api/settings/openai-key", { method: "POST", body: { provider } });
          const nextSettings = await api("/api/settings");
          renderSettings(nextSettings);
          setStatus(t("settings.keyReady", { label }), false);
        } catch (err) {
          setStatus(t("settings.keyCreateFailed", { label, message: err.message }), true);
        }
      });

      row.appendChild(title);
      row.appendChild(code);
      row.appendChild(createBtn);
      return row;
    }

    function makeApiField(label, value) {
      const wrap = document.createElement("div");
      wrap.className = "apiField";
      const labelEl = document.createElement("div");
      labelEl.className = "apiFieldLabel";
      labelEl.textContent = label;
      const valueEl = document.createElement("code");
      valueEl.textContent = value;
      wrap.appendChild(labelEl);
      wrap.appendChild(valueEl);
      return wrap;
    }

    async function onToggle() {
      // Собираем актуальный список из всех чекбоксов и пушим на сервер.
      const selected = collectAllowedCommands();
      try {
        await api("/api/settings", { method: "PUT", body: { allowedCommands: selected } });
      } catch (err) {
        // Откат UI на серверное состояние при ошибке.
        const data = await api("/api/settings").catch(() => null);
        if (data) renderSettings(data);
        alert(t("settings.saveFailed", { message: err.message }));
      }
    }

    function collectAllowedCommands() {
      const allCheckboxes = settingsBody.querySelectorAll('input[type="checkbox"][data-cmd]');
      return Array.from(allCheckboxes)
        .filter((cb) => cb.checked)
        .map((cb) => cb.dataset.cmd);
    }

    function applySavedSidebarWidth() {
      const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
      if (Number.isFinite(saved)) applySidebarWidth(saved);
    }

    function setupSidebarResize() {
      let dragging = false;

      sidebarResizer.addEventListener("pointerdown", (event) => {
        dragging = true;
        sidebarResizer.classList.add("dragging");
        document.body.classList.add("resizingSidebar");
        sidebarResizer.setPointerCapture(event.pointerId);
        event.preventDefault();
      });

      sidebarResizer.addEventListener("pointermove", (event) => {
        if (!dragging) return;
        const rect = appShell.getBoundingClientRect();
        applySidebarWidth(event.clientX - rect.left);
      });

      const finishDrag = (event) => {
        if (!dragging) return;
        dragging = false;
        sidebarResizer.classList.remove("dragging");
        document.body.classList.remove("resizingSidebar");
        try {
          sidebarResizer.releasePointerCapture(event.pointerId);
        } catch {}
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(getSidebarWidth()));
      };

      sidebarResizer.addEventListener("pointerup", finishDrag);
      sidebarResizer.addEventListener("pointercancel", finishDrag);
    }

    function applySidebarWidth(rawWidth) {
      const maxWidth = Math.max(260, Math.min(560, Math.floor(window.innerWidth * 0.55)));
      const width = Math.max(220, Math.min(maxWidth, Math.round(rawWidth)));
      appShell.style.setProperty("--sidebar-width", width + "px");
    }

    function getSidebarWidth() {
      return parseInt(getComputedStyle(appShell).getPropertyValue("--sidebar-width"), 10) || 300;
    }

    // === Resize composer (вертикально) ===
    // Логика похожа на sidebar: pointerdown → dragging → pointermove обновляет
    // --composer-height в стиле .main, pointerup сохраняет в localStorage.
    function applySavedComposerHeight() {
      const saved = Number(localStorage.getItem(COMPOSER_HEIGHT_KEY));
      if (Number.isFinite(saved) && saved > 0) applyComposerHeight(saved);
    }

    function setupComposerResize() {
      const resizer = document.getElementById("composerResizer");
      const mainEl = document.querySelector(".main");
      if (!resizer || !mainEl) return;
      let dragging = false;

      resizer.addEventListener("pointerdown", (event) => {
        dragging = true;
        resizer.classList.add("dragging");
        document.body.classList.add("resizingComposer");
        resizer.setPointerCapture(event.pointerId);
        event.preventDefault();
      });

      resizer.addEventListener("pointermove", (event) => {
        if (!dragging) return;
        // composer-height = расстояние от низа окна до курсора.
        const fromBottom = window.innerHeight - event.clientY - 3; // -3: половина handle'а
        applyComposerHeight(fromBottom);
      });

      const finishDrag = (event) => {
        if (!dragging) return;
        dragging = false;
        resizer.classList.remove("dragging");
        document.body.classList.remove("resizingComposer");
        try { resizer.releasePointerCapture(event.pointerId); } catch {}
        const current = getComposerHeight();
        if (current) localStorage.setItem(COMPOSER_HEIGHT_KEY, String(current));
      };

      resizer.addEventListener("pointerup", finishDrag);
      resizer.addEventListener("pointercancel", finishDrag);
    }

    function applyComposerHeight(rawPx) {
      const mainEl = document.querySelector(".main");
      if (!mainEl) return;
      // Лимиты:
      //  - min 140px = textarea (~70) + gap (10) + composerControls (~48) + padding. Меньше — обрезает кнопки.
      //  - max 80% окна, чтобы messages не сжимался полностью.
      const maxPx = Math.floor(window.innerHeight * 0.8);
      const px = Math.max(140, Math.min(maxPx, Math.round(rawPx)));
      mainEl.style.setProperty("--composer-height", px + "px");
      mainEl.classList.add("composerSized");
    }

    function getComposerHeight() {
      const mainEl = document.querySelector(".main");
      if (!mainEl) return 0;
      const raw = getComputedStyle(mainEl).getPropertyValue("--composer-height").trim();
      return parseInt(raw, 10) || 0;
    }

    loadState().catch((error) => setStatus(error.message, true));
  </script>
</body>
</html>`;
}
