// Загрузка большого контекста как файла-вложения в Qwen web (аналог вставки
// большого текста в поле ввода chat.qwen.ai, где фронтенд сам превращает его
// в Pasted_Text_<ts>.txt).
//
// Зачем: /api/v2/chat/completions при промпте свыше ~118-120k символов молча
// возвращает 380-байтную JSON-заглушку антибота Alibaba TMD (ret:
// FAIL_SYS_USER_VALIDATE / RGV587_ERROR, data.url = punish/captcha) вместо
// SSE-стрима. Веб-интерфейс обходит это, прикрепляя текст файлом.
//
// Пайплайн (захвачен из HAR веб-интерфейса, 2026-08-20):
//   1. POST /api/v2/files/getstsToken  { filename, filesize: "717775", filetype: "file" }
//      -> data: { access_key_id, access_key_secret, security_token, bucketname,
//                 region, endpoint, file_id, file_path, file_url }
//   2. PUT https://<bucket>.<endpoint>/<objectKey>  (OSS, подпись HMAC-SHA1)
//   3. POST /api/v2/files/parse        { file_id }
//   4. POST /api/v2/files/parse/status { file_id_list: [file_id] }  -> status: success
//   5. messages[0].files = [attachment]  (объект ниже, включая context: "full")
//
// Шаги 1/3/4 — same-origin, выполняются через page.evaluate внутри страницы
// chat.qwen.ai (bx-ua подписывается их JS-бандлом автоматически). Шаг 2 — PUT
// на другой домен (oss-accelerate.aliyuncs.com) из Node: браузерный fetch не
// может устанавливать заголовок Date, а OSS PUT не требует bx-ua.

import { createHmac, randomUUID } from "node:crypto";

export const QWEN_CONTEXT_FILE_DEFAULTS = Object.freeze({
  thresholdChars: 100_000,
  inlineChars: 50_000,
});

export function resolveQwenContextFileConfig(env = process.env) {
  return {
    thresholdChars: Number(env.QWEN_CONTEXT_FILE_THRESHOLD || QWEN_CONTEXT_FILE_DEFAULTS.thresholdChars),
    inlineChars: Number(env.QWEN_CONTEXT_FILE_INLINE_CHARS || QWEN_CONTEXT_FILE_DEFAULTS.inlineChars),
  };
}

const SEGMENT_SEPARATOR = /\n\n---\n\n/;

// Разделяет промпт на инлайн-часть (инструкции инструментов + последние
// сообщения + заметка о файле) и файловую часть (старая история диалога).
// Возвращает null, если промпт ниже порога — файл не нужен.
export function splitPromptForFileUpload(prompt, config = resolveQwenContextFileConfig()) {
  const text = String(prompt || "");
  if (text.length <= config.thresholdChars) return null;

  const parts = text.split(SEGMENT_SEPARATOR);
  const head = parts[0] || ""; // [TOOL INSTRUCTIONS ...] — всегда инлайн
  const segments = parts.slice(1);

  // Промпт без разделителей (один гигантский блоб, например вставленный
  // документ): делим по символам — начало в файл, хвост инлайн.
  if (segments.length === 0) {
    const giant = head;
    const keep = Math.max(0, Math.min(giant.length, config.inlineChars));
    const fileText = giant.slice(0, giant.length - keep);
    if (!fileText.trim()) return null;
    const note =
      `\n\n---\n[CONTEXT FILE]: Начальная часть этого сообщения (${fileText.length} символов) ` +
      `прикреплена как текстовый файл "context.txt" в списке вложений (files). ` +
      `Используй его содержимое как основную часть запроса.`;
    const inlineTail = giant.slice(giant.length - keep);
    return {
      inline: inlineTail + note,
      fileText,
      fileChars: fileText.length,
      inlineChars: inlineTail.length + note.length,
    };
  }

  // Собираем «хвост» (самые свежие сообщения), идя с конца, пока влезает.
  let inlineLen = head.length;
  let splitIdx = segments.length;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segLen = segments[i].length + SEGMENT_SEPARATOR.source.length;
    if (inlineLen + segLen <= config.inlineChars) {
      inlineLen += segLen;
      splitIdx = i;
    } else {
      break;
    }
  }

  let fileSegments;
  let inlineSegments;
  if (splitIdx === 0) {
    // Хвост съел всё: делим по символам внутри одного гигантского сегмента.
    const giant = segments[0] || "";
    const keep = Math.max(0, Math.min(giant.length, config.inlineChars - head.length));
    fileSegments = [giant.slice(0, giant.length - keep)];
    inlineSegments = keep > 0 ? [giant.slice(giant.length - keep)] : [];
    // Если после сплита файл пуст (порог меньше inline), файл не нужен.
    if (!fileSegments[0].length) return null;
  } else {
    fileSegments = segments.slice(0, splitIdx);
    inlineSegments = segments.slice(splitIdx);
  }

  const fileText = fileSegments.join("\n\n---\n\n");
  if (!fileText.trim()) return null;

  const note =
    `\n\n---\n[CONTEXT FILE]: Более ранняя часть этого разговора (${fileText.length} символов) ` +
    `прикреплена к сообщению как текстовый файл "context.txt" в списке вложений (files) — ` +
    `Qwen мог переименовать его (например, в "e316e72a-..._Pasted_Text_....txt"): ` +
    `ориентируйся на вложение, а не на имя файла. ` +
    `Прочитай его содержимое, уясни задачу и контекст диалога, изложи кратко замысел ` +
    `(1–2 предложения) и продолжи работу со строгим соблюдением инструкций из вложения. ` +
    `Не отвечай только на последнее сообщение — учитывай всю прикреплённую историю.`;

  const inline = [head, ...inlineSegments].join("\n\n---\n\n") + note;

  return {
    inline,
    fileText,
    fileChars: fileText.length,
    inlineChars: inline.length,
  };
}

