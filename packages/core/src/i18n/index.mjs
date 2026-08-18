import { language as ru } from "./languages/ru.mjs";
import { language as en } from "./languages/en.mjs";
import { language as es } from "./languages/es.mjs";
import { language as pt } from "./languages/pt.mjs";
import { language as fr } from "./languages/fr.mjs";
import { language as de } from "./languages/de.mjs";
import { language as zh } from "./languages/zh.mjs";
import { language as hi } from "./languages/hi.mjs";
import { language as ar } from "./languages/ar.mjs";

export const DEFAULT_LANGUAGE = "ru";

export const LANGUAGES = Object.freeze({
  ru,
  en,
  es,
  pt,
  fr,
  de,
  zh,
  hi,
  ar,
});

const ALIASES = Object.freeze({
  "pt-br": "pt",
  "pt-pt": "pt",
  "zh-cn": "zh",
  "zh-hans": "zh",
  "zh-tw": "zh",
  "zh-hant": "zh",
});

export function normalizeLanguage(value) {
  const raw = String(value || "")
    .trim()
    .replace(/\..*$/, "")
    .replace(/_/g, "-")
    .toLowerCase();
  if (!raw) return DEFAULT_LANGUAGE;
  const exact = ALIASES[raw] || raw;
  if (LANGUAGES[exact]) return exact;
  const short = exact.split("-")[0];
  return LANGUAGES[short] ? short : DEFAULT_LANGUAGE;
}

export function resolveUserLanguage(explicitLanguage = "") {
  return normalizeLanguage(
    explicitLanguage
      || process.env.AI_FREE_LANG
      || process.env.LC_ALL
      || process.env.LC_MESSAGES
      || process.env.LANG
      || DEFAULT_LANGUAGE,
  );
}

export function getLanguageMeta(languageCode = DEFAULT_LANGUAGE) {
  const language = LANGUAGES[normalizeLanguage(languageCode)] || LANGUAGES[DEFAULT_LANGUAGE];
  return {
    code: language.code,
    name: language.name,
    dir: language.dir || "ltr",
  };
}

export function getMessages(languageCode = DEFAULT_LANGUAGE) {
  const code = normalizeLanguage(languageCode);
  const base = code === DEFAULT_LANGUAGE
    ? LANGUAGES[DEFAULT_LANGUAGE].messages
    : LANGUAGES.en.messages;
  return {
    ...base,
    ...(LANGUAGES[code]?.messages || {}),
  };
}

export function formatMessage(template, vars = {}) {
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
  ));
}

export function createTranslator(languageCode = DEFAULT_LANGUAGE) {
  const language = getLanguageMeta(languageCode);
  const messages = getMessages(language.code);
  return {
    language,
    messages,
    t(key, vars = {}) {
      return formatMessage(messages[key] || key, vars);
    },
  };
}
