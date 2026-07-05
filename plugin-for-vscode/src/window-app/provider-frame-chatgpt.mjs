// Reverse-proxy chatgpt.com для iframe в drawer (127.0.0.1).
// Снимает X-Frame-Options/CSP и переписывает абсолютные URL на локальный префикс.

import https from "node:https";
import zlib from "node:zlib";
import { URL } from "node:url";
import { CHATGPT_AUTH_FILE, CHATGPT_BASE_URL } from "../providers/chatgpt/config.mjs";
import {
  chatGPTCookieHeaderFromArray,
  dedupeChatGPTCookies,
  pickEssentialChatGPTCookies,
  readChatGPTAuth,
  writeChatGPTAuth,
} from "../providers/chatgpt/auth-files.mjs";

export const CHATGPT_FRAME_PREFIX = "/provider-frame/chatgpt";
export const CHATGPT_CDN_PREFIX = "/provider-frame/chatgpt-cdn";

const TARGET_HOST = "chatgpt.com";
const STRIP_RESPONSE_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "permissions-policy",
  "strict-transport-security",
]);

const REWRITABLE_CT = /text\/html|application\/javascript|text\/javascript|application\/json|text\/css|application\/xml|text\/xml/i;

let persistTimer = null;
let pendingCookies = null;

function isEmbedEnabled() {
  return process.env.CHATGPT_EMBED_IN_UI === "1";
}

function parseCookieHeader(header) {
  if (!header) return [];
  const out = [];
  for (const part of String(header).split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out.push({ name: trimmed.slice(0, eq), value: trimmed.slice(eq + 1) });
  }
  return out;
}

function parseSetCookieHeaders(headers) {
  const raw = headers["set-cookie"];
  if (!raw) return [];
  const lines = Array.isArray(raw) ? raw : [raw];
  const cookies = [];
  for (const line of lines) {
    const segments = String(line).split(";").map((s) => s.trim());
    const [pair] = segments;
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const entry = {
      name: pair.slice(0, eq),
      value: pair.slice(eq + 1),
      domain: ".chatgpt.com",
      path: "/",
      secure: true,
      httpOnly: false,
    };
    for (const seg of segments.slice(1)) {
      const lower = seg.toLowerCase();
      if (lower.startsWith("domain=")) entry.domain = seg.slice(7);
      else if (lower.startsWith("path=")) entry.path = seg.slice(5);
      else if (lower === "httponly") entry.httpOnly = true;
      else if (lower === "secure") entry.secure = true;
    }
    cookies.push(entry);
  }
  return cookies;
}

function mergeCookieSources(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const c of list || []) {
      if (!c?.name) continue;
      map.set(c.name, c);
    }
  }
  return dedupeChatGPTCookies([...map.values()]);
}

function schedulePersistCookies(cookies) {
  pendingCookies = cookies;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const merged = pickEssentialChatGPTCookies(pendingCookies || []);
    pendingCookies = null;
    if (!merged.length) return;
    const prev = readChatGPTAuth(CHATGPT_AUTH_FILE) || {};
    writeChatGPTAuth(CHATGPT_AUTH_FILE, {
      cookies: merged,
      accessToken: prev.accessToken || "",
      sessionToken: prev.sessionToken
        || merged.find((c) => c.name === "__Secure-next-auth.session-token")?.value
        || "",
      profileDir: prev.profileDir || "",
      userAgent: prev.userAgent || "",
    });
  }, 400);
  persistTimer.unref?.();
}

async function maybeCaptureSessionFromBody(body, contentType) {
  if (!contentType || !/application\/json/i.test(contentType)) return;
  try {
    const json = JSON.parse(body.toString("utf8"));
    if (!json?.accessToken) return;
    const prev = readChatGPTAuth(CHATGPT_AUTH_FILE) || {};
    writeChatGPTAuth(CHATGPT_AUTH_FILE, {
      cookies: prev.cookies || [],
      accessToken: json.accessToken,
      sessionToken: json.sessionToken || prev.sessionToken || "",
      profileDir: prev.profileDir || "",
      userAgent: prev.userAgent || "",
    });
  } catch {}
}

