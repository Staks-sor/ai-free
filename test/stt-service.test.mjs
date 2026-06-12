import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getVoiceStatus, installSttRuntime, transcribeAudio } from "../src/stt/service.mjs";

describe("stt service", () => {
  it("reports missing optional helper without requiring a bundled model", () => {
    const previous = process.env.AI_FREE_STT_BIN;
    process.env.AI_FREE_STT_BIN = path.join(os.tmpdir(), "missing-ai-free-stt");
    try {
      const status = getVoiceStatus();
      assert.equal(status.provider, "parakeet-v3");
      assert.equal(status.helperAvailable, false);
      assert.match(status.installHint, /AI_FREE_STT_BIN/);
    } finally {
      if (previous === undefined) delete process.env.AI_FREE_STT_BIN;
      else process.env.AI_FREE_STT_BIN = previous;
    }
  });

  it("passes recorded audio to an external helper and parses JSON output", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stt-helper-"));
    const helper = path.join(dir, "ai-free-stt");
    fs.writeFileSync(
      helper,
      "#!/bin/sh\nprintf '{\"text\":\"hello from voice\",\"language\":\"en\",\"durationMs\":25}'\n",
      { mode: 0o755 },
    );
    const previous = process.env.AI_FREE_STT_BIN;
    process.env.AI_FREE_STT_BIN = helper;
    try {
      const result = await transcribeAudio({
        dataBase64: Buffer.from("fake audio").toString("base64"),
        mimeType: "audio/webm",
      });
      assert.deepEqual(result, {
        text: "hello from voice",
        language: "en",
        durationMs: 25,
      });
    } finally {
      if (previous === undefined) delete process.env.AI_FREE_STT_BIN;
      else process.env.AI_FREE_STT_BIN = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to Cargo when Homebrew terminates during install", { skip: process.platform !== "darwin" }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stt-install-"));
    const brew = path.join(dir, "brew");
    const cargo = path.join(dir, "cargo");
    const parakeet = path.join(dir, "parakeet");
    const sttDir = path.join(dir, "stt");
    fs.writeFileSync(brew, "#!/bin/sh\nkill -TERM $$\n", { mode: 0o755 });
    fs.writeFileSync(
      cargo,
      `#!/bin/sh
cat > ${shellQuote(parakeet)} <<'EOF'
#!/bin/sh
if [ "$1" = "download" ]; then
  mkdir -p "$3"
  touch "$3/model.onnx"
  exit 0
fi
printf '{"text":"ok","language":"auto","durationMs":1}'
EOF
chmod +x ${shellQuote(parakeet)}
`,
      { mode: 0o755 },
    );
    const previousPath = process.env.PATH;
    const previousSttDir = process.env.AI_FREE_STT_DIR;
    const previousStrictPath = process.env.AI_FREE_STT_STRICT_PATH;
    process.env.PATH = [dir, "/bin", "/usr/bin"].join(path.delimiter);
    process.env.AI_FREE_STT_DIR = sttDir;
    process.env.AI_FREE_STT_STRICT_PATH = "1";
    try {
      const logs = [];
      const status = await installSttRuntime({ onLog: (message) => logs.push(message) });
      assert.equal(status.parakeetAvailable, true);
      assert.equal(status.sttDir, sttDir);
      assert.ok(fs.existsSync(path.join(sttDir, "runtime", "ai-free-stt")));
      assert.ok(logs.some((message) => /Homebrew install failed/.test(message)));
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousSttDir === undefined) delete process.env.AI_FREE_STT_DIR;
      else process.env.AI_FREE_STT_DIR = previousSttDir;
      if (previousStrictPath === undefined) delete process.env.AI_FREE_STT_STRICT_PATH;
      else process.env.AI_FREE_STT_STRICT_PATH = previousStrictPath;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
