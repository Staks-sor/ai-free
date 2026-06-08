import { Readable, Writable } from "node:stream";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { handleRequest } from "../api/openai-handler.mjs";

describe("OpenAI-compatible handler", () => {
  it("advertises the Responses API endpoint", async () => {
    const res = await callHandler({ method: "GET", url: "/" });
    assert.equal(res.statusCode, 200);
    assert.ok(res.json.endpoints.includes("POST /v1/responses"));
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
});

async function callHandler({ method, url, body }) {
  const chunks = [];
  const reqBody = body === undefined ? "" : JSON.stringify(body);
  const req = Readable.from(reqBody ? [Buffer.from(reqBody)] : []);
  req.method = method;
  req.url = url;
  req.headers = { host: "127.0.0.1:4318" };

  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = (name, value) => {
    res.headers[String(name).toLowerCase()] = value;
  };

  await handleRequest(req, res);
  const text = Buffer.concat(chunks).toString("utf8");
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    text,
    json: text ? JSON.parse(text) : null,
  };
}
