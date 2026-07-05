import { loadSettings, saveSettings } from "../state/settings.mjs";

const PROVIDERS = new Set(["deepseek", "qwen", "chatgpt"]);
const POLL_TIMEOUT_SEC = 25;
const IDLE_DELAY_MS = 3000;
const MAX_TELEGRAM_MESSAGE = 3900;

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
    const marker = conversation.id === activeConversationId ? ">" : " ";
    const provider = conversation.provider || "deepseek";
    const title = conversation.title || "Untitled";
    return `${marker} ${index + 1}. [${provider}] ${title}\n   /select ${index + 1}`;
  }).join("\n");
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

  const createConversation = async (provider, title) => {
    const body = JSON.stringify({ provider, title, workspace: workspaceRoot });
    const data = JSON.parse(await appFetch("/api/conversations", { method: "POST", body }));
    return data.conversation;
  };

  const selectConversation = async (chatId, selector) => {
    const state = await getState();
    const conversations = state.conversations || [];
    const index = Number.parseInt(String(selector || ""), 10);
    const conversation = Number.isFinite(index) && index > 0
      ? conversations[index - 1]
      : conversations.find((item) => item.id === selector);
    if (!conversation) throw new Error("Чат не найден. Посмотри список: /chats");
    await appFetch(`/api/conversations/${encodeURIComponent(conversation.id)}`, { method: "GET" });
    sessions.set(String(chatId), { conversationId: conversation.id });
    return conversation;
  };

  const getActiveConversation = async (chatId) => {
    const session = sessions.get(String(chatId));
    const state = await getState();
    const conversations = state.conversations || [];
    let conversation = conversations.find((item) => item.id === session?.conversationId);
    if (!conversation && state.activeConversationId) {
      conversation = conversations.find((item) => item.id === state.activeConversationId);
    }
    if (!conversation) conversation = await createConversation("deepseek", "Telegram");
    sessions.set(String(chatId), { conversationId: conversation.id });
    return conversation;
  };

  const sendToConversation = async (conversation, text) => {
    const responseText = await appFetch(`/api/conversations/${encodeURIComponent(conversation.id)}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: text }),
    });
    const lines = responseText.split(/\n+/).filter(Boolean);
    let finalConversation = null;
    let finalText = "";
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.conversation) finalConversation = event.conversation;
        if (typeof event.content === "string") finalText = event.content;
      } catch {}
    }
    if (!finalConversation) {
      try {
        finalConversation = JSON.parse(responseText || "{}")?.conversation;
      } catch {}
    }
    const assistant = finalConversation?.messages?.slice().reverse().find((message) => message.role === "assistant");
    return String(assistant?.content || finalText || "Задача запущена. Статус можно посмотреть в приложении.").trim();
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
      await showMenu(chatId, "Команды: /chats, /new [deepseek|qwen|chatgpt] название, /select N");
      return;
    }
    if (command?.command === "chats") {
      const state = await getState();
      await sendMessage(chatId, formatTelegramConversationList(state.conversations || [], state.activeConversationId));
      return;
    }
    if (command?.command === "new") {
      const parsed = resolveTelegramProviderAndTitle(command.args);
      const conversation = await createConversation(parsed.provider, parsed.title);
      sessions.set(String(chatId), { conversationId: conversation.id });
      await sendMessage(chatId, `Создан чат: [${conversation.provider}] ${conversation.title}`);
      return;
    }
    if (command?.command === "select") {
      const conversation = await selectConversation(chatId, command.args);
      await sendMessage(chatId, `Выбран чат: [${conversation.provider}] ${conversation.title}`);
      return;
    }

    const conversation = await getActiveConversation(chatId);
    await sendMessage(chatId, `Отправил в [${conversation.provider}] ${conversation.title}. Жду ответ...`);
    const answer = await sendToConversation(conversation, text);
    await sendMessage(chatId, answer);
  };

  const handleCallback = async (callback) => {
    const chatId = callback?.message?.chat?.id;
    const data = String(callback?.data || "");
    if (!chatId) return;
    await request("answerCallbackQuery", { callback_query_id: callback.id }).catch(() => {});
    if (data === "chats") {
      const state = await getState();
      await sendMessage(chatId, formatTelegramConversationList(state.conversations || [], state.activeConversationId));
      return;
    }
    if (data.startsWith("new:")) {
      const provider = data.slice(4);
      const conversation = await createConversation(PROVIDERS.has(provider) ? provider : "deepseek", `Telegram ${provider}`);
      sessions.set(String(chatId), { conversationId: conversation.id });
      await sendMessage(chatId, `Создан чат: [${conversation.provider}] ${conversation.title}`);
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
