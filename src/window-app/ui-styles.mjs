// Стили окна чатов. Вынесены из ui-html.mjs для удобной навигации.
// При изменении: открой localhost:4317 — проверь, что layout/модалки/чат не поехали.

export const STYLES = `
    :root {
      color-scheme: dark;
      --bg: #0e1116;
      --sidebar: #13171f;
      --panel: #161a23;
      --panel-2: #0f1116;
      --line: rgba(255, 255, 255, 0.05);
      --line-strong: rgba(255, 255, 255, 0.12);
      --text: #edf1f7;
      --muted: #8b96a7;
      --accent: #4d7cff;
      --accent-strong: #7fa0ff;
      --accent-soft: rgba(77, 124, 255, 0.12);
      --bubble: #1c212d;
      --danger: #ff776d;
      --button-bg: #1a1f27;
      --button-hover: #222936;
      --input-bg: #10141a;
      --shadow-soft: rgba(0, 0, 0, 0.22);
    }
    body[data-theme="light"] {
      color-scheme: light;
      --bg: #f6f7fb;
      --sidebar: #ffffff;
      --panel: #ffffff;
      --panel-2: #eef1f6;
      --line: rgba(18, 24, 38, 0.10);
      --line-strong: rgba(18, 24, 38, 0.20);
      --text: #151923;
      --muted: #5b6678;
      --accent: #2557d6;
      --accent-strong: #1746bd;
      --accent-soft: rgba(37, 87, 214, 0.12);
      --bubble: #ffffff;
      --danger: #c9342f;
      --button-bg: #ffffff;
      --button-hover: #eef2f8;
      --input-bg: #ffffff;
      --shadow-soft: rgba(24, 32, 48, 0.12);
    }
    body[data-theme="contrast"] {
      color-scheme: light;
      --bg: #ffffff;
      --sidebar: #f2f2f2;
      --panel: #ffffff;
      --panel-2: #e8e8e8;
      --line: rgba(0, 0, 0, 0.22);
      --line-strong: rgba(0, 0, 0, 0.44);
      --text: #050505;
      --muted: #343434;
      --accent: #0047ff;
      --accent-strong: #002fa8;
      --accent-soft: rgba(0, 71, 255, 0.14);
      --bubble: #ffffff;
      --danger: #b00020;
      --button-bg: #ffffff;
      --button-hover: #e6edff;
      --input-bg: #ffffff;
      --shadow-soft: rgba(0, 0, 0, 0.16);
    }
    * { box-sizing: border-box; }
    html {
      height: 100%;
      overflow: hidden;
      background: var(--bg);
    }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      overflow: hidden;
    }
    button, input, textarea {
      font: inherit;
    }
    ::selection {
      background: rgba(77, 124, 255, 0.35);
    }
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid transparent;
      background-clip: content-box;
      border-radius: 999px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.2);
    }
    .app {
      --sidebar-width: 300px;
      display: grid;
      grid-template-columns: var(--sidebar-width) 6px minmax(0, 1fr);
      height: 100vh;
      width: 100vw;
      overflow: hidden;
    }
    .sidebar {
      background: var(--sidebar);
      display: flex;
      flex-direction: column;
      height: 100vh;
      min-width: 0;
      overflow: hidden;
    }
    .sidebarResizer {
      width: 6px;
      height: 100vh;
      background: var(--panel-2);
      border-left: 1px solid var(--line);
      border-right: 1px solid var(--line);
      cursor: col-resize;
      touch-action: none;
    }
    .sidebarResizer:hover,
    .sidebarResizer.dragging {
      background: var(--accent);
      border-color: var(--accent);
    }
    body.resizingSidebar {
      cursor: col-resize;
      user-select: none;
    }
    .sideHead {
      padding: 14px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .brand {
      font-weight: 700;
      flex: 1;
      min-width: 0;
      color: var(--text);
    }
    .iconBtn, .sendBtn {
      border: 1px solid var(--line);
      background: var(--button-bg);
      color: var(--text);
      height: 36px;
      min-width: 36px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 120ms ease;
    }
    .iconBtn:hover {
      border-color: var(--line-strong);
      background: var(--button-hover);
    }
    .newForm {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 12px 14px 16px;
      display: grid;
      gap: 8px;
      align-content: start;
    }
    .newForm input {
      width: 100%;
      border: 1px solid var(--line);
      background: var(--panel-2);
      color: var(--text);
      border-radius: 6px;
      padding: 9px 10px;
      min-width: 0;
    }
    .newForm input::placeholder,
    textarea::placeholder {
      color: #687181;
    }
    .chatList {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 8px;
      display: grid;
      align-content: start;
      gap: 4px;
    }
    .chatItem {
      border: 1px solid transparent;
      background: transparent;
      color: var(--text);
      border-radius: 6px;
      padding: 10px;
      text-align: left;
      cursor: pointer;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 6px;
      width: 100%;
      transition: all 120ms ease;
    }
    .chatItem:hover { background: rgba(255, 255, 255, 0.03); }
    .chatItem.active {
      background: var(--accent-soft);
      border-color: rgba(77, 124, 255, 0.25);
    }
    .chatTitle {
      font-size: 13px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .chatTitleText {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chatMeta {
      color: var(--muted);
      font-size: 11px;
    }
    .chatDelete {
      width: 26px;
      height: 26px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--muted);
      border-radius: 6px;
      cursor: pointer;
      align-self: center;
      grid-row: 1 / span 2;
      grid-column: 2;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .chatDelete:hover {
      color: var(--danger);
      border-color: rgba(255, 119, 109, 0.2);
      background: rgba(255, 119, 109, 0.08);
    }
    .main {
      display: grid;
      grid-template-rows: auto minmax(120px, 1fr) 6px var(--composer-height, auto);
      min-width: 0;
      height: 100vh;
      min-height: 0;
      background: var(--panel);
      overflow: hidden;
    }
    .composerResizer {
      height: 6px;
      background: var(--panel-2);
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      cursor: row-resize;
      touch-action: none;
    }
    .composerResizer:hover,
    .composerResizer.dragging {
      background: var(--accent);
      border-color: var(--accent);
    }
    body.resizingComposer {
      cursor: row-resize;
      user-select: none;
    }
    .topbar {
      border-bottom: 1px solid var(--line);
      padding: 10px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: var(--sidebar);
    }
    .titleRow {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .title {
      font-weight: 700;
      font-size: 14px;
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .workspace {
      color: var(--muted);
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: none; /* Скрыто в сайдбаре VS Code, путь пишется в титле */
    }
    .settingsBtn {
      font-size: 16px;
      padding: 4px 8px;
    }
    .settingsOverlay {
      position: fixed;
      inset: 0;
      background: rgba(10, 12, 16, 0.65);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      z-index: 1000;
      overflow-y: auto;
      padding: 20px 10px;
    }
    .settingsOverlay.hidden { display: none; }
    .settingsPanel {
      background: #14171e;
      color: var(--text);
      width: min(720px, 92vw);
      max-height: calc(100vh - 40px);
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 24px 64px rgba(0,0,0,0.65);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .settingsHead {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid var(--line);
    }
    .settingsHead h2 {
      margin: 0;
      font-size: 16px;
    }
    .settingsBody {
      overflow-y: auto;
      padding: 12px 20px 20px;
    }
    .settingsShell {
      display: grid;
      grid-template-columns: 150px minmax(0, 1fr);
      gap: 16px;
      min-height: 360px;
    }
    .settingsTabs {
      display: flex;
      flex-direction: column;
      gap: 6px;
      border-right: 1px solid var(--line);
      padding-right: 12px;
    }
    .settingsTab {
      appearance: none;
      border: 1px solid transparent;
      background: transparent;
      color: var(--muted);
      border-radius: 7px;
      padding: 9px 10px;
      text-align: left;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    .settingsTab:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.04);
      border-color: var(--line);
    }
    .settingsTab.active {
      color: var(--text);
      background: rgba(77, 124, 255, 0.14);
      border-color: rgba(77, 124, 255, 0.38);
    }
    .settingsTabContent {
      min-width: 0;
    }
    .settingsTabPanel {
      display: none;
    }
    .settingsTabPanel.active {
      display: grid;
      gap: 18px;
    }
    .settingsGroup h3 {
      margin: 0 0 8px;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--muted);
    }
    .settingsItem {
      display: grid;
      grid-template-columns: 24px 1fr auto;
      gap: 10px;
      align-items: start;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      margin-bottom: 6px;
    }
    .settingsItem input[type="checkbox"] {
      margin-top: 3px;
      width: 18px;
      height: 18px;
    }
    .settingsItem .name {
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-weight: 600;
      font-size: 14px;
    }
    .settingsItem .desc {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
      margin-top: 2px;
    }
    .riskBadge {
      align-self: center;
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 999px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .riskBadge.low    { background: rgba(34,197,94,0.15);  color: #22c55e; border: 1px solid rgba(34,197,94,0.35); }
    .riskBadge.medium { background: rgba(234,179,8,0.15);  color: #eab308; border: 1px solid rgba(234,179,8,0.35); }
    .riskBadge.high   { background: rgba(239,68,68,0.15);  color: #ef4444; border: 1px solid rgba(239,68,68,0.4); }
    .voiceStatusCard {
      display: grid;
      gap: 8px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      margin-bottom: 6px;
    }
    .voiceStatusHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
    }
    .voicePath {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .apiSettings {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
    }
    .apiSettingsGrid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 10px;
      margin-bottom: 10px;
    }
    .apiField {
      min-width: 0;
      display: grid;
      gap: 4px;
    }
    .apiFieldLabel {
      color: var(--muted);
      font-size: 12px;
    }
    .apiField code {
      display: block;
      min-width: 0;
      overflow-wrap: anywhere;
      background: var(--code-bg, #1e1e1e);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 7px 8px;
      font-size: 12px;
    }
    .apiProviderRow {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 4px 0 10px;
    }
    .apiProviderBadge {
      border-radius: 999px;
      border: 1px solid var(--line);
      padding: 4px 8px;
      font-size: 12px;
    }
    .apiProviderBadge.ready {
      color: #22c55e;
      border-color: rgba(34,197,94,0.35);
      background: rgba(34,197,94,0.12);
    }
    .apiProviderBadge.missing {
      color: #eab308;
      border-color: rgba(234,179,8,0.35);
      background: rgba(234,179,8,0.12);
    }
    .apiKeyList {
      display: grid;
      gap: 8px;
      margin: 4px 0 10px;
    }
    .apiKeyRow {
      display: grid;
      grid-template-columns: 80px minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px;
    }
    .apiKeyProvider {
      font-size: 12px;
      font-weight: 600;
    }
    .apiKeyRow code {
      min-width: 0;
      overflow-wrap: anywhere;
      background: var(--code-bg, #1e1e1e);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 6px 8px;
      font-size: 12px;
    }
    .apiKeyBtn {
      border: 1px solid var(--line);
      background: var(--button-bg);
      color: var(--text);
      border-radius: 6px;
      padding: 7px 10px;
      cursor: pointer;
      font-size: 12px;
    }
    .apiKeyBtn:hover:not(:disabled) {
      border-color: var(--line-strong);
    }
    .apiKeyBtn:disabled {
      color: var(--muted);
      cursor: default;
      opacity: 0.8;
    }
    .primaryUpdateBtn {
      border-color: rgba(34, 197, 94, 0.35);
      background: rgba(34, 197, 94, 0.12);
    }
    .primaryUpdateBtn:hover:not(:disabled) {
      border-color: rgba(34, 197, 94, 0.55);
      background: rgba(34, 197, 94, 0.18);
    }
    .updateSettings {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
    }
    .updateStatus {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel-2);
      padding: 9px 10px;
      font-size: 13px;
      margin-bottom: 10px;
    }
    .updateStatus.ready {
      color: #22c55e;
      border-color: rgba(34, 197, 94, 0.35);
      background: rgba(34, 197, 94, 0.10);
    }
    .updateMeta {
      display: grid;
      gap: 7px;
      margin-bottom: 10px;
    }
    .updateMetaRow {
      display: grid;
      grid-template-columns: 90px minmax(0, 1fr);
      gap: 10px;
      align-items: center;
      color: var(--muted);
      font-size: 12px;
    }
    .updateMetaRow code {
      min-width: 0;
      overflow-wrap: anywhere;
      color: var(--text);
      background: var(--code-bg, #1e1e1e);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 6px 8px;
      font-size: 12px;
    }
    .updateActions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 10px;
    }
    .apiModels {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
      overflow-wrap: anywhere;
      margin-bottom: 10px;
    }
    .apiSample {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: var(--code-bg, #1e1e1e);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px;
      color: var(--text);
      font-size: 12px;
      line-height: 1.45;
    }

    .newChatBtn {
      width: 100%;
      padding: 10px;
      font-size: 14px;
      margin: 8px 0;
    }
    .formField {
      display: grid;
      gap: 6px;
      margin-bottom: 14px;
    }
    .formField > span {
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .formField input {
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--text);
      font-size: 14px;
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
    }
    .recentProjects {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 14px;
    }
    .recentProjects .chip {
      cursor: pointer;
      font-size: 12px;
      padding: 4px 10px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: transparent;
      color: var(--muted);
    }
    .recentProjects .chip:hover {
      color: var(--text);
      border-color: var(--text);
    }
    .recentProjects .chip.missing {
      opacity: 0.5;
      text-decoration: line-through;
    }
    .checkboxRow {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 14px;
      font-size: 13px;
      color: var(--muted);
    }
    .formActions {
      display: flex;
      justify-content: flex-end;
    }
    .primaryBtn {
      background: linear-gradient(135deg, #4d7cff, #704dff);
      color: white;
      padding: 8px 18px;
      font-weight: 600;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(77, 124, 255, 0.2);
      transition: all 150ms ease;
    }
    .primaryBtn:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(77, 124, 255, 0.3);
      background: linear-gradient(135deg, #5b87ff, #7f5eff);
    }
    .primaryBtn:active {
      transform: translateY(0);
    }
    .formError {
      margin-top: 10px;
      padding: 10px 12px;
      background: rgba(239,68,68,0.1);
      border: 1px solid rgba(239,68,68,0.35);
      border-radius: 8px;
      color: #ef4444;
      font-size: 13px;
    }
    .formError.hidden { display: none; }
    .chatItem .chatFolder {
      font-size: 11px;
      color: var(--muted);
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pathRow {
      display: flex;
      gap: 8px;
      align-items: stretch;
    }
    .pathRow input {
      flex: 1;
    }
    .pathRow .iconBtn {
      white-space: nowrap;
    }
    .browseSection {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 14px;
      background: #0f1115;
    }
    .browseSection.hidden { display: none; }
    .browsePath {
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 12px;
      color: var(--text);
      margin-bottom: 10px;
      padding: 6px 8px;
      background: rgba(255,255,255,0.04);
      border-radius: 4px;
      word-break: break-all;
    }
    .browseControls {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .checkboxRow.inline {
      margin: 0;
    }
    .browseList {
      max-height: min(42vh, 360px);
      overflow-y: auto;
      display: grid;
      gap: 2px;
      font-size: 13px;
    }
    .browseCount {
      font-size: 11px;
      color: var(--muted);
      margin-bottom: 6px;
    }
    .browseRow {
      text-align: left;
      padding: 6px 10px;
      border-radius: 4px;
      cursor: pointer;
      background: transparent;
      border: 1px solid transparent;
      color: var(--text);
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      display: block;
      width: 100%;
    }
    .browseRow:hover {
      background: rgba(255,255,255,0.05);
      border-color: var(--line);
    }
    .browseEmpty {
      color: var(--muted);
      font-size: 13px;
      padding: 8px;
      text-align: center;
    }
    .browseTruncated {
      margin-top: 6px;
      font-size: 11px;
      color: var(--muted);
      font-style: italic;
    }
    .browseTruncated.hidden { display: none; }
    .createFolderRow {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 8px;
    }
    .createFolderRow.hidden { display: none; }
    .createFolderRow input {
      flex: 1;
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--text);
      font-size: 13px;
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
    }
    .messages {
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 22px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      background: var(--panel);
    }
    .empty {
      margin: auto;
      color: var(--muted);
      text-align: center;
      max-width: 420px;
      line-height: 1.5;
      font-size: 13px;
    }
    .msg {
      max-width: min(860px, 92%);
      display: grid;
      gap: 4px;
    }
    .msg.user {
      align-self: flex-end;
    }
    .msg.assistant {
      align-self: flex-start;
    }
    .role {
      font-size: 11px;
      color: var(--muted);
      font-weight: 600;
      margin-bottom: 2px;
    }
    .bubble {
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 12px;
      padding: 12px 16px;
      line-height: 1.5;
      font-size: 14px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: var(--bubble);
      color: var(--text);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
      transition: all 120ms ease;
    }
    .user .bubble {
      background: linear-gradient(135deg, #3b66ff, #5c4dff);
      color: #fff;
      border: none;
      box-shadow: 0 4px 16px rgba(77, 124, 255, 0.2);
    }
    .installRequest .bubble {
      border: 1px solid rgba(245, 158, 11, 0.38);
      background: rgba(245, 158, 11, 0.10);
    }
    .questionRequest .bubble {
      border: 1px solid rgba(77, 124, 255, 0.38);
      background: var(--accent-soft);
    }
    .installTitle {
      font-weight: 700;
      margin-bottom: 6px;
    }
    .installText {
      color: var(--muted);
      margin-bottom: 8px;
    }
    .installActions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 12px;
    }
    .installLog {
      margin: 10px 0 0;
      padding: 10px;
      max-height: 220px;
      overflow: auto;
      border-radius: 6px;
      border: 1px solid var(--line);
      background: var(--panel-2);
      color: var(--text);
      white-space: pre-wrap;
      font-size: 12px;
      line-height: 1.4;
    }
    .composer {
      padding: 12px 18px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: var(--panel-2);
      height: 100%;
      min-height: 0;
      box-sizing: border-box;
    }
    .bottomBar { display: flex; flex-direction: column; min-height: 0; height: 100%; }
    .main.composerSized #messageInput {
      flex: 1 1 0;
      max-height: none;
      height: auto;
      resize: none;
    }
    .composerControls {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .composerSpacer { flex: 1; }
    .bottomBar {
      border-top: 1px solid var(--line);
      background: var(--panel-2);
    }
    .titleRow {
      display: flex;
      align-items: center;
      gap: 10px;
      grid-column: 1;
      grid-row: 1;
      min-width: 0;
    }
    .titleRow .title {
      grid-column: unset;
      grid-row: unset;
    }
    .modeBadge {
      font-size: 11px;
      padding: 3px 10px;
      border-radius: 999px;
      font-weight: 700;
      background: rgba(82, 126, 255, 0.14);
      color: #aabfff;
      border: 1px solid rgba(82, 126, 255, 0.4);
      white-space: nowrap;
      flex-shrink: 0;
    }
    .modeBadge.hidden { display: none; }

    .modelPicker,
    .rolePicker {
      font-size: 11px;
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid var(--line);
      background: var(--input-bg);
      color: var(--text);
      cursor: pointer;
      max-width: 200px;
      font-weight: 600;
    }
    .modelPicker.hidden,
    .rolePicker.hidden { display: none; }
    .modelPicker:hover,
    .rolePicker:hover { border-color: var(--line-strong); }
    .rolePicker { max-width: 150px; }

    .coderToggle {
      font-size: 11px;
      padding: 4px 12px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      font-weight: 600;
      transition: all 120ms;
    }
    .coderToggle.hidden { display: none; }
    .coderToggle:hover { color: var(--text); border-color: var(--line-strong); }
    .coderToggle.active {
      background: rgba(168, 85, 247, 0.14);
      color: #d8b4fe;
      border-color: rgba(168, 85, 247, 0.45);
    }
    .hardwareToggle.active {
      background: rgba(245, 158, 11, 0.16);
      color: #fbbf24;
      border-color: rgba(245, 158, 11, 0.50);
    }
    .pipelineToggle.active {
      background: rgba(20, 184, 166, 0.18);
      color: #5eead4;
      border-color: rgba(20, 184, 166, 0.45);
    }
    body[data-theme="light"] .coderToggle.active,
    body[data-theme="contrast"] .coderToggle.active {
      color: #6d28d9;
    }
    body[data-theme="light"] .hardwareToggle.active,
    body[data-theme="contrast"] .hardwareToggle.active {
      color: #92400e;
    }
    .pipelinePanelBtn {
      position: absolute;
      right: 58px;
      top: 10px;
    }
    .pipelinePanel {
      position: absolute;
      top: 58px;
      right: 14px;
      z-index: 20;
      width: min(720px, calc(100% - 28px));
      max-height: min(560px, calc(100% - 150px));
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.34);
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
    }
    .pipelinePanel.hidden { display: none; }
    .pipelineHead {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      padding: 14px;
      border-bottom: 1px solid var(--line);
    }
    .pipelineTitle {
      font-size: 14px;
      font-weight: 800;
    }
    .pipelineSub {
      margin-top: 3px;
      color: var(--muted);
      font-size: 12px;
    }
    .pipelineBody {
      overflow: auto;
      padding: 10px;
      display: grid;
      gap: 8px;
    }
    .pipelineRow {
      display: grid;
      grid-template-columns: minmax(160px, 1fr) minmax(130px, 160px) minmax(150px, 220px);
      gap: 8px;
      align-items: center;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--bg-soft);
    }
    .pipelineNodeMeta { min-width: 0; }
    .pipelineNodeTitle {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      font-weight: 700;
    }
    .pipelineNodeSub {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: 3px;
      color: var(--muted);
      font-size: 11px;
    }
    .pipelineSelect {
      width: 100%;
      min-width: 0;
      height: 32px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--input-bg);
      color: var(--text);
      font-size: 12px;
      padding: 0 8px;
    }
    .smallEmpty {
      padding: 20px;
      font-size: 13px;
    }
    .modeBadge.fast    { background: rgba(82, 126, 255, 0.14); color: #aabfff; border-color: rgba(82, 126, 255, 0.4); }
    .modeBadge.expert  { background: rgba(168, 85, 247, 0.14); color: #d8b4fe; border-color: rgba(168, 85, 247, 0.4); }
    .modeBadge.vision  { background: rgba(34, 197, 94, 0.14);  color: #86efac; border-color: rgba(34, 197, 94, 0.4); }

    .providerBadge {
      display: inline-flex;
      align-items: center;
      flex: 0 0 auto;
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 3px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .providerBadge.deepseek {
      background: rgba(77, 124, 255, 0.12);
      color: #7fa0ff;
      border: 1px solid rgba(77, 124, 255, 0.3);
    }
    .providerBadge.qwen {
      background: rgba(251, 146, 60, 0.12);
      color: #fca5a5;
      border: 1px solid rgba(251, 146, 60, 0.3);
    }
    @keyframes taskSpin { to { transform: rotate(360deg); } }
    .chatItem.running .chatTitle { color: #cbd5ff; font-weight: 700; }

    .providerPicker {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .providerOption {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      padding: 12px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.02);
      border-radius: 8px;
      cursor: pointer;
      transition: all 150ms ease;
      text-align: left;
      color: var(--text);
    }
    .providerOption:hover {
      border-color: rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.05);
    }
    .providerOption.active.deepseek {
      background: rgba(77, 124, 255, 0.12);
      border-color: rgba(77, 124, 255, 0.5);
      box-shadow: 0 0 12px rgba(77, 124, 255, 0.15);
    }
    .providerOption.active.qwen {
      background: rgba(251, 146, 60, 0.12);
      border-color: rgba(251, 146, 60, 0.5);
      box-shadow: 0 0 12px rgba(251, 146, 60, 0.15);
    }
    .providerOption.disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .providerOptionTitle {
      font-weight: 700;
      font-size: 14px;
    }
    .providerOptionSub {
      font-size: 11px;
      color: var(--muted);
    }

    .modePicker {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 8px;
    }
    .modeOption {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      padding: 12px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.02);
      border-radius: 8px;
      cursor: pointer;
      transition: all 150ms ease;
      text-align: left;
      color: var(--text);
    }
    .modeOption:hover {
      border-color: rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.05);
    }
    .modeOption.active {
      background: rgba(77, 124, 255, 0.12);
      border-color: rgba(77, 124, 255, 0.5);
      box-shadow: 0 0 12px rgba(77, 124, 255, 0.15);
    }
    .modeOptionTitle {
      font-weight: 700;
      font-size: 14px;
    }
    .modeOptionSub {
      font-size: 11px;
      color: var(--muted);
    }
    .modeHint {
      font-size: 11px;
      color: var(--muted);
      line-height: 1.4;
    }
    .attachBtn,
    .voiceBtn { font-size: 12px; }
    .voiceBtn.active {
      background: rgba(239, 68, 68, 0.16);
      color: #fca5a5;
      border-color: rgba(239, 68, 68, 0.50);
    }

    .attachmentList {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .attachmentList:empty { display: none; }
    .attachChip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px 4px 10px;
      background: rgba(82, 126, 255, 0.08);
      border: 1px solid rgba(82, 126, 255, 0.3);
      border-radius: 999px;
      font-size: 12px;
      color: var(--text);
    }
    .attachChip .name {
      font-weight: 600;
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .attachChip .size {
      color: var(--muted);
      font-size: 11px;
    }
    .attachChip .remove {
      cursor: pointer;
      color: var(--muted);
      background: transparent;
      border: none;
      padding: 0 4px;
      font-size: 14px;
    }
    .attachChip .remove:hover { color: #ef4444; }
    textarea {
      border: 1px solid var(--line);
      background: var(--input-bg);
      color: var(--text);
      border-radius: 10px;
      padding: 12px;
      line-height: 1.45;
      width: 100%;
      box-sizing: border-box;
      transition: all 150ms ease;
      box-shadow: inset 0 2px 4px var(--shadow-soft);
      resize: vertical;
      min-height: 56px;
      max-height: 60vh;
    }
    textarea:focus {
      outline: none;
      border-color: rgba(77, 124, 255, 0.4);
      box-shadow: inset 0 2px 4px var(--shadow-soft), 0 0 12px var(--accent-soft);
      background: var(--input-bg);
    }
    #messageInput { min-height: 72px; }
    .sendBtn {
      height: 36px;
      width: 36px;
      border: none;
      background: linear-gradient(135deg, #3b82f6, #2563eb);
      color: #fff;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 700;
      box-shadow: 0 4px 10px rgba(59, 130, 246, 0.2);
      transition: all 150ms ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .sendBtn:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 6px 14px rgba(59, 130, 246, 0.3);
      background: linear-gradient(135deg, #4f46e5, #3b82f6);
    }
    .sendBtn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .status {
      color: var(--muted);
      font-size: 12px;
      min-height: 16px;
      padding: 0 18px 12px;
      background: var(--panel-2);
    }
    .error { color: var(--danger); }

    /* Ссылка войти заново / переподключить */
    .reconnectLink {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 4px;
      margin-top: 4px;
      cursor: pointer;
      transition: all 120ms ease;
      text-transform: none;
      border: 1px solid transparent;
    }
    .reconnectLink.success {
      color: #22c55e;
      background: rgba(34, 197, 94, 0.12);
      border-color: rgba(34, 197, 94, 0.35);
    }
    .reconnectLink.success:hover {
      color: #fff;
      background: rgba(34, 197, 94, 0.25);
      border-color: rgba(34, 197, 94, 0.5);
    }
    .reconnectLink.danger {
      color: #ff776d;
      background: rgba(255, 119, 109, 0.12);
      border-color: rgba(255, 119, 109, 0.35);
    }
    .reconnectLink.danger:hover {
      color: #fff;
      background: rgba(255, 119, 109, 0.25);
      border-color: rgba(255, 119, 109, 0.5);
    }

    .togglePill {
      font-size: 11px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      background: rgba(255, 255, 255, 0.02);
      color: var(--muted);
      cursor: pointer;
      transition: all 150ms ease;
    }
    .togglePill:hover {
      color: var(--text);
      border-color: rgba(255, 255, 255, 0.15);
      background: rgba(255, 255, 255, 0.05);
    }
    .togglePill.active {
      color: #fff;
      background: rgba(77, 124, 255, 0.2);
      border-color: rgba(77, 124, 255, 0.45);
      box-shadow: 0 2px 8px rgba(77, 124, 255, 0.15);
    }

    /* Адаптивный дизайн для боковой панели VS Code (экраны до 480px) */
    @media (max-width: 480px) {
      .settingsOverlay {
        align-items: stretch;
        justify-content: stretch;
        background: var(--sidebar);
      }
      .settingsPanel {
        width: 100vw;
        height: 100vh;
        max-height: 100vh;
        border-radius: 0;
        border: none;
        box-shadow: none;
      }
      .settingsHead {
        padding: 12px 14px;
      }
      .settingsBody {
        padding: 10px 12px 18px;
      }
      .settingsShell {
        grid-template-columns: 1fr;
        gap: 12px;
      }
      .settingsTabs {
        flex-direction: row;
        overflow-x: auto;
        border-right: none;
        border-bottom: 1px solid var(--line);
        padding: 0 0 10px;
      }
      .settingsTab {
        flex: 0 0 auto;
        white-space: nowrap;
      }
      .newForm {
        padding: 10px 12px 24px;
        gap: 10px;
      }
      .formField {
        margin-bottom: 6px;
      }
      .providerPicker {
        grid-template-columns: 1fr;
        gap: 6px;
      }
      .modePicker {
        grid-template-columns: 1fr;
        gap: 6px;
      }
      .providerOption, .modeOption {
        padding: 10px 12px;
        border-radius: 8px;
        flex-direction: row;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
      }
      .providerOptionSub, .modeOptionSub {
        width: 100%;
        margin-top: 2px;
      }
      .checkboxRow {
        margin-bottom: 10px;
        font-size: 12px;
      }
      .formActions {
        margin-top: 6px;
        justify-content: stretch;
      }
      .formActions button {
        width: 100%;
        height: 40px;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
    }
`;
