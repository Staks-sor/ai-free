# Изображения и зрение AI

Обновлено: 2026-10-14, Codex. `main/3db7d9c`; исходники незакоммичены, Desktop0.5.60 опубликован.

## Контракт

ChatGPT, DeepSeek, Qwen, Google AI, GLM и Codex получают `images: [{name,mimeType,dataBase64}]` в обсуждении и общем Harness. Начальные вложения, `read_image`, `computer_snapshot` и `browser_snapshot` передаются как реальные изображения. Base64 исключён из текстовых prompts/logs/checkpoints; private temp refs с0600 переживают failed/Stop для resume и удаляются после успешного model turn. Project/Computer определяет границы чтения файлов; OS grants по-прежнему нужны для экрана.

Общие пути: `src/providers/image-input.mjs`, `src/code-agent/{run,computer-images,executor,native-tools,prompt}.mjs`, `src/browser/service.mjs`, `src/window-app/{server,agent-task,chat-images,http,ui-script}.mjs`. До пяти изображений; provider/tool limit16MB на файл, composer10MiB, JSON message cap110MB учитывает base64. Поддержаны PNG/JPEG/GIF/WebP/BMP. Desktop/VS Code синхронизированы.

## Провайдеры

DeepSeek `agent-adapter.mjs` загружает файлы, выбирает Vision для image turn и возвращает выбранную модель для следующего текста. Codex передаёт private files через CLI `-i`/app-server `localImage`; Stop завершает owned child и удаляет файлы.

Qwen использует native filechooser, включая русское меню, ждёт remote preview и сверяет file IDs штатного POST. Recovery требует точные IDs сохранённого turn; картинка не теряется при history/CAPTCHA/Stop. GLM требует успешный upload ACK; native SSE fallback принимает только один completion с точным последним user prompt и uploaded IDs, завершённым answer phase, без server error. `Thinking…` не считается ответом. ChatGPT/Google AI используют штатные uploads.

Qwen `files[]` также содержит автоматически распознанные ссылки (`file_class: url`, без upload ID). Native capture и history recovery исключают только эти ссылки из подсчёта image IDs, сохраняя штатный request body. Это исправляет ложный `QWEN_NATIVE_IMAGE_MISMATCH` у текстового продолжения и mixed image+URL. Missing/duplicate image IDs по-прежнему блокируют отправку.

OpenAI-compatible `/v1/chat/completions` передаёт validated data-URL images в ChatGPT/DeepSeek/Qwen/Google AI/GLM. Responses и Anthropic image formats явно отклоняются, remote URLs не скачиваются. CLI providers не представлены этим API. Antigravity CLI остаётся text-only; не установлен и не проверен. Qwen Coder также не заявляет image input.

## Проверки

Предыдущий live run: шесть providers распознали три фигуры через SYNVOX; DeepSeek Harness `read_image` и следующий text-only turn успешны. GLM native test49s; screenshot: `output/vision-check-20261013/glm-synvox-proof.png`. Свои15 diagnostics убраны. URL fix: TDD red→green, focused50/50, native history подтвердил URL без ID. Live URL test ранее заблокирован license timeout; не повторялся. После релиза0.5.60 subscription/installation active, debugger закрыт.

Release isolated1669/1669,192 suites,16 gates (`/tmp/synvox-0560-full.log`); CI/build/diff PASS.289 runtime files совпадают source/Desktop/VSIX/JetBrains. Пакеты: `output/release-0.5.60`; hashes/publication: `RELEASES.md`. Linux ARM64 clean ZIP install и X11 virtual snapshot/move/key verified; Windows physical acceptance pending. UI1440×900/390×844 без overflow.
