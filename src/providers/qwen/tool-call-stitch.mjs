// Сшивка tool_calls, обрезанных output-лимитом Qwen (~1k токенов на длинном
// контексте). Инцидент 2026-10-23: write_file с большим content обрывался
// посреди строки; ремонт JSON «спасал» вызов калечно (без ключа path),
// Hermes отвечал missing required field → модель повторяла тот же вызов →
// бесконечный цикл guardrail.
//
// Стратегия: пока после ШТАТНОГО финиша стрима ```tool_calls блок не закрыт,
// отправляем в тот же чат continuation-сообщение («продолжи ровно с места
// обрыва, никаких новых блоков») и сшиваем ответ overlap-детектором.
// Дельты хвоста уходят в onText — клиент (Hermes) видит один бесшовный блок.

const CONTINUATION_MARKER = "<<<CONT>>>";
const MAX_OVERLAP_CHARS = 400;

// Состояние ```tool_calls блока в тексте ответа.
//   present: блок начался; complete: fence закрыт.
// ВАЖНО: внутри content могут быть ВЛОЖЕННЫЕ markdown-фенсы ```
// (инцидент 2026-10-23: README с код-блоками). Закрывающим считается
// только ПОСЛЕДНИЙ ``` в тексте, после которого нет значимого текста.
export function toolCallsBlockState(text) {
  const source = String(text || "");
  const start = source.lastIndexOf("```tool_calls");
  if (start === -1) {
    return { present: false, complete: true };
  }
  const afterHeader = source.indexOf("\n", start);
  if (afterHeader === -1) {
    return { present: true, complete: false };
  }
  const closing = source.lastIndexOf("```");
  if (closing <= afterHeader) {
    return { present: true, complete: false };
  }
  return { present: true, complete: /^\s*$/.test(source.slice(closing + 3)) };
}

// Позиция закрывающего фенса tool_calls-блока: последний ``` с пробельным
// хвостом (внутренние markdown-фенсы не считаются закрывающими).
export function closingFenceIndex(text) {
  const source = String(text || "");
  const fence = source.lastIndexOf("```");
  if (fence === -1) return -1;
  return /^\s*$/.test(source.slice(fence + 3)) ? fence : -1;
}

// Strict-валидность JSON внутри ЗАКРЫТОГО блока (ремонт-лапка наверх может
// спасти калеченный вызов — здесь мы решаем, нужен ли ещё один continuation-
// ход, поэтому строгий парс).
export function toolCallsBlockJsonValid(text) {
  const source = String(text || "");
  const start = source.lastIndexOf("```tool_calls");
  if (start === -1) return true;
  const afterHeader = source.indexOf("\n", start);
  if (afterHeader === -1) return false;
  const closing = closingFenceIndex(source);
  if (closing === -1 || closing <= afterHeader) return false;
  const body = source.slice(afterHeader + 1, closing).trim();
  const firstArr = body.indexOf("[");
  const lastArr = body.lastIndexOf("]");
  const json = firstArr >= 0 && lastArr > firstArr ? body.slice(firstArr, lastArr + 1) : body;
  try {
    const parsed = JSON.parse(json);
    return parsed !== null && typeof parsed === "object";
  } catch {
    return false;
  }
}

// Длина наибольшего суффикса left, совпадающего с префиксом right.
function overlapLength(left, right, maxChars = MAX_OVERLAP_CHARS) {
  const max = Math.min(maxChars, left.length, right.length);
  for (let len = max; len > 0; len -= 1) {
    if (left.slice(left.length - len) === right.slice(0, len)) {
      return len;
    }
  }
  return 0;
}

