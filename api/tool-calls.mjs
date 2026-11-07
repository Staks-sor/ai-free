export function parseModelToolCalls(text) {
  const source = String(text || "");
  const block = extractToolCallsBlock(source) || extractXmlToolCallsBlock(source);
  if (!block) return { content: source, calls: [] };

  const calls = block.calls || parseCallsJson(block.json);
  if (!calls.length) return { content: source, calls: [] };

  return {
    content: source.slice(0, block.start).trim(),
    calls,
  };
}

export function parseXmlToolCalls(text) {
  const source = String(text || "");
  const block = extractXmlToolCallsBlock(source);
  return block?.calls || [];
}

const ARGUMENT_ALIASES = Object.freeze({
  file_path: ["filePath", "path"],
  old_string: ["oldString", "old_text", "oldText"],
  new_string: ["newString", "new_text", "newText", "replacement", "replacement_text"],
  content: ["file_content", "fileContent", "text"],
});

export function normalizeToolCallsForSchemas(calls, tools = []) {
  const schemas = new Map((Array.isArray(tools) ? tools : []).map((tool) => {
    const fn = tool?.function || tool;
    return [fn?.name, fn?.parameters || fn?.input_schema || {}];
  }).filter(([name]) => name));
  const errors = [];

  const normalizedCalls = (Array.isArray(calls) ? calls : []).map((call) => {
    const schema = schemas.get(call?.name);
    if (!schema) return call;
    let args;
    try {
      args = typeof call.arguments === "string" ? JSON.parse(call.arguments) : { ...(call.arguments || {}) };
    } catch {
      return call;
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) return call;

    for (const property of Object.keys(schema.properties || {})) {
      if (args[property] !== undefined) continue;
      const alias = (ARGUMENT_ALIASES[property] || []).find((candidate) => args[candidate] !== undefined);
      if (alias) {
        args[property] = args[alias];
        delete args[alias];
      }
    }

    const missing = (schema.required || []).filter((property) => args[property] === undefined);
    if (missing.length) errors.push({ name: call.name, missing });
    return { ...call, arguments: JSON.stringify(args) };
  });

  return { calls: normalizedCalls, errors };
}

// Позиция закрывающего фенса tool_calls-блока: последний ``` с пробельным
// хвостом. Внутренние markdown-фенсы (код-блоки в content) закрывающими
// не считаются — иначе JSON рвётся посередине (инцидент 2026-10-23).
export function closingFenceIndex(source) {
  const fence = source.lastIndexOf("```");
  if (fence === -1) return -1;
  return /^\s*$/.test(source.slice(fence + 3)) ? fence : -1;
}

