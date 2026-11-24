import fs from "node:fs";
import { writeAtomicJsonSync } from "../../state/state-writer.mjs";
import { GOOGLE_AI_BASE_URL } from "./config.mjs";

export function readGoogleAIAuth(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return raw && typeof raw === "object" ? raw : null;
  } catch {
    return null;
  }
}

export function isGoogleAIAuthUsable(auth) {
  return Boolean(auth?.signedIn && (auth?.storageStatePath || auth?.profileDir));
}

export function invalidateGoogleAIAuth(file) {
  const auth = readGoogleAIAuth(file);
  if (!auth?.signedIn) return;
  writeAtomicJsonSync(file, { ...auth, signedIn: false });
}

export function writeGoogleAIAuth(file, { profileDir, storageStatePath, accountLabel = "" }) {
  writeAtomicJsonSync(file, {
    version: 1,
    savedAt: new Date().toISOString(),
    baseUrl: GOOGLE_AI_BASE_URL,
    signedIn: true,
    ...(profileDir ? { profileDir } : {}),
    ...(storageStatePath ? { storageStatePath } : {}),
    accountLabel,
  });
}