// Сшивает previous + continuation. Модель может:
//   • продолжить ровно с места обрыва — конкатенация;
//   • повторить хвост (overlap) — дедуплицируем;
//   • начать с маркера <<<CONT>>> — отрезаем всё до маркера;
//   • переоткрыть fence ```tool_calls — снимаем заголовок блока.
// Возвращает { merged, appended }: appended — ровно добавленный хвост
// (для append-only стриминга в onText). Пробелы значимы (byte-for-byte).
export function mergeToolCallContinuation(previous, continuation) {
  let cont = String(continuation || "");

  const markerIdx = cont.indexOf(CONTINUATION_MARKER);
  if (markerIdx !== -1) {
    cont = cont.slice(markerIdx + CONTINUATION_MARKER.length);
  }

  const fenceHeader = cont.match(/^\s*```tool_calls\s*\[?/i);
  if (fenceHeader && toolCallsBlockState(previous).present) {
    cont = cont.slice(fenceHeader[0].length);
  }

  const overlap = overlapLength(previous, cont);
  if (overlap > 0) {
    cont = cont.slice(overlap);
  }

  return { merged: previous + cont, appended: cont };
}

// Prompt continuation-хода. mode: "continue" — блок не закрыт; "fix" —
// fence закрыт, но JSON невалиден (нужен исправленный хвост).
export function buildToolCallContinuationPrompt(truncatedText, attempt = 0, mode = "continue") {
  const source = String(truncatedText || "");
  const tail = source.slice(-800);
  if (mode === "fix") {
    return (
      `Твоё продолжение закрыло блок, но JSON внутри невалиден (незакрытая строка/пропущенная кавычка).\n` +
      `Продолжи ровно с места ошибки, чтобы JSON стал валидным: не пересылай блок целиком.\n` +
      `Начни ответ маркером ${CONTINUATION_MARKER} и продолжи текст байт-в-байт до конца валидного JSON и fence ${"```"}.\n` +
      `Последние 800 символов:\n${tail}\n${CONTINUATION_MARKER}`
    );
  }
  const reminder = attempt === 0
    ? "Твоя предыдущая реплика оборвалась на серверном лимите выходных токенов (output token limit)."
    : `Продолжение снова оборвалось (попытка ${attempt + 1}). Отправляй МАКСИМАЛЬНО короткий хвост.`;
  return (
    `${reminder}\n` +
    `Продолжи СВОЮ оборванную реплику ровно с места обрыва — БЕЗ пересказа, БЕЗ повторов, БЕЗ новых ${"```"}tool_calls блоков и БЕЗ переоткрытия fence.\n` +
    `Начни ответ маркером ${CONTINUATION_MARKER} и следующим символом продолжи оборванный текст байт-в-байт.\n` +
    `Если оборван JSON внутри tool_calls — продолжи его ровно с того же места (незакрытая строка/скобка) до полного закрытия JSON и fence ${"```"}.\n` +
    `do NOT restart the block, do NOT re-send earlier content, do NOT wrap in a new code fence.\n` +
    `Обрыв (последние 800 символов твоей реплики):\n${tail}\n${CONTINUATION_MARKER}`
  );
}

// Откат битого закрытого блока к последнему структурному якорю: последняя
// запятая (или '{'/'[' , если запятых нет) внутри tool_calls-блока. Хвост
// после якоря отбрасывается — continuation-ход перепишет его валидно.
function cutToLastStructuralAnchor(text) {
  const source = String(text || "");
  const start = source.lastIndexOf("```tool_calls");
  if (start === -1) return source;
  const afterHeader = source.indexOf("\n", start);
  if (afterHeader === -1) return source;
  const block = source.slice(afterHeader + 1);
  const comma = block.lastIndexOf(",");
  const brace = Math.max(block.lastIndexOf("{"), block.lastIndexOf("["));
  const anchor = comma !== -1 ? comma : brace;
  if (anchor === -1) return source.slice(0, afterHeader + 1);
  return source.slice(0, afterHeader + 1 + anchor + 1);
}

// Оркестратор continuation-цикла. sendTurn инъектируется (тесты/прод).
// Возвращает { complete, stitched, text, turns }: complete=true — блок
// закрыт; text — исходный текст + добавленные хвосты (append-only).
export async function stitchTruncatedToolCalls({
  text,
  sendTurn,
  onText = null,
  maxTurns = Number(process.env.QWEN_TOOLCALL_STITCH_MAX_TURNS ?? 6),
  maxFixTurns = Number(process.env.QWEN_TOOLCALL_STITCH_FIX_TURNS ?? 2),
  attemptDelayMs = Number(process.env.QWEN_TOOLCALL_STITCH_DELAY_MS ?? 1200),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let current = String(text || "");
  let turns = 0;
  let fixTurns = 0;

  if (toolCallsBlockState(current).complete && toolCallsBlockJsonValid(current)) {
    return { complete: true, stitched: false, text: current, turns: 0 };
  }

  while (turns < maxTurns) {
    const state = toolCallsBlockState(current);
    const needsFix = state.complete && !toolCallsBlockJsonValid(current);
    const mode = needsFix ? "fix" : "continue";
    if (mode === "fix") {
      if (fixTurns >= maxFixTurns) break; // сдаёмся: ремонт-лапка наверх попробует спасти
      fixTurns += 1;
      // Fence закрыт, но JSON битый: дописывать после fence бессмысленно.
      // Откатываемся к последнему структурному якорю (запятая/скобка) внутри
      // блока — продолжение модели достроит валидный хвост. Безопасно для
      // стриминга: содержимое блока буферизуется вниз по течению и клиент
      // его ещё не видел.
      current = cutToLastStructuralAnchor(current);
    }

    let round;
    try {
      round = await sendTurn({ prompt: buildToolCallContinuationPrompt(current, turns, mode), attempt: turns, mode });
    } catch (error) {
      return {
        complete: toolCallsBlockState(current).complete,
        stitched: turns > 0,
        text: current,
        turns,
        error: error?.message || String(error),
      };
    }
    const roundText = String(round?.text || "");
    if (!roundText) {
      return { complete: toolCallsBlockState(current).complete, stitched: turns > 0, text: current, turns, error: "empty continuation" };
    }

    const { merged, appended } = mergeToolCallContinuation(current, roundText);
    current = merged;
    turns += 1;
    onText?.(appended);

    if (toolCallsBlockState(current).complete && toolCallsBlockJsonValid(current)) {
      return { complete: true, stitched: true, text: current, turns };
    }
    if (attemptDelayMs > 0) await sleep(attemptDelayMs);
  }

  return {
    complete: toolCallsBlockState(current).complete && toolCallsBlockJsonValid(current),
    stitched: turns > 0,
    text: current,
    turns,
  };
}
