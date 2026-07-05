import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  buildTelegramConversationKeyboard,
  buildTelegramDirectoryKeyboard,
  buildTelegramChatActionsKeyboard,
  buildTelegramProjectKeyboard,
  buildTelegramQuestionKeyboard,
  formatTelegramConversationList,
  formatTelegramDirectoryBrowser,
  formatTelegramProjectList,
  formatTelegramQuestion,
  isTelegramChatAllowed,
  parseTelegramCommand,
  resolveTelegramConversationSelector,
  resolveTelegramProviderAndTitle,
} from "../src/telegram/bot.mjs";

describe("telegram bot helpers", () => {
  it("parses bot commands with mentions and args", () => {
    assert.deepEqual(parseTelegramCommand("/new@ai_free_bot qwen test chat"), {
      command: "new",
      args: "qwen test chat",
    });
    assert.equal(parseTelegramCommand("hello"), null);
  });

  it("allows unbound chats and blocks mismatched bound chats", () => {
    assert.equal(isTelegramChatAllowed({ telegram: { chatId: "" } }, 123), true);
    assert.equal(isTelegramChatAllowed({ telegram: { chatId: "123" } }, 123), true);
    assert.equal(isTelegramChatAllowed({ telegram: { chatId: "123" } }, 456), false);
  });

  it("resolves provider and title for /new", () => {
    assert.deepEqual(resolveTelegramProviderAndTitle("qwen frontend review"), {
      provider: "qwen",
      title: "frontend review",
    });
    assert.deepEqual(resolveTelegramProviderAndTitle("plain title"), {
      provider: "deepseek",
      title: "plain title",
    });
  });

  it("formats a compact chat list", () => {
    const text = formatTelegramConversationList([
      { id: "a", provider: "deepseek", title: "Main" },
      { id: "b", provider: "qwen", title: "Review" },
    ], "b");
    assert.match(text, /1\. \[deepseek\] Main/);
    assert.match(text, /2\. \[qwen\] Review/);
    assert.doesNotMatch(text, /> 2\. \[qwen\] Review/);
    assert.doesNotMatch(text, /\/select 2/);
  });

  it("builds inline chat selection buttons", () => {
    const keyboard = buildTelegramConversationKeyboard([
      { id: "a", provider: "deepseek", title: "Main" },
      { id: "b", provider: "qwen", title: "Review" },
    ]);
    assert.equal(keyboard.inline_keyboard[0][0].callback_data, "select:a");
    assert.equal(keyboard.inline_keyboard[1][0].callback_data, "select:b");
    assert.match(keyboard.inline_keyboard[0][0].text, /deepseek/);
  });

  it("builds project selection buttons for new Telegram chats", () => {
    const keyboard = buildTelegramProjectKeyboard([
      { path: "/tmp/main", name: "main" },
      { path: "/tmp/second", name: "second" },
    ]);
    assert.equal(keyboard.inline_keyboard[0][0].callback_data, "project:0");
    assert.equal(keyboard.inline_keyboard[1][0].callback_data, "project:1");
    assert.equal(keyboard.inline_keyboard[2][0].callback_data, "project:new");
    assert.equal(keyboard.inline_keyboard[3][0].callback_data, "cancel-new");
  });

  it("formats project list for Telegram", () => {
    const text = formatTelegramProjectList([
      { path: "/Users/test/main", name: "main", isDefault: true },
    ]);
    assert.match(text, /Выбери проект/);
    assert.match(text, /main \*/);
    assert.match(text, /\/Users\/test\/main/);
  });

  it("builds directory browser buttons for Telegram project selection", () => {
    const keyboard = buildTelegramDirectoryKeyboard({
      parent: "/Users/test",
      entries: [
        { name: "alpha", path: "/Users/test/alpha" },
        { name: "beta", path: "/Users/test/beta" },
      ],
    });
    assert.equal(keyboard.inline_keyboard[0][0].callback_data, "browse:select");
    assert.equal(keyboard.inline_keyboard[1][0].callback_data, "browse:dir:0");
    assert.equal(keyboard.inline_keyboard[2][0].callback_data, "browse:dir:1");
    assert.equal(keyboard.inline_keyboard[3][0].callback_data, "browse:up");
    assert.equal(keyboard.inline_keyboard[3][1].callback_data, "browse:mkdir");
  });

  it("formats directory browser listing for Telegram", () => {
    const text = formatTelegramDirectoryBrowser({
      path: "/Users/test",
      entries: [{ name: "alpha" }],
    });
    assert.match(text, /Выбери папку/);
    assert.match(text, /\/Users\/test/);
    assert.match(text, /1\. alpha/);
  });

  it("builds active chat action buttons", () => {
    const keyboard = buildTelegramChatActionsKeyboard();
    assert.equal(keyboard.inline_keyboard[0][0].callback_data, "chats");
    assert.equal(keyboard.inline_keyboard[0][1].callback_data, "close");
  });

  it("builds ask_user question buttons", () => {
    const keyboard = buildTelegramQuestionKeyboard("chat-1", {
      choices: ["Анимация и эффекты", "Мобильная адаптация"],
    });
    assert.equal(keyboard.inline_keyboard[0][0].callback_data, "q:chat-1:0");
    assert.equal(keyboard.inline_keyboard[1][0].callback_data, "q:chat-1:1");
    assert.equal(keyboard.inline_keyboard[2][0].callback_data, "noop");
    assert.equal(keyboard.inline_keyboard[3][0].callback_data, "chats");
    assert.equal(keyboard.inline_keyboard[3][1].callback_data, "close");
  });

  it("formats ask_user questions for Telegram", () => {
    const text = formatTelegramQuestion({
      question: "Что хочешь добавить в проект?",
      details: "У нас уже есть main.py и index.html.",
      choices: ["Анимация и эффекты"],
    });
    assert.match(text, /Что хочешь добавить/);
    assert.match(text, /main\.py/);
    assert.match(text, /Выбери вариант/);
  });

  it("does not treat UUIDs that start with digits as numeric indexes", () => {
    const conversations = [
      { id: "a", title: "first" },
      { id: "48be7a49-3b51-4e89-954b-c9787edf729b", title: "uuid" },
    ];
    assert.equal(resolveTelegramConversationSelector(conversations, "1")?.title, "first");
    assert.equal(
      resolveTelegramConversationSelector(conversations, "48be7a49-3b51-4e89-954b-c9787edf729b")?.title,
      "uuid",
    );
  });
});
