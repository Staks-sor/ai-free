import fs from "node:fs";
import path from "node:path";
import { CHATGPT_BASE_URL } from "./config.mjs";

export function readChatGPTAuth(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    const cookies = dedupeChatGPTCookies(Array.isArray(raw.cookies) ? raw.cookies : []);
    return {
      accessToken: raw.accessToken || "",
      sessionToken: raw.sessionToken || "",
      cookieHeader: chatGPTCookieHeaderFromArray(cookies),
      cookies,
      profileDir: raw.profileDir || "",
      userAgent: raw.userAgent || "",
      source: file,
    };
  } catch {
    return null;
  }
}

export function isChatGPTAuthUsable(auth) {
  if (!auth) return false;
  // JWT accessToken у ChatGPT живёт недолго; долгая сессия — в session-token cookie.
  const hasSessionCookie = Boolean(
    auth.sessionToken
    || auth.cookies?.some((c) => {
      const name = String(c?.name || "");
      return name === "__Secure-next-auth.session-token" || /^__Secure-next-auth\.session-token\.\d+$/.test(name);
    }),
  );
  if (hasSessionCookie) return true;
  if (auth.accessToken && !isJwtExpired(auth.accessToken, 60)) return true;
  return Boolean(auth.accessToken);
}

export function writeChatGPTAuth(file, { cookies, accessToken, sessionToken, profileDir, userAgent }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const cleanCookies = pickEssentialChatGPTCookies(sanitizeCookiesForStorage(cookies));
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    baseUrl: CHATGPT_BASE_URL,
    profileDir,
    accessToken,
    sessionToken,
    userAgent,
    cookies: cleanCookies,
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
}

