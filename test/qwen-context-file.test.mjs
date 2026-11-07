import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveQwenContextFileConfig,
  splitPromptForFileUpload,
  splitFileTextForOverflow,
  uploadQwenContextFile,
  uploadQwenContextFiles,
  buildQwenFileAttachment,
} from "../src/providers/qwen/context-file.mjs";
import { buildQwenCompletionPayload } from "../src/providers/qwen/completion-payload.mjs";
import { formatQwenStreamError } from "../src/providers/qwen/client.mjs";

// --- helpers ---------------------------------------------------------------

const SEP = "\n\n---\n\n";

function makePrompt(segments) {
  return segments.join(SEP);
}

function fakeSts(overrides = {}) {
  return {
    access_key_id: "STS.testkey",
    access_key_secret: "testsecret",
    security_token: "test-token",
    bucketname: "qwen-webui-prod",
    region: "oss-ap-southeast-1",
    endpoint: "https://oss-accelerate.aliyuncs.com",
    file_id: "8178ea3e-e17c-4ee5-ab9e-96180361507d",
    file_path: "361c7133-1db9-44b7-a17a-d7a1a9564f22/8178ea3e-e17c-4ee5-ab9e-96180361507d_Pasted_Text_1787236266249.txt",
    file_url: "https://qwen-webui-prod.oss-accelerate.aliyuncs.com/361c7133/8178ea3e.txt?x-oss-signature=abc",
    ...overrides,
  };
}

// --- config -----------------------------------------------------------------

describe("qwen context-file config", () => {
  it("defaults threshold/inline for the observed anti-bot limit", () => {
    const cfg = resolveQwenContextFileConfig({});
    assert.equal(cfg.thresholdChars, 100_000);
    assert.equal(cfg.inlineChars, 50_000);
  });

  it("keeps environment overrides", () => {
    const cfg = resolveQwenContextFileConfig({
      QWEN_CONTEXT_FILE_THRESHOLD: "90000",
      QWEN_CONTEXT_FILE_INLINE_CHARS: "20000",
    });
    assert.equal(cfg.thresholdChars, 90_000);
    assert.equal(cfg.inlineChars, 20_000);
  });
});

// --- split ------------------------------------------------------------------

describe("qwen context-file split", () => {
  const cfg = { thresholdChars: 1000, inlineChars: 400 };

  it("returns null below threshold", () => {
    const prompt = makePrompt(["[TOOL INSTRUCTIONS]...", "[USER]: hi"]);
    assert.equal(splitPromptForFileUpload(prompt, cfg), null);
  });

  it("keeps tool instructions head and recent tail inline, older middle goes to file", () => {
    const head = "[TOOL INSTRUCTIONS]".padEnd(50, "H");
    const old1 = "[USER]: old question 1".padEnd(350, "1");
    const old2 = "[ASSISTANT]: old answer".padEnd(350, "2");
    const old3 = "[USER]: old question 3".padEnd(350, "3");
    const recent = "[USER]: recent question".padEnd(150, "R");
    const prompt = makePrompt([head, old1, old2, old3, recent]); // ~1300 > 1000

    const split = splitPromptForFileUpload(prompt, cfg);
    assert.ok(split, "split must happen above threshold");
    // Head always stays inline (format discipline).
    assert.ok(split.inline.startsWith(head), "tool instructions must stay inline");
    // Recent tail stays inline.
    assert.ok(split.inline.includes(recent), "recent segment must stay inline");
    // Old segments moved to file.
    assert.ok(split.fileText.includes(old1) || split.fileText.includes(old2), "old segments must move to the file");
    assert.ok(!split.inline.includes(old1), "old segment must NOT stay inline");
    // Inline stays within budget (head + tail + note).
    assert.ok(split.inline.length < head.length + recent.length + 600, `inline too big: ${split.inline.length}`);
    // Note tells the model about the attachment.
    assert.match(split.inline, /context\.txt/);
    assert.ok(split.fileChars > 0);
  });

  it("falls back to a character split for one giant segment", () => {
    const giant = "X".repeat(5000); // single segment, no separators
    const split = splitPromptForFileUpload(giant, cfg);
    assert.ok(split);
    assert.ok(split.inline.length <= cfg.inlineChars + 600, `inline too big: ${split.inline.length}`);
    assert.ok(split.fileChars > 3000);
    // Reassembly keeps content: file + inline cover the giant minus note overhead.
    assert.ok(split.fileText.includes("X".repeat(100)));
  });
});

// --- attachment shape (from real web-UI HAR capture) -------------------------

