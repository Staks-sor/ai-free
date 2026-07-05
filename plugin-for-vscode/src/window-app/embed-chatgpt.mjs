// Обёртка для drawer: iframe на reverse-proxy ChatGPT (без отдельного Chrome).

export function renderEmbedChatGPTHtml({ title = "ChatGPT" } = {}) {
  const safeTitle = String(title || "ChatGPT").replace(/</g, "&lt;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; background: #0e1116; overflow: hidden; }
    iframe { display: block; width: 100%; height: 100%; border: 0; background: #0e1116; }
  </style>
</head>
<body>
  <iframe id="chatgptFrame" title="${safeTitle}" src="/provider-frame/chatgpt/"></iframe>
</body>
</html>`;
}
