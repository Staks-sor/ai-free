import { randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE_NAME = "synvox_session";
const SESSION_TOKEN = randomBytes(32).toString("base64url");
const SESSION_TOKEN_BYTES = Buffer.from(SESSION_TOKEN);

export function createLocalHttpSecurity() {
  return {
    issueCookie(res, req) {
      res.setHeader("Set-Cookie", `${cookieName(req.headers.host)}=${SESSION_TOKEN}; HttpOnly; SameSite=Strict; Path=/`);
    },
    check(req, pathname) {
      const host = req?.headers?.host;
      if (!isLoopbackHost(host)) return denied(403, "Invalid Host");

      const fetchSite = req.headers["sec-fetch-site"];
      if (typeof fetchSite !== "undefined") {
        const htmlNavigation = req.method === "GET" && (pathname === "/" || pathname.startsWith("/embed/"))
          && ["document", "iframe"].includes(req.headers["sec-fetch-dest"]);
        if (typeof fetchSite !== "string" || (fetchSite.trim().toLowerCase() === "cross-site" && !htmlNavigation)) {
          return denied(403, "Cross-site request blocked");
        }
      }

      const isApi = pathname === "/v1" || pathname?.startsWith("/v1/");
      const origin = req.headers.origin;
      if (isApi) {
        if (typeof origin !== "undefined" && !isLoopbackOrigin(origin)) {
          return denied(403, "Invalid Origin");
        }
        return null;
      }

      if (typeof origin !== "undefined" && origin !== `http://${host}`) {
        return denied(403, "Invalid Origin");
      }

      if (isPublicBootstrap(req.method, pathname)) return null;
      // Fetch Metadata is browser-controlled; cross-origin scripts cannot forge
      // same-origin. This also supports IDE iframes with third-party cookies off.
      if (fetchSite === "same-origin") return null;
      if (!hasValidSessionCookie(req.headers.cookie, cookieName(host))) return denied(401, "Session required");
      return null;
    },
  };
}

function isPublicBootstrap(method, pathname) {
  if (method !== "GET" && method !== "HEAD") return false;
  return pathname === "/"
    || pathname?.startsWith("/embed/")
    || pathname?.startsWith("/assets/")
    || pathname === "/api/heartbeat";
}

function isLoopbackOrigin(origin) {
  if (typeof origin !== "string" || origin.trim() !== origin) return false;
  const match = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::([0-9]+))?$/i.exec(origin);
  return Boolean(match && validPort(match[2]));
}

function isLoopbackHost(host) {
  if (typeof host !== "string" || host.trim() !== host) return false;
  const match = /^(localhost|127\.0\.0\.1|\[::1\])(?::([0-9]+))?$/i.exec(host);
  return Boolean(match && validPort(match[2]));
}

function validPort(port) {
  if (typeof port === "undefined") return true;
  const parsed = Number(port);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 65_535;
}

function cookieName(host) {
  return `${SESSION_COOKIE_NAME}_${/:(\d+)$/.exec(host)?.[1] || "80"}`;
}

function hasValidSessionCookie(cookieHeader, name) {
  if (typeof cookieHeader !== "string") return false;
  let token = null;
  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    if (token !== null) return false;
    token = entry.slice(separator + 1).trim();
  }
  if (token === null) return false;
  const bytes = Buffer.from(token);
  return bytes.length === SESSION_TOKEN_BYTES.length && timingSafeEqual(bytes, SESSION_TOKEN_BYTES);
}

function denied(status, error) {
  return { status, error };
}
