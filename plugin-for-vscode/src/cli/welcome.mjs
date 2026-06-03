// Welcome TUI для первого запуска. Простой консольный выбор провайдеров.
// Запускается ОДИН раз, когда ни один провайдер ещё не залогинен.
// На повторных запусках пропускается.

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AI_FREE_VERSION } from "../config.mjs";
import { listProviders } from "../providers/registry.mjs";

export async function runWelcome() {
  const providers = listProviders();

  console.log("");
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║                                                           ║");
  console.log("║         🐳  Добро пожаловать в AI Free " + `v${AI_FREE_VERSION}`.padEnd(15) + " ║");
  console.log("║                                                           ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");
  console.log("");
  console.log("Выбери AI-провайдеров, которых хочешь подключить.");
  console.log("Можно один, можно несколько — позже добавишь ещё через Settings.");
  console.log("");

  providers.forEach((p, i) => {
    console.log(`  ${i + 1}) ${p.name.padEnd(10)} ${p.description}`);
  });

  console.log("");
  console.log('Введи номера через запятую (например "1" или "1,2"),');
  console.log("или нажми Enter для DeepSeek по умолчанию:");
  console.log("");

  const rl = readline.createInterface({ input, output });
  let raw = "";
  try {
    raw = (await rl.question("> ")).trim();
  } finally {
    rl.close();
  }

  let selected;
  if (!raw) {
    // Enter без ввода = DeepSeek (первый в списке).
    selected = [providers[0]];
  } else {
    const indices = raw
      .split(",")
      .map((s) => parseInt(s.trim(), 10) - 1)
      .filter((n) => n >= 0 && n < providers.length);
    selected = [...new Set(indices)].map((i) => providers[i]);
    if (!selected.length) {
      console.log("\n⚠️ Не понял выбор. Использую DeepSeek по умолчанию.\n");
      selected = [providers[0]];
    }
  }

  console.log("");
  console.log(`Подключаю: ${selected.map((p) => p.name).join(", ")}`);
  console.log("");

  // Запускаем логины последовательно — два окна одновременно запутывают юзера.
  for (const provider of selected) {
    console.log(`\n=== ${provider.name} ===`);
    try {
      await provider.login();
    } catch (error) {
      console.error(`\n❌ Не удалось подключить ${provider.name}: ${error.message}`);
      console.error("   Можно повторить позже через Settings в окне чатов.");
    }
  }

  console.log("");
  console.log("✅ Готово. Запускаю окно чатов...");
  console.log("");
}
