// Клиент ChatGPT поверх веб-сессии (как Qwen): отправка идёт через настоящий
// интерфейс chatgpt.com в фоновом браузере. Никаких PoW/Turnstile в Node —
// React-фронтенд сам подписывает запросы. Вся механика в browser-proxy.mjs.

import { getChatGPTBrowserProxy, resetChatGPTBrowserProxy } from "./browser-proxy.mjs";

export class ChatGPTChatClient {
  constructor({ accessToken, cookies, cookieHeader, userAgent, debug = false, proxyFactory = getChatGPTBrowserProxy }) {
    this.accessToken = accessToken;
    this.cookies = cookies || [];
    this.cookieHeader = cookieHeader || "";
    this.userAgent = userAgent || "";
    this.debug = debug;
    this.proxyFactory = proxyFactory;
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
    try {
      const proxy = await this.proxyFactory({ debug: this.debug });
      return await proxy.sendChat({ prompt, conversationId, onText, images });
    } catch (error) {
      if (!isChatGPTTransportError(error)) throw error;
      if (this.debug) console.log(`[chatgpt-client] browser transport reset: ${error.message}`);
      resetChatGPTBrowserProxy();
      const proxy = await this.proxyFactory({ debug: this.debug });
      return proxy.sendChat({ prompt, conversationId, onText, images });
    }
  }
}

function isChatGPTTransportError(error) {
  const message = String(error?.message || error || "");
  return /Execution context was destroyed|Target page, context or browser has been closed|Target closed|Page closed|Context closed|Browser has been closed|page\.waitForTimeout|Failed to fetch|request is finished/i.test(message);
}
