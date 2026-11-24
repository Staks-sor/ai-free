import { browserRequestPolicies } from "../browser-request-policy.mjs";
import { measureProviderExchange } from "../../diagnostics/runtime-metrics.mjs";
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
  constructor({ accessToken, cookies, cookieHeader, userAgent, debug = false, accountId = "default", proxyFactory = getChatGPTBrowserProxy, resetProxy = resetChatGPTBrowserProxy }) {
    this.accessToken = accessToken;
    this.cookies = cookies || [];
    this.cookieHeader = cookieHeader || "";
    this.userAgent = userAgent || "";
    this.accountId = accountId;
    this.debug = debug;
    this.proxyFactory = proxyFactory;
    this.resetProxy = resetProxy;
  }

  setAuth({ accessToken, cookies, cookieHeader }) {
    if (accessToken) this.accessToken = accessToken;
    if (cookies) this.cookies = cookies;
    if (cookieHeader) this.cookieHeader = cookieHeader;
  }

  // model/parentMessageId не используются: модель берётся та, что выбрана в веб-UI,
  // а цепочка контекста ведётся самим ChatGPT через conversationId.
  // images: [{ name, mimeType, dataBase64 }] — прикрепляются в веб-композер ChatGPT.
  async complete({ prompt, model = null, onText = null, conversationId = null, images = [], signal = null }) {
    signal?.throwIfAborted();
    browserRequestPolicies.chatgpt.assertAvailable(this.accountId);
    const startedAt = Date.now();
    providerLogger.info("provider.chatgpt.request", {
      model,
      conversationId,
      promptChars: String(prompt || "").length,
      imageCount: images.length,
    });
    try {
      try {
        const proxy = await this.proxyFactory({ debug: this.debug, accountId: this.accountId });
        signal?.throwIfAborted();
        const result = await measureProviderExchange("chatgpt", probe => proxy.sendChat({ prompt, model, conversationId, onText: probe.onText, images, signal, accountId: this.accountId }), { onText, attempt: 1 });
        providerLogger.info("provider.chatgpt.success", {
          model,
          responseChars: String(result?.text || "").length,
          durationMs: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        if (signal?.aborted || error?.promptSubmitted || error?.delivery !== "not_sent" || !isChatGPTTransportError(error)) throw error;
        providerLogger.warn("provider.chatgpt.retry", {
          model,
          reason: error.message,
          durationMs: Date.now() - startedAt,
        });
        if (this.debug) console.log(`[chatgpt-client] browser transport reset: ${error.message}`);
        await this.resetProxy(this.accountId);
        const proxy = await this.proxyFactory({ debug: this.debug, accountId: this.accountId });
        signal?.throwIfAborted();
        const result = await measureProviderExchange("chatgpt", probe => proxy.sendChat({ prompt, model, conversationId, onText: probe.onText, images, signal, accountId: this.accountId }), { onText, attempt: 2 });
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
      if (this.accountId === "default") scheduleChatGPTBrowserIdleClose();
    }
  }
}

function isChatGPTTransportError(error) {
  const message = String(error?.message || error || "");
  return /Execution context was destroyed|Target page, context or browser has been closed|Target closed|Page closed|Context closed|Browser has been closed|page\.waitForTimeout|Failed to fetch|request is finished/i.test(message);
}
