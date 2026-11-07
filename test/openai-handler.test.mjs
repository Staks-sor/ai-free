import { Readable, Writable } from "node:stream";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  buildPromptFromChatBody,
  extractOpenAIChatImages,
  handleQwenStream,
  handleRequest,
  requestSearchEnabled,
  requestThinkingEnabled,
  resolveAdaptiveThinking,
  stripFastModelSuffix,
  StreamParser,
  toAnthropicMessageResponse,
  toolsForModelPrompt,
} from "../api/openai-handler.mjs";

describe("OpenAI-compatible handler", () => {
  it("advertises the Responses API endpoint", async () => {
    const res = await callHandler({ method: "GET", url: "/" });
    assert.equal(res.statusCode, 200);
    assert.ok(res.json.endpoints.includes("POST /v1/responses"));
  });

  it("does not advertise EconomyOS models", async () => {
    const res = await callHandler({ method: "GET", url: "/v1/models" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.data.some((model) => model.owned_by === "economyos"), false);
  });

  it("validates /v1/responses before calling upstream providers", async () => {
    const res = await callHandler({
      method: "POST",
      url: "/v1/responses",
      body: { model: "qwen3.7-max" },
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.json.error.message, /input/i);
  });

  it("rejects unknown /v1/responses models", async () => {
    const res = await callHandler({
      method: "POST",
      url: "/v1/responses",
      body: { model: "not-a-model", input: "hello" },
    });
    assert.equal(res.statusCode, 404);
    assert.match(res.json.error.message, /Unknown model/);
  });

  it("advertises and validates the Anthropic-compatible Messages endpoint", async () => {
    const root = await callHandler({ method: "GET", url: "/" });
    assert.ok(root.json.endpoints.includes("POST /v1/messages"));

    const missingMessages = await callHandler({
      method: "POST",
      url: "/v1/messages",
      body: { model: "deepseek-chat", max_tokens: 128 },
    });
    assert.equal(missingMessages.statusCode, 400);
    assert.equal(missingMessages.json.type, "error");
    assert.match(missingMessages.json.error.message, /messages/i);
  });

  it("maps parsed tool calls to Anthropic tool_use content", () => {
    const response = toAnthropicMessageResponse("deepseek-chat", '```tool_calls\n[{"name":"create_reminder","arguments":{"text":"test","at":"2026-06-15T09:00:00+03:00"}}]\n```');
    assert.equal(response.type, "message");
    assert.equal(response.stop_reason, "tool_use");
    assert.equal(response.content[0].type, "tool_use");
    assert.equal(response.content[0].name, "create_reminder");
    assert.deepEqual(response.content[0].input, {
      text: "test",
      at: "2026-06-15T09:00:00+03:00",
    });
  });

  it("treats OpenAI and Anthropic web-search options as native provider search", () => {
    assert.equal(requestSearchEnabled({ search: true }), true);
    assert.equal(requestSearchEnabled({ web_search_options: {} }), true);
    assert.equal(requestSearchEnabled({ tools: [{ type: "web_search_20250305", name: "web_search" }] }), true);
    assert.deepEqual(
      toolsForModelPrompt([
        { type: "web_search_20250305", name: "web_search" },
        { type: "function", function: { name: "create_reminder" } },
      ]),
      [{ type: "function", function: { name: "create_reminder" } }],
    );
  });

  it("extracts supported inline OpenAI image parts without embedding base64 in the prompt", () => {
    const body = {
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Что на картинке?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } },
        ],
      }],
    };

    assert.deepEqual(extractOpenAIChatImages(body.messages), [{
      name: "openai-image-1.png",
      mimeType: "image/png",
      dataBase64: "aW1hZ2U=",
    }]);
    const prompt = buildPromptFromChatBody(body, "deepseek-v4-vision", {
      provider: "deepseek",
      model: "vision",
    });
    assert.match(prompt, /Что на картинке/);
    assert.match(prompt, /\[IMAGE: openai-image-1\.png\]/);
    assert.doesNotMatch(prompt, /aW1hZ2U=/);
  });

  it("terminates streaming tool calls with finish_reason=tool_calls", () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("deepseek-chat", res);

    parser.onText("```tool_calls\n");
    parser.onText('[{"name":"create_reminder","arguments":{"text":"test","at":"2026-06-15T09:00:00+03:00"}}]');
    parser.onText("\n```");
    parser.onEnd();

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    assert.equal(events.at(0).choices[0].delta.role, "assistant");
    assert.equal(events.some((event) => event.choices[0].delta.tool_calls?.[0]?.function?.name === "create_reminder"), true);
    assert.deepEqual(events.at(-1).choices[0], {
      index: 0,
      delta: {},
      finish_reason: "tool_calls",
    });
  });

  it("buffers split XML tool_call chunks and emits OpenAI tool calls", () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("qwen3.7-max", res);

    parser.onText("Сейчас проверю.\n<tool");
    parser.onText('_call name="read_file">');
    parser.onText('{"path":"src/app.js"}');
    parser.onText("</tool");
    parser.onText("_call>");
    parser.onEnd();

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    const content = events
      .map((event) => event.choices[0].delta.content || "")
      .join("");

    assert.equal(content, "Сейчас проверю.\n");
    assert.equal(content.includes("<tool"), false);
    assert.equal(events.some((event) => event.choices[0].delta.tool_calls?.[0]?.function?.name === "read_file"), true);
    assert.equal(events.at(-1).choices[0].finish_reason, "tool_calls");
  });

  it("buffers split Qwen function XML chunks and emits OpenAI tool calls", () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("qwen3.7-max", res);

    parser.onText("<func");
    parser.onText("tion=write_file>");
    parser.onText("<parameter=path>src/app.js</parameter>");
    parser.onText('<parameter=content>{"ok":true}</parameter>');
    parser.onText("</function>");
    parser.onEnd();

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    const toolCall = events.find((event) => event.choices[0].delta.tool_calls)?.choices[0].delta.tool_calls[0];

    assert.equal(toolCall.function.name, "write_file");
    assert.deepEqual(JSON.parse(toolCall.function.arguments), {
      path: "src/app.js",
      content: { ok: true },
    });
    assert.equal(events.at(-1).choices[0].finish_reason, "tool_calls");
  });

  it("terminates normal streaming text with finish_reason=stop", () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("deepseek-chat", res);

    parser.onText("hello");
    parser.onEnd();

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    assert.equal(events.at(-1).choices[0].finish_reason, "stop");
  });

  it("recovers streaming tool calls with dropped closing quotes (Hermes payload)", async () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("qwen3.7-max", res, {
      tools: [{
        type: "function",
        function: {
          name: "terminal",
          parameters: {
            type: "object",
            properties: { command: { type: "string" } },
            required: ["command"],
          },
        },
      }],
    });

    // Qwen роняет закрывающую кавычку command-строки перед переносом
    // и не экранирует кавычки grep-паттерна; стрим приходит кусками.
    parser.onText("Проверяю процессы.\n\n```tool_calls\n");
    parser.onText(
      "[\n  { \"name\": \"terminal\", \"arguments\": { \"command\": \"tasklist | grep -i -E \"hermes|python\" | head -20\n    } },\n",
    );
    parser.onText(
      "  { \"name\": \"terminal\", \"arguments\": { \"command\": \"tail -100 /c/Users/User/AppData/Local/hermes/logs/gateway.log\n    } },\n  { \"name\": \"terminal\", \"arguments\": { \"command\": \"tail -50 /c/Users/User/AppData/Local/hermes/logs/errors.log\n    } }\n]",
    );
    parser.onText("\n```");
    await parser.onEnd();

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    const toolCalls = events
      .filter((event) => event.choices[0].delta.tool_calls?.length)
      .map((event) => event.choices[0].delta.tool_calls[0]);
    assert.equal(toolCalls.length, 3);
    assert.equal(toolCalls.every((call) => call.function.name === "terminal"), true);
    assert.deepEqual(JSON.parse(toolCalls[0].function.arguments), {
      command: 'tasklist | grep -i -E "hermes|python" | head -20',
    });
    assert.deepEqual(JSON.parse(toolCalls[2].function.arguments), {
      command: "tail -50 /c/Users/User/AppData/Local/hermes/logs/errors.log",
    });
    assert.equal(events.at(-1).choices[0].finish_reason, "tool_calls");
  });

  it("recovers a token-limited write_file call with raw multi-line python content (no closing fence)", async () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("qwen3.7-max", res, {
      tools: [{
        type: "function",
        function: {
          name: "write_file",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
            },
            required: ["path", "content"],
          },
        },
      }],
    });

    // Hermes CLI (2026-09-11): write_file с сырым многострочным Python —
    // неэкранированные кавычки, невалидные \x-эскейпы, стрим оборвался
    // на лимите токенов, закрывающего fence нет.
    parser.onText("```tool_calls\n[\n  {\n    \"name\": \"write_file\",\n    \"arguments\": {\n      \"path\": \"E:\\\\HermesRAG\\\\analyze_zephyr.py\",\n");
    parser.onText("      \"content\": \"import struct\nimport sys\n\nexe_path = r\"D:\\progz\\3DF Zephyr.exe\"\nwith open(exe_path, 'rb') as f:\n    data = f.read()\n\nprint(f\"File size: {len(data)} bytes\")\npat = b'\\x55\\x48\\x89\\xE5'\nprint(\"done\")\n");
    await parser.onEnd();

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    const toolCall = events
      .filter((event) => event.choices[0].delta.tool_calls?.length)
      .map((event) => event.choices[0].delta.tool_calls[0])
      .at(0);
    assert.ok(toolCall, "expected a recovered write_file call");
    assert.equal(toolCall.function.name, "write_file");
    const args = JSON.parse(toolCall.function.arguments);
    assert.equal(args.path, "E:\\HermesRAG\\analyze_zephyr.py");
    assert.equal(args.content.includes('print(f"File size: {len(data)} bytes")'), true);
    assert.equal(args.content.includes("import struct"), true);
    assert.equal(args.content.includes("\\x55\\x48\\x89\\xE5"), true);
    assert.equal(args.content.includes('print("done")'), true);
    assert.equal(events.at(-1).choices[0].finish_reason, "tool_calls");
  });

  it("logs delivered streaming tool calls to the console", async () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("qwen3.8-max", res, {
      tools: [{
        type: "function",
        function: {
          name: "terminal",
          parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
        },
      }],
    });
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(" "));
    try {
      parser.onText('```tool_calls\n[{"name": "terminal", "arguments": {"command": "echo ok"}}]\n```');
      await parser.onEnd();
    } finally {
      console.log = originalLog;
    }
    // Реструктуризация onEnd случайно убрала этот лог — без него консоль
    // не может доказать, доставлялись ли вызовы (диагностика блокер-репортов).
    assert.equal(logs.some((line) => line.includes("Parsed streaming tool calls: 1")), true);
  });

  it("strips the -fast/:fast model suffix for thinking-off routing", () => {
    assert.deepEqual(stripFastModelSuffix("qwen3.8-max-fast"), { base: "qwen3.8-max", fast: true });
    assert.deepEqual(stripFastModelSuffix("qwen3.7-plus:fast"), { base: "qwen3.7-plus", fast: true });
    assert.deepEqual(stripFastModelSuffix("qwen3.8-max"), { base: "qwen3.8-max", fast: false });
    assert.deepEqual(stripFastModelSuffix("fastball"), { base: "fastball", fast: false });
  });

  it("moderates thinking on deep tool loops but keeps it for analysis", () => {
    // «Авто» Qwen пере-думает на глубоких tool-циклах (срывы 2026-09).
    // История порога: 20 → 200 (25.10) → снят полностью (29.10).
    // Порог возвращается только через QWEN_ADAPTIVE_THINKING_DEPTH.
    assert.equal(resolveAdaptiveThinking({ thinking: true, toolCount: 0, messageCount: 60, env: {} }), true, "analysis without tools keeps thinking");
    assert.equal(resolveAdaptiveThinking({ thinking: true, toolCount: 34, messageCount: 5, env: {} }), true, "early tool turns keep thinking for planning");
    assert.equal(resolveAdaptiveThinking({ thinking: true, toolCount: 34, messageCount: 5000, env: {} }), true, "no default depth disables thinking anymore");
    assert.equal(resolveAdaptiveThinking({ thinking: true, toolCount: 34, messageCount: 250, env: { QWEN_ADAPTIVE_THINKING_DEPTH: "200" } }), false, "env threshold still works");
    assert.equal(resolveAdaptiveThinking({ thinking: true, toolCount: 34, messageCount: 25, env: { QWEN_ADAPTIVE_THINKING: "off" } }), true, "policy can be disabled");
    assert.equal(resolveAdaptiveThinking({ thinking: true, toolCount: 34, messageCount: 40, env: { QWEN_ADAPTIVE_THINKING_DEPTH: "50" } }), true, "depth threshold is configurable");
    assert.equal(resolveAdaptiveThinking({ thinking: false, toolCount: 34, messageCount: 60, env: {} }), false, "thinking off stays off");
  });

  it("maps reasoning_effort none/minimal/low to thinking off", () => {
    const mapping = { reasoning: true };
    assert.equal(requestThinkingEnabled({ reasoning_effort: "none" }, mapping), false);
    assert.equal(requestThinkingEnabled({ reasoning_effort: "minimal" }, mapping), false);
    assert.equal(requestThinkingEnabled({ reasoning_effort: "low" }, mapping), false);
    assert.equal(requestThinkingEnabled({ reasoning_effort: "high" }, mapping), true);
    assert.equal(requestThinkingEnabled({}, mapping), true);
    // Fast-мэппинг сам по себе выключает thinking.
    assert.equal(requestThinkingEnabled({}, { reasoning: false }), false);
  });

  it("flags prose turns claiming tool failure when no calls were emitted", async () => {    const res = makeWritableResponse();
    const parser = new StreamParser("qwen3.8-max", res, {
      tools: [{
        type: "function",
        function: { name: "terminal", parameters: { type: "object" } },
      }],
    });
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.map(String).join(" "));
    try {
      // Живая формулировка инцидента 2026-09-15 12:07: «инструменты не сущест-
      // вуют», «сервис… полностью недоступен» — узкий паттерн их пропускал.
      parser.onText("Сервис выполнения инструментов (tool execution backend) в данной сессии полностью недоступен: все попытки возвращают системные ошибки о том, что инструменты не существуют.");
      await parser.onEnd();
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(
      warnings.some((line) => line.includes("claims tool failure") && line.includes("no tool calls")),
      true,
    );
  });

  it("does not flag tool-failure prose when the request had no tools", async () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("qwen3.8-max", res);
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.map(String).join(" "));
    try {
      parser.onText("Инструменты недоступны в этой системе.");
      await parser.onEnd();
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(warnings.length, 0);
  });

  it("falls back to OpenRouter LLM repair when the ladder fails and OPENROUTER_API_KEY is set", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousFetch = globalThis.fetch;
    const repairedJson = JSON.stringify([
      { name: "terminal", arguments: { command: "tasklist | grep -i -E \"hermes|python\" | head -20" } },
    ]);
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: repairedJson } }] }),
      };
    };
    process.env.OPENROUTER_API_KEY = "test-key";

    try {
      const res = makeWritableResponse();
      const parser = new StreamParser("qwen3.7-max", res, {
        tools: [{
          type: "function",
          function: {
            name: "terminal",
            parameters: {
              type: "object",
              properties: { command: { type: "string" } },
              required: ["command"],
            },
          },
        }],
      });

      // Проза вместо JSON внутри fence: детерминированная ладдерка бессильна.
      parser.onText("```tool_calls\nЗапусти terminal: tasklist | grep -i -E \"hermes|python\" | head -20\n```");
      await parser.onEnd();

      const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
      const toolCall = events
        .filter((event) => event.choices[0].delta.tool_calls?.length)
        .map((event) => event.choices[0].delta.tool_calls[0])
        .at(0);
      assert.ok(toolCall, "expected a repaired tool call");
      assert.equal(toolCall.function.name, "terminal");
      assert.deepEqual(JSON.parse(toolCall.function.arguments), {
        command: 'tasklist | grep -i -E "hermes|python" | head -20',
      });
      assert.equal(events.at(-1).choices[0].finish_reason, "tool_calls");

      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, "https://openrouter.ai/api/v1/chat/completions");
      assert.equal(requests[0].init.headers.Authorization, "Bearer test-key");
    } finally {
      if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousKey;
      globalThis.fetch = previousFetch;
    }
  });

  it("runs the LLM fallback when the deterministic ladder parses an empty call array", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousFetch = globalThis.fetch;
    const repairedJson = JSON.stringify([
      { name: "terminal", arguments: { command: "python disasm_net.py" } },
    ]);
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: repairedJson } }] }),
      };
    };
    process.env.OPENROUTER_API_KEY = "test-key";

    try {
      const res = makeWritableResponse();
      const parser = new StreamParser("qwen3.7-max", res, {
        tools: [{
          type: "function",
          function: {
            name: "terminal",
            parameters: {
              type: "object",
              properties: { command: { type: "string" } },
              required: ["command"],
            },
          },
        }],
      });

      // Блок распарсился в пустой массив ([]) — раньше это сразу отдавало
      // "[Error] Upstream model returned an empty tool call" без LLM-фолбэка.
      parser.onText("```tool_calls\n[]\n```");
      await parser.onEnd();

      const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
      const toolCall = events
        .filter((event) => event.choices[0].delta.tool_calls?.length)
        .map((event) => event.choices[0].delta.tool_calls[0])
        .at(0);
      assert.ok(toolCall, "expected the LLM fallback to recover a call");
      assert.equal(toolCall.function.name, "terminal");
      assert.equal(requests.length, 1);
      assert.equal(events.at(-1).choices[0].finish_reason, "tool_calls");
    } finally {
      if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousKey;
      globalThis.fetch = previousFetch;
    }
  });

  it("keeps the error dump path when the ladder and LLM fallback both fail", async () => {    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    process.env.OPENROUTER_API_KEY = "test-key";

    try {
      const res = makeWritableResponse();
      const parser = new StreamParser("qwen3.7-max", res);
      parser.onText("```tool_calls\nЗапусти terminal: что-то\n```");
      await parser.onEnd();

      const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
      const content = events.map((event) => event.choices[0].delta.content || "").join("");
      assert.match(content, /Error parsing tool call JSON from model/);
      assert.equal(events.some((event) => event.choices[0].delta.tool_calls?.length), false);
      assert.equal(events.at(-1).choices[0].finish_reason, "stop");
    } finally {
      if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousKey;
      globalThis.fetch = previousFetch;
    }
  });

  it("recovers an unfenced Qwen tool call after already streamed prose", () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("qwen3.8-max", res, {
      tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }],
    });

    parser.onText("Анализирую проект. ".repeat(12));
    parser.onText('{"name":"read_file","arguments":{"path":"package.json"}}');
    parser.onEnd();

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    const toolCall = events.find((event) => event.choices[0].delta.tool_calls)?.choices[0].delta.tool_calls[0];

    assert.equal(toolCall.function.name, "read_file");
    assert.deepEqual(JSON.parse(toolCall.function.arguments), { path: "package.json" });
    assert.equal(
      events.map((event) => event.choices[0].delta.content || "").join("").includes('"name":"read_file"'),
      false,
    );
    assert.equal(events.at(-1).choices[0].finish_reason, "tool_calls");
  });

  it("does not terminate an empty tool_calls block as a successful tool turn", async () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("qwen3.7-max", res);

    parser.onText("```tool_calls\n[]\n```");
    await parser.onEnd();

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    const content = events.map((event) => event.choices[0].delta.content || "").join("");
    assert.match(content, /tool call|инструмент/i);
    assert.equal(events.some((event) => event.choices[0].delta.tool_calls?.length), false);
    assert.equal(events.at(-1).choices[0].finish_reason, "stop");
  });

  it("never terminates an empty stream without an explanatory content delta", () => {
    const res = makeWritableResponse();
    const parser = new StreamParser("deepseek-v4-pro", res);

    parser.onEnd();

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    assert.equal(events[0].choices[0].delta.role, "assistant");
    assert.match(
      events.map((event) => event.choices[0].delta.content || "").join(""),
      /empty|without response|пуст/i,
    );
    assert.equal(events.at(-1).choices[0].finish_reason, "stop");
  });

  it("retries an empty Qwen stream in a fresh chat before closing OpenAI SSE", async () => {
    const res = makeWritableResponse();
    const chatIds = [];
    let attempts = 0;
    const client = {
      async complete({ chatId, onText }) {
        attempts += 1;
        chatIds.push(chatId);
        if (attempts === 1) {
          return { text: "Qwen returned service events only", lastMessageId: null };
        }
        onText("working response");
        return { text: "working response", lastMessageId: "response-2" };
      },
    };
    let chatNumber = 0;

    await handleQwenStream(client, null, "hello", "qwen3.7-max", "qwen3.7-max", res, {
      createChat: async () => `chat-${++chatNumber}`,
    });

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    const content = events.map((event) => event.choices[0].delta.content || "").join("");
    assert.equal(attempts, 2);
    assert.deepEqual(chatIds, ["chat-1", "chat-2"]);
    assert.equal(content, "working response");
    assert.equal(events.at(-1).choices[0].finish_reason, "stop");
  });

  it("retries a Qwen first-content timeout in a fresh chat without refreshing auth", async () => {
    const res = makeWritableResponse();
    const chatIds = [];
    let attempts = 0;
    let refreshes = 0;
    const client = {
      async complete({ chatId, onText }) {
        attempts += 1;
        chatIds.push(chatId);
        if (attempts === 1) {
          const error = new Error("Qwen stream produced no response content before timeout.");
          error.code = "EMPTY_UPSTREAM_STREAM";
          throw error;
        }
        onText("recovered response");
        return { text: "recovered response", lastMessageId: "response-2" };
      },
    };
    let chatNumber = 0;

    await handleQwenStream(client, null, "hello", "qwen3.7-plus", "qwen3.7-plus", res, {
      createChat: async () => `chat-${++chatNumber}`,
      refreshClient: async () => {
        refreshes += 1;
        return client;
      },
    });

    const events = parseSseJsonEvents(Buffer.concat(res.chunks).toString("utf8"));
    const content = events.map((event) => event.choices[0].delta.content || "").join("");
    assert.equal(attempts, 2);
    assert.equal(refreshes, 0);
    assert.deepEqual(chatIds, ["chat-1", "chat-2"]);
    assert.equal(content, "recovered response");
    assert.equal(events.at(-1).choices[0].finish_reason, "stop");
  });

  it("maps tool result ids back to tool names and explains validation recovery", () => {
    const prompt = buildPromptFromChatBody({
      tools: [{
        type: "function",
        function: {
          name: "Edit",
          parameters: {
            type: "object",
            properties: { file_path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } },
            required: ["file_path", "old_string", "new_string"],
          },
        },
      }],
      messages: [
        { role: "assistant", content: "", tool_calls: [{ id: "call_1", function: { name: "Edit", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_1", content: "params must have required property 'new_string'" },
        { role: "tool", tool_call_id: "call_2", content: "No changes detected." },
      ],
    }, "deepseek-v4-pro", { provider: "deepseek", model: "expert" });

    assert.match(prompt, /TOOL RESULT FOR Edit/);
    assert.match(prompt, /missing required argument/i);
    assert.match(prompt, /No changes detected/i);
  });

  it("inoculates the tool bridge against stale tool-broken claims inherited from context", () => {
    const prompt = buildPromptFromChatBody({
      tools: [{
        type: "function",
        function: { name: "terminal", parameters: { type: "object" } },
      }],
      messages: [{ role: "user", content: "Продолжай план" }],
    }, "qwen3.8-max", { provider: "qwen", model: "qwen3.8-max" });

    // Handoff/сжатие может принести в контекст нарратив «инструменты сломаны» —
    // правило обязывает модель считать такие утверждения ложью и пробовать вызов.
    assert.match(prompt, /tools are (available|working) on every turn/i);
    assert.match(prompt, /do not exist/i);
    assert.match(prompt, /re-emit|retry/i);
    // Правило 11: жалоба на сбой инструментов валидна только с исполненной пробой
    // в том же ходу — закрывает «режим эссе» с сфабрикованным блокер-репортом.
    assert.match(prompt, /probe/i);
    assert.match(prompt, /final answer/i);
  });
});

async function callHandler({ method, url, body }) {
  const res = makeWritableResponse();
  const reqBody = body === undefined ? "" : JSON.stringify(body);
  const req = Readable.from(reqBody ? [Buffer.from(reqBody)] : []);
  req.method = method;
  req.url = url;
  req.headers = { host: "127.0.0.1:4318" };

  await handleRequest(req, res);
  const text = Buffer.concat(res.chunks).toString("utf8");
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    text,
    json: text ? JSON.parse(text) : null,
  };
}

function makeWritableResponse() {
  const chunks = [];
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  res.statusCode = 200;
  res.headers = {};
  res.chunks = chunks;
  res.setHeader = (name, value) => {
    res.headers[String(name).toLowerCase()] = value;
  };
  return res;
}

function parseSseJsonEvents(text) {
  return text
    .split("\n\n")
    .map((event) => event.trim())
    .filter((event) => event.startsWith("data: "))
    .map((event) => event.slice("data: ".length))
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data));
}
