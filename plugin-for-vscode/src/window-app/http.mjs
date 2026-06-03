// Утилиты HTTP-сервера для окна чатов: чтение JSON-тела, отправка JSON/HTML.

// maxBytes по умолчанию 2 МБ — для обычных JSON-запросов.
// Для загрузки картинок передаётся 30 МБ (base64 раздувает payload на ~33%).
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
  });
  res.end(html);
}
