#!/usr/bin/env node
// Тонкий entry-point. Вся логика — в src/.
//
// Дополнительно: при ПЕРВОМ запуске (node_modules/playwright отсутствует)
// автоматически делает `npm install`. Юзеру достаточно `npm start` после клонирования.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

// Help / version не требуют зависимостей — пропускаем bootstrap, иначе юзер
// не сможет даже посмотреть `--help` без интернета.
const argv = process.argv.slice(2);
const isHelpOnly = argv.some((a) => a === "-h" || a === "--help" || a === "--version");
const isVsCodeMode = process.env.AI_FREE_VSCODE === "1";

// Проверяем единственную внешнюю зависимость. Если её нет — установка нужна.
const playwrightPkg = path.join(projectRoot, "node_modules", "playwright", "package.json");
if (!isHelpOnly && !fs.existsSync(playwrightPkg)) {
  if (isVsCodeMode) {
    console.error("AI Free VS Code extension is missing bundled dependencies.");
    console.error("Reinstall the extension from Marketplace or install a newer VSIX build.");
    process.exit(1);
  }

  console.log("📦 Первый запуск: ставлю зависимости (один раз, ~150 МБ с Chromium)...");
  console.log("   Это займёт минуту. Вывод npm:\n");

  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCmd, ["install"], {
    cwd: projectRoot,
    stdio: "inherit",
  });

  if (result.error && result.error.code === "ENOENT") {
    console.error("\n❌ Не нашёл `npm` в PATH. Установи Node.js с nodejs.org и попробуй снова.");
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error("\n❌ npm install упал. Попробуй вручную:");
    console.error(`   cd "${projectRoot}"`);
    console.error("   npm install");
    process.exit(1);
  }
  console.log("\n✅ Зависимости установлены. Запускаюсь...\n");
}

// Импортируем динамически — на случай если в будущем какой-то модуль захочет
// что-то проверить перед стартом. Сейчас работает и через static, но dynamic безопаснее.
const { run } = await import("../src/cli/run.mjs");

run().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
