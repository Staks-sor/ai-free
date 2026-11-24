import { browserRequestPolicies } from "../browser-request-policy.mjs";
import { measureProviderExchange } from "../../diagnostics/runtime-metrics.mjs";
import {
  getGoogleAIBrowserProxy,
  resetGoogleAIBrowserProxy,
} from "./browser-proxy.mjs";
import { createFileLogger } from "../../logging/logger.mjs";

const providerLogger = createFileLogger({ component: "provider.google-ai" });

export class GoogleAIChatClient {
  constructor({ debug = false, accountId = "default", proxyFactory = getGoogleAIBrowserProxy, resetProxy = resetGoogleAIBrowserProxy, onAuthRequired = null } = {}) {
    this.accountId = accountId;
    this.debug = debug;
    this.proxyFactory = proxyFactory;
    this.resetProxy = resetProxy;
    this.onAuthRequired = onAuthRequired;
  }

  async complete({ prompt, conversationId = null, images = [], onText = null, signal = null }) {
    const startedAt = Date.now();
    providerLogger.info("provider.google-ai.request", {
      conversationId,
      promptChars: String(prompt || "").length,
      imageCount: Array.isArray(images) ? images.length : 0,
    });
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      signal?.throwIfAborted();
      browserRequestPolicies.googleai.assertAvailable(this.accountId);
      let proxyReady = false;
      try {
        const proxy = await this.proxyFactory({ debug: this.debug, accountId: this.accountId });
        proxyReady = true;
        const result = await measureProviderExchange("google-ai", probe => proxy.sendChat({ prompt, conversationId, images, onText: probe.onText, signal, accountId: this.accountId }), { onText, attempt });
        providerLogger.info("provider.google-ai.success", {
          responseChars: String(result?.text || "").length,
          durationMs: Date.now() - startedAt,
          attempt,
        });
        return result;
      } catch (error) {
        if (!proxyReady) error.delivery = 'not_sent';
        providerLogger.error("provider.google-ai.error", error, {
          durationMs: Date.now() - startedAt,
          attempt,
        });
        const recoverable = /Target (?:page, context or browser has been |closed)|Page closed|Context closed|Execution context was destroyed/i
          .test(String(error?.message || error));
        if (/Google AI не авторизован/i.test(String(error?.message || error)) && !signal?.aborted) {
          await this.onAuthRequired?.();
          throw error;
        }
        if (attempt === 1 && recoverable && error.delivery === "not_sent" && error.promptSubmitted !== true && !signal?.aborted) {
          await this.resetProxy(this.accountId);
          continue;
        }
        throw error;
      }
    }
  }
}
