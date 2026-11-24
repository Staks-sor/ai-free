import path from "node:path";
import { launchCamoufoxSession } from "../../browser/camoufox-runtime.mjs";

export function qwenCamoufoxOptions(profileDir, headless) {
  return {
    headless,
    viewport: { width: 1280, height: 800 },
    profileDir: path.join(profileDir, "camoufox-profile"),
    storageStatePath: path.join(profileDir, "camoufox-storage-state.json"),
    fingerprintStatePath: path.join(profileDir, "camoufox-fingerprint.json"),
  };
}

export function launchQwenCamoufoxSession(profileDir, headless) {
  return launchCamoufoxSession(qwenCamoufoxOptions(profileDir, headless));
}