describe("qwen context-file attachment", () => {
  it("matches the web UI files[] object shape", () => {
    const sts = fakeSts();
    const att = buildQwenFileAttachment(sts, "Pasted_Text_1787236266249.txt", 717_775);
    assert.equal(att.type, "file");
    assert.equal(att.file.id, sts.file_id);
    assert.equal(att.id, sts.file_id);
    assert.equal(att.url, sts.file_url);
    assert.equal(att.file.user_id, "361c7133-1db9-44b7-a17a-d7a1a9564f22");
    assert.equal(att.file.meta.content_type, "text/plain");
    assert.equal(att.file.meta.parse_meta.parse_status, "success");
    assert.equal(att.file.size, 717_775);
    assert.equal(att.size, 717_775);
    assert.equal(att.file_class, "default");
    assert.equal(att.context, "full");
    assert.equal(att.showType, "file");
    assert.equal(att.status, "uploaded");
    assert.equal(att.greenNet, "success");
    assert.equal(att.progress, 0);
    assert.equal(att.error, "");
    assert.ok(att.itemId);
    assert.ok(att.uploadTaskId);
    assert.equal(att.file.webkitRelativePath, "");
  });
});

// --- upload orchestrator -----------------------------------------------------

describe("qwen context-file upload pipeline", () => {
  it("runs sts -> oss put -> parse -> poll and returns the attachment", async () => {
    const sts = fakeSts();
    const calls = [];
    const proxyApiPost = async (path, body) => {
      calls.push({ path, body });
      if (path === "/api/v2/files/getstsToken") return { ok: true, status: 200, json: { data: sts } };
      if (path === "/api/v2/files/parse") return { ok: true, status: 200, json: {} };
      if (path === "/api/v2/files/parse/status") return { ok: true, status: 200, json: { data: [{ status: "success" }] } };
      throw new Error("unexpected path " + path);
    };
    const ossPuts = [];
    const fetchImpl = async (url, init) => {
      ossPuts.push({ url, init });
      return { ok: true, status: 200, statusText: "OK", text: async () => "" };
    };

    const att = await uploadQwenContextFile({
      proxyApiPost,
      fetchImpl,
      content: "hello context",
      now: () => 1_787_236_266_249,
    });

    // STS requested with the web UI body shape.
    assert.equal(calls[0].path, "/api/v2/files/getstsToken");
    assert.equal(calls[0].body.filetype, "file");
    assert.equal(typeof calls[0].body.filesize, "string");
    assert.match(calls[0].body.filename, /^Pasted_Text_\d+\.txt$/);

    // OSS PUT to bucket endpoint with Authorization: OSS <key>:<sig>.
    assert.equal(ossPuts.length, 1);
    assert.ok(ossPuts[0].url.startsWith("https://qwen-webui-prod.oss-accelerate.aliyuncs.com/"));
    assert.equal(ossPuts[0].init.method, "PUT");
    assert.match(ossPuts[0].init.headers.Authorization, /^OSS STS\.testkey:/);
    assert.equal(ossPuts[0].init.headers["x-oss-security-token"], "test-token");

    // parse + status polled.
    assert.ok(calls.some((c) => c.path === "/api/v2/files/parse"));
    assert.ok(calls.some((c) => c.path === "/api/v2/files/parse/status"));

    assert.equal(att.id, sts.file_id);
    assert.equal(att.context, "full");
  });

  it("proceeds after parse poll timeout (server finishes parsing async)", async () => {
    const sts = fakeSts();
    let statusCalls = 0;
    const proxyApiPost = async (path) => {
      if (path === "/api/v2/files/getstsToken") return { ok: true, status: 200, json: { data: sts } };
      if (path === "/api/v2/files/parse") return { ok: true, status: 200, json: {} };
      if (path === "/api/v2/files/parse/status") { statusCalls += 1; return { ok: true, status: 200, json: { data: [{ status: "running" }] } }; }
      throw new Error("unexpected " + path);
    };
    const att = await uploadQwenContextFile({
      proxyApiPost,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => "" }),
      content: "x",
      pollTimeoutMs: 10,
      pollIntervalMs: 4,
    });
    assert.equal(att.id, sts.file_id);
    assert.ok(statusCalls >= 2);
  });
});

// --- payload integration ------------------------------------------------------

describe("qwen completion payload files", () => {
  it("places provided files into the user message", () => {
    const file = { type: "file", id: "abc", context: "full" };
    const payload = buildQwenCompletionPayload({
      chatId: "chat-1",
      prompt: "inline question",
      model: "qwen3.7-plus",
      files: [file],
    });
    assert.deepEqual(payload.messages[0].files, [file]);
    assert.equal(payload.messages[0].content, "inline question");
  });

  it("defaults to empty files array", () => {
    const payload = buildQwenCompletionPayload({ chatId: "c", prompt: "p", model: "m" });
    assert.deepEqual(payload.messages[0].files, []);
  });
});

// --- punish stub detection -----------------------------------------------------

