import fs from "node:fs";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  classifyGLMPageState,
  findGLMNativeModelOption,
  findGLMModelLabel,
  getGLMBrowserLaunchConfig,
  getGLMModelLabelPattern,
  isGLMTransientErrorText,
  minimizeGLMBrowserWindow,
  normalizeGLMModelId,
  normalizeGLMAnswer,
  submitGLMPrompt,
  attachGLMImages,
  observeGLMCompletionDebug,
  observeGLMNativeCompletion,
  summarizeGLMCompletionResponse,
  summarizeGLMRequestBinding,
  selectGLMAnswerText,
} from "../src/providers/glm/browser-proxy.mjs";
import { GLMChatClient } from "../src/providers/glm/client.mjs";
import { createWebAccountAdapters, isGLMDebugEnabled } from "../src/providers/web-account-adapters.mjs";
import {
  isGLMSessionCheckComplete,
  resolveGLMLoginOptions,
} from "../src/providers/glm/browser-login.mjs";
import { createGLMAgentAdapter } from "../src/providers/glm/agent-adapter.mjs";
import { getCodeSessionId, setCodeSessionId } from "../src/window-app/agent-task.mjs";
import { launchPersistentDeepSeekContext } from "../src/browser/launch.mjs";
import {
  hasGLMAuthCookie,
  isGLMAuthUsable,
  isGLMLoginConfirmed,
  isGLMUserToken,
} from "../src/providers/glm/auth-files.mjs";
import { isGLMStorageStateUsable } from "../src/providers/glm/storage-state.mjs";
import {
  findModel,
  getProviderCatalog,
  getProviderIds,
} from "../packages/core/src/providers/model-catalog.mjs";