function extractToolCallsBlock(source) {
  const headerIdx = source.search(/```tool_calls/i);
  if (headerIdx === -1) return null;
  const blockStart = headerIdx;
  // Закрывающий fence — ПОСЛЕДНИЙ ``` с пробельным хвостом: внутри content
  // бывают вложенные markdown-фенсы (инцидент 2026-10-23), не жадный
  // first-match, а хвостовой. До Connection: закрывающий = последний ``` в
  // сообщении, после которого нет значимого текста.
  const close = closingFenceIndex(source);
  if (close === -1 || close <= blockStart) {
    // Блок не закрыт: берём всё до конца — ремонт-лапка разберётся.
    const raw = source.slice(source.indexOf("\n", blockStart) + 1).trim();
    return { start: blockStart, json: raw };
  }
  const raw = source.slice(source.indexOf("\n", blockStart) + 1, close).trim();
  const firstArray = raw.indexOf("[");
  const lastArray = raw.lastIndexOf("]");
  if (firstArray >= 0 && lastArray >= firstArray) {
    return { start: blockStart, json: raw.slice(firstArray, lastArray + 1) };
  }

  const firstObject = raw.indexOf("{");
  const lastObject = raw.lastIndexOf("}");
  if (firstObject >= 0 && lastObject >= firstObject) {
    return { start: blockStart, json: raw.slice(firstObject, lastObject + 1) };
  }

  return null;
}

function parseCallsJson(jsonStr) {
  // Общая ладдер-лапка ремонтов деградированного JSON (см. repairToolCallJson):
  // обе дорожки (non-stream parseModelToolCalls и стрим StreamParser.onEnd)
  // проходят одинаковые попытки, дедуплицированные через Set.
  const parsed = repairToolCallJson(jsonStr);
  if (!parsed) return [];
  const list = (Array.isArray(parsed) ? parsed : [parsed]).flat(Infinity);
  return list.map(normalizeCall).filter(Boolean);
}

// Первая попытка каждой дорожки: прогоняем jsonStr через всю серию ремонтов
// и возвращаем первый распарсенный объект/массив, либо null.
export function repairToolCallJson(jsonStr) {
  for (const attempt of buildRepairAttempts(jsonStr)) {
    try {
      const parsed = JSON.parse(attempt);
      if (parsed && typeof parsed === "object") return parsed;
    } catch { /* next attempt */ }
  }
  return null;
}

// Серия ремонтов деградированного JSON: дропнутая закрывающая кавычка,
// пропавший ключ "arguments", неэкранированные внутренние кавычки,
// обрезанный блок, мусор Reasoner'а. Комбинируем стратегии, дедуплицируем.
// Порядок критичен: цепочка с terminateUnterminatedStrings идёт РАНЬШЕ
// одиночного escapeUnescapedInnerQuotes — одиночный escape на пейлоаде с
// дропнутой кавычкой даёт парсибельный, но обрезанный value (ранний close).
function buildRepairAttempts(jsonStr) {
  const terminated = terminateUnterminatedStrings(jsonStr);
  const terminatedEscaped = escapeUnescapedInnerQuotes(terminated);
  const xmlTail = repairQwenXmlTailSwitch(terminatedEscaped);
  // Сырые \n внутри значений (Qwen-код с Python) требуют escapeRawNewlinesInStrings
  // ПОСЛЕ xml-tail-ремонта, иначе JSON.parse падает на control character.
  const xmlTailRawNl = escapeRawNewlinesInStrings(xmlTail);
  return [...new Set([
    jsonStr,
    terminated,
    terminatedEscaped,
    repairQwenXmlTailSwitch(jsonStr),
    repairTruncatedToolCallJson(repairQwenXmlTailSwitch(jsonStr)),
    escapeRawNewlinesInStrings(repairQwenXmlTailSwitch(jsonStr)),
    repairTruncatedToolCallJson(escapeRawNewlinesInStrings(repairQwenXmlTailSwitch(jsonStr))),
    xmlTail,
    escapeUnescapedInnerQuotes(xmlTail),
    xmlTailRawNl,
    escapeUnescapedInnerQuotes(xmlTailRawNl),
    repairTruncatedToolCallJson(xmlTailRawNl),
    repairTruncatedToolCallJson(escapeUnescapedInnerQuotes(xmlTailRawNl)),
    repairMissingArgumentsKey(terminatedEscaped),
    escapeRawNewlinesInStrings(terminatedEscaped),
    repairXmlParameterHybrids(jsonStr),
    escapeUnescapedInnerQuotes(repairXmlParameterHybrids(terminatedEscaped)),
    repairMissingArgumentsKey(jsonStr),
    escapeUnescapedInnerQuotes(jsonStr),
    repairMissingArgumentsKey(escapeUnescapedInnerQuotes(jsonStr)),
    escapeUnescapedInnerQuotes(repairMissingArgumentsKey(jsonStr)),
    escapeUnescapedInnerQuotes(repairTruncatedToolCallJson(jsonStr)),
    repairTruncatedToolCallJson(terminatedEscaped),
    escapeRawNewlinesInStrings(repairTruncatedToolCallJson(terminatedEscaped)),
    escapeUnescapedInnerQuotes(cleanReasonerJunk(jsonStr)),
    cleanReasonerJunk(jsonStr),
  ])];
}

// Ремонт обрезанного tool-call JSON: модель упёрлась в лимит выходных токенов
// посреди блока ```tool_calls — стрим завершается штатно (stream_done), но
// массив не закрыт. Дописываем незакрытую строку/скобки, чтобы спасти вызов.
export function repairTruncatedToolCallJson(jsonStr) {
  let s = String(jsonStr || "").trim();
  if (!s) return s;
  // Быстрая проверка: если уже валиден — не трогаем.
  try {
    JSON.parse(s);
    return s;
  } catch {}
  // Считаем незакрытые строки: если внутри строки — закрываем кавычку.
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { if (inString) escaped = true; continue; }
    if (ch === '"') inString = !inString;
  }
  if (inString) {
    if (escaped) s = s.slice(0, -1); // dangling backslash
    s += '"';
  }
  // Убираем висячую запятую перед закрытием.
  s = s.replace(/,\s*$/, "");
  // Дописываем скобки по стеку, строки пропускаем (скобки внутри строк не
  // структурные). Closer может перескочить уровень — модель или экстрактор
  // ставит ] при ещё открытой вложенной скобке; тогда ВСТАВЛЯЕМ пропущенные
  // вложенные closers перед ним. Лишний closer без открывающей — выбрасываем.
  let out = "";
  const stack = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') {
      // Копируем строку целиком с эскейпами.
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === "\\") j += 2;
        else if (s[j] === '"') { j += 1; break; }
        else j += 1;
      }
      out += s.slice(i, j);
      i = j;
      continue;
    }
    if (ch === "{") { stack.push("}"); out += ch; i += 1; continue; }
    if (ch === "[") { stack.push("]"); out += ch; i += 1; continue; }
    if (ch === "}" || ch === "]") {
      if (stack[stack.length - 1] === ch) {
        stack.pop();
        out += ch;
      } else if (stack.includes(ch)) {
        while (stack.length && stack[stack.length - 1] !== ch) out += stack.pop();
        stack.pop();
        out += ch;
      }
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  if (stack.length) out += stack.reverse().join("");
  s = out;
  try {
    JSON.parse(s);
    return s;
  } catch {
    return String(jsonStr || "");
  }
}

