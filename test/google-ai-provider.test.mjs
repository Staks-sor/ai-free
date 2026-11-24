import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  buildGoogleAIQueryUrl,
  classifyGoogleAIPageState,
  getGoogleAIAnswerTimeoutError,
  saveGoogleAIAnswerTimeoutScreenshot,
  summarizeGoogleAIAnswerDiagnostics,
  getGoogleAIBrowserLaunchConfig,
  getGoogleAITurnDelayMs,
  isFreshGoogleAIAnswer,
  isGoogleAIAnswerReady,
  normalizeGoogleAIImages,
  normalizeGoogleAIAnswer,
  readGoogleAIPageState,
  selectGoogleAIAnswerText,
  submitGoogleAIComposer,
} from "../src/providers/google-ai/browser-proxy.mjs";
import { captureBrowserDiagnosticScreenshot, summarizeBrowserDiagnosticError } from "../src/providers/browser-diagnostics.mjs";
import { createWebAccountAdapters, isGoogleAIDebugEnabled } from "../src/providers/web-account-adapters.mjs";
import { GoogleAIChatClient } from "../src/providers/google-ai/client.mjs";
import { migrateLegacyCodeSession } from "../src/window-app/agent-task.mjs";
import { createGoogleAIAgentAdapter } from "../src/providers/google-ai/agent-adapter.mjs";
import { invalidateGoogleAIAuth, isGoogleAIAuthUsable } from "../src/providers/google-ai/auth-files.mjs";
import { loginGoogleAIAndSave } from "../src/providers/google-ai/browser-login.mjs";
import { ensureGoogleAIStorageState } from "../src/providers/google-ai/storage-state.mjs";
import { buildCamoufoxContextOptions, saveCamoufoxFingerprint } from "../src/browser/camoufox-runtime.mjs";
import { incrementalBrowserStreamDelta } from "../api/openai-handler.mjs";
import {
  getProviderCatalog,
  getProviderIds,
  findModel,
} from "../packages/core/src/providers/model-catalog.mjs";

