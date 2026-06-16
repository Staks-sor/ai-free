// Главная точка входа в CLI после парсинга args.
// Маршрутизирует: --save-creds / --login / --window / --check / single prompt / REPL.

import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { loadDotEnv, parseArgs } from "../args.mjs";
import { resolveAuth } from "../auth/files.mjs";
import { saveCredentialsInteractive } from "../auth/credentials.mjs";
import { AuthManager } from "../auth/manager.mjs";
import { loginAndSaveAuth, refreshAuthFromProfile } from "../browser/login.mjs";
import { DeepSeekChatClient } from "../providers/deepseek/client.mjs";
import { executeWorkspaceTool } from "../code-agent/executor.mjs";
import { runCodeTask } from "../code-agent/run.mjs";
import { runWindowApp } from "../window-app/server.mjs";
import { askLine, printAssistantMessage, printWelcome } from "./repl.mjs";

export async function run() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  const workspaceRoot = path.resolve(args.workspace);

  if (args.saveCreds) {
    await saveCredentialsInteractive();
    return;
  }

  if (args.login) {
    await loginAndSaveAuth(args.authFile);
    return;
  }

  if (args.loginQwen) {
    const { loginQwenAndSave } = await import("../providers/qwen/browser-login.mjs");
    await loginQwenAndSave();
    return;
  }

  if (args.importQwenFile) {
    const { importQwenFromJson } = await import("../providers/qwen/browser-login.mjs");
    await importQwenFromJson(path.resolve(args.importQwenFile));
    return;
  }

  if (args.acp) {
    const { runAcpServer } = await import("../acp/server.mjs");
    await runAcpServer();
    return;
  }

  if (args.api) {
    const { startOpenAICompatServer } = await import("../../api/server.mjs");
    startOpenAICompatServer({ port: args.apiPort });
    return;
  }

  // Welcome TUI: показывается ТОЛЬКО если ни один провайдер не залогинен,
  // ИЛИ если юзер явно попросил через --welcome (для добавления провайдера).
  const { configuredCount } = await import("../providers/registry.mjs");
  if (args.forceWelcome || configuredCount() === 0) {
    const { runWelcome } = await import("./welcome.mjs");
    await runWelcome();
  }

  // resolveAuth получает callbacks для login и silent-refresh — это избегает
  // цикла зависимостей между src/auth/files.mjs и src/browser/login.mjs.
  const auth = await resolveAuth(args, { loginAndSaveAuth, refreshAuthFromProfile });
  const authManager = new AuthManager({
    authFile: args.authFile,
    debug: args.debug,
    autoVisible: true,
  });
  const client = new DeepSeekChatClient({
    cookieHeader: auth.cookieHeader,
    token: auth.token,
    hifLeim: auth.hifLeim,
    debug: args.debug,
    authManager,
  });

  if (!auth.token) {
    console.log("⚠️ Token missing in cached auth. Triggering re-login...");
    const fresh = await authManager.refresh({ forceVisible: true });
    client._applyAuth(fresh);
  }

  if (args.window) {
    await runWindowApp({
      client,
      workspaceRoot,
      port: args.port,
      modelType: args.model,
      thinkingEnabled: args.thinking,
      searchEnabled: args.search,
      openWindow: !args.noWindow,
      consoleLog: args.noWindow,
    });
    return;
  }

  let sessionId = await client.createSession();
  if (args.check) {
    console.log(`OK: authenticated, created session ${sessionId}`);
    return;
  }

  if (args.prompt) {
    const directCodePrefix = "/code ";
    if (args.prompt.startsWith(directCodePrefix)) {
      await runCodeTask(client, {
        sessionId,
        modelType: args.model,
        thinkingEnabled: args.thinking,
        searchEnabled: args.search,
      }, workspaceRoot, args.prompt.slice(directCodePrefix.length).trim(), null, {
        onTool: (_call, _result, log) => console.log(log),
        onAssistant: (message) => printAssistantMessage(message),
      });
      return;
    }

    const result = await client.complete({
      sessionId,
      prompt: args.prompt,
      modelType: args.model,
      thinkingEnabled: args.thinking,
      searchEnabled: args.search,
      onText: args.stream ? (text) => output.write(text) : null,
    });
    if (!args.stream && result.text) console.log(result.text.trimEnd());
    if (args.stream) output.write("\n");
    return;
  }

  // REPL-цикл: /code, /ls, /workspace, /new, /clear, /exit, иначе обычный prompt.
  printWelcome(sessionId, workspaceRoot);
  const rl = readline.createInterface({ input, output });
  let parentMessageId = null;

  for (;;) {
    const answer = await askLine(rl, "\nYou: ");
    if (answer === null) break;
    const prompt = answer.trim();
    if (!prompt) continue;
    if (["/exit", "exit", "quit"].includes(prompt)) break;
    if (prompt === "/clear") {
      console.clear();
      printWelcome(sessionId, workspaceRoot);
      continue;
    }
    if (prompt === "/workspace") {
      console.log(`Workspace: ${workspaceRoot}`);
      continue;
    }
    if (prompt === "/ls" || prompt.startsWith("/ls ")) {
      const targetPath = prompt.slice(3).trim() || ".";
      try {
        const entries = (await executeWorkspaceTool(workspaceRoot, {
          tool: "list_files",
          path: targetPath,
        })).entries;
        console.log(entries.join("\n") || "[empty]");
      } catch (error) {
        console.error(`Error: ${error.message}`);
      }
      continue;
    }
    if (prompt.startsWith("/code ")) {
      const codeResult = await runCodeTask(client, {
        sessionId,
        modelType: args.model,
        thinkingEnabled: args.thinking,
        searchEnabled: args.search,
      }, workspaceRoot, prompt.slice(6).trim(), parentMessageId, {
        onTool: (_call, _result, log) => console.log(log),
        onAssistant: (message) => printAssistantMessage(message),
      });
      parentMessageId = codeResult.parentMessageId;
      continue;
    }
    if (prompt === "/new") {
      sessionId = await client.createSession();
      parentMessageId = null;
      console.log(`\nNew session: ${sessionId}`);
      continue;
    }

    try {
      const result = await client.complete({
        sessionId,
        prompt,
        parentMessageId,
        modelType: args.model,
        thinkingEnabled: args.thinking,
        searchEnabled: args.search,
        onText: args.stream ? (text) => output.write(text) : null,
      });
      if (!args.stream) printAssistantMessage(result.text);
      else output.write("\n");
      parentMessageId = result.lastAssistantMessageId ?? parentMessageId;
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }

  rl.close();
}