// Ремонт деградированного Qwen-вывода: модель роняет ключ "arguments" и
// вставляет объект аргументов сразу после имени:
//   {"name": "read_file", {"path": "..."}}   (невалидный JSON)
// вместо
//   {"name": "read_file", "arguments": {"path": "..."}}
// Эвристика: {"name": "...", { → вставляем "arguments": перед второй "{".
// Ограничиваем матч именами тулов (безопасно для прозы со сложными скобками).
export function repairMissingArgumentsKey(jsonStr) {
  const s = String(jsonStr || "");
  try {
    JSON.parse(s);
    return s;
  } catch { /* repair below */ }
  return s.replace(
    /("name"\s*:\s*"[^"]+"\s*,\s*)(\{\s*\n?\s*")/g,
    '$1"arguments": $2',
  );
}

// Ремонт неэкранированных двойных кавычек внутри JSON-строк.
// Деградировавший Qwen кладёт shell-команды с quoted-аргументами в
// "command" без экранирования: "grep -n "foo" bar" ломает JSON.
// Эвристика: если после закрывающей кавычки НЕ идёт структурный символ
// JSON (,:}] или конец ввода) — эта кавычка на самом деле литеральная,
// экранируем её. Итеративно, т.к. одна строка может содержать несколько.
export function escapeUnescapedInnerQuotes(jsonStr) {
  const s = String(jsonStr || "");
  // Быстрая проверка: валидный JSON — не трогаем.
  try {
    JSON.parse(s);
    return s;
  } catch {}
  let out = "";
  let inString = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === "\\") {
      // Валидные JSON-эскейпы пробрасываем; невалидные (\| ! ^ и т.п.,
      // которые модель пишет для grep-regex) удваиваем бэкслеш.
      const nextCh = s[i + 1];
      if (nextCh !== undefined && nextCh !== "" && /[\\/"]|[bfnrtu]/.test(nextCh)) {
        out += ch + nextCh;
      } else if (nextCh !== undefined) {
        out += "\\\\" + nextCh;
      } else {
        out += ch; // dangling backslash
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (!inString) {
        inString = true;
        out += ch;
        continue;
      }
      // Мы внутри строки и встретили '"'. Смотрим следующий значимый символ.
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j += 1;
      const next = s[j];
      if (next === undefined || /[,:\]}]/.test(next)) {
        // Структурный символ — это настоящая закрывающая кавычка.
        inString = false;
        out += ch;
      } else {
        // Литеральная кавычка внутри строки — экранируем.
        out += '\\"';
      }
      continue;
    }
    out += ch;
  }
  return out;
}

