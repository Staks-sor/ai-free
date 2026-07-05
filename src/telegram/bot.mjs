import path from "node:path";

import { loadSettings, saveSettings } from "../state/settings.mjs";

const PROVIDERS = new Set(["deepseek", "qwen", "chatgpt"]);
const POLL_TIMEOUT_SEC = 25;
const IDLE_DELAY_MS = 3000;
const MAX_TELEGRAM_MESSAGE = 3900;
const RUNNING_POLL_MS = 1500;
const RUNNING_TIMEOUT_MS = 10 * 60 * 1000;

export function parseTelegramCommand(text) {
  const value = String(text || "").trim();
  if (!value.startsWith("/")) return null;
  const [rawCommand, ...rest] = value.split(/\s+/);
  const command = rawCommand.slice(1).split("@")[0].toLowerCase();
  return { command, args: rest.join(" ").trim() };
}

export function isTelegramChatAllowed(settings, chatId) {
  const configured = String(settings?.telegram?.chatId || "").trim();
  return !configured || configured === String(chatId);
}

export function formatTelegramConversationList(conversations = [], activeConversationId = null) {
  if (!conversations.length) return "Чатов пока нет. Создай: /new deepseek Название";
  return conversations.slice(0, 15).map((conversation, index) => {
    const provider = conversation.provider || "deepseek";
    const title = conversation.title || "Untitled";
    return `${index + 1}. [${provider}] ${title}`;
  }).join("\n");
}

export function buildTelegramConversationKeyboard(conversations = []) {
  const rows = conversations.slice(0, 15).map((conversation, index) => {
    const provider = conversation.provider || "deepseek";
    const title = String(conversation.title || "Untitled").slice(0, 34);
    return [{
      text: `${index + 1}. ${provider}: ${title}`,
      callback_data: `select:${conversation.id}`,
    }];
  });
  rows.push([{ text: "Новый DeepSeek", callback_data: "new:deepseek" }, { text: "Новый Qwen", callback_data: "new:qwen" }]);
  rows.push([{ text: "Новый ChatGPT", callback_data: "new:chatgpt" }]);
  return { inline_keyboard: rows };
}

export function formatTelegramProjectList(projects = []) {
  if (!projects.length) return "Проектов пока нет. Можно создать новый проект.";
  return [
    "Выбери проект для нового чата:",
    "",
    ...projects.slice(0, 10).map((project, index) => {
      const marker = project.isDefault ? " *" : "";
      const name = project.name || project.path || "Project";
      return `${index + 1}. ${name}${marker}\n${project.path || ""}`;
    }),
  ].join("\n");
}

export function buildTelegramProjectKeyboard(projects = []) {
  const rows = projects.slice(0, 10).map((project, index) => [{
    text: `${index + 1}. ${String(project.name || project.path || "Project").slice(0, 42)}`,
    callback_data: `project:${index}`,
  }]);
  rows.push([{ text: "Новый проект", callback_data: "project:new" }]);
  rows.push([{ text: "Отмена", callback_data: "cancel-new" }]);
  return { inline_keyboard: rows };
}

export function formatTelegramDirectoryBrowser(listing = {}) {
  const entries = Array.isArray(listing.entries) ? listing.entries : [];
  const visible = entries.slice(0, 8);
  const lines = [
    "Выбери папку для нового проекта:",
    "",
    listing.path || "",
    "",
  ];
  if (visible.length) {
    lines.push(...visible.map((entry, index) => `${index + 1}. ${entry.name}`));
  } else {
    lines.push("Внутри нет доступных подпапок.");
  }
  if (listing.truncated) lines.push("", `Показаны первые ${visible.length} из ${listing.totalDirectories}.`);
  return lines.join("\n");
}

