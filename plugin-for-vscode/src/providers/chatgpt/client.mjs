// Клиент ChatGPT поверх веб-сессии (как Qwen): отправка идёт через настоящий
// интерфейс chatgpt.com в фоновом браузере. Никаких PoW/Turnstile в Node —
// React-фронтенд сам подписывает запросы. Вся механика в browser-proxy.mjs.

import {
  getChatGPTBrowserProxy,
  resetChatGPTBrowserProxy,
  scheduleChatGPTBrowserIdleClose,
} from "./browser-proxy.mjs";
import { createFileLogger } from "../../logging/logger.mjs";

const providerLogger = createFileLogger({ component: "provider.chatgpt" });

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
  async complete({ prompt, model = null, onText = null, conversationId = null, images = [] }) {
    const startedAt = Date.now();
    providerLogger.info("provider.chatgpt.request", {
      model,
      conversationId,
      promptChars: String(prompt || "").length,
      imageCount: images.length,
    });
    try {
      try {
        const proxy = await this.proxyFactory({ debug: this.debug });
        const result = await proxy.sendChat({ prompt, model, conversationId, onText, images });
        providerLogger.info("provider.chatgpt.success", {
          model,
          responseChars: String(result?.text || "").length,
          durationMs: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        if (!isChatGPTTransportError(error)) throw error;
        providerLogger.warn("provider.chatgpt.retry", {
          model,
          reason: error.message,
          durationMs: Date.now() - startedAt,
        });
        if (this.debug) console.log(`[chatgpt-client] browser transport reset: ${error.message}`);
        resetChatGPTBrowserProxy();
        const proxy = await this.proxyFactory({ debug: this.debug });
        const result = await proxy.sendChat({ prompt, model, conversationId, onText, images });
        providerLogger.info("provider.chatgpt.success", {
          model,
          retried: true,
          responseChars: String(result?.text || "").length,
          durationMs: Date.now() - startedAt,
        });
        return result;
      }
    } catch (error) {
      providerLogger.error("provider.chatgpt.error", error, {
        model,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    } finally {
      scheduleChatGPTBrowserIdleClose();
    }
  }
}

function isChatGPTTransportError(error) {
  const message = String(error?.message || error || "");
  return /Execution context was destroyed|Target page, context or browser has been closed|Target closed|Page closed|Context closed|Browser has been closed|page\.waitForTimeout|Failed to fetch|request is finished/i.test(message);
}
