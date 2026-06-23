// Пути установленных плагинов (~/.ai-free/plugins/).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PLUGINS_DIR = process.env.AI_FREE_PLUGINS_DIR
  ? path.resolve(process.env.AI_FREE_PLUGINS_DIR)
  : path.join(os.homedir(), ".ai-free", "plugins");

export function ensurePluginsDir() {
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
}
