import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderWindowHtml } from "../src/window-app/ui-html.mjs";

describe("Qwen account settings UI", () => {
  it("manages Qwen accounts without exposing credentials or promising policy bypasses", () => {
    const html = renderWindowHtml({ language: "ru" });

    assert.match(html, /id: "accounts", label: "Аккаунты"/);
    assert.match(html, /function renderQwenAccountsSettings/);
    assert.match(html, /api\("\/api\/accounts\/qwen"\)/);
    assert.match(html, /action: "login"/);
    assert.match(html, /action: "disable"/);
    assert.match(html, /action: "primary"/);
    assert.match(html, /action: "autoSwitch"/);
    assert.match(html, /action: "retry", id: account\.id/);
    assert.match(html, /if \(providerId === "qwen" && account.status === "limited"\)/);
    assert.match(html, /Повторить после лимита/);
    assert.match(html, /вернитесь в чат и напишите «продолжи»/);
    assert.match(html, /Основной для новых задач/);
    assert.match(html, /Основной аккаунт/);
    assert.match(html, /Дополнительный аккаунт/);
    assert.match(html, /Отдельный профиль/);
    assert.match(html, /account\.role === "duplicate"/);
    assert.match(html, /providerLoginStates\.get\(sendProvider\)\?\.error \|\| t\("provider\.tokenMissing"/);
    assert.match(html, /Автопереключение срабатывает только при подтверждённом лимите/);
    assert.match(html, /Сброс лимита неизвестен/);
    assert.match(html, /function renderConnectedAccounts/);
    assert.match(html, /\.providerAccountsPanel \{[^}]*display: grid/);
    assert.match(html, /\.accountsToolbar select \{[^}]*min-height: 40px/);
    assert.match(html, /Выберите AI/);
    assert.match(html, /accountProviderSelect/);
    assert.match(html, /renderQwenAccountsSettings\(panel, providerSelect.value\)/);
    assert.match(html, /action: "rename", id: account.id/);
    assert.match(html, /"Аккаунты " \+ providerLabel/);
    assert.match(html, /data.accounts.*length >= 10/);
    assert.match(html, /accountsPollTimer/);
    assert.match(html, /settingsOverlay\.classList\.contains\("hidden"\)/);
    const accountsRenderer = html.match(/function renderQwenAccountsSettings[\s\S]*?\n    function selectSettingsTab/);
    assert.ok(accountsRenderer, "expected dedicated Qwen account renderer");
    assert.doesNotMatch(accountsRenderer[0], /password|api[_-]?key|токен/i);
  });

  it("keeps account actions readable at the narrow settings breakpoint", () => {
    const html = renderWindowHtml({ language: "ru" });

    assert.match(html, /@media \(max-width: 480px\)[\s\S]*?\.accountActions \{[\s\S]*?grid-template-columns:/);
    assert.match(html, /\.accountActions \.iconBtn \{[\s\S]*?min-width:\s*0/);
  });
});

describe('browser login preparation status',()=>{
 it('shows setup progress and Python recovery without claiming a live connection',()=>{
  const html=renderWindowHtml({language:'ru'});
  assert.match(html,/login\.message \|\|/);assert.match(html,/Вход сохранён/);assert.match(html,/https:\/\/www\.python\.org\/downloads\//);assert.match(html,/login\.code/);
 });
});