export function chatGPTCookieHeaderFromArray(parsed) {
  if (!Array.isArray(parsed)) {
    throw new Error("ChatGPT cookie data must be an array.");
  }
  const usable = parsed.filter((cookie) => cookie?.name && "value" in cookie);
  return usable.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

export function playwrightCookiesFromSaved(cookies) {
  if (!Array.isArray(cookies)) return [];
  const result = [];
  const cleanCookies = dedupeChatGPTCookies(cookies);
  const chunkedBases = new Set(
    cleanCookies
      .map((cookie) => String(cookie?.name || "").match(/^(.*)\.\d+$/)?.[1])
      .filter(Boolean),
  );

  for (const c of cleanCookies) {
    if (!c?.name || !("value" in c)) continue;

    const name = String(c.name);
    const value = String(c.value);
    if (chunkedBases.has(name)) continue;

    let url = "https://chatgpt.com";
    const domain = String(c.domain || "");
    if (domain.includes("openai.com")) {
      url = "https://openai.com";
    } else if (domain.includes("auth0.com")) {
      url = "https://auth0.com";
    }

    let sameSite = undefined;
    const rawSameSite = String(c.sameSite || "").toLowerCase();
    if (rawSameSite === "lax") sameSite = "Lax";
    else if (rawSameSite === "strict") sameSite = "Strict";
    else if (rawSameSite === "none") sameSite = "None";

    const baseEntry = {
      url: url,
      httpOnly: Boolean(c.httpOnly),
      secure: Boolean(c.secure),
    };

    if (sameSite) {
      baseEntry.sameSite = sameSite;
    }

    if (c.expires !== undefined && c.expires !== null) {
      const val = Number(c.expires);
      if (!isNaN(val) && val > 0) {
        baseEntry.expires = val;
      }
    } else if (c.expirationDate !== undefined && c.expirationDate !== null) {
      const val = Number(c.expirationDate);
      if (!isNaN(val) && val > 0) {
        baseEntry.expires = val;
      }
    }

    const totalLen = name.length + value.length;
    if (totalLen > 4000) {
      // Chunking large cookies (like __Secure-next-auth.session-token) into .0, .1, etc.
      // NextAuth automatically gathers them back on the server side
      const chunkSize = 3800;
      let chunkIdx = 0;
      for (let offset = 0; offset < value.length; offset += chunkSize) {
        result.push({
          ...baseEntry,
          name: `${name}.${chunkIdx}`,
          value: value.slice(offset, offset + chunkSize),
        });
        chunkIdx++;
      }
    } else {
      result.push({
        ...baseEntry,
        name,
        value,
      });
    }
  }

  return result;
}

export async function applyCookiesToContext(context, cookies) {
  const normalized = playwrightCookiesFromSaved(pickEssentialChatGPTCookies(cookies));
  if (!normalized.length) return 0;
  await context.addCookies(normalized);
  return normalized.length;
}

export function dedupeChatGPTCookies(cookies) {
  if (!Array.isArray(cookies)) return [];
  const allowedDomain = /(^|\.)((chatgpt\.com)|(openai\.com)|(auth0\.com))$/i;
  const byKey = new Map();

  for (const cookie of cookies) {
    if (!cookie?.name || !("value" in cookie)) continue;
    const name = String(cookie.name);
    const value = String(cookie.value);
    if (!name || !value) continue;
    const domain = String(cookie.domain || "chatgpt.com").replace(/^\./, "");
    if (domain && !allowedDomain.test(domain)) continue;
    const pathName = String(cookie.path || "/");
    const key = `${domain}|${pathName}|${name}`;
    byKey.set(key, {
      ...cookie,
      name,
      value,
      domain: cookie.domain || ".chatgpt.com",
      path: pathName,
    });
  }

  return [...byKey.values()];
}

// Склеивает chunked-cookies (.0, .1) в одну запись и убирает дубли.
// Иначе при каждом sync/addCookies заголовок Cookie раздувается → HTTP 431.
export function sanitizeCookiesForStorage(cookies) {
  const deduped = dedupeChatGPTCookies(cookies);
  const chunked = new Map();
  const singles = new Map();

  for (const cookie of deduped) {
    const match = String(cookie.name).match(/^(.*)\.(\d+)$/);
    if (match && /^\d+$/.test(match[2])) {
      const base = match[1];
      if (!chunked.has(base)) chunked.set(base, []);
      chunked.get(base).push({ idx: Number(match[2]), cookie });
      continue;
    }
    singles.set(`${cookie.domain}|${cookie.path}|${cookie.name}`, cookie);
  }

  const result = [];
  for (const [base, parts] of chunked) {
    parts.sort((a, b) => a.idx - b.idx);
    const mergedValue = parts.map((part) => part.cookie.value).join("");
    const template = parts[0].cookie;
    const singleKey = `${template.domain}|${template.path}|${base}`;
    const existing = singles.get(singleKey);
    if (!existing || mergedValue.length >= String(existing.value).length) {
      singles.delete(singleKey);
      result.push({ ...template, name: base, value: mergedValue });
    } else {
      result.push(existing);
      singles.delete(singleKey);
    }
  }
  result.push(...singles.values());
  return dedupeChatGPTCookies(result);
}

const ESSENTIAL_CHATGPT_COOKIE_PATTERNS = [
  /^__Secure-next-auth\.session-token$/,
  /^__Secure-next-auth\.csrf-token$/,
  /^__Host-next-auth\.csrf-token$/,
  /^cf_clearance$/,
  /^__cf_bm$/,
  /^_cfuvid$/,
  /^__cflb$/,
  /^oai-did$/,
  /^oai-sc/,
  /^oai-hlib/,
  /^oai-nav-state/,
  /^oai-client-auth/,
  /^_account$/,
  /^_puid$/,
  /^_dd_s$/,
];

export function pickEssentialChatGPTCookies(cookies) {
  const sanitized = sanitizeCookiesForStorage(cookies);
  const picked = sanitized.filter((cookie) =>
    ESSENTIAL_CHATGPT_COOKIE_PATTERNS.some((pattern) => pattern.test(String(cookie.name || ""))),
  );
  return picked.length ? picked : sanitized.slice(0, 24);
}

export function estimateCookieHeaderBytes(cookies) {
  return (Array.isArray(cookies) ? cookies : []).reduce(
    (sum, cookie) => sum + String(cookie?.name || "").length + String(cookie?.value || "").length + 3,
    0,
  );
}

export async function clearBrowserCookiesViaCdp(page, context) {
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.clearBrowserCookies");
    return true;
  } catch {
    try {
      await context.clearCookies();
      return true;
    } catch {
      return false;
    }
  }
}

export async function replaceCookiesInContext(context, cookies, page = null) {
  const essential = pickEssentialChatGPTCookies(cookies);
  const normalized = playwrightCookiesFromSaved(essential);
  if (page) {
    await clearBrowserCookiesViaCdp(page, context);
  } else {
    await context.clearCookies();
  }
  if (!normalized.length) return 0;
  await context.addCookies(normalized);
  return normalized.length;
}

function isJwtExpired(token, skewSeconds = 0) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return false;
  try {
    const payload = JSON.parse(Buffer.from(base64UrlToBase64(parts[1]), "base64").toString("utf8"));
    const exp = Number(payload.exp || 0);
    if (!exp) return false;
    return exp <= Math.floor(Date.now() / 1000) + skewSeconds;
  } catch {
    return false;
  }
}

function base64UrlToBase64(value) {
  const text = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  return text.padEnd(Math.ceil(text.length / 4) * 4, "=");
}
