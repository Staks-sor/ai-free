import { browserRequestPolicies } from "../browser-request-policy.mjs";
import { measureProviderExchange } from "../../diagnostics/runtime-metrics.mjs";
import {
  getGLMBrowserProxy,
  resetGLMBrowserProxy,
} from "./browser-proxy.mjs";
import { createFileLogger } from "../../logging/logger.mjs";
import { toProviderImageFiles } from "../image-input.mjs";

const providerLogger = createFileLogger({ component: "provider.glm" });

export class GLMChatClient {
  constructor({
    debug = false,
    accountId = "default",
    proxyFactory = getGLMBrowserProxy,
    resetProxy = resetGLMBrowserProxy,
  } = {}) {
    this.accountId = accountId;
    this.debug = debug;
    this.proxyFactory = proxyFactory;
    this.resetProxy = resetProxy;
  }

  async complete({ prompt, model = null, conversationId = null, images = [], onText = null, signal = null, humanReadable = false }) {
    const startedAt = Date.now();
    const imageFiles = toProviderImageFiles(images);
    providerLogger.info("provider.glm.request", {
      conversationId,
      promptChars: String(prompt || "").length,
      imageCount: imageFiles.length,
    });
    const result = await this.completeViaBrowser({
      prompt: humanReadable
        ? `${prompt}\n\nРежим обычного чата SYNVOX: ответь человеку естественным текстом. Не выводи служебные JSON/XML-вызовы инструментов; здесь они не выполняются.`
        : prompt,
      model, conversationId, images: imageFiles, onText: humanReadable ? null : onText, signal, startedAt,
    });
    if (!humanReadable) return result;
    if (!isGLMToolProtocolReply(result.text)) {
      onText?.(result.text);
      return result;
    }
    const sameThread = /^https:\/\/chat\.z\.ai\/c\//i.test(String(result.conversationId || ""));
    const corrected = await this.completeViaBrowser({
      prompt: `${sameThread ? "" : `Вопрос пользователя:\n${prompt}\n\n`}Предыдущий ответ был служебным вызовом инструмента. Это обычный чат: ответь на вопрос пользователя обычным текстом, без JSON/XML-команд. Ничего не выполнялось; не утверждай обратное. Если нужна работа с файлами, объясни, что для неё нужен режим Coder.`,
      model: result.model || model,
      conversationId: result.conversationId || conversationId,
      signal,
      startedAt,
    });
    const text = isGLMToolProtocolReply(corrected.text)
      ? "GLM вернул команду вместо ответа. В обычном чате инструменты не выполнялись. Для работы с файлами переключитесь в режим Coder; для объяснения задайте вопрос без команды."
      : corrected.text;
    onText?.(text);
    return { ...corrected, text };
  }

  async completeViaBrowser({ prompt, model = null, conversationId = null, images = [], onText = null, signal = null, startedAt = Date.now() }) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      signal?.throwIfAborted();
      browserRequestPolicies.glm.assertAvailable(this.accountId);
      let proxyReady = false;
      try {
        const proxy = await this.proxyFactory({ debug: this.debug, accountId: this.accountId });
        proxyReady = true;
        const result = await measureProviderExchange("glm", probe => proxy.sendChat({ prompt, model, conversationId, images, onText: probe.onText, signal, accountId: this.accountId }), { onText, attempt });
        providerLogger.info("provider.glm.success", {
          responseChars: String(result?.text || "").length,
          durationMs: Date.now() - startedAt,
          attempt,
        });
        return result;
      } catch (error) {
        if (!proxyReady) error.delivery = 'not_sent';
        providerLogger.error("provider.glm.error", error, {
          durationMs: Date.now() - startedAt,
          attempt,
        });
        const recoverable = /Target (?:page, context or browser has been |closed)|Page closed|Context closed|Execution context was destroyed|GLM temporary response failure|locator\.click: Timeout[\s\S]*#send-message-button|GLM blocking dialog overlay|dialog overlay intercepts pointer events/i
          .test(String(error?.message || error));
        if (attempt === 1 && recoverable && error.delivery === "not_sent" && error?.promptSubmitted !== true && !signal?.aborted) {
          await this.resetProxy(this.accountId);
          continue;
        }
        throw error;
      }
    }
  }
}

function isGLMToolProtocolReply(value) {
  const text = String(value || "").trim();
  return /^<workspace_file\b[\s\S]*<\/workspace_file>$/i.test(text)
    || /^\{\s*"tool"\s*:\s*"(?:run_command|run_shell|read_file|write_file|append_file|list_files|mkdir|delete_file|delete_dir|finish)"/i.test(text);
}
