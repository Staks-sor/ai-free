import os from "node:os";
import path from "node:path";
import { getProviderCatalog } from "../model-catalog.mjs";

export const GLM_BASE_URL = "https://chat.z.ai/";
export const GLM_HOME = path.join(os.homedir(), ".glm-cli");
export const GLM_AUTH_FILE = path.join(GLM_HOME, "auth.json");
export const GLM_BROWSER_PROFILE = path.join(GLM_HOME, "browser-profile");
export const GLM_STORAGE_STATE = path.join(GLM_HOME, "storage-state.json");
export const GLM_MODELS = getProviderCatalog("glm").models;
export const GLM_DEFAULT_MODEL = getProviderCatalog("glm").defaultModel;