// Ремонт дропнутой закрывающей кавычки (2026-09-07, Hermes): Qwen роняет
// финальную `"` строкового значения перед переносом строки. Без неё
// escapeUnescapedInnerQuotes дессинхронизируется и глотает следующий ключ
// "name" как содержимое строки. Сырой \n внутри JSON-строки запрещён,
// поэтому ПЕРВЫЙ перенос внутри строки — кандидат на точку обрыва: если
// следующий значимый символ структурный (, } ] или конец ввода), вставляем
// закрывающую кавычку перед переносом. Не-первые переносы той же строки —
// легитимный многострочный контент (write_file) — не трогаем.
export function terminateUnterminatedStrings(jsonStr) {
  const s = String(jsonStr || "");
  // Быстрая проверка: валидный JSON — не трогаем.
  try {
    JSON.parse(s);
    return s;
  } catch {}
  let out = "";
  let inString = false;
  let escaped = false;
  let newlinesInString = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (!inString) {
      if (ch === '"') {
        inString = true;
        newlinesInString = 0;
      }
      out += ch;
      continue;
    }
    if (escaped) {
      escaped = false;
      out += ch;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      inString = false;
      newlinesInString = 0;
      out += ch;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (newlinesInString === 0) {
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j += 1;
        const next = s[j];
        if (next === undefined || next === "," || next === "}" || next === "]") {
          out += '"';
          inString = false;
        } else {
          newlinesInString += 1;
        }
      }
      out += ch;
      continue;
    }
    out += ch;
  }
  return out;
}

// Ремонт гибрида JSON + нативного Qwen-XML (2026-09-07, Hermes): модель
// начинает блок tool_calls валидным JSON, а хвост выдаёт параметрами
// <parameter=KEY>VALUE</parameter> внутри JSON-объекта:
//   { "name": "skill_view", <parameter=name>x</parameter> },
// Преобразуем серии parameter-блоков в "arguments": { KEY: VALUE }.
// Объекты без parameter-блоков (обычный JSON) не трогаем.
export function repairXmlParameterHybrids(jsonStr) {
  const s = String(jsonStr || "");
  if (!s.includes("<parameter=")) return s;
  const members = (block) => block
    .replace(/<parameter=\s*([^\s>]+)[^>]*>([\s\S]*?)<\/parameter>/g, (_m, key, value) => {
      const name = cleanToolName(key);
      if (!name) return "";
      return `"${name}": ${JSON.stringify(decodeXmlText(String(value || "").trim()))}`;
    })
    .replace(/,\s*,+/g, ",")
    .replace(/^\s*,\s*/, "");
  return s.replace(
    /("name"\s*:\s*"[^"]+")\s*,?\s*((?:<parameter=[^>]*>[\s\S]*?<\/parameter>\s*)+)(,?)/g,
    (_m, namePart, paramsBlock, trailingComma) =>
      `${namePart}, "arguments": { ${members(paramsBlock)} }${trailingComma}`,
  );
}

// Ремонт «Qwen mid-string XML switch» (2026-09-29, чек-лист ГПН): модель
// начинает tool-call как JSON, но посреди строкового аргумента переходит на
// родной XML — закрывает аргумент тегом </parameter> вместо кавычки, а
// следующий аргумент открывает <parameter name="KEY">. Пример из прод-лога:
//   "code": "... print(" | ".join(cells))\n</parameter>\n    }\n  }\n]"
//   "path": "E:/...json\n</parameter>\n<parameter name="content">{ ... }
// Стратегия: одиночный закрывающий тег = конец значения → закрываем кавычку;
// <parameter name="KEY">VALUE без закрывающего тега = ещё один аргумент →
// конвертим оба в обычные JSON-члены. Работает после terminateUnterminatedStrings.
export function repairQwenXmlTailSwitch(jsonStr) {
  let s = String(jsonStr || "");
  if (!s.includes("</parameter>")) return s;

  // 1) Хвостовые конструкции "</parameter> ... }... ]" — закрыть строку кавычкой
  //    перед тегом и выкинуть тег. Ловим незакрытую строку: тег идёт сразу
  //    после \n без закрывающей кавычки значения.
  s = s.replace(
    /([^"\s])\n[ \t]*<\/parameter>/g,
    (_m, prevChar) => prevChar + '"',
  );

  // 2) "<parameter name="KEY">VALUE" (без закрывающего тега) → "KEY": "VALUE".
  //    VALUE — сырой текст (может быть вложенный JSON со своими \n ] }):
  //    границы — только следующий <parameter-тег или КОНЕЦ строки. Внешние
  //    скобки допишет repairTruncatedToolCallJson (модель их не закрыла).
  s = s.replace(
    /<parameter\s+name\s*=\s*"?([^">\s]+)"?\s*>([\s\S]*?)(?=\s*<parameter|$)/g,
    (_m, key, value) => `,"${key}": ${JSON.stringify(value.trim())}`,
  );

  // 3) Склеенный мусор вида  value" \n } — где value уже закрыт, но тег выкинут:
  //    нормализуем случайные двойные запятые и запятые перед }.
  s = s.replace(/,\s*,/g, ",");
  s = s.replace(/,\s*([}\]])/g, "$1");

  return s;
}

