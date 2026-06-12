// Тесты /code-агента: парсер tool-call'ов и валидаторы аргументов команд.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { extractFirstJsonObject, parseToolCall } from "../src/code-agent/parser.mjs";
import {
  buildCommandPath,
  createInstallRequestForMissingCommand,
  createUserQuestion,
  executeWorkspaceTool,
  getCommandExecutionEnv,
  isAllowedDevicePath,
  listSerialPorts,
  looksLikePath,
  resolveWorkspacePath,
  truncateOutput,
  validateCommandArgs,
} from "../src/code-agent/executor.mjs";
import {
  formatToolLog,
  isTransientUpstreamTextError,
  resolveMaxToolSteps,
  runCodeTask,
} from "../src/code-agent/run.mjs";
import { createCodeSystemPrompt } from "../src/code-agent/prompt.mjs";
import { getCommandDescription } from "../src/i18n/command-descriptions.mjs";
import { getLocalizedAgentRoles } from "../src/i18n/agent-roles.mjs";
import { LANGUAGES, createTranslator, getMessages } from "../src/i18n/index.mjs";
import { COMMAND_CATALOG } from "../src/state/settings.mjs";

describe("code agent prompt", () => {
  it("does not tell the model that internet is unavailable when provider search is enabled", () => {
    const prompt = createCodeSystemPrompt("/tmp/project", "посмотри новости", "", { searchEnabled: true });
    assert.match(prompt, /Provider web search is ENABLED/);
    assert.match(prompt, /Do not say you have no internet access/);
    assert.doesNotMatch(prompt, /Forbidden: network access/);
  });
});

describe("localized command descriptions", () => {
  it("has permission descriptions for every bundled UI language", () => {
    const languages = ["ru", "en", "es", "pt", "fr", "de", "zh", "hi", "ar"];
    for (const language of languages) {
      assert.ok(getCommandDescription("node", language), language);
      assert.ok(getCommandDescription("npm", language), language);
      assert.ok(getCommandDescription("rm", language), language);
    }
    assert.equal(getCommandDescription("node", "es"), "Ejecutar archivos JavaScript con Node");
    assert.equal(getCommandDescription("node", "pt"), "Executar arquivos JavaScript com Node");
    assert.equal(getCommandDescription("node", "fr"), "Exécuter des fichiers JavaScript avec Node");
    assert.equal(getCommandDescription("node", "de"), "JavaScript-Dateien mit Node ausführen");
    assert.equal(getCommandDescription("node", "zh"), "使用 Node 运行 JavaScript 文件");
    assert.equal(getCommandDescription("node", "hi"), "Node से JavaScript फ़ाइलें चलाएँ");
    assert.equal(getCommandDescription("node", "ar"), "تشغيل ملفات JavaScript عبر Node");
  });
});

describe("ui localization coverage", () => {
  it("keeps every supported language on the full UI key set", () => {
    const expectedKeys = Object.keys(LANGUAGES.ru.messages).sort();
    for (const [code, language] of Object.entries(LANGUAGES)) {
      const ownKeys = Object.keys(language.messages).sort();
      assert.deepEqual(ownKeys, expectedKeys, `${code} must define every UI string`);
      for (const key of expectedKeys) {
        assert.notEqual(String(language.messages[key] || "").trim(), "", `${code}.${key} must not be empty`);
      }
    }
  });

  it("does not fall back to Russian for non-Russian languages", () => {
    assert.equal(getMessages("es")["app.workspace"], "Área de trabajo");
    assert.equal(getMessages("pt")["settings.webSearchDefault"], "Ativar busca inteligente por padrão");
    assert.equal(getMessages("de")["role.assistant.label"], "Assistent");
  });

  it("localizes pipeline role labels and descriptions", () => {
    const spanishRoles = getLocalizedAgentRoles("es");
    assert.equal(spanishRoles.find((role) => role.id === "assistant").label, "Asistente");
    assert.match(
      spanishRoles.find((role) => role.id === "prompt_builder").description,
      /prompt útil/,
    );

    const { t } = createTranslator("zh");
    assert.equal(t("topbar.pipeline"), "流程");
  });
});

