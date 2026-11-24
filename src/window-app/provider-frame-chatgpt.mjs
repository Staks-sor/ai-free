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

function isLocalSessionCookie(name) {
  return name === "synvox_session" || name.startsWith("synvox_session_");
}

function buildUpstreamCookieHeader(req, auth) {
  const fromAuth = (auth?.cookies || []).filter((cookie) => !isLocalSessionCookie(String(cookie?.name || "")));
  const fromReq = parseCookieHeader(req.headers.cookie).filter((cookie) => !isLocalSessionCookie(cookie.name));
  const merged = mergeCookieSources(fromAuth, fromReq);
  return chatGPTCookieHeaderFromArray(merged);
}

export function buildUpstreamCookieHeaderForTest(req, auth) {
  return buildUpstreamCookieHeader(req, auth);
}

function stripLocalSessionHeaders(headers) {
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase().startsWith("x-synvox-session")) delete headers[name];
  }
  return headers;
}

function deleteHeader(headers, headerName) {
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === headerName) delete headers[name];
  }
}

export function stripLocalSessionHeadersForTest(headers) {
  return stripLocalSessionHeaders({ ...headers });
}

function isAllowedChatGPTCDNHostname(hostname) {
  if (typeof hostname !== "string" || hostname.trim() !== hostname) return false;
  const host = hostname.toLowerCase();
  if (host.length > 253) return false;
  if (host === "files.oaiusercontent.com" || host === "ab.chatgpt.com" || host === "oaistatic.com") return true;
  const suffix = ".oaistatic.com";
  if (!host.endsWith(suffix)) return false;
  const subdomain = host.slice(0, -suffix.length);
  return subdomain.split(".").every((label) =>
    label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}

export function isAllowedChatGPTCDNHostnameForTest(hostname) {
  return isAllowedChatGPTCDNHostname(hostname);
}

export function buildChatGPTCDNHeadersForTest(req, hostname, auth) {
  return buildUpstreamHeaders(req, hostname, true, auth);
}

function rewriteLocationHeader(value, reqHost) {
  if (!value) return value;
  try {
    const u = new URL(value, CHATGPT_BASE_URL);
    if (u.hostname === TARGET_HOST || u.hostname === "www.chatgpt.com") {
      return `${CHATGPT_FRAME_PREFIX}${u.pathname}${u.search}${u.hash}`;
    }
    if (isAllowedChatGPTCDNHostname(u.hostname)) {
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
    ["https://chat.openai.com", CHATGPT_FRAME_PREFIX],
    ["https:\\/\\/chat.openai.com", frameEsc],
  ];
  for (const [from, to] of replacements) {
    text = text.split(from).join(to);
  }
  text = text.replace(/https?:\/\/([a-z0-9.-]+)(?=[:/?#])/gi, (url, hostname) =>
    isAllowedChatGPTCDNHostname(hostname)
      ? `${CHATGPT_CDN_PREFIX}/${hostname.toLowerCase()}`
      : url);
  text = rewriteEscapedCdnUrls(text);
  return Buffer.from(text, "utf8");
}

function rewriteEscapedCdnUrls(text) {
  const sourcePrefix = "https:\\/\\/";
  const targetPrefix = `${CHATGPT_CDN_PREFIX.replace(/\//g, "\\/")}\\/`;
  let cursor = 0;
  let start;
  while ((start = text.indexOf(sourcePrefix, cursor)) >= 0) {
    const hostStart = start + sourcePrefix.length;
    let hostEnd = hostStart;
    while (hostEnd < text.length && /[a-z0-9.-]/i.test(text[hostEnd])) hostEnd += 1;
    const hostname = text.slice(hostStart, hostEnd);
    const boundary = text[hostEnd] === ":" || text[hostEnd] === "?" || text[hostEnd] === "#"
      || text[hostEnd] === "/"
      || (text[hostEnd] === "\\" && text[hostEnd + 1] === "/");
    if (boundary && isAllowedChatGPTCDNHostname(hostname)) {
      text = `${text.slice(0, start)}${targetPrefix}${hostname.toLowerCase()}${text.slice(hostEnd)}`;
      cursor = start + targetPrefix.length + hostname.length;
    } else {
      cursor = hostEnd;
    }
  }
  return text;
}

export function rewriteChatGPTFrameBodyForTest(text, contentType) {
  return rewriteBodyBuffer(Buffer.from(String(text), "utf8"), contentType);
}

export function rewriteChatGPTFrameLocationForTest(value) {
  return rewriteLocationHeader(value, "");
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

function resolveFrameTarget(pathname) {
  if (pathname === CHATGPT_CDN_PREFIX) return { status: 404 };
  if (pathname.startsWith(`${CHATGPT_CDN_PREFIX}/`)) {
    const rest = pathname.slice(CHATGPT_CDN_PREFIX.length);
    const slash = rest.indexOf("/", 1);
    if (!rest.startsWith("/")) return { status: 404 };
    const hostname = slash < 0 ? rest.slice(1) : rest.slice(1, slash);
    if (!hostname) return { status: 404 };
    if (!isAllowedChatGPTCDNHostname(hostname)) return { status: 403 };
    return { hostname: hostname.toLowerCase(), upstreamPath: slash < 0 ? "/" : rest.slice(slash) || "/", isCDN: true };
  }
  if (pathname === CHATGPT_FRAME_PREFIX || pathname.startsWith(`${CHATGPT_FRAME_PREFIX}/`)) {
    return {
      hostname: TARGET_HOST,
      upstreamPath: pathname.slice(CHATGPT_FRAME_PREFIX.length) || "/",
      isCDN: false,
    };
  }
  return { status: 404 };
}

export function resolveChatGPTFrameTargetForTest(pathname) {
  return resolveFrameTarget(pathname);
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

function buildUpstreamHeaders(req, hostname, isCDN, auth) {
  const headers = {
    ...req.headers,
    host: hostname,
    origin: CHATGPT_BASE_URL,
    referer: `${CHATGPT_BASE_URL}/`,
  };
  deleteHeader(headers, "cookie");
  if (!isCDN) headers.cookie = buildUpstreamCookieHeader(req, auth);
  deleteHeader(headers, "connection");
  deleteHeader(headers, "content-length");
  deleteHeader(headers, "accept-encoding");
  headers["accept-encoding"] = "identity";
  if (isCDN) deleteHeader(headers, "authorization");
  if (!isCDN && auth?.userAgent) headers["user-agent"] = auth.userAgent;
  return stripLocalSessionHeaders(headers);
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

  const target = resolveFrameTarget(url.pathname);
  if (target.status) {
    res.writeHead(target.status, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(target.status === 403 ? "Forbidden" : "Not found");
    return;
  }

  const auth = target.isCDN ? null : readChatGPTAuth(CHATGPT_AUTH_FILE);
  const upstreamHeaders = buildUpstreamHeaders(req, target.hostname, target.isCDN, auth);

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
      hostname: target.hostname,
      path: target.upstreamPath + url.search,
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
  if (url.pathname !== CHATGPT_FRAME_PREFIX && !url.pathname.startsWith(`${CHATGPT_FRAME_PREFIX}/`)) return false;

  const upstreamPath = url.pathname.slice(CHATGPT_FRAME_PREFIX.length) || "/";
  const auth = readChatGPTAuth(CHATGPT_AUTH_FILE);
  const headers = buildUpstreamHeaders(req, TARGET_HOST, false, auth);

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