describe("GLM browser provider", () => {
  it("summarizes completion diagnostics without retaining request or response content", () => {
    assert.deepEqual(summarizeGLMCompletionResponse({
      model: "glm-5.3", completionCount: 1, imageFileIds: ["private-id"], requestBody: '{"model":"glm-5.3-live","files":["private-id"]}',
      status: 200, contentType: "text/event-stream", responseText: 'event: chunk\ndata: {"data":{"choices":[{"delta":{"content":"abc","reasoning_content":"xy"},"finish_reason":"stop"}],"error":{"code":"E_STREAM"}},"type":"message"}\n\ndata: [DONE]',
    }), {
      model: "glm-5.3-live", imageRefIdsMatch: true, expectedImageCount: 1, completionCount: 1, HTTPstatus: 200,
      contentType: "text/event-stream", streamBytes: 176, knownResponseError: false, eventNames: ["chunk", "message"],
      topLevelKeys: ["data", "type"], dataKeys: ["choices", "error"], choiceKeys: ["delta", "finish_reason"],
      finalContentChars: 3, reasoningChars: 2, terminal: true, errorCodes: ["E_STREAM"],
      phaseValues: [], doneTrueCount: 0, doneFalseCount: 0, deltaChars: 0,
      promptOccurrences: 0, imageIdOccurrences: 1, lastUserContentType: "unknown", lastUserTextMatch: false,
    });
  });

  it("installs completion diagnostics only in debug mode and removes its listener", async () => {
    const listeners = new Map(), logs = [];
    const page = {
      on: (event, listener) => listeners.set(event, listener),
      off: (event, listener) => { if (listeners.get(event) === listener) listeners.delete(event); },
    };
    assert.equal(observeGLMCompletionDebug(page, { debug: false }), null);
    assert.equal(listeners.size, 0);
    const dispose = observeGLMCompletionDebug(page, { debug: true, model: "glm-5.3", imageFileIds: ["private-id"], log: value => logs.push(value) });
    await listeners.get("response")({
      url: () => "https://chat.z.ai/api/v1/chat/completions",
      status: () => 200,
      headers: () => ({ "content-type": "text/event-stream" }),
      request: () => ({ method: () => "POST", postData: () => '{"files":["private-id"]}' }),
      text: async () => "data: [DONE]",
    });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].imageRefIdsMatch, true);
    assert.equal(JSON.stringify(logs[0]).includes("private-id"), false);
    dispose();
    assert.equal(listeners.size, 0);
  });
  it("summarizes the final user message binding without exposing request content", () => {
    assert.deepEqual(summarizeGLMRequestBinding('{"metadata":"prompt","messages":[{"role":"user","content":"old"},{"role":"user","content":[{"type":"text","text":"pro"},{"type":"text","text":"mpt"}]}],"files":[{"id":"file-1","file":{"id":"file-1"}}]}', "prompt", ["file-1"]), {
      promptOccurrences: 1,
      imageIdOccurrences: 2,
      lastUserContentType: "text_parts",
      lastUserTextMatch: true,
    });
  });

  it("accepts documented image parts while binding only final-user text", () => {
    assert.deepEqual(summarizeGLMRequestBinding('{"messages":[{"role":"user","content":[{"type":"text","text":"describe this"},{"type":"image_url","image_url":{"url":"data:image/png;base64,private"}},{"type":"input_image","image_url":"private"}]}],"files":["file-1"]}', "describe this", ["file-1"]), {
      promptOccurrences: 1,
      imageIdOccurrences: 1,
      lastUserContentType: "multimodal_parts",
      lastUserTextMatch: true,
    });
  });

  it("accepts one terminal native SSE response only when it binds the current prompt and uploads", async () => {
    const listeners = new Map();
    const page = { on: (event, listener) => listeners.set(event, listener), off: (event, listener) => { if (listeners.get(event) === listener) listeners.delete(event); } };
    const observer = observeGLMNativeCompletion(page, { prompt: "current prompt", imageFileIds: ["file-1"] });
    const response = (body, stream) => ({
      url: () => "https://chat.z.ai/api/v1/chat/completions",
      headers: () => ({ "content-type": "text/event-stream" }),
      request: () => ({ method: () => "POST", postData: () => body }),
      text: async () => stream,
    });
    await listeners.get("response")(response('{"messages":[{"content":"other prompt"}],"files":["file-1"]}', 'data: {"type":"chat:completion","data":{"phase":"answer","delta_content":"wrong","done":true}}'));
    await listeners.get("response")(response('{"messages":[{"content":"current prompt"}],"files":[]}', 'data: {"type":"chat:completion","data":{"phase":"answer","delta_content":"missing","done":true}}'));
    assert.equal(observer.getResult(), null);
    await listeners.get("response")(response('{"metadata":"current prompt","messages":[{"role":"user","content":"other prompt"}],"files":["file-1"]}', 'data: {"type":"chat:completion","data":{"phase":"answer","delta_content":"metadata","done":true}}'));
    assert.equal(observer.getResult(), null);
    await listeners.get("response")(response('{"messages":[{"role":"user","content":"current prompt"}],"files":[{"id":"file-1","file":{"id":"file-1"}}]}', 'data: {"type":"chat:completion","data":{"phase":"answer","delta_content":"accepted","done":true}}'));
    assert.deepEqual(observer.getResult(), { ok: true, text: "accepted", terminal: true });
    await listeners.get("response")(response('{"messages":[{"role":"user","content":"current prompt"}],"files":[{"id":"file-1","file":{"id":"file-1"}}]}', 'data: {"type":"chat:completion","data":{"phase":"answer","delta_content":"duplicate","done":true}}'));
    assert.equal(observer.getResult(), null);
    observer.dispose();
    assert.equal(listeners.size, 0);
  });

  it("does not accept terminal native placeholders or known response errors", async () => {
    for (const text of ["Thinking…", "No response, Please try again later"]) {
      const listeners = new Map();
      const page = { on: (event, listener) => listeners.set(event, listener), off: (event, listener) => { if (listeners.get(event) === listener) listeners.delete(event); } };
      const observer = observeGLMNativeCompletion(page, { prompt: "prompt" });
      await listeners.get("response")({
        url: () => "https://chat.z.ai/api/v1/chat/completions",
        headers: () => ({ "content-type": "text/event-stream" }),
        request: () => ({ method: () => "POST", postData: () => '{"messages":[{"role":"user","content":"prompt"}]}' }),
        text: async () => `data: {"type":"chat:completion","data":{"phase":"answer","delta_content":${JSON.stringify(text)},"done":true}}`,
      });
      assert.equal(observer.getResult(), null);
      observer.dispose();
    }
  });

  it("does not accept reasoning or partial native SSE output and removes listener on Stop", async () => {
    const listeners = new Map();
    const controller = new AbortController();
    const page = { on: (event, listener) => listeners.set(event, listener), off: (event, listener) => { if (listeners.get(event) === listener) listeners.delete(event); } };
    const observer = observeGLMNativeCompletion(page, { prompt: "prompt", signal: controller.signal });
    const response = stream => ({
      url: () => "https://chat.z.ai/api/v1/chat/completions",
      headers: () => ({ "content-type": "text/event-stream" }),
      request: () => ({ method: () => "POST", postData: () => '{"messages":[{"content":"prompt"}]}' }),
      text: async () => stream,
    });
    await listeners.get("response")(response('data: {"type":"chat:completion","data":{"phase":"reasoning","delta_content":"hidden","done":true}}'));
    assert.equal(observer.getResult(), null);
    controller.abort();
    assert.equal(listeners.size, 0);
  });

  it("uses an exactly-bound native terminal answer before querying a frozen renderer", async () => {
    const { waitForGLMAnswer } = await import("../src/providers/glm/browser-proxy.mjs");
    const texts = [];
    const text = await waitForGLMAnswer({}, {}, value => texts.push(value), false, null, () => {}, {
      getResult: () => ({ ok: true, text: "native answer", terminal: true }),
    });
    assert.equal(text, "native answer");
    assert.deepEqual(texts, ["native answer"]);
  });

  const tokenFor = (email) => [
    Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ id: "account-id", email })).toString("base64url"),
    "signature",
  ].join(".");

  it("enables GLM diagnostics for selected accounts with the existing debug flag", async () => {
    assert.equal(isGLMDebugEnabled({}), false);
    assert.equal(isGLMDebugEnabled({ DEEPSEEK_DEBUG_GLM: "1" }), true);
    const previous = process.env.DEEPSEEK_DEBUG_GLM;
    process.env.DEEPSEEK_DEBUG_GLM = "1";
    try {
      const client = await createWebAccountAdapters().glm.buildClient({
        authFile: "/tmp/glm-auth.json",
        profileDir: "/tmp/glm-profile",
        storageStatePath: "/tmp/glm-state.json",
      }, "selected");
      assert.equal(client.debug, true);
    } finally {
      if (previous === undefined) delete process.env.DEEPSEEK_DEBUG_GLM;
      else process.env.DEEPSEEK_DEBUG_GLM = previous;
    }
  });

  it("is exposed by the shared catalog and OpenAI-compatible model list", () => {
    assert.ok(getProviderIds().includes("glm"));
    assert.equal(getProviderCatalog("glm").defaultModel, "glm-5.3-flash");
    assert.deepEqual(
      getProviderCatalog("glm").models.map((model) => model.id),
      ["glm-5.3-flash", "glm-5.3", "glm-5.2", "glm-5-turbo"],
    );
    assert.equal(findModel("glm-5.2").provider, "glm");
  });

  it("removes the GLM reasoning UI heading from the visible answer", () => {
    assert.equal(
      normalizeGLMAnswer("Thought Process\n\nИтог\n\nРабота завершена."),
      "Итог\n\nРабота завершена.",
    );
  });

  it("requires a confirmed signed-in browser profile", () => {
    assert.equal(isGLMAuthUsable(null), false);
    assert.equal(isGLMAuthUsable({ signedIn: false }), false);
    assert.equal(isGLMAuthUsable({ signedIn: true, profileDir: "C:/profile" }), true);
  });

  it("recognizes the Z.ai token cookie used by browser login", () => {
    const cookies = [
      { name: "token", value: tokenFor("user@example.com"), domain: "chat.z.ai" },
      { name: "token", value: "wrong-host", domain: "example.com" },
    ];

    assert.equal(hasGLMAuthCookie(cookies), true);
    assert.equal(isGLMLoginConfirmed({ hasComposer: true, hasAuthCookie: true, hasSignIn: true }), true);
    assert.equal(isGLMLoginConfirmed({ hasComposer: true, hasAuthCookie: false }), false);
  });

  it("does not accept the anonymous Z.ai guest token as a completed login", () => {
    const guestToken = tokenFor("guest-1787922021629@guest.com");
    assert.equal(isGLMUserToken(guestToken), false);
    assert.equal(isGLMUserToken(tokenFor("user@example.com")), true);
    assert.equal(hasGLMAuthCookie([
      { name: "token", value: guestToken, domain: "chat.z.ai" },
    ]), false);
    assert.equal(isGLMLoginConfirmed({
      hasComposer: true,
      hasAuthToken: false,
      hasAuthCookie: false,
    }), false);
  });

  it("accepts a portable GLM session backed only by the auth cookie", () => {
    const file = new URL(`./tmp-glm-state-${process.pid}.json`, import.meta.url);
    fs.writeFileSync(file, JSON.stringify({
      cookies: [{ name: "token", value: tokenFor("user@example.com"), domain: ".z.ai" }],
      origins: [],
    }));
    try {
      assert.equal(isGLMStorageStateUsable(file), true);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it("rejects a portable GLM session containing only an anonymous guest token", () => {
    const file = new URL(`./tmp-glm-guest-state-${process.pid}.json`, import.meta.url);
    const guestToken = tokenFor("guest-1787922021629@guest.com");
    fs.writeFileSync(file, JSON.stringify({
      cookies: [{ name: "token", value: guestToken, domain: "chat.z.ai" }],
      origins: [{
        origin: "https://chat.z.ai",
        localStorage: [{ name: "token", value: guestToken }],
      }],
    }));
    try {
      assert.equal(isGLMStorageStateUsable(file), false);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it("uses a background headed Chromium profile for Z.ai requests", () => {
    const launch = getGLMBrowserLaunchConfig();
    assert.equal(launch.engine, "chromium-persistent");
    assert.match(launch.profileDir, /glm-cli.+browser-profile$/);
    assert.equal(launch.headless, false);
    assert.equal(launch.channel, null);
    assert.ok(launch.args.includes("--start-minimized"));
    assert.ok(launch.args.includes("--window-position=-32000,-32000"));
  });

  it("launches bundled Chromium when the browser channel is explicitly disabled", async () => {
    const profile = new URL(`./tmp-glm-profile-${process.pid}`, import.meta.url).pathname;
    const calls = [];
    const chromium = {
      launchPersistentContext: async (profileDir, options) => {
        calls.push({ profileDir, options });
        return { close: async () => {} };
      },
    };
    try {
      await launchPersistentDeepSeekContext(chromium, profile, false, { channel: null });
      assert.equal(calls.length, 1);
      assert.equal(Object.hasOwn(calls[0].options, "channel"), false);
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });

  it("minimizes the dedicated Chromium window through CDP", async () => {
    const calls = [];
    const session = {
      send: async (method, params) => {
        calls.push([method, params]);
        if (method === "Browser.getWindowForTarget") return { windowId: 17 };
        return {};
      },
      detach: async () => calls.push(["detach"]),
    };
    const page = {
      context: () => ({ newCDPSession: async () => session }),
    };

    assert.equal(await minimizeGLMBrowserWindow(page), true);
    assert.deepEqual(calls, [
      ["Browser.getWindowForTarget", undefined],
      ["Browser.setWindowBounds", { windowId: 17, bounds: { windowState: "minimized" } }],
      ["detach"],
    ]);
  });

  it("submits through the current Z.ai send button instead of relying on Enter", async () => {
    const actions = [];
    const composer = {
      waitFor: async () => actions.push("wait"),
      fill: async (text) => actions.push(`fill:${text}`),
      press: async () => actions.push("press"),
    };
    const sendButton = {
      count: async () => 1,
      click: async () => actions.push("click"),
    };
    const page = {
      locator: (selector) => selector === "#chat-input"
        ? { first: () => composer }
        : { first: () => sendButton },
    };

    await submitGLMPrompt(page, "hello");
    assert.deepEqual(actions, ["wait", "fill:hello", "click"]);
  });

  it("waits for one same-origin multipart upload acknowledgment per selected image", async () => {
    const payload = [
      { name: "screen.png", mimeType: "image/png", buffer: Buffer.from("pixels") },
      { name: "second.png", mimeType: "image/png", buffer: Buffer.from("second") },
    ];
    let responseListener = null;
    const fileInput = {
      waitFor: async () => {},
      setInputFiles: async (files) => {
        assert.deepEqual(files, payload);
        responseListener({
          url: () => "https://chat.z.ai/api/files",
          status: () => 200,
          request: () => ({
            method: () => "POST",
            headers: () => ({ "content-type": "multipart/form-data; boundary=x" }),
            postDataBuffer: () => Buffer.concat([Buffer.from('filename="screen.png"'), Buffer.from("pixels")]),
          }),
          json: async () => ({ id: "file-1" }),
        });
        responseListener({
          url: () => "https://chat.z.ai/api/files",
          status: () => 200,
          request: () => ({
            method: () => "POST",
            headers: () => ({ "content-type": "multipart/form-data; boundary=x" }),
            postDataBuffer: () => Buffer.concat([Buffer.from('filename="second.png"'), Buffer.from("second")]),
          }),
          json: async () => ({ id: "file-2" }),
        });
      },
    };
    const page = { on: (_event, listener) => { responseListener = listener; }, off: () => {}, locator: (selector) => {
      assert.equal(selector, 'input[type="file"][multiple]');
      return { first: () => fileInput };
    } };

    assert.deepEqual(await attachGLMImages(page, payload), ["file-1", "file-2"]);
  });

  it("does not accept stale input selection, a mismatched upload, or an upload failure", async () => {
    const payload = [{ name: "screen.png", mimeType: "image/png", buffer: Buffer.from("pixels") }];
    const response = (status, body, requestBody = Buffer.from('filename="other.png"wrong')) => ({
      url: () => "https://chat.z.ai/api/files",
      status: () => status,
      request: () => ({
        method: () => "POST",
        headers: () => ({ "content-type": "multipart/form-data; boundary=x" }),
        postDataBuffer: () => requestBody,
      }),
      json: async () => body,
    });
    const fileInput = {
      waitFor: async () => {},
      setInputFiles: async () => {},
    };
    let listener = null;
    const page = { on: (_event, value) => { listener = value; }, off: () => {}, locator: () => ({ first: () => fileInput }) };

    const mismatch = attachGLMImages(page, payload, null, { timeoutMs: 5 });
    listener(response(200, { id: "wrong" }));
    await assert.rejects(mismatch, error => error.delivery === "not_sent" && /acknowledgment/i.test(error.message));

    const twoImages = [...payload, { name: "second.png", mimeType: "image/png", buffer: Buffer.from("second") }];
    const duplicate = attachGLMImages(page, twoImages, null, { timeoutMs: 5 });
    const firstBody = Buffer.concat([Buffer.from('filename="screen.png"'), Buffer.from("pixels")]);
    listener(response(200, { id: "file-1" }, firstBody));
    listener(response(200, { id: "file-1" }, firstBody));
    await assert.rejects(duplicate, error => error.delivery === "not_sent" && /timed out/i.test(error.message));

    const failed = attachGLMImages(page, payload, null, { timeoutMs: 100 });
    listener(response(500, { error: "rejected" }, Buffer.concat([Buffer.from('filename="screen.png"'), Buffer.from("pixels")]))) ;
    await assert.rejects(failed, error => error.delivery === "not_sent" && /upload failed/i.test(error.message));
  });

  it("handles a matched upload failure during delayed file selection without an unhandled rejection", async () => {
    const payload = [{ name: "screen.png", mimeType: "image/png", buffer: Buffer.from("pixels") }];
    let listener = null;
    let unhandled = null;
    const onUnhandled = error => { unhandled = error; };
    process.once("unhandledRejection", onUnhandled);
    const fileInput = {
      waitFor: async () => {},
      setInputFiles: async () => {
        listener({
          url: () => "https://chat.z.ai/api/files",
          status: () => 500,
          request: () => ({ method: () => "POST", headers: () => ({ "content-type": "multipart/form-data" }), postDataBuffer: () => Buffer.concat([Buffer.from('filename="screen.png"'), Buffer.from("pixels")]) }),
          json: async () => ({ error: "rejected" }),
        });
        await new Promise(resolve => setTimeout(resolve, 10));
      },
    };
    const page = { on: (_event, value) => { listener = value; }, off: () => {}, locator: () => ({ first: () => fileInput }) };
    try {
      await assert.rejects(attachGLMImages(page, payload), /upload failed/i);
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(unhandled, null);
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
    }
  });

  it("closes a blocking Z.ai dialog before submitting the prompt", async () => {
    const actions = [];
    let overlayVisible = true;
    const composer = {
      waitFor: async () => actions.push("wait"),
      fill: async (text) => actions.push(`fill:${text}`),
      press: async () => actions.push("press"),
    };
    const sendButton = {
      count: async () => 1,
      click: async () => actions.push("click"),
    };
    const overlay = {
      count: async () => 1,
      isVisible: async () => overlayVisible,
      waitFor: async () => {
        if (overlayVisible) throw new Error("still visible");
      },
    };
    const page = {
      locator: (selector) => {
        if (selector === "#chat-input") return { first: () => composer };
        if (selector === "#send-message-button") return { first: () => sendButton };
        if (selector.includes("data-dialog-overlay")) return { first: () => overlay };
        return { first: () => ({ count: async () => 0 }) };
      },
      keyboard: {
        press: async (key) => {
          actions.push(`key:${key}`);
          overlayVisible = false;
        },
      },
    };

    await submitGLMPrompt(page, "hello");
    assert.deepEqual(actions, ["key:Escape", "wait", "fill:hello", "click"]);
  });

  it("closes the first-run Z.ai tutorial before one send click", async () => {
    let visible = true, sends = 0;
    const overlay = {
      count: async () => 1, isVisible: async () => visible,
      waitFor: async () => { if (visible) throw new Error('tutorial remains open'); },
    };
    const absent = { count: async () => 0, isVisible: async () => false };
    const page = {
      keyboard: { press: async () => {} },
      locator: selector => ({ first: () => {
        if (selector === '#chat-input') return { waitFor: async () => {}, fill: async () => {} };
        if (selector === '#send-message-button') return { count: async () => 1, click: async () => {
          assert.equal(visible, false, 'driver overlay still intercepts the send button');
          sends += 1;
        } };
        if (selector.includes('.driver-overlay')) return overlay;
        if (selector.includes('.driver-popover-close-btn')) return {
          count: async () => 1, isVisible: async () => visible, click: async () => { visible = false; },
        };
        return absent;
      } }),
    };
    await submitGLMPrompt(page, 'synthetic prompt');
    assert.equal(sends, 1);
  });

  it("closes a dialog that appears while clicking the Z.ai send button", async () => {
    const actions = [];
    let overlayVisible = false;
    let clickCount = 0;
    const composer = {
      waitFor: async () => actions.push("wait"),
      fill: async (text) => actions.push(`fill:${text}`),
      press: async () => actions.push("press"),
    };
    const sendButton = {
      count: async () => 1,
      click: async () => {
        clickCount += 1;
        actions.push(`click:${clickCount}`);
        if (clickCount === 1) {
          overlayVisible = true;
          throw new Error("dialog overlay intercepts pointer events");
        }
      },
    };
    const overlay = {
      count: async () => 1,
      isVisible: async () => overlayVisible,
      waitFor: async () => {
        if (overlayVisible) throw new Error("still visible");
      },
    };
    const page = {
      locator: (selector) => {
        if (selector === "#chat-input") return { first: () => composer };
        if (selector === "#send-message-button") return { first: () => sendButton };
        if (selector.includes("data-dialog-overlay")) return { first: () => overlay };
        return { first: () => ({ count: async () => 0 }) };
      },
      keyboard: {
        press: async (key) => {
          actions.push(`key:${key}`);
          overlayVisible = false;
        },
      },
    };

    await submitGLMPrompt(page, "hello");
    assert.deepEqual(actions, ["wait", "fill:hello", "click:1", "key:Escape", "click:2"]);
  });

  it("completes login only after a new answer and no security verification", () => {
    assert.equal(isGLMSessionCheckComplete({
      answer: "GLM OK",
      previousText: "",
      hasVerification: false,
    }), true);
    assert.equal(isGLMSessionCheckComplete({
      answer: "GLM OK",
      previousText: "",
      hasVerification: true,
    }), false);
    assert.equal(isGLMSessionCheckComplete({
      answer: "Старый ответ",
      previousText: "Старый ответ",
      hasVerification: false,
    }), false);
  });

  it("normalizes model labels reported by the Z.ai selector", () => {
    assert.equal(normalizeGLMModelId("GLM-5.3-Flash"), "glm-5.3-flash");
    assert.equal(normalizeGLMModelId("GLM-5.3"), "glm-5.3");
    assert.equal(normalizeGLMModelId("GLM-5.2"), "glm-5.2");
    assert.equal(normalizeGLMModelId("GLM-5-Turbo"), "glm-5-turbo");
    assert.equal(normalizeGLMModelId("GLM 5.3 Flash (free)"), "glm-5.3-flash");
    assert.match("GLM 5.2 — reasoning model", getGLMModelLabelPattern("glm-5.2"));
    assert.doesNotMatch("GLM-5.3-Flash", getGLMModelLabelPattern("glm-5.3"));
    assert.equal(findGLMModelLabel([
      "GLM-5.3",
      "GLM-5.2 Previous flagship model",
    ], "glm-5.2"), "GLM-5.2 Previous flagship model");
    assert.deepEqual(findGLMNativeModelOption([
      { value: "glm-5.3-flash", label: "GLM-5.3-Flash", disabled: false },
      { value: "glm-5.2", label: "GLM-5.2", disabled: false },
    ], "glm-5.3-flash"), {
      value: "glm-5.3-flash",
      label: "GLM-5.3-Flash",
      disabled: false,
    });
  });

  it("keeps the login window open only in explicit diagnostic mode", () => {
    assert.deepEqual(resolveGLMLoginOptions({}, {}), { keepOpen: false });
    assert.deepEqual(resolveGLMLoginOptions({}, { GLM_KEEP_LOGIN_OPEN: "1" }), { keepOpen: true });
    assert.deepEqual(resolveGLMLoginOptions({ keepOpen: false }, { GLM_KEEP_LOGIN_OPEN: "1" }), {
      keepOpen: false,
    });
  });

  it("distinguishes ready, signed-out and verification pages", () => {
    assert.equal(classifyGLMPageState({ hasComposer: true, hasAuthToken: true }), "ready");
    assert.equal(classifyGLMPageState({ hasComposer: true, hasAuthToken: true, hasSignIn: true }), "ready");
    assert.equal(classifyGLMPageState({ hasSignIn: true }), "signed_out");
    assert.equal(classifyGLMPageState({ hasVerification: true }), "verification");
    assert.equal(classifyGLMPageState({}), "loading");
  });

  it("removes Z.ai controls without truncating the generated answer", () => {
    assert.equal(
      normalizeGLMAnswer("Готовый ответ\nCopy\nRegenerate\nGLM can make mistakes. Check important info."),
      "Готовый ответ",
    );
    assert.equal(
      selectGLMAnswerText({ assistantTexts: ["Старый ответ", "Новый\nответ"] }),
      "Новый\nответ",
    );
  });

  it("recognizes a Z.ai JSON parser failure as a transient provider error", () => {
    assert.equal(
      isGLMTransientErrorText(
        "No response, Please try again later.\nSyntaxError: JSON.parse: unexpected character at line 1 column 1 of the JSON data",
      ),
      true,
    );
    assert.equal(isGLMTransientErrorText("Обычный полезный ответ"), false);
  });

  it("restarts the hidden browser and retries one interrupted request", async () => {
    let calls = 0;
    let resets = 0;
    const client = new GLMChatClient({
      proxyFactory: async () => ({
        sendChat: async (options) => {
          calls += 1;
          if (calls === 1) throw Object.assign(new Error("Target page, context or browser has been closed"),{delivery:"not_sent"});
          assert.equal(options.model, "glm-5.3-flash");
          return { text: "ok", conversationId: "glm-thread", lastMessageId: null, model: options.model };
        },
      }),
      resetProxy: async () => { resets += 1; },
    });

    const result = await client.complete({ prompt: "test", model: "glm-5.3-flash" });
    assert.equal(result.text, "ok");
    assert.equal(calls, 2);
    assert.equal(resets, 1);
  });

  it("passes only normalized image payloads to the GLM browser transport", async () => {
    const calls = [];
    const client = new GLMChatClient({
      proxyFactory: async () => ({ sendChat: async (request) => {
        calls.push(request);
        return { text: "ok" };
      } }),
    });
    await client.complete({ prompt: "inspect", images: [{ name: "screen.png", mimeType: "image/png", dataBase64: "cGl4ZWxz" }] });
    assert.deepEqual(calls[0].images, [{ name: "screen.png", mimeType: "image/png", buffer: Buffer.from("pixels") }]);
  });

  it("retries when a Z.ai overlay prevents the send-button click", async () => {
    let calls = 0;
    let resets = 0;
    const client = new GLMChatClient({
      proxyFactory: async () => ({
        sendChat: async () => {
          calls += 1;
          if (calls === 1) {
            throw Object.assign(new Error("locator.click: Timeout 30000ms exceeded waiting for #send-message-button; dialog overlay intercepts pointer events"),{delivery:"not_sent"});
          }
          return { text: "Ответ главного", conversationId: "glm-thread", lastMessageId: null };
        },
      }),
      resetProxy: async () => { resets += 1; },
    });

    const result = await client.complete({ prompt: "test" });
    assert.equal(result.text, "Ответ главного");
    assert.equal(calls, 2);
    assert.equal(resets, 1);
  });

  it("retries when a Z.ai overlay prevents model selection", async () => {
    let calls = 0;
    let resets = 0;
    const client = new GLMChatClient({
      proxyFactory: async () => ({
        sendChat: async () => {
          calls += 1;
          if (calls === 1) {
            throw Object.assign(new Error("locator.click: Timeout 30000ms exceeded; dialog overlay intercepts pointer events"),{delivery:"not_sent"});
          }
          return { text: "Ответ главного", conversationId: "glm-thread", lastMessageId: null };
        },
      }),
      resetProxy: async () => { resets += 1; },
    });

    const result = await client.complete({ prompt: "test" });
    assert.equal(result.text, "Ответ главного");
    assert.equal(calls, 2);
    assert.equal(resets, 1);
  });

  it("does not duplicate a prompt after Z.ai reports a transient response failure", async () => {
    let calls = 0;
    let resets = 0;
    const client = new GLMChatClient({
      proxyFactory: async () => ({
        sendChat: async () => {
          calls += 1;
          const error = new Error("GLM temporary response failure: No response, Please try again later. SyntaxError: JSON.parse");
          error.promptSubmitted = true;
          throw error;
        },
      }),
      resetProxy: async () => { resets += 1; },
    });

    await assert.rejects(() => client.complete({ prompt: "Картинки читаешь?" }), /temporary response failure/);
    assert.equal(calls, 1);
    assert.equal(resets, 0);
  });

  it("does not resubmit a prompt after an answer timeout", async () => {
    let calls = 0;
    const client = new GLMChatClient({
      proxyFactory: async () => ({
        sendChat: async () => {
          calls += 1;
          throw new Error("GLM не начал формировать ответ.");
        },
      }),
      resetProxy: async () => assert.fail("a submitted prompt must not be retried"),
    });

    await assert.rejects(() => client.complete({ prompt: "test" }), /не начал/i);
    assert.equal(calls, 1);
  });

  it("waits for the generation deadline instead of an eager first-text timeout", () => {
    for (const file of ["src/providers/glm/browser-proxy.mjs", "plugin-for-vscode/src/providers/glm/browser-proxy.mjs"]) {
      const source = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(source, /FIRST_TEXT_TIMEOUT_MS|не начал формировать ответ/);
      assert.match(source, /elapsedMs >= GENERATION_TIMEOUT_MS/);
      assert.match(source, /if \(lastText\) return lastText/);
    }
  });

  it("keeps raw workspace actions out of normal chat and asks GLM for a plain answer once", async () => {
    const requests = [];
    const streamed = [];
    const client = new GLMChatClient({
      proxyFactory: async () => ({
        sendChat: async (options) => {
          requests.push(options);
          return requests.length === 1
            ? { text: '{"tool":"run_command","cmd":"awk","args":["NR==1"]}', conversationId: "https://chat.z.ai/c/normal" }
            : { text: "Это команда для чтения первой строки файла. В обычном чате я её не выполнял.", conversationId: "https://chat.z.ai/c/normal" };
        },
      }),
    });
    const result = await client.complete({ prompt: "Что означает команда?", humanReadable: true, onText: (value) => streamed.push(value) });
    assert.equal(requests.length, 2);
    assert.match(requests[0].prompt, /обычн.*чат/i);
    assert.equal(requests[1].conversationId, requests[0].conversationId || "https://chat.z.ai/c/normal");
    assert.match(requests[1].prompt, /обычн.*текст/i);
    assert.match(result.text, /не выполнял/);
    assert.deepEqual(streamed, [result.text]);
  });

  it("never shows a raw workspace file envelope as the final normal-chat answer", async () => {
    let calls = 0;
    const client = new GLMChatClient({
      proxyFactory: async () => ({ sendChat: async () => {
        calls += 1;
        return { text: '<workspace_file tool="write_file" path="a.txt" indent="levels">\n|0|hello\n</workspace_file>', conversationId: "https://chat.z.ai/c/normal" };
      } }),
    });
    const result = await client.complete({ prompt: "Объясни", humanReadable: true });
    assert.equal(calls, 2);
    assert.doesNotMatch(result.text, /workspace_file|\|0\|/);
    assert.match(result.text, /Coder|инструмент/i);
  });

  it("repeats the question in a correction if Z.ai did not return a reusable chat URL", async () => {
    const requests = [];
    const client = new GLMChatClient({ proxyFactory: async () => ({ sendChat: async (options) => {
      requests.push(options);
      return requests.length === 1
        ? { text: '{"tool":"read_file","path":"a.txt"}', conversationId: "glm-local-placeholder" }
        : { text: "Я не открывал файл; для этого нужен Coder.", conversationId: "https://chat.z.ai/c/new" };
    } }) });
    await client.complete({ prompt: "Что в файле a.txt?", humanReadable: true });
    assert.match(requests[1].prompt, /Что в файле a\.txt\?/);
  });

  it("does not blindly resubmit when the browser failed after pressing Send", async () => {
    let calls = 0;
    let resets = 0;
    const client = new GLMChatClient({
      proxyFactory: async () => ({ sendChat: async () => {
        calls += 1;
        const error = new Error("Execution context was destroyed");
        error.promptSubmitted = true;
        throw error;
      } }),
      resetProxy: async () => { resets += 1; },
    });
    await assert.rejects(() => client.complete({ prompt: "test" }), /Execution context/);
    assert.equal(calls, 1);
    assert.equal(resets, 0);
    for (const file of ["src/providers/glm/browser-proxy.mjs", "plugin-for-vscode/src/providers/glm/browser-proxy.mjs"]) {
      assert.match(fs.readFileSync(file, "utf8"), /error\.promptSubmitted = promptSubmitted/);
    }
  });

  it("forces Coder turns to return one workspace tool call", async () => {
    const prompts = [];
    const models = [];
    const modes = [];
    const adapter = createGLMAgentAdapter({
      complete: async ({ prompt, model, humanReadable }) => {
        prompts.push(prompt);
        models.push(model);
        modes.push(humanReadable);
        return { text: '{"tool":"finish","message":"ok"}', conversationId: "glm-code", model };
      },
    }, { model: "glm-5.3" });

    await adapter.complete({ prompt: JSON.stringify({
      type: "task",
      task: "Inspect the project and fix the bug.",
      toolGuidance: "Use read_image for screenshots when pixels are needed.",
    }) });
    assert.equal(adapter.noToolTextRetries, 1);
    assert.match(prompts[0], /Return exactly one action/i);
    assert.match(prompts[0], /"tool":"write_file"|<workspace_file tool="write_file"/);
    assert.match(prompts[0], /"tool":"finish"/);
    assert.match(prompts[0], /"tool":"read_image"/);
    assert.match(prompts[0], /Use read_image for screenshots/);
    assert.equal(models[0], "glm-5.3");
    assert.deepEqual(modes, [undefined], "Coder must retain raw tool-call protocol");
    assert.equal(adapter.parseToolCall('{"tool":"run_command","cmd":"node","args":["test.js"]}').tool, "run_command");
    assert.equal(adapter.parseToolCall('<workspace_file tool="write_file" path="a.txt" indent="levels">\n|0|ok\n</workspace_file>').tool, "write_file");
  });

  it("attaches initial and later Coder screenshots exactly once", async () => {
    const calls = [];
    const initial = { name: "initial.png", mimeType: "image/png", dataBase64: "aW5pdGlhbA==" };
    const desktop = { name: "desktop.png", mimeType: "image/png", dataBase64: "ZGVza3RvcA==" };
    const adapter = createGLMAgentAdapter({ complete: async request => {
      calls.push(request);
      return { text: '{"tool":"finish","message":"ok"}' };
    } }, { images: [initial] });
    assert.equal(adapter.supportsImageAttachments, true);
    await adapter.complete({ prompt: "first" });
    await adapter.complete({ prompt: "screen", images: [desktop] });
    await adapter.complete({ prompt: "after" });
    assert.deepEqual(calls.map(call => call.images), [[initial], [desktop], []]);
  });

  it("returns a stable chain marker so the next Coder task reuses the Z.ai chat", async () => {
    const adapter = createGLMAgentAdapter({
      complete: async () => ({
        text: '{"tool":"finish","message":"ok"}',
        conversationId: "https://chat.z.ai/c/glm-code-thread",
        lastMessageId: null,
        model: "glm-5.3-flash",
      }),
    });

    const result = await adapter.complete({ prompt: "Inspect the project." });

    assert.equal(result.lastAssistantMessageId, "https://chat.z.ai/c/glm-code-thread");
    assert.equal(adapter.getConversationId(), "https://chat.z.ai/c/glm-code-thread");
  });

  it("keeps the Coder Z.ai chat separate from the normal conversation", () => {
    const conversation = {
      sessionId: "https://chat.z.ai/c/normal-chat",
      codeSessionId: null,
    };

    assert.equal(getCodeSessionId(conversation), null);
    setCodeSessionId(conversation, "https://chat.z.ai/c/code-chat");
    assert.equal(getCodeSessionId(conversation), "https://chat.z.ai/c/code-chat");
    assert.equal(conversation.sessionId, "https://chat.z.ai/c/normal-chat");
  });

  it("enables plain-language guarding only on the normal SYNVOX chat route", () => {
    for (const file of ["src/window-app/server.mjs", "plugin-for-vscode/src/window-app/server.mjs"]) {
      const source = fs.readFileSync(file, "utf8");
      assert.match(source, /humanReadable: convProvider === "glm"/);
      assert.match(source, /createGLMAgentAdapter\(client/);
    }
  });

  it("keeps the provider implementation identical in desktop and VS Code", () => {
    for (const file of [
      "config.mjs",
      "auth-files.mjs",
      "storage-state.mjs",
      "browser-proxy.mjs",
      "client.mjs",
      "browser-login.mjs",
      "agent-adapter.mjs",
    ]) {
      const desktop = fs.readFileSync(new URL(`../src/providers/glm/${file}`, import.meta.url), "utf8");
      const vscode = fs.readFileSync(new URL(`../plugin-for-vscode/src/providers/glm/${file}`, import.meta.url), "utf8");
      assert.equal(vscode, desktop, file);
    }
  });
});

it('never resets/replays an ambiguous GLM transport failure without delivery evidence',async()=>{
  let calls=0;
  const client=new GLMChatClient({proxyFactory:async()=>({sendChat:async()=>{calls++;throw new Error('Target page, context or browser has been closed');}}),resetProxy:async()=>assert.fail('ambiguous delivery')});
  await assert.rejects(client.complete({prompt:'test'}),/closed/);assert.equal(calls,1);
});

it('a GLM send click timeout is not followed by another click or Enter',async()=>{
  let clicks=0,marked=0;
  const composer={waitFor:async()=>{},fill:async()=>{},press:async()=>assert.fail('Enter fallback')};
  const button={count:async()=>1,click:async()=>{clicks++;throw new Error('locator.click: Timeout 5000ms exceeded');}};
  const page={locator:selector=>({first:()=>selector==='#chat-input'?composer:selector==='#send-message-button'?button:{count:async()=>0}})};
  await assert.rejects(submitGLMPrompt(page,'hello',()=>{marked++;}),/Timeout/);assert.equal(clicks,1);assert.equal(marked,1);
});

it('GLM preparation failures expose not_sent before a prompt can be submitted',async()=>{
  const {sendGLMChatOnce}=await import('../src/providers/glm/browser-proxy.mjs');
  const page={goto:async()=>{throw new Error('Target closed');}};
  await assert.rejects(sendGLMChatOnce(page,{prompt:'test'}),e=>e.delivery==='not_sent'&&e.promptSubmitted===false);
});
