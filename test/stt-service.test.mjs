import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getVoiceStatus, transcribeAudio } from "../src/stt/service.mjs";

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
});
