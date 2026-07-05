// Стартовая страница Web-браузера (headless → MJPEG).

export function buildWebBrowserStartDataUrl() {
  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; background: #0e1116; color: #8b96a7;
      font: 14px/1.55 system-ui, sans-serif; display: flex; align-items: center; justify-content: center;
      padding: 24px; text-align: center;
    }
    .card { max-width: 440px; }
    h1 { margin: 0 0 12px; color: #edf1f7; font-size: 20px; font-weight: 700; }
    p { margin: 0 0 10px; }
    code { color: #7fa0ff; font-size: 13px; }
    .url { margin-top: 16px; color: #6ee7b7; font-size: 13px; word-break: break-all; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🌐 Web-браузер ai-free</h1>
    <p>Страницы здесь видят <strong>DeepSeek</strong> и <strong>Qwen</strong>.</p>
    <p>Введите URL в поле адреса выше или напишите в чат:<br><code>найди новости Мурманска</code></p>
    <p class="url">Ожидание навигации…</p>
  </div>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