describe("Google AI Mode provider", () => {
  it("separates a legacy Coder thread from ordinary chat without losing it", () => {
    const conversation = { provider: "googleai", sessionId: "legacy-code-thread", codeParentMessageId: "m1" };
    migrateLegacyCodeSession(conversation);
    assert.equal(conversation.codeSessionId, "legacy-code-thread");
    assert.equal(conversation.sessionId, null);
    migrateLegacyCodeSession(conversation);
    assert.equal(conversation.codeSessionId, "legacy-code-thread");
  });
  it("is exposed by the shared catalog and OpenAI-compatible model list", () => {
    assert.ok(getProviderIds().includes("googleai"));
    assert.equal(getProviderCatalog("googleai").defaultModel, "google-ai-mode");
    assert.equal(findModel("google-ai-mode").provider, "googleai");
  });

  it("builds an AI Mode URL without losing Unicode or multiline prompts", () => {
    const url = new URL(buildGoogleAIQueryUrl("Новости ИИ\nза сегодня"));
    assert.equal(url.origin, "https://www.google.com");
    assert.equal(url.searchParams.get("udm"), "50");
    assert.equal(url.searchParams.get("q"), "Новости ИИ\nза сегодня");
  });

  it("submits long composer prompts with the visible send button", async () => {
    let clicks = 0;
    let enterPresses = 0;
    const sendButton = {
      waitFor: async () => {},
      click: async () => { clicks += 1; },
    };
    const page = {
      getByRole: () => ({
        filter: () => ({ first: () => sendButton }),
      }),
    };
    const composer = {
      press: async () => { enterPresses += 1; },
    };

    await submitGoogleAIComposer(page, composer);

    assert.equal(clicks, 1);
    assert.equal(enterPresses, 0);
  });

  it("removes Google status/disclaimer text but keeps the answer", () => {
    assert.equal(
      normalizeGoogleAIAnswer("AI Free работает.\nОтвет от режима ИИ готов.\nВ ответах искусственного интеллекта могут быть ошибки."),
      "AI Free работает.",
    );
  });

  it("keeps every paragraph and list item from the current Google AI response", () => {
    assert.equal(
      selectGoogleAIAnswerText({
        responseContainerText: [
          "Вот три возможности:",
          "Анализ данных",
          "Создание текстов",
          "Автоматизация процессов",
          "Чем помочь?",
          "В ответах искусственного интеллекта могут быть ошибки. Подробнее…",
        ].join("\n"),
        directTexts: ["Вот три возможности:", "Чем помочь?"],
      }),
      "Вот три возможности:\nАнализ данных\nСоздание текстов\nАвтоматизация процессов\nЧем помочь?",
    );
  });

  it("waits for a new Google AI answer instead of returning the previous turn", () => {
    assert.equal(isFreshGoogleAIAnswer("Старый ответ", "Старый ответ"), false);
    assert.equal(isFreshGoogleAIAnswer("Старый ответ", "Новый ответ"), true);
    assert.equal(isFreshGoogleAIAnswer("", "Первый ответ"), true);
  });

  it("treats the image-answer copy control as a completed Google response", () => {
    assert.equal(isGoogleAIAnswerReady({ bodyText: "", copyButtonCount: 1 }), true);
    assert.equal(isGoogleAIAnswerReady({ bodyText: "Ответ от режима ИИ готов", copyButtonCount: 0 }), true);
    assert.equal(isGoogleAIAnswerReady({ bodyText: "Формирую ответ", copyButtonCount: 0 }), false);
  });

  it("keeps Google answer-timeout diagnostics free of page text and URLs", () => {
    assert.deepEqual(summarizeGoogleAIAnswerDiagnostics({
      directTextCount: 2,
      copyButtonCount: 1,
      previewImageCount: 1,
      readyMarkerPresent: true,
    }), {
      directTextCount: 2,
      copyButtonCount: 1,
      previewImageCount: 1,
      readyMarkerPresent: true,
    });
  });

  it("writes a private viewport screenshot for a debug-only Google timeout", async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-google-timeout-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    let screenshotOptions = null;

    const file = await saveGoogleAIAnswerTimeoutScreenshot({
      screenshot: async (options) => {
        screenshotOptions = options;
        return Buffer.from("png-fixture");
      },
    }, { tmpDir: directory, id: () => "fixture" });

    assert.equal(path.basename(file), "ai-free-google-ai-timeout-fixture.png");
    assert.deepEqual(screenshotOptions, { type: "png", timeout: 15_000 });
    assert.deepEqual(fs.readFileSync(file), Buffer.from("png-fixture"));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });

  it("uses one private browser diagnostic writer with a caller-defined safe label", async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-browser-diagnostic-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = await captureBrowserDiagnosticScreenshot({ screenshot: async () => Buffer.from("png") }, "glm-timeout", {
      tmpDir: directory,
      id: () => "fixture",
    });

    assert.equal(path.basename(file), "ai-free-glm-timeout-fixture.png");
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });

  it("falls back to a bounded Chromium screenshot and detaches the CDP session", async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-browser-cdp-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    let detached = 0;
    let method = "";
    const file = await captureBrowserDiagnosticScreenshot({
      screenshot: async () => { throw new Error("viewport capture failed"); },
      context: () => ({ newCDPSession: async () => ({
        send: async (value) => {
          method = value;
          return { data: Buffer.from("cdp-png").toString("base64") };
        },
        detach: async () => { detached += 1; },
      }) }),
    }, "glm-timeout", { tmpDir: directory, id: () => "fixture" });

    assert.equal(method, "Page.captureScreenshot");
    assert.equal(detached, 1);
    assert.deepEqual(fs.readFileSync(file), Buffer.from("cdp-png"));
  });

  it("formats a diagnostic failure as one redacted line", () => {
    assert.equal(
      summarizeBrowserDiagnosticError(new Error("capture https://host.test/?token=secret\nsecond line")),
      "Error: capture <url>",
    );
  });

  it("enables Google diagnostics for selected accounts with the existing debug flag", async () => {
    assert.equal(isGoogleAIDebugEnabled({}), false);
    assert.equal(isGoogleAIDebugEnabled({ DEEPSEEK_DEBUG_GOOGLE_AI: "1" }), true);
    const previous = process.env.DEEPSEEK_DEBUG_GOOGLE_AI;
    process.env.DEEPSEEK_DEBUG_GOOGLE_AI = "1";
    try {
      const client = await createWebAccountAdapters().googleai.buildClient({
        authFile: "/tmp/google-auth.json",
        profileDir: "/tmp/google-profile",
        fingerprintStatePath: "/tmp/google-fingerprint.json",
        storageStatePath: "/tmp/google-state.json",
      }, "selected");
      assert.equal(client.debug, true);
    } finally {
      if (previous === undefined) delete process.env.DEEPSEEK_DEBUG_GOOGLE_AI;
      else process.env.DEEPSEEK_DEBUG_GOOGLE_AI = previous;
    }
  });

  it("fails fast when Google AI never starts an answer", () => {
    assert.equal(
      getGoogleAIAnswerTimeoutError({ elapsedMs: 44_999, hasText: false }),
      null,
    );
    assert.equal(
      getGoogleAIAnswerTimeoutError({ elapsedMs: 45_000, hasText: false }),
      null,
    );
    assert.match(
      getGoogleAIAnswerTimeoutError({ elapsedMs: 120_000, hasText: false }).message,
      /не начал формировать ответ/i,
    );
    assert.equal(
      getGoogleAIAnswerTimeoutError({ elapsedMs: 45_000, hasText: true }),
      null,
    );
  });

  it("paces consecutive Google AI turns", () => {
    assert.equal(getGoogleAITurnDelayMs({ lastTurnStartedAt: 0, now: 10_000 }), 0);
    assert.equal(getGoogleAITurnDelayMs({ lastTurnStartedAt: 10_000, now: 14_000 }), 4_000);
    assert.equal(getGoogleAITurnDelayMs({ lastTurnStartedAt: 10_000, now: 19_000 }), 0);
  });

  it("does not replay a silent Google AI turn whose delivery is unknown", async () => {
    let proxyCalls = 0;
    let resetCalls = 0;
    let waits = 0;
    const client = new GoogleAIChatClient({
      proxyFactory: async () => ({
        sendChat: async () => {
          proxyCalls += 1;
          if (proxyCalls === 1) throw new Error("Google AI не начал формировать ответ.");
          return { text: "ok", conversationId: "new-thread", lastMessageId: null };
        },
      }),
      resetProxy: async () => { resetCalls += 1; },
      sleep: async () => { waits += 1; },
    });

    await assert.rejects(client.complete({ prompt: "test" }), /не начал формировать ответ/);
    assert.equal(proxyCalls, 1);
    assert.equal(resetCalls, 0);
    assert.equal(waits, 0);
  });

  it("stops after the first ambiguous Google AI turn", async () => {
    let proxyCalls = 0;
    let resetCalls = 0;
    const client = new GoogleAIChatClient({
      proxyFactory: async () => ({ sendChat: async () => {
        proxyCalls += 1;
        throw new Error("Google AI не начал формировать ответ.");
      } }),
      resetProxy: async () => { resetCalls += 1; },
      sleep: async () => {},
    });
    await assert.rejects(client.complete({ prompt: "test" }), /не начал формировать ответ/);
    assert.equal(proxyCalls, 1);
    assert.equal(resetCalls, 0);
  });

  it("starts visible reconnect when Google AI reports a signed-out session", async () => {
    let reconnects = 0;
    let proxyCalls = 0;
    const client = new GoogleAIChatClient({
      proxyFactory: async () => ({
        sendChat: async () => {
          proxyCalls += 1;
          throw new Error("Google AI не авторизован. Подключите Google AI в окне нового чата и завершите вход.");
        },
      }),
      onAuthRequired: async () => { reconnects += 1; },
    });

    await assert.rejects(client.complete({ prompt: "изучи проект" }), /не авторизован/);
    assert.equal(proxyCalls, 1);
    assert.equal(reconnects, 1);
  });

  it("does not retry after cancellation", async () => {
    let proxyCalls = 0;
    const controller = new AbortController();
    const client = new GoogleAIChatClient({
      proxyFactory: async () => ({
        sendChat: async () => {
          proxyCalls += 1;
          controller.abort();
          throw controller.signal.reason;
        },
      }),
      resetProxy: async () => assert.fail("cancelled requests must not reset and retry"),
    });

    await assert.rejects(
      () => client.complete({ prompt: "test", signal: controller.signal }),
      /abort/i,
    );
    assert.equal(proxyCalls, 1);
  });

  it("normalizes supported Google image attachments and rejects malformed data", () => {
    assert.deepEqual(normalizeGoogleAIImages([
      { name: "screen.png", mimeType: "image/png", dataBase64: "aW1hZ2U=" },
      { name: "bad.svg", mimeType: "image/svg+xml", dataBase64: "PHN2Zz4=" },
      { name: "empty.jpg", mimeType: "image/jpeg", dataBase64: "" },
    ]), [{
      name: "screen.png",
      mimeType: "image/png",
      buffer: Buffer.from("image"),
    }]);
  });

  it("forces Google Coder turns to return one workspace tool call", async () => {
    const calls = [];
    const adapter = createGoogleAIAgentAdapter({
      complete: async (options) => {
        calls.push(options);
        return { text: "{}", conversationId: "google-code-1", lastMessageId: null };
      },
    }, { images: [{ name: "screen.png", mimeType: "image/png", dataBase64: "aW1hZ2U=" }] });

    await adapter.complete({ prompt: "Inspect the project and fix the bug." });
    await adapter.complete({ prompt: "Continue after the tool result." });

    assert.equal(adapter.noToolTextRetries, 1);
    assert.match(calls[0].prompt, /Inspect the project and fix the bug\./);
    assert.ok(calls[0].prompt.length < 700);
    assert.match(calls[0].prompt, /одним JSON-объектом/i);
    assert.match(calls[0].prompt, /"tool":"list_files"/);
    assert.match(calls[0].prompt, /read_file\(path\)/);
    assert.match(calls[0].prompt, /write_file\(path,content\)/);
    assert.match(calls[0].prompt, /run_command\(cmd,args\)/);
    assert.equal(calls[0].images.length, 1);
    assert.deepEqual(calls[1].images, []);
  });

  it("starts a fresh Coder thread when the saved Google URL contains the obsolete tool protocol", async () => {
    const calls = [];
    const adapter = createGoogleAIAgentAdapter({
      complete: async (options) => {
        calls.push(options);
        return { text: '{"tool":"list_files","path":"."}', conversationId: "fresh-thread" };
      },
    }, {
      conversationId: buildGoogleAIQueryUrl("Task\n=== LOCAL WORKSPACE TOOLS ==="),
    });

    await adapter.complete({ prompt: "изучи проект" });

    assert.equal(calls[0].conversationId, null);
    assert.equal(adapter.getConversationId(), "fresh-thread");
  });

  it("renders compact task JSON as a short readable Google prompt", async () => {
    const prompts = [];
    const adapter = createGoogleAIAgentAdapter({
      complete: async ({ prompt }) => {
        prompts.push(prompt);
        return { text: '{"tool":"finish","message":"ok"}', conversationId: "readable", lastMessageId: null };
      },
    });

    await adapter.complete({
      prompt: JSON.stringify({
        type: "task",
        task: "проверь проект",
        context: { memory: "важная память", projectInstructions: "сначала тесты" },
      }),
    });

    assert.match(prompts[0], /^Task:\nпроверь проект/m);
    assert.match(prompts[0], /Memory:\nважная память/);
    assert.match(prompts[0], /Project instructions:\nсначала тесты/);
    assert.doesNotMatch(prompts[0], /\{"type":"task"/);
  });

  it("keeps literal [US] path text distinct from encoded underscores", async () => {
    const prompts = [];
    const adapter = createGoogleAIAgentAdapter({
      complete: async ({ prompt }) => {
        prompts.push(prompt);
        return {
          text: '{"tool":"delete_dir","path":"test[LITERAL-US]test"}',
          conversationId: "google-code-literal-path",
          lastMessageId: null,
        };
      },
    });

    const result = await adapter.complete({ prompt: "Удалить test[US]test" });

    assert.match(prompts[0], /Удалить test\[LITERAL-US\]test/);
    assert.deepEqual(adapter.parseToolCall(result.text), {
      tool: "delete_dir",
      path: "test[US]test",
    });
  });

  it("requires a confirmed signed-in profile marker", () => {
    assert.equal(isGoogleAIAuthUsable(null), false);
    assert.equal(isGoogleAIAuthUsable({ signedIn: false }), false);
    assert.equal(isGoogleAIAuthUsable({ signedIn: true, profileDir: "C:/profile" }), true);
    assert.equal(isGoogleAIAuthUsable({ signedIn: true, storageStatePath: "C:/google-state.json" }), true);
  });

  it("clears a rejected Google sign-in marker without deleting the saved session", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-google-expired-auth-"));
    const authFile = path.join(dir, "auth.json");
    fs.writeFileSync(authFile, JSON.stringify({ signedIn: true, storageStatePath: "saved-state.json" }));

    invalidateGoogleAIAuth(authFile);

    const auth = JSON.parse(fs.readFileSync(authFile, "utf8"));
    assert.equal(auth.signedIn, false);
    assert.equal(auth.storageStatePath, "saved-state.json");
  });

  it("uses visible Camoufox for Google sign-in and saves its browser state", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-google-login-"));
    const authFile = path.join(dir, "auth.json");
    const storageStatePath = path.join(dir, "storage-state.json");
    const launchOptions = [];
    let closed = false;
    const page = {
      goto: async () => {},
      bringToFront: async () => {},
      waitForFunction: async () => {},
      reload: async () => {},
      waitForTimeout: async () => {},
      evaluate: async () => ({ hasComposer: true, hasAccount: true, hasSignIn: false, accountLabel: "Google Account: test@example.com" }),
    };
    const context = {
      storageState: async ({ path: outputPath }) => fs.writeFileSync(outputPath, JSON.stringify({ cookies: [{ name: "session" }], origins: [] })),
    };

    await loginGoogleAIAndSave(authFile, {
      storageStatePath,
      launchSession: async (options) => {
        launchOptions.push(options);
        return { page, context, close: async () => { closed = true; } };
      },
    });

    assert.deepEqual(launchOptions.map((options) => options.headless), [false, true]);
    assert.equal(launchOptions[0].storageStatePath, storageStatePath);
    assert.ok(launchOptions[0].profileDir);
    assert.ok(launchOptions[0].fingerprintStatePath);
    assert.equal(launchOptions[1].profileDir, launchOptions[0].profileDir);
    assert.equal(closed, true);
    assert.equal(JSON.parse(fs.readFileSync(authFile, "utf8")).storageStatePath, storageStatePath);
    assert.equal(JSON.parse(fs.readFileSync(authFile, "utf8")).profileDir, launchOptions[0].profileDir);
    assert.equal(JSON.parse(fs.readFileSync(storageStatePath, "utf8")).cookies[0].name, "session");
  });

  it("does not accept login when a fresh hidden Camoufox is signed out", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-google-hidden-auth-"));
    const authFile = path.join(dir, "auth.json");
    await assert.rejects(loginGoogleAIAndSave(authFile, {
      storageStatePath: path.join(dir, "state.json"),
      profileDir: path.join(dir, "profile"),
      fingerprintStatePath: path.join(dir, "fingerprint.json"),
      launchSession: async ({ headless }) => ({
        page: {
          goto: async () => {}, bringToFront: async () => {}, waitForFunction: async () => {},
          reload: async () => {}, waitForTimeout: async () => {},
          evaluate: async () => ({ hasComposer: true, hasAccount: !headless, hasSignIn: headless, accountLabel: "Google Account" }),
        },
        context: { storageState: async ({ path: outputPath }) => fs.writeFileSync(outputPath, JSON.stringify({ cookies: [] })) },
        close: async () => {},
      }),
    }), /вход не сохранился/);
    assert.equal(fs.existsSync(authFile), false);
  });

  it("does not save a transient Google account indicator that disappears after reload", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-google-login-race-"));
    const authFile = path.join(dir, "auth.json");
    let reloads = 0;
    let saves = 0;
    const page = {
      goto: async () => {},
      bringToFront: async () => {},
      waitForFunction: async () => {},
      reload: async () => { reloads += 1; },
      waitForTimeout: async () => {},
      evaluate: async () => ({
        hasComposer: true,
        hasAccount: reloads > 1,
        hasSignIn: reloads === 1,
        accountLabel: reloads > 1 ? "Google Account: test@example.com" : "",
      }),
    };
    const context = { storageState: async ({ path: outputPath }) => {
      saves += 1;
      fs.writeFileSync(outputPath, JSON.stringify({ cookies: [{ name: "session" }], origins: [] }));
    } };

    await loginGoogleAIAndSave(authFile, {
      storageStatePath: path.join(dir, "storage-state.json"),
      launchSession: async () => ({ page, context, close: async () => {} }),
    });

    assert.equal(reloads, 2);
    assert.equal(saves, 1);
    assert.equal(JSON.parse(fs.readFileSync(authFile, "utf8")).signedIn, true);
  });

  it("does not treat a still-loading signed-in page as logged out", () => {
    assert.equal(classifyGoogleAIPageState({ hasAccount: true, hasComposer: false, hasSignIn: true }), "loading");
    assert.equal(classifyGoogleAIPageState({ hasAccount: true, hasComposer: true, hasSignIn: false }), "ready");
    assert.equal(classifyGoogleAIPageState({ hasAccount: false, hasComposer: false, hasSignIn: true }), "signed_out");
  });

  it("recognizes Google sign-in controls identified only by aria-label", async () => {
    const composer = { getAttribute: (name) => name === "placeholder" ? "Задайте вопрос" : "" };
    const signIn = { textContent: "", getAttribute: (name) => name === "aria-label" ? "Войти" : "" };
    const page = {
      evaluate: (callback) => vm.runInNewContext(`(${callback.toString()})()`, {
        document: { querySelectorAll: (selector) => selector.includes("textarea") ? [composer] : [signIn] },
        getComputedStyle: () => ({ display: "block", visibility: "visible" }),
      }),
    };

    const state = await readGoogleAIPageState(page);
    assert.equal(state.hasSignIn, true);
    assert.equal(classifyGoogleAIPageState(state), "signed_out");
  });

  it("uses headless Camoufox with a portable Google session", () => {
    const launch = getGoogleAIBrowserLaunchConfig();
    assert.equal(launch.engine, "camoufox");
    assert.match(launch.storageStatePath, /google-ai-cli.+storage-state\.json$/);
    assert.match(launch.profileDir, /google-ai-cli.+camoufox-profile$/);
    assert.match(launch.fingerprintStatePath, /google-ai-cli.+camoufox-fingerprint\.json$/);
  });

  it("migrates the existing browser profile into portable storage without opening Google", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-google-state-"));
    const stateFile = path.join(dir, "storage-state.json");
    let closed = false;
    await ensureGoogleAIStorageState(stateFile, {
      launchContext: async () => ({
        storageState: async ({ path: outputPath }) => {
          fs.writeFileSync(outputPath, JSON.stringify({ cookies: [{ name: "session" }], origins: [] }));
        },
        close: async () => { closed = true; },
      }),
    });
    assert.equal(closed, true);
    assert.equal(JSON.parse(fs.readFileSync(stateFile, "utf8")).cookies[0].name, "session");
  });

  it("lets Camoufox load and persist a provider-specific storage state", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-camoufox-state-"));
    const stateFile = path.join(dir, "google.json");
    fs.writeFileSync(stateFile, JSON.stringify({ cookies: [], origins: [] }));
    const options = buildCamoufoxContextOptions({
      viewport: { width: 1280, height: 900 },
      storageStatePath: stateFile,
    });
    assert.equal(options.storageState, stateFile);
  });

  it("preserves large Camoufox fingerprint integers without JavaScript rounding", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-camoufox-fingerprint-"));
    const file = path.join(dir, "fingerprint.json");
    const raw = '{"seed":18446744073709551615}';
    saveCamoufoxFingerprint({ env: { CAMOU_CONFIG_1: raw } }, file);
    assert.equal(fs.readFileSync(file, "utf8"), raw);
  });

  it("delegates completions to the browser proxy and logs streaming text", async () => {
    const calls = [];
    const client = new GoogleAIChatClient({
      proxyFactory: async () => ({
        sendChat: async (options) => {
          calls.push(options);
          options.onText?.("Готово");
          return { text: "Готово", conversationId: "google-chat-1", lastMessageId: null };
        },
      }),
    });
    let streamed = "";
    const result = await client.complete({
      prompt: "Проверь новости",
      conversationId: "google-chat-1",
      images: [{ name: "screen.png", mimeType: "image/png", dataBase64: "aW1hZ2U=" }],
      onText: (text) => { streamed = text; },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].prompt, "Проверь новости");
    assert.equal(calls[0].images[0].name, "screen.png");
    assert.equal(streamed, "Готово");
    assert.equal(result.text, "Готово");
  });

  it("turns full DOM snapshots into non-duplicating SSE deltas", () => {
    assert.equal(incrementalBrowserStreamDelta("Пр", "Привет"), "ивет");
    assert.equal(incrementalBrowserStreamDelta("старый", "новый"), "новый");
  });

  it("keeps the provider implementation identical in desktop and VS Code", () => {
    for (const file of ["config.mjs", "auth-files.mjs", "storage-state.mjs", "browser-proxy.mjs", "client.mjs", "browser-login.mjs", "agent-adapter.mjs"]) {
      const desktop = fs.readFileSync(new URL(`../src/providers/google-ai/${file}`, import.meta.url), "utf8");
      const vscode = fs.readFileSync(new URL(`../plugin-for-vscode/src/providers/google-ai/${file}`, import.meta.url), "utf8");
      assert.equal(vscode, desktop, file);
    }
  });
});

