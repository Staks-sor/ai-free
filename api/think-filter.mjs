// Фильтр литеральных <think>-блоков, которые деградировавший Qwen шлёт
// прямо в текстовом канале (вместо отдельного phase:"think" в SSE).
// Внутри reasoning-текста модель накидывает черновики tool-call JSON —
// без фильтра стрим-детектор findBareToolStart выдёргивает их как
// реальные вызовы ("Tool X does not exists" каскад в Hermes).
//
// Экспортирует:
//   stripThinkBlocks(text) — утилита для non-stream пути;
//   createThinkTagFilter({ onText }) — обёртка для стриминга: держит
//     маленький хвост-буфер, чтобы тег, разрезанный по чанкам, не протёк.

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

// Строка-сепаратор, которой Qwen помечает конец reasoning в деградированном
// выводе (без полноценных тегов). Вырезаем строку целиком.
const THINKING_COMPLETED_RE = /(?:^|\n)[ \t]*Thinking completed[ \t]*(?=\n|$)/g;

export function stripThinkBlocks(text) {
  const s = String(text || "");
  if (!s) return s;
  let out = "";
  let i = 0;
  let inThink = false;
  while (i < s.length) {
    if (!inThink) {
      const open = s.indexOf(THINK_OPEN, i);
      if (open === -1) {
        out += s.slice(i);
        break;
      }
      out += s.slice(i, open);
      i = open + THINK_OPEN.length;
      inThink = true;
    } else {
      const close = s.indexOf(THINK_CLOSE, i);
      if (close === -1) {
        // Незакрытый reasoning: весь хвост — черновики, подавляем.
        i = s.length;
        break;
      }
      i = close + THINK_CLOSE.length;
      inThink = false;
    }
  }
  const cleaned = out.replace(THINKING_COMPLETED_RE, "\n");
  return /\S/.test(cleaned) ? cleaned.replace(/\n{3,}/g, "\n\n") : "";
}

// Стриминговая обёртка. Держим до (len(THINK_OPEN)-1) символов «на подозрении»:
// если это начало "<think>" — не эмитим; если оказалось обычным текстом —
// эмитим при поступлении следующего чанка или на flush.
export function createThinkTagFilter({ onText = null } = {}) {
  let hold = "";
  let suppress = false; // внутри <think>...</think>

  function emit(text) {
    if (text && typeof onText === "function") onText(text);
  }

  return {
    push(delta) {
      hold += String(delta || "");
      let out = "";
      let progress = true;
      while (progress) {
        progress = false;
        if (suppress) {
          // Ищем закрывающий тег (в т.ч. частичный в самом конце хвоста).
          const close = hold.indexOf(THINK_CLOSE);
          if (close !== -1) {
            hold = hold.slice(close + THINK_CLOSE.length);
            suppress = false;
            progress = true;
            continue;
          }
          // Закрывающего нет: подавляем всё, КРОМЕ возможного частичного
          // префикса "</th..." в самом конце — он ещё может стать тегом.
          const keepClose = partialTagPrefixLen(hold, THINK_CLOSE);
          hold = keepClose ? hold.slice(-keepClose) : "";
          return;
        }
        const open = hold.indexOf(THINK_OPEN);
        if (open !== -1) {
          out += hold.slice(0, open);
          hold = hold.slice(open + THINK_OPEN.length);
          suppress = true;
          progress = true;
          continue;
        }
        // Открывающего нет. Возможно, хвост — частичный префикс "<th...".
        const keep = partialTagPrefixLen(hold, THINK_OPEN);
        out += hold.slice(0, hold.length - keep);
        hold = keep ? hold.slice(-keep) : "";
      }
      emit(out);
    },

    flush() {
      if (suppress) {
        hold = "";
        return;
      }
      // Частичный префикс тега в конце стрима — это просто текст.
      emit(hold);
      hold = "";
    },
  };
}

// Длина самого длинного суффикса s, являющегося префиксом tag.
function partialTagPrefixLen(s, tag) {
  const max = Math.min(s.length, tag.length - 1);
  for (let len = max; len > 0; len -= 1) {
    if (s.endsWith(tag.slice(0, len))) return len;
    // Суффикс "<think>" длины 7 — это сам тег, не частичный (обработан выше).
  }
  return 0;
}
