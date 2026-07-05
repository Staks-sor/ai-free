import os from "node:os";
import path from "node:path";
import { getProviderCatalog } from "../model-catalog.mjs";

export const CHATGPT_BASE_URL = "https://chatgpt.com";
export const CHATGPT_HOME = path.join(os.homedir(), ".chatgpt-cli");
export const CHATGPT_AUTH_FILE = path.join(CHATGPT_HOME, "auth.json");
export const CHATGPT_BROWSER_PROFILE = path.join(CHATGPT_HOME, "browser-profile");

export const CHATGPT_MODELS = getProviderCatalog("chatgpt").models;
export const CHATGPT_DEFAULT_MODEL = getProviderCatalog("chatgpt").defaultModel;
