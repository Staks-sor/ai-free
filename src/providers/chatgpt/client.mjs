// Клиент ChatGPT поверх веб-сессии (как Qwen): отправка идёт через настоящий
// интерфейс chatgpt.com в фоновом браузере. Никаких PoW/Turnstile в Node —
// React-фронтенд сам подписывает запросы. Вся механика в browser-proxy.mjs.

import { getChatGPTBrowserProxy } from "./browser-proxy.mjs";

export class ChatGPTChatClient {
  constructor({ accessToken, cookies, cookieHeader, userAgent, debug = false }) {
    this.accessToken = accessToken;
    this.cookies = cookies || [];
    this.cookieHeader = cookieHeader || "";
    this.userAgent = userAgent || "";
    this.debug = debug;
  }

  setAuth({ accessToken, cookies, cookieHeader }) {
    if (accessToken) this.accessToken = accessToken;
    if (cookies) this.cookies = cookies;
    if (cookieHeader) this.cookieHeader = cookieHeader;
  }

  // model/parentMessageId не используются: модель берётся та, что выбрана в веб-UI,
  // а цепочка контекста ведётся самим ChatGPT через conversationId.
  // images: [{ name, mimeType, dataBase64 }] — прикрепляются в веб-композер ChatGPT.
  async complete({ prompt, onText = null, conversationId = null, images = [] }) {
    if (!this.accessToken) {
      throw new Error("ChatGPT access token is missing. Войди в ChatGPT заново через кнопку авторизации.");
    }

    const proxy = await getChatGPTBrowserProxy({ debug: this.debug });
    return proxy.sendChat({ prompt, conversationId, onText, images });
  }
}