export function buildTelegramDirectoryKeyboard(listing = {}) {
  const rows = [];
  const entries = Array.isArray(listing.entries) ? listing.entries.slice(0, 8) : [];
  rows.push([{ text: "Выбрать эту папку", callback_data: "browse:select" }]);
  for (const [index, entry] of entries.entries()) {
    rows.push([{ text: `📁 ${String(entry.name || "Folder").slice(0, 45)}`, callback_data: `browse:dir:${index}` }]);
  }
  const nav = [];
  if (listing.parent) nav.push({ text: "Вверх", callback_data: "browse:up" });
  nav.push({ text: "Создать папку", callback_data: "browse:mkdir" });
  rows.push(nav);
  rows.push([
    { text: "Home", callback_data: "browse:root:home" },
    { text: "Documents", callback_data: "browse:root:documents" },
    { text: "Desktop", callback_data: "browse:root:desktop" },
  ]);
  rows.push([{ text: "Текущий workspace", callback_data: "browse:root:default" }]);
  rows.push([{ text: "Назад к проектам", callback_data: "browse:projects" }, { text: "Отмена", callback_data: "cancel-new" }]);
  return { inline_keyboard: rows };
}

export function buildTelegramChatActionsKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Сменить чат", callback_data: "chats" }, { text: "Выйти из чата", callback_data: "close" }],
    ],
  };
}

export function buildTelegramQuestionKeyboard(conversationId, question) {
  const choices = Array.isArray(question?.choices) ? question.choices.slice(0, 6) : [];
  const rows = choices.map((choice, index) => [{
    text: String(choice).slice(0, 54),
    callback_data: `q:${conversationId}:${index}`,
  }]);
  rows.push([{ text: "Напишу ответ сам", callback_data: "noop" }]);
  rows.push([{ text: "Сменить чат", callback_data: "chats" }, { text: "Выйти из чата", callback_data: "close" }]);
  return { inline_keyboard: rows };
}

export function formatTelegramQuestion(question) {
  const parts = ["❓ " + String(question?.question || "Нужно уточнение").trim()];
  if (question?.details) parts.push("", String(question.details).trim());
  const choices = Array.isArray(question?.choices) ? question.choices.filter(Boolean) : [];
  if (choices.length) {
    parts.push("", "Выбери вариант кнопкой ниже или напиши свой ответ сообщением.");
  } else {
    parts.push("", "Напиши ответ сообщением.");
  }
  return parts.join("\n");
}

export function resolveTelegramProviderAndTitle(args, fallbackProvider = "deepseek") {
  const parts = String(args || "").trim().split(/\s+/).filter(Boolean);
  const maybeProvider = parts[0]?.toLowerCase();
  const provider = PROVIDERS.has(maybeProvider) ? maybeProvider : fallbackProvider;
  const titleParts = PROVIDERS.has(maybeProvider) ? parts.slice(1) : parts;
  return {
    provider,
    title: titleParts.join(" ").trim() || `Telegram ${provider}`,
  };
}

export function resolveTelegramConversationSelector(conversations = [], selector = "") {
  const rawSelector = String(selector || "").trim();
  const isIndexSelector = /^\d+$/.test(rawSelector);
  const index = isIndexSelector ? Number.parseInt(rawSelector, 10) : NaN;
  return Number.isFinite(index) && index > 0
    ? conversations[index - 1] || null
    : conversations.find((item) => item.id === rawSelector) || null;
}