describe("parseToolCall", () => {
  it("parses bare JSON object", () => {
    assert.deepEqual(parseToolCall('{"tool":"read_file","path":"a.txt"}'), {
      tool: "read_file",
      path: "a.txt",
    });
  });

  it("extracts JSON from markdown fence", () => {
    const text = '```json\n{"tool":"finish","message":"done"}\n```';
    assert.deepEqual(parseToolCall(text), { tool: "finish", message: "done" });
  });

  it("extracts first JSON object from surrounding prose", () => {
    const text = 'Here is my call: {"tool":"list_files","path":"."} ok?';
    assert.deepEqual(parseToolCall(text), { tool: "list_files", path: "." });
  });

  it("returns null when no JSON object at all", () => {
    assert.equal(parseToolCall("Just some text"), null);
    assert.equal(parseToolCall(""), null);
    assert.equal(parseToolCall(null), null);
  });

  it("returns null when JSON lacks tool field", () => {
    assert.equal(parseToolCall('{"path":"x.txt"}'), null);
  });

  it("returns null on malformed JSON", () => {
    assert.equal(parseToolCall("{tool:"), null);
  });

  it("ignores ```python``` fence and finds JSON tool-call after it (Qwen case)", () => {
    const text = [
      "Сейчас покажу как создать файл:",
      "```python",
      'with open("hello.py", "w") as f:',
      '    f.write("print(1)")',
      "```",
      "Теперь выполню это через write_file:",
      '{"tool":"write_file","path":"hello.py","content":"print(1)"}',
    ].join("\n");
    assert.deepEqual(parseToolCall(text), {
      tool: "write_file",
      path: "hello.py",
      content: "print(1)",
    });
  });

  it("finds JSON tool-call inside ```tool_calls``` fence", () => {
    const text = '```tool_calls\n{"tool":"read_file","path":"a.txt"}\n```';
    assert.deepEqual(parseToolCall(text), {
      tool: "read_file",
      path: "a.txt",
    });
  });

  it("finds JSON inside ```python``` fence if the python block itself contains tool JSON", () => {
    const text = '```python\n{"tool":"finish","message":"ok"}\n```';
    assert.deepEqual(parseToolCall(text), { tool: "finish", message: "ok" });
  });

  it("skips non-tool JSON objects and returns the one with 'tool' field", () => {
    const text =
      'config: {"version":1,"name":"x"} and now action {"tool":"list_files","path":"."}.';
    assert.deepEqual(parseToolCall(text), { tool: "list_files", path: "." });
  });

  it("handles multiple fenced blocks — picks one with tool", () => {
    const text = [
      "```json",
      '{"comment":"this is just metadata"}',
      "```",
      "и потом",
      "```json",
      '{"tool":"mkdir","path":"src"}',
      "```",
    ].join("\n");
    assert.deepEqual(parseToolCall(text), { tool: "mkdir", path: "src" });
  });

  it("normalizes malformed empty-key tool calls", () => {
    const text = '{"":"write_file","path":"мегатест/skura","content":""}';
    assert.deepEqual(parseToolCall(text), {
      tool: "write_file",
      path: "мегатест/skura",
      content: "",
    });
  });

  it("normalizes OpenAI function-call shaped tool calls", () => {
    const text = '{"name":"mkdir","arguments":{"path":"мегатест"}}';
    assert.deepEqual(parseToolCall(text), {
      tool: "mkdir",
      path: "мегатест",
    });
  });

  it("parses XML-ish tool_call blocks", () => {
    const text = [
      "Хм, пользователь просит ещё раз проверить.",
      '<tool_call name="list_files">{"path":".","maxDepth":4}</tool_call>',
    ].join("\n");
    assert.deepEqual(parseToolCall(text), {
      tool: "list_files",
      path: ".",
      maxDepth: 4,
    });
  });

  it("parses XML-ish tool_calls wrapper with command args", () => {
    const text = [
      "Попробую другой подход.",
      '<tool_calls> <tool_call name="run_command">{"cmd":"ls","args":["-la","."]}</tool_call> </tool_calls>',
    ].join("\n");
    assert.deepEqual(parseToolCall(text), {
      tool: "run_command",
      cmd: "ls",
      args: ["-la", "."],
    });
  });
});

