// Поисковики для headless-браузера: Google часто даёт captcha — по умолчанию Яндекс / DuckDuckGo.

const SEARCH_ENGINES = {
  yandex: {
    id: "yandex",
    label: "Yandex",
    buildUrl(query) {
      return `https://yandex.ru/search/?text=${encodeURIComponent(query)}`;
    },
  },
  duckduckgo: {
    id: "duckduckgo",
    label: "DuckDuckGo",
    buildUrl(query) {
      return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
    },
  },
  bing: {
    id: "bing",
    label: "Bing",
    buildUrl(query) {
      return `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
    },
  },
};

export function getPreferredSearchEngineId({ task = "", locale = "" } = {}) {
  const fromEnv = String(process.env.AI_FREE_SEARCH_ENGINE || "").trim().toLowerCase();
  if (fromEnv && SEARCH_ENGINES[fromEnv]) return fromEnv;

  const text = String(task || "");
  const loc = String(locale || process.env.LANG || "").toLowerCase();
  if (/[а-яё]/iu.test(text) || loc.startsWith("ru")) return "yandex";
  return "duckduckgo";
}

export function buildSearchUrl(query, options = {}) {
  const q = String(query || "").trim();
  if (!q) throw new Error("Пустой поисковый запрос");
  const engineId = getPreferredSearchEngineId(options);
  return SEARCH_ENGINES[engineId].buildUrl(q);
}

export function userExplicitlyWantsGoogle(task) {
  return /\b(google\.com|www\.google|гугл|google)\b/iu.test(String(task || ""));
}

export function looksLikeSearchTask(task) {
  const text = String(task || "").trim();
  if (!text) return false;
  return /(найди|найти|поиск|search|ищи|загугли|погугли|узнай|собери|новост|курс|погода|расписан)/iu.test(text);
}

export function extractSearchQueryFromTask(task) {
  let text = String(task || "").trim();
  if (!text) return "";

  text = text
    .replace(/^(пожалуйста[,]?\s*)?/iu, "")
    .replace(/^(найди|найти|поиск|search|ищи|загугли|погугли|узнай|собери)\s+(мне\s+)?/iu, "")
    .replace(/^(открой|open|visit|перейди|зайди)\s+(сайт\s+)?/iu, "")
    .replace(/\s+(в\s+)?(интернет[е]?|онлайн|в\s+сети|в\s+браузере)$/iu, "")
    .replace(/\s+через\s+(яндекс|yandex|duckduckgo|bing)$/iu, "")
    .trim();

  return text;
}

export function suggestSearchNavigation(task) {
  if (!looksLikeSearchTask(task) || userExplicitlyWantsGoogle(task)) return null;
  const query = extractSearchQueryFromTask(task);
  if (!query || query.length < 2) return null;
  const engineId = getPreferredSearchEngineId({ task });
  const engine = SEARCH_ENGINES[engineId];
  return {
    engineId,
    engineLabel: engine.label,
    query,
    url: engine.buildUrl(query),
  };
}

export function rewriteBlockedSearchUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) return { url, rewritten: false };

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (host !== "google.com" && host !== "google.ru") {
      return { url, rewritten: false };
    }

    const q = parsed.searchParams.get("q") || parsed.searchParams.get("query");
    const isSearchPath = parsed.pathname === "/search" || parsed.pathname.startsWith("/search/");
    if (!q && !isSearchPath) {
      return { url, rewritten: false };
    }
    if (!q) {
      return { url, rewritten: false };
    }

    const next = buildSearchUrl(q, { task: q });
    return {
      url: next,
      rewritten: true,
      reason: "google-search-captcha-risk",
      originalUrl: url,
      engineId: getPreferredSearchEngineId({ task: q }),
    };
  } catch {
    return { url, rewritten: false };
  }
}

export function buildBlockedSearchFallback(rawUrl, options = {}) {
  const url = String(rawUrl || "").trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (!["google.com", "google.ru", "sorry.google.com"].includes(host)) return null;

    let query = parsed.searchParams.get("q")
      || parsed.searchParams.get("query")
      || parsed.searchParams.get("continue")
      || "";
    if (/^https?:\/\//i.test(query)) {
      try {
        const continued = new URL(query);
        query = continued.searchParams.get("q") || continued.searchParams.get("query") || "";
      } catch {}
    }
    query = String(query || "").trim();
    if (!query) return null;

    const engineId = getPreferredSearchEngineId({ task: query, locale: options.locale });
    return {
      query,
      engineId,
      url: SEARCH_ENGINES[engineId].buildUrl(query),
      originalUrl: url,
    };
  } catch {
    return null;
  }
}

export function detectSearchBlockHint({ url = "", title = "", text = "" } = {}) {
  const blob = `${url}\n${title}\n${text}`.toLowerCase();
  if (!blob) return null;
  if (
    /unusual traffic|not a robot|sorry.*google|подозрительн|похоже.*робот|капч|captcha|verify you are human|before you continue/i.test(blob)
  ) {
    return "Страница похожа на captcha/блок Google. Используй yandex.ru/search или duckduckgo.com, не google.com.";
  }
  return null;
}

export function formatSearchPolicyHint(task = "") {
  const suggestion = suggestSearchNavigation(task);
  const lines = [
    "Search policy: automated Google search often triggers captcha — do NOT use google.com/search.",
    "Default: yandex.ru/search (RU/Cyrillic) or duckduckgo.com (other). Bing only if user asks.",
    "Open google.com only when the user explicitly names Google.",
  ];
  if (suggestion) {
    lines.push(`Suggested first step: browser_navigate to ${suggestion.url} (${suggestion.engineLabel}, query: "${suggestion.query}")`);
  }
  return lines.join("\n");
}
