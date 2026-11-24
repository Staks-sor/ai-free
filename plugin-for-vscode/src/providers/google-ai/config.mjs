import os from "node:os";
import path from "node:path";
import { getProviderCatalog } from "../model-catalog.mjs";

export const GOOGLE_AI_BASE_URL = "https://www.google.com/search?udm=50&aep=11";
export const GOOGLE_AI_HOME = path.join(os.homedir(), ".google-ai-cli");
export const GOOGLE_AI_AUTH_FILE = path.join(GOOGLE_AI_HOME, "auth.json");
export const GOOGLE_AI_BROWSER_PROFILE = path.join(GOOGLE_AI_HOME, "browser-profile");
export const GOOGLE_AI_CAMOUFOX_PROFILE = path.join(GOOGLE_AI_HOME, "camoufox-profile");
export const GOOGLE_AI_FINGERPRINT_STATE = path.join(GOOGLE_AI_HOME, "camoufox-fingerprint.json");
export const GOOGLE_AI_STORAGE_STATE = path.join(GOOGLE_AI_HOME, "storage-state.json");
export const GOOGLE_AI_MODELS = getProviderCatalog("googleai").models;
export const GOOGLE_AI_DEFAULT_MODEL = getProviderCatalog("googleai").defaultModel;