export async function startTelegramBot({ port, workspaceRoot, log = console.log, fetchImpl = globalThis.fetch } = {}) {
  if (!fetchImpl) throw new Error("Telegram bot requires fetch.");
  const baseUrl = `http://127.0.0.1:${port}`;
  const sessions = new Map();
  const controller = new AbortController();
  let offset = 0;
  let started = false;

  const request = async (method, payload = {}) => {
    const settings = loadSettings();
    const token = String(settings.telegram?.botToken || "").trim();
    if (!settings.telegram?.enabled || !token) return null;
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.description || `Telegram ${method} failed: HTTP ${response.status}`);
    }
    return data.result;
  };

  const sendMessage = async (chatId, text, extra = {}) => {
    for (const chunk of splitTelegramMessage(text)) {
      await request("sendMessage", {
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: true,
        ...extra,
      });
    }
  };

  const appFetch = async (pathname, options = {}) => {
    const response = await fetchImpl(`${baseUrl}${pathname}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    if (!response.ok) {
      let message = text || `HTTP ${response.status}`;
      try { message = JSON.parse(text).error || message; } catch {}
      throw new Error(message);
    }
    return text;
  };

  const getState = async () => JSON.parse(await appFetch("/api/state", { method: "GET" }));

  const getConversation = async (conversationId) =>
    JSON.parse(await appFetch(`/api/conversations/${encodeURIComponent(conversationId)}`, { method: "GET" }));

  const getProjects = async () =>
    JSON.parse(await appFetch("/api/projects", { method: "GET" }));

  const browseDirectory = async (targetPath = "") => {
    const query = targetPath ? `?path=${encodeURIComponent(targetPath)}` : "";
    return JSON.parse(await appFetch(`/api/browse${query}`, { method: "GET" }));
  };

  const createBrowseDirectory = async (parent, name) =>
    JSON.parse(await appFetch("/api/browse/mkdir", {
      method: "POST",
      body: JSON.stringify({ parent, name }),
    }));

  const createConversation = async (provider, title, workspace = workspaceRoot, createFolder = false) => {
    const body = JSON.stringify({ provider, title, workspace, createFolder });
    const data = JSON.parse(await appFetch("/api/conversations", { method: "POST", body }));
    return data.conversation;
  };

  const getPendingNew = (chatId) => sessions.get(String(chatId))?.pendingNew || null;

  const setPendingNew = (chatId, pendingNew) => {
    const current = sessions.get(String(chatId)) || {};
    sessions.set(String(chatId), { ...current, pendingNew });
  };

  const clearPendingNew = (chatId) => {
    const current = sessions.get(String(chatId)) || {};
    const { pendingNew: _pendingNew, ...rest } = current;
    sessions.set(String(chatId), rest);
  };

  const showProjectPicker = async (chatId, provider, title) => {
    setPendingNew(chatId, { provider, title, awaitingPath: false });
    const data = await getProjects();
    await sendMessage(chatId, formatTelegramProjectList(data.projects || []), {
      reply_markup: buildTelegramProjectKeyboard(data.projects || []),
    });
  };

  const showDirectoryBrowser = async (chatId, targetPath = "") => {
    const current = getPendingNew(chatId);
    if (!current) {
      await sendMessage(chatId, "Сначала начни создание чата: /new deepseek Название");
      return;
    }
    const listing = await browseDirectory(targetPath);
    setPendingNew(chatId, {
      ...current,
      awaitingPath: false,
      awaitingFolderName: false,
      browse: {
        path: listing.path,
        parent: listing.parent,
        entries: Array.isArray(listing.entries) ? listing.entries.slice(0, 8) : [],
        roots: {
          home: listing.home,
          documents: listing.home ? path.join(listing.home, "Documents") : "",
          desktop: listing.home ? path.join(listing.home, "Desktop") : "",
          default: listing.defaultWorkspace || workspaceRoot,
        },
      },
    });
    await sendMessage(chatId, formatTelegramDirectoryBrowser(listing), {
      reply_markup: buildTelegramDirectoryKeyboard(listing),
    });
  };

  const finishNewConversation = async (chatId, workspace, createFolder = false) => {
    const pendingNew = getPendingNew(chatId);
    if (!pendingNew) {
      await sendMessage(chatId, "Сначала начни создание чата: /new deepseek Название");
      return;
    }
    const conversation = await createConversation(
      pendingNew.provider,
      pendingNew.title,
      workspace || workspaceRoot,
      createFolder,
    );
    clearPendingNew(chatId);
    sessions.set(String(chatId), { conversationId: conversation.id, closed: false });
    await sendMessage(chatId, `Создан чат: [${conversation.provider}] ${conversation.title}\n${conversation.workspace}`, {
      reply_markup: buildTelegramChatActionsKeyboard(),
    });
  };

  const selectConversation = async (chatId, selector) => {
    const state = await getState();
    const conversations = state.conversations || [];
    const conversation = resolveTelegramConversationSelector(conversations, selector);
    if (!conversation) throw new Error("Чат не найден. Посмотри список: /chats");
    await appFetch(`/api/conversations/${encodeURIComponent(conversation.id)}`, { method: "GET" });
    sessions.set(String(chatId), { conversationId: conversation.id, closed: false });
    return conversation;
  };

  const getActiveConversation = async (chatId) => {
    const session = sessions.get(String(chatId));
    if (session?.closed === true) return null;
    const state = await getState();
    const conversations = state.conversations || [];
    let conversation = conversations.find((item) => item.id === session?.conversationId);
    if (!conversation && state.activeConversationId) {
      conversation = conversations.find((item) => item.id === state.activeConversationId);
    }
    if (!conversation) conversation = await createConversation("deepseek", "Telegram");
    sessions.set(String(chatId), { conversationId: conversation.id, closed: false });
    return conversation;
  };

  const closeActiveConversation = (chatId) => {
    sessions.set(String(chatId), { conversationId: null, closed: true });
  };

  const latestAssistantText = (conversation, fallback = "") => {
    const assistant = conversation?.messages?.slice().reverse().find((message) => message.role === "assistant");
    return String(assistant?.content || fallback || "").trim();
  };

  const getPendingQuestion = (conversation) => {
    const question = conversation?.pendingQuestion;
    return question?.status === "pending" && question.question ? question : null;
  };

  const waitForConversationToFinish = async (conversationId, initialConversation) => {
    const start = Date.now();
    let current = initialConversation;
    while (Date.now() - start < RUNNING_TIMEOUT_MS) {
      const data = await getConversation(conversationId);
      current = data.conversation || current;
      if (getPendingQuestion(current)) return current;
      if (!data.running) return current;
      await delay(RUNNING_POLL_MS, controller.signal);
    }
    return current;
  };

  const sendToConversation = async (conversation, text) => {
    const responseText = await appFetch(`/api/conversations/${encodeURIComponent(conversation.id)}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: text, source: "telegram" }),
    });
    const lines = responseText.split(/\n+/).filter(Boolean);
    let finalConversation = null;
    let finalText = "";
    let running = false;
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.conversation) finalConversation = event.conversation;
        if (typeof event.content === "string") finalText = event.content;
        if (event.running === true) running = true;
      } catch {}
    }
    if (!finalConversation) {
      try {
        const parsed = JSON.parse(responseText || "{}");
        finalConversation = parsed?.conversation;
        if (parsed?.running === true) running = true;
      } catch {}
    }
    if (running && finalConversation?.id) {
      finalConversation = await waitForConversationToFinish(finalConversation.id, finalConversation);
    }
    return {
      text: latestAssistantText(finalConversation, finalText || "Ответ пока не получен. Проверь чат в AI Free."),
      conversation: finalConversation,
      question: getPendingQuestion(finalConversation),
    };
  };

  const sendConversationResult = async (chatId, result) => {
    if (result?.question && result?.conversation?.id) {
      await sendMessage(chatId, formatTelegramQuestion(result.question), {
        reply_markup: buildTelegramQuestionKeyboard(result.conversation.id, result.question),
      });
      return;
    }
    await sendMessage(chatId, result?.text || "Готово.", {
      reply_markup: buildTelegramChatActionsKeyboard(),
    });
  };

  const showMenu = async (chatId, text = "AI Free bot") => {
    await sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Чаты", callback_data: "chats" }, { text: "Новый DeepSeek", callback_data: "new:deepseek" }],
          [{ text: "Новый Qwen", callback_data: "new:qwen" }, { text: "Новый ChatGPT", callback_data: "new:chatgpt" }],
        ],
      },
    });
  };

  const sendConversationList = async (chatId) => {
    const state = await getState();
    const conversations = state.conversations || [];
    await sendMessage(chatId, formatTelegramConversationList(conversations, state.activeConversationId), {
      reply_markup: buildTelegramConversationKeyboard(conversations),
    });
  };

  const cancelNewConversation = async (chatId) => {
    clearPendingNew(chatId);
    await sendMessage(chatId, "Создание чата отменено. Выбери чат или создай новый:");
    await sendConversationList(chatId);
  };

  const bindChatIfNeeded = async (chatId) => {
    const settings = loadSettings();
    if (settings.telegram?.chatId) return settings;
    return saveSettings({
      ...settings,
      telegram: {
        ...settings.telegram,
        enabled: true,
        chatId: String(chatId),
      },
    });
  };

  const handleMessage = async (message) => {
    const chatId = message?.chat?.id;
    const text = String(message?.text || "").trim();
    if (!chatId || !text) return;
    const settings = loadSettings();
    if (!settings.telegram?.enabled || !settings.telegram?.botToken) return;
    if (!isTelegramChatAllowed(settings, chatId)) {
      await sendMessage(chatId, "Этот бот уже привязан к другому Telegram-чату.");
      return;
    }

    const command = parseTelegramCommand(text);
    if (command?.command === "start") {
      await bindChatIfNeeded(chatId);
      await showMenu(chatId, "Готово. Telegram-чат привязан к AI Free.");
      return;
    }
    if (command?.command === "help" || command?.command === "menu") {
      await showMenu(chatId, "Команды: /chats, /new [deepseek|qwen|chatgpt] название. При создании чата бот спросит проект.");
      return;
    }
    if (command?.command === "chats") {
      await sendConversationList(chatId);
      return;
    }
    if (command?.command === "cancel") {
      await cancelNewConversation(chatId);
      return;
    }
    if (command?.command === "new") {
      const parsed = resolveTelegramProviderAndTitle(command.args);
      await showProjectPicker(chatId, parsed.provider, parsed.title);
      return;
    }
    if (command?.command === "close" || command?.command === "exit") {
      closeActiveConversation(chatId);
      await sendMessage(chatId, "Вышел из текущего чата. Выбери другой: /chats");
      return;
    }
    if (command?.command === "select") {
      if (!command.args) {
        await sendConversationList(chatId);
        return;
      }
      const conversation = await selectConversation(chatId, command.args);
      await sendMessage(chatId, `Выбран чат: [${conversation.provider}] ${conversation.title}`, {
        reply_markup: buildTelegramChatActionsKeyboard(),
      });
      return;
    }

    const pendingNew = getPendingNew(chatId);
    if (pendingNew?.awaitingFolderName) {
      const parent = pendingNew.browse?.path;
      if (!parent) {
        await sendMessage(chatId, "Не вижу текущую папку. Открой проводник заново.");
        return;
      }
      const result = await createBrowseDirectory(parent, text);
      await showDirectoryBrowser(chatId, result.path);
      return;
    }

    const conversation = await getActiveConversation(chatId);
    if (!conversation) {
      await sendMessage(chatId, "Сначала выбери чат:", {
        reply_markup: buildTelegramConversationKeyboard((await getState()).conversations || []),
      });
      return;
    }
    await sendMessage(chatId, `Отправил в [${conversation.provider}] ${conversation.title}. Жду ответ...`);
    await sendConversationResult(chatId, await sendToConversation(conversation, text));
  };

  const handleCallback = async (callback) => {
    const chatId = callback?.message?.chat?.id;
    const data = String(callback?.data || "");
    if (!chatId) return;
    await request("answerCallbackQuery", { callback_query_id: callback.id }).catch(() => {});
    if (data === "chats") {
      await sendConversationList(chatId);
      return;
    }
    if (data === "noop") {
      await sendMessage(chatId, "Напиши ответ обычным сообщением.");
      return;
    }
    if (data === "cancel-new") {
      await cancelNewConversation(chatId);
      return;
    }
    if (data.startsWith("select:")) {
      const conversation = await selectConversation(chatId, data.slice("select:".length));
      const full = (await getConversation(conversation.id)).conversation || conversation;
      const question = getPendingQuestion(full);
      if (question) {
        await sendMessage(chatId, `Открыт чат: [${conversation.provider}] ${conversation.title}`);
        await sendMessage(chatId, formatTelegramQuestion(question), {
          reply_markup: buildTelegramQuestionKeyboard(conversation.id, question),
        });
      } else {
        await sendMessage(chatId, `Открыт чат: [${conversation.provider}] ${conversation.title}`, {
          reply_markup: buildTelegramChatActionsKeyboard(),
        });
      }
      return;
    }
    if (data.startsWith("q:")) {
      const [, conversationId, rawIndex] = data.split(":");
      const full = (await getConversation(conversationId)).conversation;
      const question = getPendingQuestion(full);
      const choiceIndex = Number.parseInt(rawIndex, 10);
      const choice = Array.isArray(question?.choices) ? question.choices[choiceIndex] : "";
      if (!full || !question || !choice) {
        await sendMessage(chatId, "Вопрос уже не актуален. Посмотри текущий чат:", {
          reply_markup: buildTelegramConversationKeyboard((await getState()).conversations || []),
        });
        return;
      }
      sessions.set(String(chatId), { conversationId: full.id, closed: false });
      await sendMessage(chatId, `Ответ: ${choice}`);
      await sendConversationResult(chatId, await sendToConversation(full, choice));
      return;
    }
    if (data === "close") {
      closeActiveConversation(chatId);
      await sendMessage(chatId, "Вышел из текущего чата. Выбери другой:", {
        reply_markup: buildTelegramConversationKeyboard((await getState()).conversations || []),
      });
      return;
    }
    if (data.startsWith("new:")) {
      const provider = data.slice(4);
      const safeProvider = PROVIDERS.has(provider) ? provider : "deepseek";
      await showProjectPicker(chatId, safeProvider, `Telegram ${safeProvider}`);
      return;
    }
    if (data.startsWith("project:")) {
      const selector = data.slice("project:".length);
      const pendingNew = getPendingNew(chatId);
      if (!pendingNew) {
        await sendMessage(chatId, "Сначала начни создание чата: /new deepseek Название");
        return;
      }
      if (selector === "new") {
        await showDirectoryBrowser(chatId);
        return;
      }
      const index = Number.parseInt(selector, 10);
      const projects = (await getProjects()).projects || [];
      const project = Number.isFinite(index) ? projects[index] : null;
      if (!project?.path) {
        await sendMessage(chatId, "Проект не найден. Открой список заново:", {
          reply_markup: buildTelegramProjectKeyboard(projects),
        });
        return;
      }
      await finishNewConversation(chatId, project.path, false);
      return;
    }
    if (data.startsWith("browse:")) {
      const action = data.slice("browse:".length);
      const pendingNew = getPendingNew(chatId);
      if (!pendingNew) {
        await sendMessage(chatId, "Сначала начни создание чата: /new deepseek Название");
        return;
      }
      const browse = pendingNew.browse || {};
      if (action === "select") {
        await finishNewConversation(chatId, browse.path || workspaceRoot, false);
        return;
      }
      if (action === "up") {
        await showDirectoryBrowser(chatId, browse.parent || browse.path || "");
        return;
      }
      if (action === "mkdir") {
        setPendingNew(chatId, { ...pendingNew, awaitingFolderName: true });
        await sendMessage(chatId, "Напиши имя новой папки. Например: my-project");
        return;
      }
      if (action === "projects") {
        await showProjectPicker(chatId, pendingNew.provider, pendingNew.title);
        return;
      }
      if (action.startsWith("dir:")) {
        const index = Number.parseInt(action.slice(4), 10);
        const entry = Number.isFinite(index) ? browse.entries?.[index] : null;
        if (!entry?.path) {
          await showDirectoryBrowser(chatId, browse.path || "");
          return;
        }
        await showDirectoryBrowser(chatId, entry.path);
        return;
      }
      if (action.startsWith("root:")) {
        const rootName = action.slice(5);
        const rootPath = browse.roots?.[rootName] || "";
        await showDirectoryBrowser(chatId, rootPath);
        return;
      }
    }
  };

  const loop = async () => {
    while (!controller.signal.aborted) {
      const settings = loadSettings();
      const token = String(settings.telegram?.botToken || "").trim();
      if (!settings.telegram?.enabled || !token) {
        await delay(IDLE_DELAY_MS, controller.signal);
        continue;
      }
      if (!started) {
        started = true;
        log("[telegram] bot polling started");
      }
      try {
        const updates = await request("getUpdates", {
          offset,
          timeout: POLL_TIMEOUT_SEC,
          allowed_updates: ["message", "callback_query"],
        }) || [];
        for (const update of updates) {
          offset = Math.max(offset, Number(update.update_id || 0) + 1);
          try {
            if (update.message) await handleMessage(update.message);
            if (update.callback_query) await handleCallback(update.callback_query);
          } catch (error) {
            const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
            if (chatId) await sendMessage(chatId, `Ошибка: ${error.message}`).catch(() => {});
            log(`[telegram] update failed: ${error.message}`);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          log(`[telegram] polling error: ${error.message}`);
          await delay(IDLE_DELAY_MS, controller.signal).catch(() => {});
        }
      }
    }
  };

  loop().catch((error) => log(`[telegram] bot stopped: ${error.message}`));
  return {
    stop() {
      controller.abort();
    },
  };
}

function splitTelegramMessage(text) {
  const value = String(text || "").trim() || "[empty]";
  const chunks = [];
  for (let index = 0; index < value.length; index += MAX_TELEGRAM_MESSAGE) {
    chunks.push(value.slice(index, index + MAX_TELEGRAM_MESSAGE));
  }
  return chunks;
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      }, { once: true });
    }
  });
}
