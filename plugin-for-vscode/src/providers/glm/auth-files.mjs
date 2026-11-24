import fs from "node:fs";
import { writeAtomicJsonSync } from "../../state/state-writer.mjs";
import { GLM_BASE_URL } from "./config.mjs";

export function readGLMAuth(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return raw && typeof raw === "object" ? raw : null;
  } catch {
    return null;
  }
}

export function isGLMAuthUsable(auth) {
  return Boolean(auth?.signedIn && auth?.profileDir);
}

export function isGLMUserToken(value) {
  const token = String(value || "").trim();
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return true;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const email = String(payload?.email || "").trim().toLowerCase();
    return !email.endsWith("@guest.com") && !email.startsWith("guest-");
  } catch {
    return true;
  }
}

export function hasGLMAuthCookie(cookies = []) {
  return cookies.some((cookie) => (
    /^(?:token|access_token)$/i.test(String(cookie?.name || ""))
    && /(?:^|\.)z\.ai$/i.test(String(cookie?.domain || "").replace(/^\./, ""))
    && isGLMUserToken(cookie?.value)
  ));
}

export function isGLMLoginConfirmed({
  hasComposer = false,
  hasAuthToken = false,
  hasAuthCookie = false,
} = {}) {
  return Boolean(hasComposer && (hasAuthToken || hasAuthCookie));
}

export function writeGLMAuth(file, { profileDir, accountLabel = "" }) {
  writeAtomicJsonSync(file, {
    version: 1,
    savedAt: new Date().toISOString(),
    baseUrl: GLM_BASE_URL,
    signedIn: true,
    profileDir,
    accountLabel,
  });
}