describe("extractFirstJsonObject", () => {
  it("returns null when no opening brace", () => {
    assert.equal(extractFirstJsonObject("no braces"), null);
  });

  it("handles nested objects", () => {
    const text = 'before {"a":{"b":"c"}} after';
    assert.equal(extractFirstJsonObject(text), '{"a":{"b":"c"}}');
  });

  it("respects strings (ignores braces inside)", () => {
    const text = '{"key":"value with } brace"}';
    assert.equal(extractFirstJsonObject(text), text);
  });

  it("respects escaped quotes", () => {
    const text = '{"key":"escaped \\" still string"}';
    assert.equal(extractFirstJsonObject(text), text);
  });
});

describe("validateCommandArgs", () => {
  it("blocks npm install/add/remove/publish", () => {
    assert.throws(() => validateCommandArgs("/tmp", "npm", ["install"]));
    assert.throws(() => validateCommandArgs("/tmp", "npm", ["add", "left-pad"]));
    assert.throws(() => validateCommandArgs("/tmp", "npm", ["publish"]));
  });

  it("blocks node -e / --eval / -p / --print", () => {
    assert.throws(() => validateCommandArgs("/tmp", "node", ["-e", "x"]));
    assert.throws(() => validateCommandArgs("/tmp", "node", ["--eval", "x"]));
    assert.throws(() => validateCommandArgs("/tmp", "node", ["-p", "x"]));
  });

  it("blocks python -c / -m", () => {
    assert.throws(() => validateCommandArgs("/tmp", "python", ["-c", "x"]));
    assert.throws(() => validateCommandArgs("/tmp", "python3", ["-m", "x"]));
  });

  it("blocks interactive node/python without script args", () => {
    assert.throws(() => validateCommandArgs("/tmp", "node", []));
    assert.throws(() => validateCommandArgs("/tmp", "python", []));
    assert.throws(() => validateCommandArgs("/tmp", "python3", []));
  });

  it("blocks shell operators in args", () => {
    assert.throws(() => validateCommandArgs("/tmp", "ls", ["a;b"]));
    assert.throws(() => validateCommandArgs("/tmp", "ls", ["a&&b"]));
    assert.throws(() => validateCommandArgs("/tmp", "ls", ["a|b"]));
    assert.throws(() => validateCommandArgs("/tmp", "ls", ["`whoami`"]));
  });

  it("blocks network URLs in args", () => {
    assert.throws(() => validateCommandArgs("/tmp", "ls", ["http://x"]));
    assert.throws(() => validateCommandArgs("/tmp", "ls", ["https://x"]));
  });

  it("accepts normal node + relative path", () => {
    // Path inside workspace should not throw.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-"));
    try {
      assert.doesNotThrow(() => validateCommandArgs(dir, "node", ["script.js"]));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("executeWorkspaceTool delete_file", () => {
  it("deletes a file inside the workspace", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-"));
    const file = path.join(dir, "setup_venv.py");
    fs.writeFileSync(file, "print('x')", "utf8");
    try {
      const result = await executeWorkspaceTool(dir, { tool: "delete_file", path: "setup_venv.py" });
      assert.deepEqual(result, {
        ok: true,
        path: "setup_venv.py",
        deleted: true,
        existed: true,
      });
      assert.equal(fs.existsSync(file), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not delete directories", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-"));
    fs.mkdirSync(path.join(dir, "nested"));
    try {
      await assert.rejects(
        () => executeWorkspaceTool(dir, { tool: "delete_file", path: "nested" }),
        /directory/i,
      );
      assert.equal(fs.existsSync(path.join(dir, "nested")), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("executeWorkspaceTool delete_dir", () => {
  it("deletes an empty directory inside the workspace", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-delete-dir-"));
    fs.mkdirSync(path.join(dir, "empty"));
    try {
      const result = await executeWorkspaceTool(dir, { tool: "delete_dir", path: "empty" });
      assert.equal(result.ok, true);
      assert.equal(result.deleted, true);
      assert.equal(fs.existsSync(path.join(dir, "empty")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("deletes non-empty directories inside the workspace", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-delete-dir-"));
    fs.mkdirSync(path.join(dir, "nonempty"));
    fs.writeFileSync(path.join(dir, "nonempty", "file.txt"), "x");
    try {
      const result = await executeWorkspaceTool(dir, { tool: "delete_dir", path: "nonempty" });
      assert.equal(result.ok, true);
      assert.equal(result.deleted, true);
      assert.equal(fs.existsSync(path.join(dir, "nonempty")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not delete a plain file through delete_dir", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-free-delete-dir-"));
    fs.writeFileSync(path.join(dir, "file.txt"), "x");
    try {
      await assert.rejects(
        () => executeWorkspaceTool(dir, { tool: "delete_dir", path: "file.txt" }),
        /not a directory/i,
      );
      assert.equal(fs.existsSync(path.join(dir, "file.txt")), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("executeWorkspaceTool list_files", () => {
  it("lists nested project files beyond the old shallow depth", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-"));
    fs.mkdirSync(path.join(dir, "project", "src", "core"), { recursive: true });
    fs.writeFileSync(path.join(dir, "project", "src", "core", "app.py"), "print(1)", "utf8");
    try {
      const result = await executeWorkspaceTool(dir, {
        tool: "list_files",
        path: ".",
        maxDepth: 4,
      });
      assert.equal(result.ok, true);
      assert.equal(result.path, ".");
      assert.ok(result.entries.includes("project/"));
      assert.ok(result.entries.includes("project/src/core/app.py"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports truncation instead of silently hiding files", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-"));
    try {
      for (let i = 0; i < 30; i += 1) {
        fs.writeFileSync(path.join(dir, `file-${String(i).padStart(2, "0")}.txt`), "x", "utf8");
      }
      const result = await executeWorkspaceTool(dir, {
        tool: "list_files",
        path: ".",
        maxEntries: 20,
      });
      assert.equal(result.entries.length, 20);
      assert.equal(result.truncated, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("formats list_files entries in tool logs", () => {
    const log = formatToolLog(
      { tool: "list_files", path: "." },
      { ok: true, entries: ["project/", "project/src/app.py"], truncated: false },
    );
    assert.match(log, /entries: 2/);
    assert.match(log, /project\/src\/app\.py/);
  });
});

describe("runCodeTask fatal tool errors", () => {
  it("stops immediately on interactive python instead of consuming the tool-step limit", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-"));
    let calls = 0;
    try {
      const fakeClient = {
        async complete() {
          calls += 1;
          return {
            text: '{"tool":"run_command","cmd":"python3"}',
            lastAssistantMessageId: `m${calls}`,
          };
        },
      };
      const result = await runCodeTask(fakeClient, { sessionId: "s1" }, dir, "make app");
      assert.equal(calls, 1);
      assert.match(result.message, /python3 without a script is blocked/);
      assert.doesNotMatch(result.message, /tool-step limit/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints tool errors instead of status undefined", () => {
    const log = formatToolLog(
      { tool: "run_command", cmd: "python3" },
      { ok: false, error: "blocked", fatal: true },
    );
    assert.match(log, /error: blocked/);
    assert.doesNotMatch(log, /status: undefined/);
  });
});

describe("runCodeTask transient text retries", () => {
  it("retries transient quota text and continues the same step", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-"));
    const file = path.join(dir, "setup_venv.py");
    fs.writeFileSync(file, "print('x')", "utf8");
    let calls = 0;
    try {
      const fakeClient = {
        async complete() {
          calls += 1;
          if (calls === 1) {
            return {
              text: "Qwen отклонил этот запрос по quota/token-limit. allocated quota exceeded",
              lastAssistantMessageId: "quota",
            };
          }
          if (calls === 2) {
            return {
              text: '{"tool":"delete_file","path":"setup_venv.py"}',
              lastAssistantMessageId: "tool",
            };
          }
          return {
            text: '{"tool":"finish","message":"Удалил setup_venv.py"}',
            lastAssistantMessageId: "finish",
          };
        },
      };
      const result = await runCodeTask(fakeClient, { sessionId: "s1" }, dir, "delete setup_venv.py", null, {
        transientTextRetries: 1,
      });
      assert.equal(calls, 3);
      assert.equal(result.message, "Удалил setup_venv.py");
      assert.equal(fs.existsSync(file), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveMaxToolSteps", () => {
  it("defaults to a larger budget for multi-file tasks", () => {
    assert.equal(resolveMaxToolSteps(undefined), 200);
  });

  it("clamps configured values to a safe range", () => {
    assert.equal(resolveMaxToolSteps(1), 5);
    assert.equal(resolveMaxToolSteps(500), 200);
    assert.equal(resolveMaxToolSteps("55"), 55);
  });
});

describe("isTransientUpstreamTextError", () => {
  it("detects quota and rate-limit text returned as assistant content", () => {
    assert.equal(isTransientUpstreamTextError("allocated quota exceeded"), true);
    assert.equal(isTransientUpstreamTextError("Qwen отклонил этот запрос по quota/token-limit"), true);
    assert.equal(isTransientUpstreamTextError("normal answer"), false);
  });
});

describe("COMMAND_CATALOG.rm validateArgs", () => {
  const v = COMMAND_CATALOG.rm.validateArgs;

  it("blocks --recursive", () => {
    assert.throws(() => v(["--recursive", "x"]));
  });

  it("blocks --no-preserve-root", () => {
    assert.throws(() => v(["--no-preserve-root"]));
  });

  it("blocks -r, -R, -rf, -Rf, -fR", () => {
    assert.throws(() => v(["-r"]));
    assert.throws(() => v(["-R"]));
    assert.throws(() => v(["-rf"]));
    assert.throws(() => v(["-Rf"]));
    assert.throws(() => v(["-fR"]));
    assert.throws(() => v(["-fr"]));
  });

  it("allows simple rm without recursive flag", () => {
    assert.doesNotThrow(() => v(["file.txt"]));
    assert.doesNotThrow(() => v(["-f", "file.txt"]));
  });
});

describe("COMMAND_CATALOG.rmdir validateArgs", () => {
  const v = COMMAND_CATALOG.rmdir.validateArgs;

  it("blocks flags", () => {
    assert.throws(() => v(["-p", "dir"]));
    assert.throws(() => v(["--ignore-fail-on-non-empty", "dir"]));
  });

  it("allows a plain directory path", () => {
    assert.doesNotThrow(() => v(["empty_dir"]));
  });
});

describe("COMMAND_CATALOG.git validateArgs", () => {
  const v = COMMAND_CATALOG.git.validateArgs;

  it("blocks clone, fetch, pull", () => {
    assert.throws(() => v(["clone", "https://x"]));
    assert.throws(() => v(["fetch"]));
    assert.throws(() => v(["pull"]));
  });

  it("blocks push --force / -f", () => {
    assert.throws(() => v(["push", "--force"]));
    assert.throws(() => v(["push", "-f"]));
    assert.throws(() => v(["push", "+"]));
  });

  it("blocks remote add", () => {
    assert.throws(() => v(["remote", "add", "origin", "x"]));
  });

  it("blocks submodule add", () => {
    assert.throws(() => v(["submodule", "add", "x"]));
  });

  it("allows normal git ops", () => {
    assert.doesNotThrow(() => v(["status"]));
    assert.doesNotThrow(() => v(["log"]));
    assert.doesNotThrow(() => v(["diff"]));
    assert.doesNotThrow(() => v(["add", "."]));
    assert.doesNotThrow(() => v(["commit", "-m", "msg"]));
    assert.doesNotThrow(() => v(["push"]));
    assert.doesNotThrow(() => v(["push", "origin", "main"]));
  });
});

describe("COMMAND_CATALOG.find validateArgs", () => {
  const v = COMMAND_CATALOG.find.validateArgs;

  it("blocks -exec, -execdir, -delete, -ok", () => {
    assert.throws(() => v([".", "-exec", "rm", "{}"]));
    assert.throws(() => v([".", "-execdir", "x"]));
    assert.throws(() => v([".", "-delete"]));
    assert.throws(() => v([".", "-ok", "x"]));
  });

  it("allows normal find queries", () => {
    assert.doesNotThrow(() => v([".", "-name", "*.js"]));
    assert.doesNotThrow(() => v([".", "-type", "f"]));
  });
});

describe("COMMAND_CATALOG.chmod validateArgs", () => {
  const v = COMMAND_CATALOG.chmod.validateArgs;

  it("blocks 777, a+rwx, ugo+rwx", () => {
    assert.throws(() => v(["777", "file"]));
    assert.throws(() => v(["a+rwx", "file"]));
    assert.throws(() => v(["ugo+rwx", "file"]));
  });

  it("allows normal chmod", () => {
    assert.doesNotThrow(() => v(["644", "file"]));
    assert.doesNotThrow(() => v(["+x", "file"]));
  });
});

describe("COMMAND_CATALOG hardware validators", () => {
  it("allows safe PlatformIO device/run commands and blocks account/network maintenance", () => {
    const v = COMMAND_CATALOG.pio.validateArgs;
    assert.doesNotThrow(() => v(["device", "list"]));
    assert.doesNotThrow(() => v(["device", "monitor", "--port", "/dev/cu.usbserial-110"]));
    assert.doesNotThrow(() => v(["run", "-t", "upload"]));
    assert.throws(() => v(["pkg", "update"]));
    assert.throws(() => v(["upgrade"]));
  });

  it("allows Arduino CLI compile/upload/monitor and blocks package management", () => {
    const v = COMMAND_CATALOG["arduino-cli"].validateArgs;
    assert.doesNotThrow(() => v(["board", "list"]));
    assert.doesNotThrow(() => v(["compile", "--fqbn", "esp32:esp32:esp32"]));
    assert.doesNotThrow(() => v(["upload", "-p", "/dev/cu.usbserial-110"]));
    assert.throws(() => v(["core", "install", "esp32:esp32"]));
    assert.throws(() => v(["lib", "install", "x"]));
  });

  it("allows esptool diagnostics/write_flash and blocks erase_flash", () => {
    const v = COMMAND_CATALOG["esptool.py"].validateArgs;
    assert.doesNotThrow(() => v(["--port", "/dev/cu.usbserial-110", "read_mac"]));
    assert.doesNotThrow(() => v(["--chip", "esp32", "write_flash", "0x1000", "firmware.bin"]));
    assert.throws(() => v(["--port", "/dev/cu.usbserial-110", "erase_flash"]));
    assert.throws(() => v(["--port", "/dev/cu.usbserial-110"]));
  });
});

describe("hardware tool helpers", () => {
  it("adds common user install bins to command PATH", () => {
    const env = getCommandExecutionEnv({ HOME: "/Users/example", PATH: "/usr/bin" });
    const parts = env.PATH.split(path.delimiter);
    assert.equal(parts.includes("/Users/example/.local/bin"), true);
    assert.equal(parts.includes("/Users/example/Library/Python"), true);
    assert.equal(parts.includes("/opt/homebrew/bin"), true);
    assert.equal(parts.includes("/usr/local/bin"), true);
    assert.equal(parts.includes("/usr/bin"), true);
    assert.equal(buildCommandPath({ HOME: "/Users/example", PATH: "/usr/bin" }).includes("/Users/example/Library/Python"), true);
  });

  it("lists serial ports as a safe read-only tool", async () => {
    const result = await executeWorkspaceTool(process.cwd(), { tool: "list_serial_ports" });
    assert.equal(typeof result.ok, "boolean");
    assert.ok(Array.isArray(result.ports));
    assert.equal(result.count, result.ports.length);
  });

  it("formats serial port logs", () => {
    const log = formatToolLog(
      { tool: "list_serial_ports" },
      { ok: true, ports: ["/dev/cu.usbserial-110"], count: 1 },
    );
    assert.match(log, /ports: 1/);
    assert.match(log, /\/dev\/cu\.usbserial-110/);
  });

  it("creates fixed install requests only for hardware commands", () => {
    assert.deepEqual(createInstallRequestForMissingCommand("node"), null);
    assert.equal(createInstallRequestForMissingCommand("pio").id, "platformio");
    assert.equal(createInstallRequestForMissingCommand("esptool.py").command, "python3");
    assert.equal(createInstallRequestForMissingCommand("arduino-cli").command, "brew");
  });
});

describe("ask_user helper", () => {
  it("creates a bounded clarification request", () => {
    const result = createUserQuestion({
      question: "Which board?",
      details: "Needed before flashing.",
      choices: ["ESP32", "ESP8266", "Other", "A", "B", "C", "D"],
    });
    assert.equal(result.awaitingUser, true);
    assert.equal(result.userQuestion.question, "Which board?");
    assert.equal(result.userQuestion.details, "Needed before flashing.");
    assert.deepEqual(result.userQuestion.choices, ["ESP32", "ESP8266", "Other", "A", "B", "C"]);
  });

  it("rejects empty questions", () => {
    const result = createUserQuestion({ question: "" });
    assert.equal(result.ok, false);
    assert.equal(result.fatal, true);
  });
});

describe("isAllowedDevicePath", () => {
  it("allows serial ports only for hardware commands", () => {
    assert.equal(isAllowedDevicePath("pio", "/dev/cu.usbserial-110"), true);
    assert.equal(isAllowedDevicePath("arduino-cli", "/dev/ttyUSB0"), true);
    assert.equal(isAllowedDevicePath("esptool.py", "/dev/cu.SLAB_USBtoUART"), true);
    assert.equal(isAllowedDevicePath("node", "/dev/cu.usbserial-110"), false);
    assert.equal(isAllowedDevicePath("pio", "/etc/passwd"), false);
  });
});

describe("looksLikePath", () => {
  it("detects paths starting with . or /", () => {
    assert.equal(looksLikePath("./file"), true);
    assert.equal(looksLikePath("/abs"), true);
  });

  it("detects paths with slash", () => {
    assert.equal(looksLikePath("dir/file"), true);
  });

  it("detects common code file extensions", () => {
    assert.equal(looksLikePath("script.js"), true);
    assert.equal(looksLikePath("notes.md"), true);
    assert.equal(looksLikePath("README.txt"), true);
  });

  it("doesnt confuse non-path strings", () => {
    assert.equal(looksLikePath("hello"), false);
    assert.equal(looksLikePath("argument"), false);
  });
});

describe("resolveWorkspacePath", () => {
  let ws;

  it("setup", () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "rw-"));
  });

  it("resolves relative path inside workspace", () => {
    const result = resolveWorkspacePath(ws, "file.txt");
    assert.equal(result, path.join(ws, "file.txt"));
  });

  it("rejects path that escapes via ..", () => {
    assert.throws(() => resolveWorkspacePath(ws, "../outside"));
  });

  it("rejects absolute path pointing outside", () => {
    assert.throws(() => resolveWorkspacePath(ws, "/etc/passwd"));
  });

  it("rejects .git, node_modules, .env subdirs", () => {
    assert.throws(() => resolveWorkspacePath(ws, ".git/config"));
    assert.throws(() => resolveWorkspacePath(ws, "node_modules/foo"));
    assert.throws(() => resolveWorkspacePath(ws, ".env"));
  });

  it("rejects empty/null path", () => {
    assert.throws(() => resolveWorkspacePath(ws, ""));
    assert.throws(() => resolveWorkspacePath(ws, null));
  });

  it("cleanup", () => {
    fs.rmSync(ws, { recursive: true, force: true });
  });
});

describe("truncateOutput", () => {
  it("returns string unchanged when short", () => {
    assert.equal(truncateOutput("hello"), "hello");
  });

  it("truncates and adds marker when too long", () => {
    const long = "x".repeat(15000);
    const result = truncateOutput(long);
    assert.ok(result.length < long.length);
    assert.ok(result.endsWith("[truncated]"));
  });

  it("coerces non-strings", () => {
    assert.equal(truncateOutput(null), "");
    assert.equal(truncateOutput(undefined), "");
    assert.equal(truncateOutput(42), "42");
  });
});