// Объект вложения — форма из HAR веб-интерфейса Qwen (files[] в completions).
export function buildQwenFileAttachment(sts, fileName, fileSize) {
  const userId = String(sts.file_path || "").split("/")[0] || "";
  const now = Date.now();
  const meta = {
    name: fileName,
    size: fileSize,
    content_type: "text/plain",
    parse_meta: { parse_status: "success" },
  };
  const file = {
    created_at: now,
    data: {},
    filename: fileName,
    hash: null,
    id: sts.file_id,
    user_id: userId,
    meta,
    update_at: now,
    lastModified: now,
    name: fileName,
    webkitRelativePath: "",
    size: fileSize,
    type: "text/plain",
  };
  return {
    type: "file",
    file,
    id: sts.file_id,
    url: sts.file_url,
    name: fileName,
    collection_name: "",
    progress: 0,
    status: "uploaded",
    greenNet: "success",
    size: fileSize,
    error: "",
    itemId: randomUUID(),
    file_type: "text/plain",
    showType: "file",
    file_class: "default",
    context: "full",
    uploadTaskId: randomUUID(),
  };
}

function hmacSha1Base64(key, message) {
  return createHmac("sha1", key).update(message).digest("base64");
}

function buildOssCanonicalRequest(method, contentType, date, securityToken, bucket, objectKey) {
  return [
    method,
    "",
    contentType,
    date,
    `x-oss-security-token:${securityToken}`,
    `/${bucket}/${objectKey}`,
  ].join("\n");
}

function buildOssUploadUrl(sts) {
  let endpoint = String(sts.endpoint || "").replace(/\/+$/, "");
  if (!endpoint.includes(String(sts.bucketname))) {
    endpoint = `https://${sts.bucketname}.${endpoint.replace(/^https?:\/\//, "")}`;
  }
  let objectKey = String(sts.file_path || "");
  const bucketPrefix = `${sts.bucketname}/`;
  if (objectKey.startsWith(bucketPrefix)) objectKey = objectKey.slice(bucketPrefix.length);
  return { uploadUrl: `${endpoint}/${objectKey}`, objectKey };
}

// Полный пайплайн загрузки. proxyApiPost выполняет same-origin POST из
// контекста страницы и возвращает { ok, status, json } с УЖЕ распарсенным телом;
// fetchImpl — обычный Node fetch для OSS PUT.
export async function uploadQwenContextFile({
  proxyApiPost,
  fetchImpl = fetch,
  content,
  now = Date.now,
  pollTimeoutMs = 15_000,
  pollIntervalMs = 1_000,
}) {
  const text = String(content || "");
  const buffer = Buffer.from(text, "utf8");
  const fileName = `Pasted_Text_${now()}.txt`;

  // 1. STS-токен (filesize строкой — так шлёт веб-интерфейс).
  // proxyApiPost возвращает { ok, status, json } где json — УЖЕ распарсенное
  // тело (page.evaluate не переносит функции через границу Playwright).
  const stsRes = await proxyApiPost("/api/v2/files/getstsToken", {
    filename: fileName,
    filesize: String(buffer.length),
    filetype: "file",
  });
  if (!stsRes || !stsRes.ok) {
    throw new Error(`qwen context-file: getstsToken failed (${stsRes ? stsRes.status : "no response"})`);
  }
  const sts = stsRes.json?.data;
  if (!sts || !sts.file_id) throw new Error("qwen context-file: getstsToken returned no file_id");

  // 2. OSS PUT.
  const date = new Date(now()).toUTCString();
  const contentType = "text/plain";
  const { uploadUrl, objectKey } = buildOssUploadUrl(sts);
  const canonical = buildOssCanonicalRequest("PUT", contentType, date, sts.security_token, sts.bucketname, objectKey);
  const signature = hmacSha1Base64(sts.access_key_secret, canonical);
  const putRes = await fetchImpl(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      Date: date,
      Authorization: `OSS ${sts.access_key_id}:${signature}`,
      "x-oss-security-token": sts.security_token,
    },
    body: buffer,
  });
  if (!putRes.ok) {
    const errText = await putRes.text().catch(() => "");
    throw new Error(`qwen context-file: OSS PUT failed ${putRes.status} — ${errText.slice(0, 200)}`);
  }

  // 3. Запуск серверного парсинга.
  const parseRes = await proxyApiPost("/api/v2/files/parse", { file_id: sts.file_id });
  if (!parseRes || !parseRes.ok) {
    throw new Error(`qwen context-file: parse failed (${parseRes ? parseRes.status : "no response"})`);
  }

  // 4. Поллинг статуса. Таймаут НЕ фатален: сервер доделает парсинг асинхронно.
  const deadline = now() + pollTimeoutMs;
  for (;;) {
    const statusRes = await proxyApiPost("/api/v2/files/parse/status", { file_id_list: [sts.file_id] });
    if (statusRes && statusRes.ok) {
      const data = statusRes.json;
      const status = data?.data?.[0]?.status || data?.status;
      if (status === "success") break;
      if (status === "failed") throw new Error(`qwen context-file: server-side parse failed for ${sts.file_id}`);
    }
    if (now() >= deadline) break; // proceed anyway — parsing finishes async
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  // 5. Объект вложения.
  return buildQwenFileAttachment(sts, fileName, buffer.length);
}
