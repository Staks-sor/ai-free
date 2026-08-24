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

// Чипы ошибок Qwen-бэкенда: когда модель пытается звать тулы во время
// thinking-фазы, бэкенд возвращает «Tool <name> does not exists.» (или
// «does not exist») прямо текстом в контент-канал. В реальных логах чипы
// приходят слитно, сериями по много штук («…exists.Tool X does not
// exists.Tool Y does not exists.Замысел: …»). Вырезаем целиком вместе с
// обрамляющими пробелами; обычная проза про инструменты не матчится.
const TOOL_CHIP_RE = /[ \t]*Tool[ \t]+\S{1,64}[ \t]+does[ \t]+not[ \t]+exists?[ \t]*\.?/g;

// Максимальная длина потенциального чипа-префикса, который стриминговый
// фильтр может придержать (см. partialChipPrefixLen).
const CHIP_PREFIX_MAX = 96;

export function stripThinkBlocks(text) {
  const s = String(text || "");
  if (!s) return s;
  let out = "";
  let i = 0;
  let inThink = false;
  while (i < s.length) {
    if (!inThink) {
      const open = s.indexOf(THINK_OPEN, i);
      // Осиротевший закрывающий тег (деградация: открывающий съеден или
      // неполон) — вырезаем, чтобы он не протекал в видимый ответ.
      const strayClose = s.indexOf(THINK_CLOSE, i);
      if (open === -1 && strayClose !== -1) {
        out += s.slice(i, strayClose);
        i = strayClose + THINK_CLOSE.length;
        continue;
      }
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
        // Осиротевший закрывающий тег (деградация: открывающий съеден) —
        // вырезаем, не протекает в видимый ответ.
        const strayClose = hold.indexOf(THINK_CLOSE);
        if (strayClose !== -1) {
          out += hold.slice(0, strayClose);
          hold = hold.slice(strayClose + THINK_CLOSE.length);
          progress = true;
          continue;
        }
        // Открывающего/закрывающего нет. Хвост может быть частичным
        // префиксом любого из тегов ("<th..." или "</th...").
        const keep = Math.max(
          partialTagPrefixLen(hold, THINK_OPEN),
          partialTagPrefixLen(hold, THINK_CLOSE),
        );
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

// Вырезает чипы ошибок бэкенда из готового текста (non-stream путь).
export function stripToolErrorChips(text) {
  const s = String(text || "");
  if (!s) return s;
  const out = s.replace(TOOL_CHIP_RE, "");
  // Слитные серии чипов оставляют пустые строки — поджимаем.
  return /\S/.test(out) ? out.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ") : "";
}

// Стриминговая версия: ту же логику, но с удержанием потенциального
// начала чипа («Tool rea…»), разрезанного по границе чанков. Буфер
// ограничен CHIP_PREFIX_MAX, поэтому латентность видимого текста
// растёт максимум на длину одного чипа и только рядом с ним.
export function createToolErrorChipFilter({ onText = null } = {}) {
  let hold = "";

  function emit(text) {
    if (text && typeof onText === "function") onText(text);
  }

  function process(s) {
    // Быстрая проверка: без «Tool » чипов быть не может.
    if (!/(^|[ \t\n])Tool[ \t]/.test(s)) return { out: s, hold: "" };
    const cleaned = s.replace(TOOL_CHIP_RE, "");
    // Если в конце остался потенциальный prefix чипа — придержим его.
    const keep = partialChipPrefixLen(s);
    if (keep > 0) {
      return { out: cleaned.slice(0, cleaned.length - keep), hold: cleaned.slice(-keep) };
    }
    return { out: cleaned, hold: "" };
  }

  return {
    push(delta) {
      const s = hold + String(delta || "");
      const r = process(s);
      hold = r.hold;
      emit(r.out);
    },
    flush() {
      emit(hold);
      hold = "";
    },
  };
}

// Длина самого длинного суффикса s, который может стать началом чипа
// (совпадает с TOOL_CHIP_RE по префиксу «Tool … does not exist…»).
function partialChipPrefixLen(s) {
  const max = Math.min(s.length, CHIP_PREFIX_MAX);
  for (let len = max; len > 0; len -= 1) {
    const cand = s.slice(s.length - len);
    if (/^[ \t]*Tool[ \t]+\S{1,64}([ \t]+does)?([ \t]+not)?([ \t]+exists?[ \t]*\.?)?$/.test(cand)) {
      return len;
    }
  }
  return 0;
}