// Экранирование сырых переносов строк внутри JSON-строк: DeepSeek Reasoner
// кладёт литеральные \n в content. Заменяем только внутри кавычек, уже
// экранированные последовательности (\n) не трогаем, \r выкидываем.
function escapeRawNewlinesInStrings(jsonStr) {
  return String(jsonStr || "").replace(
    /"(?:[^"\\]|\\.)*"/g,
    (match) => match.replace(/\n/g, "\\n").replace(/\r/g, ""),
  );
}

// Агрессивная чистка мусора DeepSeek Reasoner внутри блока tool_calls:
// литеральный текст между } и ] / } и {, теги вида <environment_details>,
// несколько склеенных массивов ][, пропущенная { после [, оборванная
// строка в конце. Порт стрим-лапки openai-handler в общий модуль (2026-09-07).
function cleanReasonerJunk(jsonStr) {
  let s = String(jsonStr || "").trim();
  if (!s) return s;
  // Несколько top-level массивов: [ ... ] [ ... ] → склеиваем в один.
  s = s.replace(/\]\s*\[/g, '],[');
  s = s.replace(/\][^\[]*\[/g, '],[');
  if (s.includes('],[')) {
    if (!s.startsWith('[[')) s = '[' + s;
    if (!s.endsWith(']]')) s = s + ']';
  }
  // Пропущенная { перед "name" после [.
  s = s.replace(/\[\s*"name"/g, '[{"name"');
  s = s.replace(/\[\n\s*"name"/g, '[\n  {"name"');
  // Объекты без запятой: } { → }, {.
  s = s.replace(/}\s*{/g, '}, {');
  s = s.replace(/\[\s*"name"/g, '[ {"name"');
  // Оборванная строка/объект в самом конце.
  s = s.replace(/(["\da-zA-Z])\s*\]$/, '$1}]');
  // Литеральные теги и текст внутри массива.
  s = s.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '');
  s = s.replace(/<environment_details>[\s\S]*/, '');
  s = s.replace(/}\s*[^,\]\{\[\}"]+\s*\]$/, '}]');
  s = s.replace(/}\s*[^,\]\{\[\}"]+\s*{/g, '}, {');
  // Оборванная строка перед финальным }].
  s = s.replace(/([^"])\}\]$/, '$1"}}]');
  return escapeRawNewlinesInStrings(s);
}

// Salvage tool-calls из прозы БЕЗ fence-маркера (```tool_calls / ```json).
// Деградировавший Qwen иногда выдаёт голый JSON-массив в тексте —
// стрим-детектор openai-handler его не видит, весь ответ уходит клиенту как
// проза, и агентный цикл ломается. Порт идеи prePassDeinterleave из
// FreeQwenApi: скан от каждого "name": назад к "{", подбор балансных скобок,
// серия ремонтов (переносы строк, незакрытые строки/скобки).
export function extractBareToolCallsArray(text) {
  const source = String(text || "");
  if (!source) return null;
  const nameRegex = /"\s*name\s*"\s*:\s*"([^"\n]+)"/g;
  const calls = [];
  const seen = new Set();
  let m;
  while ((m = nameRegex.exec(source)) !== null) {
    // Ищем открывающую "{" перед "name" (не дальше 200 символов).
    let braceStart = -1;
    for (let i = m.index - 1; i >= Math.max(0, m.index - 200); i -= 1) {
      if (source[i] === "{") { braceStart = i; break; }
    }
    if (braceStart < 0) continue;
    // Подбираем балансные скобки объекта.
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = braceStart; i < source.length && i < braceStart + 100_000; i += 1) {
      const ch = source[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\" && inStr) { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (!inStr) {
        if (ch === "{") depth += 1;
        else if (ch === "}") { depth -= 1; if (depth === 0) { end = i; break; } }
      }
    }
    let candidate;
    if (end >= 0) {
      candidate = source.slice(braceStart, end + 1);
    } else {
      // Обрезанный объект — пробуем ремонт.
      candidate = repairTruncatedToolCallJson(source.slice(braceStart));
    }
    const attempts = [
      candidate,
      repairMissingArgumentsKey(candidate),
      repairTruncatedToolCallJson(candidate),
      repairTruncatedToolCallJson(repairMissingArgumentsKey(candidate)),
    ];
    for (const attempt of attempts) {
      try {
        const obj = JSON.parse(attempt);
        const name = obj.name || obj.tool;
        const hasArgs = obj.arguments !== undefined || obj.args !== undefined || obj.input !== undefined;
        if (!name || !hasArgs || typeof obj !== "object") continue;
        const args = obj.arguments ?? obj.args ?? obj.input ?? {};
        const key = `${name}::${JSON.stringify(args).slice(0, 200)}`;
        if (seen.has(key)) break;
        seen.add(key);
        calls.push({ name, arguments: typeof args === "string" ? args : JSON.stringify(args) });
        break;
      } catch { /* next attempt */ }
    }
  }
  return calls.length ? calls : null;
}

export function extractBareToolCalls(text, { allowedNames } = {}) {
  const source = String(text || "");
  const allowed = allowedNames ? new Set(allowedNames) : null;
  const calls = [];
  const seen = new Set();

  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== "{") continue;
    const end = findBalancedJsonObjectEnd(source, start);
    if (end === -1) continue;

    let parsed;
    const rawCandidate = source.slice(start, end + 1);
    const candidates = [...new Set([
      rawCandidate,
      repairMissingArgumentsKey(rawCandidate),
      escapeUnescapedInnerQuotes(rawCandidate),
      repairMissingArgumentsKey(escapeUnescapedInnerQuotes(rawCandidate)),
    ])];
    for (const candidate of candidates) {
      try {
        parsed = JSON.parse(candidate);
        break;
      } catch { /* next candidate */ }
    }
    if (!parsed) continue;

    const call = normalizeCall(parsed);
    const hasExplicitArguments = parsed && typeof parsed === "object"
      && (parsed.arguments !== undefined || parsed.args !== undefined || parsed.input !== undefined);
    if (!call || !hasExplicitArguments || (allowed && !allowed.has(call.name))) continue;

    const key = `${call.name}\0${call.arguments}`;
    if (!seen.has(key)) {
      seen.add(key);
      calls.push(call);
    }
    start = end;
  }

  return calls;
}

function findBalancedJsonObjectEnd(source, start) {
  const stack = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") stack.push(char === "{" ? "}" : "]");
    else if (char === "}" || char === "]") {
      if (stack.pop() !== char) return -1;
      if (!stack.length) return index;
    }
  }

  return -1;
}

function normalizeCall(call) {
  if (!call || typeof call !== "object") return null;
  const name = typeof call.name === "string"
    ? call.name
    : typeof call.tool === "string"
      ? call.tool
      : "";
  if (!name) return null;

  let args = call.arguments ?? call.args ?? call.input;
  if (args === undefined) {
    const { name: _name, tool: _tool, ...rest } = call;
    args = rest;
  }

  return {
    name,
    arguments: typeof args === "string" ? args : JSON.stringify(args || {}),
  };
}

function extractXmlToolCallsBlock(source) {
  const calls = [];
  let firstStart = -1;
  let lastEnd = -1;

  const wrappedToolCallRe = /<tool_call\s+name=(["'])([^"']+)\1\s*>([\s\S]*?)<\/tool_call>/gi;
  for (const match of source.matchAll(wrappedToolCallRe)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const call = normalizeXmlToolCall(match[2], match[3]);
    if (!call) continue;
    calls.push(call);
    if (firstStart === -1 || start < firstStart) firstStart = start;
    if (end > lastEnd) lastEnd = end;
  }

  const qwenFunctionRe = /<function=([^\s>]+)[^>]*>([\s\S]*?)<\/function>/gi;
  for (const match of source.matchAll(qwenFunctionRe)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const call = normalizeQwenFunctionCall(match[1], match[2]);
    if (!call) continue;
    calls.push(call);
    if (firstStart === -1 || start < firstStart) firstStart = start;
    if (end > lastEnd) lastEnd = end;
  }

  if (!calls.length) return null;

  const wrapperStart = source.lastIndexOf("<tool_calls", firstStart);
  if (wrapperStart !== -1) {
    const wrapperEnd = source.indexOf("</tool_calls>", lastEnd);
    if (wrapperEnd !== -1) {
      firstStart = wrapperStart;
      lastEnd = wrapperEnd + "</tool_calls>".length;
    }
  }

  return { start: firstStart, end: lastEnd, calls };
}

function normalizeXmlToolCall(name, rawBody) {
  const toolName = cleanToolName(name);
  if (!toolName) return null;

  const body = String(rawBody || "").trim();
  if (!body) return { name: toolName, arguments: "{}" };

  const parsed = parseJsonishObject(body);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return normalizeCall({ name: toolName, arguments: parsed });
  }

  return normalizeCall({ name: toolName, arguments: body });
}

function normalizeQwenFunctionCall(name, rawBody) {
  const toolName = cleanToolName(name);
  if (!toolName) return null;

  const args = {};
  const paramRe = /<parameter=([^\s>]+)[^>]*>([\s\S]*?)<\/parameter>/gi;
  for (const match of String(rawBody || "").matchAll(paramRe)) {
    const key = cleanToolName(match[1]);
    if (!key) continue;
    const value = decodeXmlText(match[2].trim());
    const parsed = parseJsonishValue(value);
    args[key] = parsed === undefined ? value : parsed;
  }

  return normalizeCall({ name: toolName, arguments: args });
}

function cleanToolName(value) {
  return String(value || "")
    .replace(/^★-/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function parseJsonishObject(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    const first = value.indexOf("{");
    const last = value.lastIndexOf("}");
    if (first === -1 || last < first) return null;
    try {
      const parsed = JSON.parse(value.slice(first, last + 1));
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
}

function parseJsonishValue(value) {
  if (!value) return "";
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Потолок длины описания тула в компактном списке. Полные простыни
// описаний дублируют прозу системного промпта Hermes (которая уезжает в
// context.txt) и раздувают промпт на десятки КБ.
const TOOL_DESCRIPTION_CAP = 200;
const PROPERTY_DESCRIPTION_CAP = 100;

export function formatCompactTools(tools) {
  if (!Array.isArray(tools) || !tools.length) return "[]";
  const cleaned = tools
    .map((t) => {
      const fn = t?.function || t;
      if (!fn?.name) return null;
      const description = fn.description?.trim() || "";
      const cleanParams = cleanJsonSchema(fn.parameters || fn.input_schema);
      return {
        type: "function",
        function: {
          name: fn.name,
          ...(description ? { description: cap(description, TOOL_DESCRIPTION_CAP) } : {}),
          ...(cleanParams ? { parameters: shrinkParams(cleanParams) } : {}),
        },
      };
    })
    .filter(Boolean);
  return JSON.stringify(cleaned);
}

function cap(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

// Схема параметров в «рационе»: типы + required + короткие описания.
// enums сохраняются (модели обязаны знать допустимые значения), дефолты тоже.
function shrinkParams(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const res = { ...schema };
  if (res.properties && typeof res.properties === "object") {
    const shrunk = {};
    for (const [k, v] of Object.entries(res.properties)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const { description, ...rest } = v;
        shrunk[k] = typeof description === "string" && description.trim()
          ? { ...rest, description: cap(description, PROPERTY_DESCRIPTION_CAP) }
          : rest;
      } else {
        shrunk[k] = v;
      }
    }
    res.properties = shrunk;
  }
  // вложенные items/objects не обходим: чистка первого уровня даёт основной выигрыш
  return res;
}

function cleanJsonSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const { $schema, $id, additionalProperties, title, ...rest } = schema;
  const res = { ...rest };
  if (res.properties && typeof res.properties === "object") {
    const cleanedProps = {};
    for (const [k, v] of Object.entries(res.properties)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const { $schema: _, $id: __, additionalProperties: ___, ...propRest } = v;
        cleanedProps[k] = propRest;
      } else {
        cleanedProps[k] = v;
      }
    }
    res.properties = cleanedProps;
  }
  return res;
}