describe("qwen punish stub error formatting", () => {
  it("recognizes the RGV587 anti-bot stub returned for oversized prompts", () => {
    const stub = {
      ret: ["FAIL_SYS_USER_VALIDATE", "RGV587_ERROR::SM::哎哟喂,被挤爆啦,请稝坎針试"],
      data: {
        url: "https://chat.qwen.ai:443//api/v2/chat/completions/_____tmd_____/punish?x5secdata=abc&x5step=2&action=captcha&pureCaptcha=",
      },
    };
    const msg = formatQwenStreamError(stub);
    assert.ok(msg, "stub must be recognized");
    assert.match(msg, /anti-bot|RGV587/i);
    assert.match(msg, /context|меньше|file/i);
  });

  it("still ignores normal payloads without ret/punish markers", () => {
    assert.equal(formatQwenStreamError({ data: { url: "https://example.com/ok" } }), null);
  });
});

describe("qwen context-file overflow (мульти-файл)", () => {
  const cfg = (patch = {}) => ({
    thresholdChars: 100,
    inlineChars: 50,
    maxFileChars: 500_000,
    ...patch,
  });

  it("splitFileTextForOverflow: ниже потолка — одна часть", () => {
    const parts = splitFileTextForOverflow("a".repeat(1000), 500_000);
    assert.equal(parts.length, 1);
    assert.equal(parts[0].length, 1000);
  });

  it("упаковывает целые сегменты, излишек — во вторую часть", () => {
    const seg = (n) => `SEG${n} ` + "x".repeat(400);
    const text = [seg(1), seg(2), seg(3)].join("\n\n---\n\n");
    const parts = splitFileTextForOverflow(text, 1000);
    assert.equal(parts.length, 2);
    assert.ok(parts[0].includes("SEG1") && parts[0].includes("SEG2"));
    assert.ok(!parts[0].includes("SEG3"));
    assert.ok(parts[1].includes("SEG3"));
    assert.equal(parts.join("\n\n---\n\n"), text, "сборка без потерь");
  });

  it("гигантский сегмент жёстко режется на куски по потолку", () => {
    const parts = splitFileTextForOverflow("y".repeat(2500), 1000);
    assert.equal(parts.length, 3);
    assert.deepEqual(parts.map((p) => p.length), [1000, 1000, 500]);
  });

  it("пустой текст — ноль частей", () => {
    assert.deepEqual(splitFileTextForOverflow("", 100), []);
    assert.deepEqual(splitFileTextForOverflow("   \n ", 100), []);
  });

  it("splitPromptForFileUpload возвращает fileParts и упоминает число файлов", () => {
    const head = "[TOOL INSTRUCTIONS] head";
    const seg = (n) => `MSG${n} ` + "z".repeat(120);
    const prompt = [head, seg(1), seg(2), seg(3)].join("\n\n---\n\n");
    const split = splitPromptForFileUpload(prompt, cfg({ thresholdChars: 300, inlineChars: 150, maxFileChars: 200 }));
    assert.ok(split.fileParts.length >= 2, "ожидались минимум 2 части");
    assert.equal(split.fileParts.join("\n\n---\n\n"), split.fileText);
    const noteMatch = split.inline.match(/(\d+) текстовых файл/);
    assert.ok(noteMatch, "заметка должна упоминать число файлов");
    assert.equal(Number(noteMatch[1]), split.fileParts.length);
  });

  it("uploadQwenContextFiles загружает части последовательно с нумерацией", async () => {
    const calls = [];
    const proxyApiPost = async (path, body) => {
      calls.push(path);
      if (path === "/api/v2/files/getstsToken") {
        const n = calls.filter((c) => c === "/api/v2/files/getstsToken").length;
        return {
          ok: true, status: 200,
          json: { data: {
            access_key_id: "ak", access_key_secret: "sk", security_token: "st",
            bucketname: "b", region: "r", endpoint: "https://oss.example",
            file_id: "fid_" + n,
            file_path: "u1/f" + n + ".txt",
            file_url: "https://oss.example/u1/f.txt",
          } },
        };
      }
      if (path === "/api/v2/files/parse/status") {
        return { ok: true, status: 200, json: { data: [{ status: "success" }] } };
      }
      return { ok: true, status: 200, json: {} };
    };
    const fetchImpl = async () => ({ ok: true });
    const attachments = await uploadQwenContextFiles({
      proxyApiPost,
      fetchImpl,
      parts: ["часть один", "часть два", "часть три"],
      now: () => 1_700_000_000_000,
    });
    assert.equal(attachments.length, 3);
    assert.equal(attachments[0].name, "Pasted_Text_1700000000000.txt");
    assert.equal(attachments[1].name, "Pasted_Text_1700000000000_2.txt");
    assert.equal(attachments[2].name, "Pasted_Text_1700000000000_3.txt");
    assert.equal(calls.filter((c) => c === "/api/v2/files/getstsToken").length, 3);
    assert.equal(attachments[0].file_class, "default");
  });
});