function buildUpstreamCookieHeader(req) {
  const auth = readChatGPTAuth(CHATGPT_AUTH_FILE);
  const fromAuth = auth?.cookies || [];
  const fromReq = parseCookieHeader(req.headers.cookie);
  const merged = mergeCookieSources(fromAuth, fromReq);
  return chatGPTCookieHeaderFromArray(merged);
}

function rewriteLocationHeader(value, reqHost) {
  if (!value) return value;
  try {
    const u = new URL(value, CHATGPT_BASE_URL);
    if (u.hostname === TARGET_HOST || u.hostname === "www.chatgpt.com") {
      return `${CHATGPT_FRAME_PREFIX}${u.pathname}${u.search}${u.hash}`;
    }
    if (
      u.hostname.endsWith("oaistatic.com")
      || u.hostname === "files.oaiusercontent.com"
      || u.hostname === "ab.chatgpt.com"
    ) {
      return `${CHATGPT_CDN_PREFIX}/${u.hostname}${u.pathname}${u.search}${u.hash}`;
    }
  } catch {}
  return value;
}

function rewriteBodyBuffer(body, contentType) {
  if (!body?.length || !contentType || !REWRITABLE_CT.test(contentType)) return body;
  let text = body.toString("utf8");
  const frameEsc = CHATGPT_FRAME_PREFIX.replace(/\//g, "\\/");
  const frameBase = `${CHATGPT_FRAME_PREFIX}/`;
  const ct = String(contentType || "").toLowerCase();

  if (ct.includes("text/html")) {
    text = text.replace(
      /<base\s+([^>]*?)href=["']https?:\/\/(?:www\.)?chatgpt\.com\/?["']([^>]*)>/gi,
      `<base $1href="${frameBase}"$2>`,
    );
    // Корневые пути /_next/... иначе уходят на 127.0.0.1/_next (без CSS).
    text = text.replace(
      /(\s(?:href|src|action)=["'])\/(?!\/|provider-frame\/)/gi,
      `$1${CHATGPT_FRAME_PREFIX}/`,
    );
    text = text.replace(
      /(\scontent=["'][^"']*?)https?:\/\/(?:www\.)?chatgpt\.com\/?/gi,
      `$1${frameBase}`,
    );
    if (!/<base\s[\s\S]*?href=["'][^"']*provider-frame\/chatgpt/i.test(text)) {
      text = text.replace(/<head([^>]*)>/i, `<head$1><base href="${frameBase}">`);
    }
  }

  if (ct.includes("text/css") || ct.includes("javascript") || ct.includes("json")) {
    text = text.replace(/url\(\s*\/(?!\/)/gi, `url(${CHATGPT_FRAME_PREFIX}/`);
    text = text.replace(/url\(\s*["']\/(?!\/)/gi, `url("${CHATGPT_FRAME_PREFIX}/`);
    text = text.replace(/import\s*["']\/(?!\/)/gi, `import "${CHATGPT_FRAME_PREFIX}/`);
    text = text.replace(/from\s*["']\/(?!\/)/gi, `from "${CHATGPT_FRAME_PREFIX}/`);
  }

  const replacements = [
    ["https://chatgpt.com", CHATGPT_FRAME_PREFIX],
    ["https://www.chatgpt.com", CHATGPT_FRAME_PREFIX],
    ["https:\\/\\/chatgpt.com", frameEsc],
    ["https:\\/\\/www.chatgpt.com", frameEsc],
    ["http://chatgpt.com", CHATGPT_FRAME_PREFIX],
    ["http:\\/\\/chatgpt.com", frameEsc],
    ["//chatgpt.com", CHATGPT_FRAME_PREFIX],
    ["//www.chatgpt.com", CHATGPT_FRAME_PREFIX],
    ["https://cdn.oaistatic.com", `${CHATGPT_CDN_PREFIX}/cdn.oaistatic.com`],
    ["https:\\/\\/cdn.oaistatic.com", `${CHATGPT_CDN_PREFIX.replace(/\//g, "\\/")}\\/cdn.oaistatic.com`],
    ["https://oaistatic.com", `${CHATGPT_CDN_PREFIX}/oaistatic.com`],
    ["https:\\/\\/oaistatic.com", `${CHATGPT_CDN_PREFIX.replace(/\//g, "\\/")}\\/oaistatic.com`],
    ["https://ab.chatgpt.com", `${CHATGPT_CDN_PREFIX}/ab.chatgpt.com`],
    ["https:\\/\\/ab.chatgpt.com", `${CHATGPT_CDN_PREFIX.replace(/\//g, "\\/")}\\/ab.chatgpt.com`],
    ["https://chat.openai.com", CHATGPT_FRAME_PREFIX],
    ["https:\\/\\/chat.openai.com", frameEsc],
  ];
  for (const [from, to] of replacements) {
    text = text.split(from).join(to);
  }
  return Buffer.from(text, "utf8");
}

export function rewriteChatGPTFrameBodyForTest(text, contentType) {
  return rewriteBodyBuffer(Buffer.from(String(text), "utf8"), contentType);
}

function rewriteSetCookieForFrame(setCookieLine) {
  let line = String(setCookieLine);
  line = line.replace(/;\s*domain=[^;]*/gi, "");
  line = line.replace(/;\s*secure/gi, "");
  if (!/;\s*path=/i.test(line)) {
    line += "; Path=/";
  }
  return line;
}

function collectRequestBody(req, maxBytes = 25_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function decompressBody(body, encoding) {
  const enc = String(encoding || "").toLowerCase();
  if (!enc || enc === "identity") return Promise.resolve(body);
  const fn = enc.includes("gzip")
    ? zlib.gunzip
    : enc.includes("br")
      ? zlib.brotliDecompress
      : enc.includes("deflate")
        ? zlib.inflate
        : null;
  if (!fn) return Promise.resolve(body);
  return new Promise((resolve, reject) => {
    fn(body, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

function compressBody(body, encoding) {
  const enc = String(encoding || "").toLowerCase();
  if (!enc || enc === "identity") return Promise.resolve(body);
  const fn = enc.includes("gzip")
    ? zlib.gzip
    : enc.includes("br")
      ? zlib.brotliCompress
      : enc.includes("deflate")
        ? zlib.deflate
        : null;
  if (!fn) return Promise.resolve(body);
  return new Promise((resolve, reject) => {
    fn(body, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

function proxyHttpsRequest({ hostname, path, method, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        port: 443,
        path,
        method,
        headers,
        rejectUnauthorized: true,
      },
      (upstream) => {
        const chunks = [];
        upstream.on("data", (c) => chunks.push(c));
        upstream.on("end", () => {
          resolve({
            statusCode: upstream.statusCode || 502,
            headers: upstream.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on("error", reject);
    if (body?.length) req.write(body);
    req.end();
  });
}

export function isChatGPTFramePath(pathname) {
  return pathname === CHATGPT_FRAME_PREFIX
    || pathname.startsWith(`${CHATGPT_FRAME_PREFIX}/`)
    || pathname.startsWith(`${CHATGPT_CDN_PREFIX}/`);
}

export async function handleChatGPTFrameProxy(req, res, url) {
  if (!isEmbedEnabled()) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ChatGPT embed is disabled.");
    return;
  }

  let hostname = TARGET_HOST;
  let upstreamPath = url.pathname;

  if (upstreamPath.startsWith(CHATGPT_CDN_PREFIX)) {
    const rest = upstreamPath.slice(CHATGPT_CDN_PREFIX.length);
    const slash = rest.indexOf("/", 1);
    if (slash <= 1) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    hostname = rest.slice(1, slash);
    upstreamPath = rest.slice(slash) || "/";
  } else if (upstreamPath.startsWith(CHATGPT_FRAME_PREFIX)) {
    upstreamPath = upstreamPath.slice(CHATGPT_FRAME_PREFIX.length) || "/";
  } else {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const auth = readChatGPTAuth(CHATGPT_AUTH_FILE);
  const upstreamHeaders = {
    ...req.headers,
    host: hostname,
    cookie: buildUpstreamCookieHeader(req),
    origin: CHATGPT_BASE_URL,
    referer: `${CHATGPT_BASE_URL}/`,
  };
  delete upstreamHeaders.connection;
  delete upstreamHeaders["content-length"];
  delete upstreamHeaders["accept-encoding"];
  upstreamHeaders["accept-encoding"] = "identity";

  if (auth?.userAgent) {
    upstreamHeaders["user-agent"] = auth.userAgent;
  }

  let body = Buffer.alloc(0);
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      body = await collectRequestBody(req);
      upstreamHeaders["content-length"] = String(body.length);
    } catch (error) {
      res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(error.message);
      return;
    }
  }

  let upstream;
  try {
    upstream = await proxyHttpsRequest({
      hostname,
      path: upstreamPath + url.search,
      method: req.method,
      headers: upstreamHeaders,
      body,
    });
  } catch (error) {
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`ChatGPT proxy error: ${error.message}`);
    return;
  }

  const setCookies = parseSetCookieHeaders(upstream.headers);
  if (setCookies.length) {
    const merged = mergeCookieSources(readChatGPTAuth(CHATGPT_AUTH_FILE)?.cookies, setCookies);
    schedulePersistCookies(merged);
  }

  let outBody = upstream.body;
  const contentType = upstream.headers["content-type"] || "";
  const encoding = upstream.headers["content-encoding"];
  const shouldRewrite = REWRITABLE_CT.test(contentType);

  try {
    if (shouldRewrite) {
      outBody = await decompressBody(outBody, encoding);
      outBody = rewriteBodyBuffer(outBody, contentType);
      await maybeCaptureSessionFromBody(outBody, contentType);
    }
  } catch {
    outBody = upstream.body;
  }

  const outHeaders = {};
  for (const [key, value] of Object.entries(upstream.headers)) {
    const lower = key.toLowerCase();
    if (STRIP_RESPONSE_HEADERS.has(lower)) continue;
    if (lower === "set-cookie") continue;
    if (lower === "content-length") continue;
    if (lower === "content-encoding") continue;
    if (lower === "transfer-encoding") continue;
    if (lower === "location") {
      outHeaders[key] = rewriteLocationHeader(Array.isArray(value) ? value[0] : value, req.headers.host);
      continue;
    }
    outHeaders[key] = value;
  }

  const rawSetCookie = upstream.headers["set-cookie"];
  if (rawSetCookie) {
    const lines = Array.isArray(rawSetCookie) ? rawSetCookie : [rawSetCookie];
    outHeaders["set-cookie"] = lines.map(rewriteSetCookieForFrame);
  }

  outHeaders["content-length"] = String(outBody.length);

  res.writeHead(upstream.statusCode, outHeaders);
  if (req.method === "HEAD") res.end();
  else res.end(outBody);
}

export function handleChatGPTFrameUpgrade(req, socket, head) {
  if (!isEmbedEnabled()) {
    socket.destroy();
    return false;
  }

  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (!url.pathname.startsWith(CHATGPT_FRAME_PREFIX)) return false;

  const upstreamPath = url.pathname.slice(CHATGPT_FRAME_PREFIX.length) || "/";
  const auth = readChatGPTAuth(CHATGPT_AUTH_FILE);
  const headers = {
    ...req.headers,
    host: TARGET_HOST,
    cookie: buildUpstreamCookieHeader(req),
    origin: CHATGPT_BASE_URL,
  };
  if (auth?.userAgent) headers["user-agent"] = auth.userAgent;
  delete headers.connection;

  const proxyReq = https.request({
    hostname: TARGET_HOST,
    port: 443,
    path: upstreamPath + url.search,
    method: req.method,
    headers,
  });

  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    const lines = [`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage || ""}`];
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) lines.push(`${key}: ${v}`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    }
    lines.push("", "");
    socket.write(lines.join("\r\n"));
    if (proxyHead?.length) proxySocket.write(proxyHead);
    if (head?.length) proxySocket.write(head);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
    proxySocket.on("error", () => socket.destroy());
    socket.on("error", () => proxySocket.destroy());
  });

  proxyReq.on("error", () => socket.destroy());
  proxyReq.end();
  return true;
}