it('does not retry a closed browser after a possibly submitted Google query',async()=>{
  let calls=0;
  const client=new GoogleAIChatClient({proxyFactory:async()=>({sendChat:async()=>{calls++;throw Object.assign(new Error('Target closed'),{promptSubmitted:true,delivery:'unknown'});}}),resetProxy:async()=>assert.fail('do not discard an ambiguous live query')});
  await assert.rejects(client.complete({prompt:'test'}),/Target closed/);assert.equal(calls,1);
});

it('retries a Google browser preparation failure only with explicit not_sent evidence',async()=>{
  let calls=0,resets=0;
  const client=new GoogleAIChatClient({proxyFactory:async()=>({sendChat:async()=>{if(++calls===1)throw Object.assign(new Error('Target closed'),{delivery:'not_sent'});return {text:'ok'};}}),resetProxy:async()=>{resets++;}});
  assert.equal((await client.complete({prompt:'test'})).text,'ok');assert.equal(calls,2);assert.equal(resets,1);
});

it('query navigation is already an ambiguous submission; preparation navigation is not',async()=>{
  const {sendGoogleAIChatOnce}=await import('../src/providers/google-ai/browser-proxy.mjs');
  const page={goto:async()=>{throw new Error('Target closed');}};
  await assert.rejects(sendGoogleAIChatOnce(page,{prompt:'short'}),e=>e.delivery==='unknown'&&e.promptSubmitted===true);
  await assert.rejects(sendGoogleAIChatOnce(page,{prompt:'x'.repeat(1600)}),e=>e.delivery==='not_sent'&&e.promptSubmitted===false);
});
