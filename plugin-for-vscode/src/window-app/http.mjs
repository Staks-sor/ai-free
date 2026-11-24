// Утилиты HTTP-сервера для окна чатов: чтение JSON-тела, отправка JSON/HTML.

// maxBytes по умолчанию 2 МБ — для обычных JSON-запросов.
// Five 16 MB image inputs plus base64 encoding and bounded text overhead.
export const MAX_IMAGE_MESSAGE_BODY_BYTES = 110_000_000;

export function readJsonBody(req, maxBytes = 2_000_000) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > maxBytes) {
        reject(new Error(`Request body is too large (limit ${maxBytes} bytes).`));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

export function sendJson(res, body, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

export function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "frame-ancestors 'self' vscode-webview: vscode-file://vscode-app https://*.vscode-cdn.net http://127.0.0.1:* http://localhost:*",
  });
  res.end(html);
}

export function responseAbortSignal(res) {
  const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  return controller.signal;
}

export function beginNdjsonStream(res, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
}

export function writeNdjsonLine(res, body) {
  res.write(`${JSON.stringify(body)}\n`);
}

export function endNdjsonStream(res) {
  res.end();
}

export async function sendSavedJson(writer, res, body, status = 200) {
  if (status < 400) {
    try { await writer.flush(); }
    catch (error) {
      return sendJson(res, { error: error.message, code: error.code || 'STATE_SAVE_FAILED' }, error.code === 'STATE_CONFLICT' ? 409 : 503);
    }
  }
  if (!res.writableEnded) return sendJson(res, body, status);
}

export async function endSavedNdjsonStream(writer, res) {
  try { await writer.flush(); }
  catch (error) {
    if (!res.writableEnded) writeNdjsonLine(res, { type: 'error', message: error.message, code: error.code || 'STATE_SAVE_FAILED' });
  }
  if (!res.writableEnded) endNdjsonStream(res);
}
