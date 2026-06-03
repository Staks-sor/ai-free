// Хелперы CLI-режима: приветствие, печать ответа, безопасный readline.

export function printWelcome(sessionId, workspaceRoot) {
  console.log("DeepSeek CLI");
  console.log(`Session: ${sessionId}`);
  console.log(`Workspace: ${workspaceRoot}`);
  console.log("Commands: /code task, /ls [path], /workspace, /new, /clear, /exit");
}

export function printAssistantMessage(text) {
  const cleanText = String(text || "").trimEnd();
  console.log("\nDeepSeek:");
  console.log(cleanText || "[empty response]");
}

// readline.question бросает ERR_USE_AFTER_CLOSE, если процесс закрыли пока ждали ввод.
// Перехватываем и возвращаем null — главный цикл интерпретирует как «выход».
export async function askLine(rl, query) {
  try {
    return await rl.question(query);
  } catch (error) {
    if (error?.code === "ERR_USE_AFTER_CLOSE" || error?.message === "readline was closed") {
      return null;
    }
    throw error;
  }
}
