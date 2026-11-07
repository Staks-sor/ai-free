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
  maxFileChars: 500_000,
});

export function resolveQwenContextFileConfig(env = process.env) {
  return {
    thresholdChars: Number(env.QWEN_CONTEXT_FILE_THRESHOLD || QWEN_CONTEXT_FILE_DEFAULTS.thresholdChars),
    inlineChars: Number(env.QWEN_CONTEXT_FILE_INLINE_CHARS || QWEN_CONTEXT_FILE_DEFAULTS.inlineChars),
    maxFileChars: Number(env.QWEN_CONTEXT_FILE_MAX_CHARS || QWEN_CONTEXT_FILE_DEFAULTS.maxFileChars),
  };
}

// Порог «большой промпт» для форса context-файла при пустом стриме. Ниже
// этого объёма пустой стрим — почти наверняка антибот/сеть, а не размер.
export const QWEN_CONTEXT_FILE_FORCE_MIN_CHARS = 30_000;

// Конфиг для конкретного запроса. Инцидент 2026-09-30 «depth 47+ пустые
// стримы»: Qwen молча отдаёт пустой стрим (200 OK без punish) на промптах
// НИЖЕ thresholdChars — реальный предел плавающий. При force (пустой стрим
// уже случился) и промпте от FORCE_MIN_CHARS — thresholdChars=0: сплит
// сработает, история уедет файлом-вложением, инлайн останутся инструкции
// инструментов + свежие сообщения.
export function contextFileConfigForRequest(config, { force = false, promptLength = 0 } = {}) {
  if (!force || !(promptLength >= QWEN_CONTEXT_FILE_FORCE_MIN_CHARS)) return config;
  return { ...config, thresholdChars: 0 };
}

const SEGMENT_SEPARATOR = /\n\n---\n\n/;

// Разбиение файловой части на части-«переливы»: первый txt заполняется до
// maxFileChars, излишек — во второй, третий и т.д. Сегменты истории по
// возможности остаются целыми (упаковка с конца границы), гигантский
// одиночный сегмент жёстко режется по потолку.
export function splitFileTextForOverflow(fileText, maxFileChars) {
  const text = String(fileText || "");
  if (!text.trim() || !(maxFileChars > 0)) return text.trim() ? [text] : [];
  const cap = Math.floor(maxFileChars);

  // Текст меньше потолка — один файл.
  if (text.length <= cap) return [text];

  const segments = text.split(SEGMENT_SEPARATOR);
  // Нет разделителей — жёсткая нарезка по символам.
  if (segments.length === 1) {
    const parts = [];
    for (let i = 0; i < text.length; i += cap) parts.push(text.slice(i, i + cap));
    return parts;
  }

  const parts = [];
  let current = [];
  let currentLen = 0;
  const flush = () => {
    if (current.length) {
      parts.push(current.join("\n\n---\n\n"));
      current = [];
      currentLen = 0;
    }
  };
  for (const segment of segments) {
    // Гигантский сегмент сам больше потолка: закрываем текущую часть и режем
    // его кусков по cap.
    if (segment.length > cap) {
      flush();
      let cut = 0;
      while (cut < segment.length) {
        parts.push(segment.slice(cut, cut + cap));
        cut += cap;
      }
      continue;
    }
    const addLen = current.length ? SEGMENT_SEPARATOR.source.length + segment.length : segment.length;
    if (currentLen + addLen > cap) flush();
    current.push(segment);
    currentLen += addLen;
  }
  flush();
  return parts.filter((part) => part.trim());
}

// Заметка для инлайн-части: сколько файлов прикреплено и как их использовать.
export function buildContextFileNote(fileChars, partCount) {
  const filesLabel = partCount > 1
    ? `${partCount} текстовых файла ("context.txt" части 1..${partCount} в порядке следования истории)`
    : 'текстовый файл "context.txt"';
  return (
    `\n\n---\n[CONTEXT FILE]: Более ранняя часть этого разговора (${fileChars} символов) ` +
    `прикреплена к сообщению как ${filesLabel} в списке вложений (files) — ` +
    `Qwen мог переименовать их (например, в "e316e72a-..._Pasted_Text_....txt"): ` +
    `ориентируйся на вложения, а не на имена файлов. ` +
    `Прочитай их содержимое, уясни задачу и контекст диалога, изложи кратко замысел ` +
    `(1–2 предложения) и продолжи работу со строгим соблюдением инструкций из вложений. ` +
    `Не отвечай только на последнее сообщение — учитывай всю прикреплённую историю.`
  );
}

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

  const fileParts = splitFileTextForOverflow(fileText, config.maxFileChars);
  const note = buildContextFileNote(fileText.length, fileParts.length);

  const inline = [head, ...inlineSegments].join("\n\n---\n\n") + note;

  return {
    inline,
    fileText,
    fileParts,
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
  fileName = null,
  now = Date.now,
  pollTimeoutMs = 15_000,
  pollIntervalMs = 1_000,
}) {
  const text = String(content || "");
  const buffer = Buffer.from(text, "utf8");
  const finalName = fileName || `Pasted_Text_${now()}.txt`;

  // 1. STS-токен (filesize строкой — так шлёт веб-интерфейс).
  // proxyApiPost возвращает { ok, status, json } где json — УЖЕ распарсенное
  // тело (page.evaluate не переносит функции через границу Playwright).
  const stsRes = await proxyApiPost("/api/v2/files/getstsToken", {
    filename: finalName,
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
  return buildQwenFileAttachment(sts, finalName, buffer.length);
}

// Мульти-файловая загрузка «переливом»: части загружаются последовательно,
// первая сохраняет веб-имя Pasted_Text_<ts>.txt, последующие нумеруются
// _2, _3… — порядок в массиве соответствует порядку истории.
export async function uploadQwenContextFiles({
  proxyApiPost,
  fetchImpl = fetch,
  parts,
  now = Date.now,
  pollTimeoutMs = 15_000,
  pollIntervalMs = 1_000,
}) {
  const attachments = [];
  const ts = now();
  for (let i = 0; i < parts.length; i += 1) {
    const fileName = i === 0 ? `Pasted_Text_${ts}.txt` : `Pasted_Text_${ts}_${i + 1}.txt`;
    attachments.push(await uploadQwenContextFile({
      proxyApiPost,
      fetchImpl,
      content: parts[i],
      fileName,
      now,
      pollTimeoutMs,
      pollIntervalMs,
    }));
  }
  return attachments;
}
