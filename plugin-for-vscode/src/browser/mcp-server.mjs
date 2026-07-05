// MCP stdio-сервер для управляемого Web-браузера ai-free (Codex-style Browser tools).

import readline from "node:readline";
import { executeBrowserTool, getBrowserMcpToolDefinitions } from "./service.mjs";

const SERVER_INFO = {
  name: "ai-free-browser",
  version: "1.0.0",
};

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function toolResultContent(result) {
  const payload = { ...result };
  if (payload.screenshot?.base64) {
    delete payload.screenshot.base64;
  }
  const text = JSON.stringify(payload, null, 2);
  const parts = [{ type: "text", text }];
  if (result?.screenshot?.base64) {
    parts.push({
      type: "image",
      data: result.screenshot.base64,
      mimeType: result.screenshot.mime || "image/jpeg",
    });
  }
  return parts;
}

async function handleRequest(message) {
  const { id, method, params } = message;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    });
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id,
      result: { tools: getBrowserMcpToolDefinitions() },
    });
    return;
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      const result = await executeBrowserTool({
        tool: name,
        ...args,
        includeScreenshotBase64: true,
      });
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: toolResultContent(result),
          isError: result?.ok === false,
        },
      });
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: error.message }],
          isError: true,
        },
      });
    }
    return;
  }

  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }

  if (id != null) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }
}

export async function runBrowserMcpServer() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const trimmed = String(line || "").trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return;
    }
    handleRequest(message).catch((error) => {
      if (message?.id != null) {
        send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32603, message: error.message },
        });
      }
    });
  });
}
