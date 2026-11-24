// Стили окна чатов. Вынесены из ui-html.mjs для удобной навигации.
// При изменении: открой localhost:4317 — проверь, что layout/модалки/чат не поехали.

export const STYLES = `
    :root {
      color-scheme: dark;
      --bg: #0e1116;
      --sidebar: #13171f;
      --panel: #161a23;
      --panel-2: #0f1116;
      --topbar-bg: #13171f;
      --message-bg: #161a23;
      --composer-bg: #0f1116;
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
      --modal-bg: #14171e;
      --overlay-bg: rgba(10, 12, 16, 0.65);
      --overlay-strong: rgba(10, 12, 16, 0.82);
      --surface-subtle: rgba(255, 255, 255, 0.02);
      --surface-hover: rgba(255, 255, 255, 0.05);
      --surface-inset: rgba(0, 0, 0, 0.14);
      --scroll-thumb: rgba(255, 255, 255, 0.12);
      --scroll-thumb-hover: rgba(255, 255, 255, 0.22);
      --modal-shadow: 0 24px 64px rgba(0, 0, 0, 0.65);
      --drawer-shadow: -12px 0 40px rgba(0, 0, 0, 0.35);
      --blue-text: #aabfff;
      --purple-text: #d8b4fe;
      --teal-text: #99f6e4;
      --green-text: #86efac;
      --orange-text: #fbbf24;
      --pink-text: #f9a8d4;
    }
    body[data-theme="light"] {
      color-scheme: light;
      --bg: #e5ebf3;
      --sidebar: #f1f5f9;
      --panel: #f8fafc;
      --panel-2: #eaf0f6;
      --topbar-bg: #ffffff;
      --message-bg: #f8fafc;
      --composer-bg: #eaf0f6;
      --line: rgba(38, 51, 70, 0.13);
      --line-strong: rgba(38, 51, 70, 0.24);
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
      --modal-bg: #ffffff;
      --overlay-bg: rgba(35, 43, 58, 0.38);
      --overlay-strong: rgba(35, 43, 58, 0.55);
      --surface-subtle: rgba(18, 24, 38, 0.025);
      --surface-hover: rgba(18, 24, 38, 0.065);
      --surface-inset: rgba(18, 24, 38, 0.045);
      --scroll-thumb: rgba(18, 24, 38, 0.20);
      --scroll-thumb-hover: rgba(18, 24, 38, 0.34);
      --modal-shadow: 0 24px 64px rgba(24, 32, 48, 0.24);
      --drawer-shadow: -12px 0 40px rgba(24, 32, 48, 0.18);
      --blue-text: #1d4ed8;
      --purple-text: #6d28d9;
      --teal-text: #0f766e;
      --green-text: #15803d;
      --orange-text: #92400e;
      --pink-text: #be185d;
      --code-bg: #f3f5f9;
    }
    body[data-theme="contrast"] {
      color-scheme: light;
      --bg: #ffffff;
      --sidebar: #f2f2f2;
      --panel: #ffffff;
      --panel-2: #e8e8e8;
      --topbar-bg: #ffffff;
      --message-bg: #ffffff;
      --composer-bg: #e8e8e8;
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
      --modal-bg: #ffffff;
      --overlay-bg: rgba(0, 0, 0, 0.46);
      --overlay-strong: rgba(0, 0, 0, 0.62);
      --surface-subtle: rgba(0, 0, 0, 0.03);
      --surface-hover: rgba(0, 0, 0, 0.08);
      --surface-inset: rgba(0, 0, 0, 0.06);
      --scroll-thumb: rgba(0, 0, 0, 0.30);
      --scroll-thumb-hover: rgba(0, 0, 0, 0.48);
      --modal-shadow: 0 24px 64px rgba(0, 0, 0, 0.28);
      --drawer-shadow: -12px 0 40px rgba(0, 0, 0, 0.22);
      --blue-text: #003db8;
      --purple-text: #5b21b6;
      --teal-text: #00695c;
      --green-text: #006b2d;
      --orange-text: #7c2d12;
      --pink-text: #9d174d;
      --code-bg: #f0f0f0;
    }
    * { box-sizing: border-box; }
    html {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--bg);
    }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      width: 100%;
      height: 100%;
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
      background: var(--scroll-thumb);
      border: 1px solid transparent;
      background-clip: content-box;
      border-radius: 999px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: var(--scroll-thumb-hover);
    }
    .app {
      --sidebar-width: 300px;
      display: grid;
      grid-template-columns: var(--sidebar-width) 6px minmax(0, 1fr);
      height: 100%;
      width: 100%;
      max-width: 100%;
      overflow: hidden;
      transition: width 0.12s ease, max-width 0.12s ease;
    }
    .sidebar {
      background: var(--sidebar);
      position: relative;
      display: flex;
      flex-direction: column;
      height: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
    .sidebarMenu {
      display: flex;
      gap: 4px;
      padding: 8px 8px 6px;
      border-bottom: 1px solid var(--line);
      flex: 0 0 auto;
    }
    .sidebarMenuBtn {
      flex: 1;
      min-width: 0;
      border: 1px solid var(--line);
      background: var(--button-bg);
      color: var(--muted);
      border-radius: 6px;
      padding: 6px 8px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      transition: all 120ms ease;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sidebarMenuBtn:hover {
      color: var(--text);
      border-color: var(--line-strong);
      background: var(--button-hover);
    }
    .sidebarResizer {
      width: 6px;
      height: 100%;
      min-height: 0;
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
    .updateToast {
      position: absolute;
      left: 12px;
      right: 12px;
      top: 104px;
      z-index: 25;
      border: 1px solid rgba(34, 197, 94, 0.45);
      background: color-mix(in srgb, var(--panel) 92%, #16a34a);
      box-shadow: 0 14px 34px rgba(0, 0, 0, 0.32);
      border-radius: 8px;
      padding: 12px;
      display: grid;
      gap: 7px;
      animation: updateToastPop 260ms ease-out;
    }
    .updateToast.hidden { display: none; }
    .updateToastTitle {
      padding-right: 24px;
      color: var(--text);
      font-size: 13px;
      font-weight: 800;
      line-height: 1.25;
    }
    .updateToastMeta,
    .updateToastStatus {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .updateToastStatus:empty { display: none; }
    .updateToastClose {
      position: absolute;
      top: 7px;
      right: 7px;
      width: 26px;
      height: 26px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--muted);
      border-radius: 6px;
      cursor: pointer;
    }
    .updateToastClose:hover {
      color: var(--text);
      background: var(--button-hover);
      border-color: var(--line);
    }
    .updateToastDownload {
      height: 34px;
      border: 1px solid rgba(34, 197, 94, 0.58);
      background: rgba(34, 197, 94, 0.18);
      color: #86efac;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 900;
      cursor: pointer;
    }
    .updateToastDownload:hover:not(:disabled) {
      background: rgba(34, 197, 94, 0.26);
      border-color: rgba(34, 197, 94, 0.78);
    }
    .updateToastDownload:disabled {
      cursor: default;
      opacity: 0.74;
    }
    @keyframes updateToastPop {
      from { opacity: 0; transform: translateY(-8px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .taskPanelContent { padding: 20px; overflow: auto; min-height: 0; }
    .taskCards { display: grid; gap: 12px; margin-top: 16px; }
    .taskCard { padding: 14px; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--panel); min-width: 0; overflow-wrap: anywhere; }
    .taskCard h3 { font-size: 15px; margin: 0 0 8px; }
    .taskCard p { margin: 8px 0; }
    .taskMeta { color: var(--muted); font-size: 12px; }
    .taskStatus { font-weight: 600; }
    .taskVerification[data-result="passed"] { color: var(--accent-strong); }
    .taskVerification[data-result="failed"] { color: #f09292; }
    .taskActions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .taskActions button { min-height: 40px; }
    .taskCard details { font-size: 12px; }
    .taskCard details summary { cursor: pointer; min-height: 32px; }
    .newForm input, .newForm select {
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
      padding: 4px 6px;
      display: grid;
      align-content: start;
      gap: 2px;
    }
    .chatItem {
      border: 1px solid transparent;
      background: transparent;
      color: var(--text);
      border-radius: 5px;
      padding: 5px 6px;
      text-align: left;
      cursor: pointer;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 18px;
      gap: 1px 4px;
      width: 100%;
      transition: all 120ms ease;
    }
    .chatItem:hover { background: var(--surface-hover); }
    .chatItem.active {
      background: var(--accent-soft);
      border-color: rgba(77, 124, 255, 0.25);
    }
    .chatItem.completed {
      background: var(--accent-soft);
      border-color: var(--accent-strong);
    }
    .chatTitle {
      font-size: 12px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
      grid-column: 1;
    }
    .chatTitleText {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chatSubline {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      grid-column: 1;
    }
    .chatMeta {
      color: var(--muted);
      font-size: 10px;
      flex: 0 0 auto;
    }
    .chatDelete {
      width: 18px;
      height: 18px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--muted);
      border-radius: 4px;
      cursor: pointer;
      align-self: center;
      grid-row: 1 / span 2;
      grid-column: 2;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      line-height: 1;
      padding: 0;
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
      height: 100%;
      min-height: 0;
      background: var(--message-bg);
      overflow: hidden;
      position: relative;
      isolation: isolate;
    }
    .chatWatermark {
      position: absolute;
      top: 47%;
      left: 50%;
      z-index: 0;
      width: min(48%, 520px);
      aspect-ratio: 4 / 3;
      transform: translate(-50%, -50%);
      background-image: url("/assets/synvox-watermark.png");
      background-position: center;
      background-repeat: no-repeat;
      background-size: contain;
      opacity: 0.045;
      filter: grayscale(1);
      pointer-events: none;
      user-select: none;
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
      padding: 8px 12px;
      display: grid;
      grid-template-columns: minmax(120px, 1fr) minmax(0, auto) auto;
      align-items: center;
      gap: 8px;
      background: var(--topbar-bg);
      min-width: 0;
    }
    .titleRow {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .topbarTitle {
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      overflow: hidden;
    }
    .title {
      font-weight: 700;
      font-size: 14px;
      color: var(--text);
      max-width: 100%;
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
      max-width: 100%;
      display: none;
    }
    .topbarControls,
    .topbarActions {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .topbarControls {
      justify-content: flex-end;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .topbarControls::-webkit-scrollbar { display: none; }
    .topbarActions {
      justify-content: flex-end;
      flex-shrink: 0;
      padding-left: 4px;
      border-left: 1px solid var(--line);
    }
    .topbar .iconBtn {
      font-size: 12px;
      line-height: 1;
      white-space: nowrap;
      flex-shrink: 0;
      height: 28px;
      min-width: 28px;
      padding: 0 8px;
    }
    .tourBtn { min-width: 88px; font-weight: 700; }
    .tourRoot { position: fixed; inset: 0; z-index: 95; overflow: hidden; }
    .tourSpotlight {
      position: fixed;
      border: 2px solid var(--accent-strong);
      border-radius: 10px;
      box-shadow: 0 0 0 9999px rgba(5, 8, 14, 0.72), 0 0 0 4px rgba(77, 124, 255, 0.18);
      pointer-events: none;
      transition: left 180ms ease, top 180ms ease, width 180ms ease, height 180ms ease;
    }
    .tourCard {
      position: fixed;
      width: min(360px, calc(100vw - 24px));
      display: grid;
      gap: 10px;
      padding: 18px;
      border: 1px solid var(--line-strong);
      border-radius: 12px;
      background: var(--modal-bg);
      box-shadow: var(--modal-shadow);
    }
    .tourProgress { color: var(--accent-strong); font-size: 11px; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase; }
    .tourCard h2 { margin: 0; font-size: 18px; line-height: 1.25; }
    .tourCard p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.55; }
    .tourActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
    .tourActions .iconBtn { min-height: 40px; }
    .tourCard :focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
    @media (max-width: 640px) {
      .tourBtn { min-width: 0; }
      .tourCard { width: calc(100vw - 24px); }
      .tourActions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .tourActions:has(button[hidden]) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .tourActions .iconBtn { width: 100%; min-width: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .tourSpotlight { transition: none; }
    }
    .settingsBtn {
      font-size: 16px;
    }
    .quitBtn {
      font-size: 15px;
      color: #f87171;
    }
    .quitBtn:hover { color: #fca5a5; }
    .shutdownOverlay {
      position: fixed;
      inset: 0;
      background: var(--overlay-strong);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
    }
    .shutdownOverlay.hidden { display: none; }
    .shutdownPanel {
      text-align: center;
      padding: 32px 40px;
      border-radius: 12px;
      border: 1px solid var(--line-strong);
      background: var(--modal-bg);
      box-shadow: var(--modal-shadow);
      max-width: min(420px, 90vw);
    }
    .shutdownTitle {
      font-size: 18px;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 10px;
    }
    .shutdownSub {
      font-size: 13px;
      color: var(--muted);
      line-height: 1.5;
    }
    .settingsOverlay {
      position: fixed;
      inset: 0;
      background: var(--overlay-bg);
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
    .confirmOverlay {
      align-items: center;
    }
    #updateConfirmOverlay {
      z-index: 3000;
    }
    .confirmPanel {
      width: min(420px, 92vw);
    }
    .confirmBody {
      padding: 18px 20px 20px;
    }
    .confirmBody p {
      margin: 0 0 12px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }
    .confirmMessage {
      white-space: pre-line;
    }
    .confirmTarget {
      margin-bottom: 18px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel-2);
      color: var(--text);
      font-size: 13px;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .confirmActions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .settingsPanel {
      background: var(--modal-bg);
      color: var(--text);
      width: min(720px, 92vw);
      max-height: calc(100vh - 40px);
      border-radius: 10px;
      border: 1px solid var(--line-strong);
      box-shadow: var(--modal-shadow);
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
      background: var(--surface-hover);
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
    .accountsHeader h3 {
      margin: 0 0 5px;
      font-size: 15px;
      color: var(--text);
    }
    .accountsHeader p, .accountsNotice, .accountsEmpty {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .accountsNotice {
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface-subtle);
    }
    .accountsToolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .accountActions {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 8px;
      flex: none;
    }
    .accountsToolbar .iconBtn, .accountActions .iconBtn {
      min-width: 0;
      min-height: 40px;
      height: auto;
      padding: 8px 10px;
      line-height: 1.25;
      overflow-wrap: anywhere;
      white-space: normal;
    }
    .accountsProgress {
      padding: 9px 11px;
      border: 1px solid rgba(77, 124, 255, 0.38);
      border-radius: 8px;
      background: rgba(77, 124, 255, 0.1);
      color: var(--text);
      font-size: 12px;
    }
    .accountsProgress.error { border-color: rgba(255, 119, 109, 0.5); color: var(--danger); }
    .accountsProgress.hidden { display: none; }
    .accountsAutoSwitch {
      display: flex;
      align-items: start;
      gap: 9px;
      color: var(--text);
      font-size: 12px;
      line-height: 1.4;
      cursor: pointer;
    }
    .accountsAutoSwitch input { width: 18px; height: 18px; margin: 0; accent-color: var(--accent); }
    .accountsList { display: grid; gap: 7px; }
    .accountRow {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: stretch;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface-subtle);
    }
    .providerAccountsPanel { display: grid; gap: 12px; }
    .accountsToolbar select { min-height: 40px; min-width: 0; padding: 8px 12px; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 8px; font: inherit; }

    .accountDetails { display: grid; gap: 3px; min-width: 0; }
    .accountDetails strong { font-size: 13px; color: var(--text); overflow-wrap: anywhere; }
    .accountDetails span { color: var(--muted); font-size: 11px; line-height: 1.4; }
    .accountRetryHint { margin-top: 3px; color: var(--muted); font-size: 11px; line-height: 1.4; }
    .legalHeader h3, .legalDangerZone h3 {
      margin: 0 0 6px;
      font-size: 15px;
      color: var(--text);
    }
    .legalHeader p, .legalDangerZone p {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.55;
    }
    .legalWarning {
      padding: 11px 12px;
      border: 1px solid rgba(245, 181, 63, 0.42);
      border-radius: 8px;
      background: rgba(245, 181, 63, 0.1);
      color: var(--text);
      font-size: 12px;
      line-height: 1.5;
    }
    .legalMeta { color: var(--muted); font-size: 11px; }
    .legalDocuments { display: grid; gap: 7px; }
    .legalDocument {
      border: 1px solid var(--line);
      border-radius: 9px;
      background: var(--surface-subtle);
      overflow: hidden;
    }
    .legalDocument > summary {
      min-height: 54px;
      padding: 10px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      cursor: pointer;
      list-style: none;
    }
    .legalDocument > summary::-webkit-details-marker { display: none; }
    .legalDocument > summary:hover { background: var(--surface-hover); }
    .legalDocument > summary span:first-child { display: grid; gap: 3px; }
    .legalDocument > summary strong { font-size: 13px; color: var(--text); }
    .legalDocument > summary small { color: var(--muted); font-size: 11px; line-height: 1.35; }
    .legalMarker { color: var(--muted); font-size: 18px; transition: transform 150ms ease; }
    .legalDocument[open] .legalMarker { transform: rotate(45deg); }
    .legalDocumentBody {
      padding: 2px 14px 14px;
      border-top: 1px solid var(--line);
    }
    .legalDocumentBody h4 { margin: 14px 0 5px; font-size: 12px; color: var(--text); }
    .legalDocumentBody p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
    .legalDangerZone {
      padding: 13px;
      border: 1px solid rgba(255, 119, 109, 0.35);
      border-radius: 9px;
      background: rgba(255, 119, 109, 0.07);
    }
    .legalDeleteBtn { margin-top: 12px; min-height: 40px; }
    .legalDeleteBtn:disabled { opacity: 0.5; cursor: not-allowed; }
    .alphaNoticeOverlay { z-index: 80; }
    .alphaNoticePanel { width: min(680px, 94vw); max-height: min(860px, 94vh); padding: 24px; gap: 12px; overflow: auto; }
    .alphaNoticeEyebrow { color: var(--accent); font-size: 11px; font-weight: 800; letter-spacing: 1.4px; }
    .alphaNoticePanel h2 { margin: 0; font-size: 20px; }
    .alphaNoticePanel p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.6; }
    .alphaNoticeData { padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-inset); }
    .consentLanguageLabel { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; }
    .consentLanguageLabel select { min-height: 40px; padding: 7px 10px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--surface-inset); color: var(--text); }
    .alphaNoticeActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
    .consentDocuments { display: grid; gap: 6px; max-height: 280px; overflow: auto; padding-right: 4px; }
    .consentDocuments a { display: flex; align-items: center; min-height: 44px; padding: 10px 12px; border: 1px solid var(--line-strong); border-radius: 8px; color: var(--accent); }
    .consentDocuments details { border: 1px solid var(--line); border-radius: 8px; background: var(--surface-subtle); }
    .consentDocuments summary { padding: 10px 12px; cursor: pointer; font-size: 13px; font-weight: 700; }
    .consentDocumentBody { display: grid; gap: 7px; padding: 0 12px 12px; }
    .consentDocumentBody strong { font-size: 12px; }
    .consentDocumentBody p { font-size: 12px; line-height: 1.5; }
    .consentForm { display: grid; gap: 9px; }
    .consentCheck { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 9px; align-items: start; padding: 10px 12px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--surface-inset); font-size: 12px; line-height: 1.45; cursor: pointer; }
    .consentCheck input { width: 16px; height: 16px; margin: 1px 0 0; accent-color: var(--accent); }
    .consentError { color: var(--danger); font-size: 12px; }
    @media (max-width: 560px) {
      .alphaNoticePanel { padding: 16px; }
      .alphaNoticeActions { display: grid; grid-template-columns: minmax(0, 1fr); }
      .alphaNoticeActions .iconBtn { width: 100%; }
    }
    .agentSettingsHeader h3 {
      margin: 0 0 4px;
      font-size: 15px;
      color: var(--text);
    }
    .agentSettingsNav {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px;
      padding: 4px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--surface-inset);
    }
    .agentSettingsNavBtn {
      min-width: 0;
      min-height: 44px;
      border: 1px solid transparent;
      border-radius: 7px;
      background: transparent;
      color: var(--muted);
      font: inherit;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .agentSettingsNavBtn:hover {
      color: var(--text);
      background: var(--surface-hover);
    }
    .agentSettingsNavBtn.active {
      color: var(--text);
      background: var(--button-bg);
      border-color: var(--line-strong);
      box-shadow: 0 2px 8px var(--shadow-soft);
    }
    .agentSettingsNavBtn:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .agentSettingsContent { min-width: 0; }
    .agentSettingsSection { display: none; }
    .agentSettingsSection.active {
      display: grid;
      gap: 14px;
    }
    .agentSettingsSection > .settingsGroup { min-width: 0; }
    .settingsMetaBadge {
      flex: 0 0 auto;
      align-self: center;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 4px 8px;
      background: var(--surface-subtle);
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
      white-space: nowrap;
    }
    .settingsTechnicalDetails {
      margin: 8px 0 12px;
      color: var(--muted);
      font-size: 11px;
    }
    .settingsTechnicalDetails summary {
      width: fit-content;
      cursor: pointer;
      user-select: none;
    }
    .settingsTechnicalDetails .settingsHint { margin-top: 6px; }
    .agentSettingsSection .settingsItemRow .iconBtn {
      min-width: 44px;
      height: 44px;
    }
    .memorySettingsItem.settingsItemRow .name {
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.45;
    }
    .memorySettingsList { min-width: 0; }
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
    .settingsItemRow {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      margin-bottom: 6px;
    }
    .settingsItemRow .textWrap {
      flex: 1;
      min-width: 0;
    }
    .settingsItemRow .iconBtn {
      flex: 0 0 auto;
      margin-top: 2px;
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
      overflow-wrap: anywhere;
      word-break: normal;
    }
    .settingsSelectRow {
      grid-template-columns: minmax(0, 1fr) minmax(160px, 240px);
      align-items: center;
    }
    .permissionSettings {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 12px;
      background: var(--surface-subtle);
    }
    .permissionOverview {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .permissionSettingCard {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        "text checkbox"
        "risk risk";
      gap: 8px 10px;
      margin: 0;
      background: var(--surface-inset);
    }
    .permissionSettingCard > input { grid-area: checkbox; }
    .permissionSettingCard > div { grid-area: text; min-width: 0; }
    .permissionSettingCard > .riskBadge {
      grid-area: risk;
      justify-self: start;
      align-self: end;
    }
    .permissionSettingCard .name {
      font-family: inherit;
      font-size: 12px;
      line-height: 1.35;
    }
    .permissionSettingCard .desc { font-size: 11px; }
    .permissionCommandGroup {
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--surface-subtle);
      overflow: hidden;
    }
    .permissionCommandGroup > summary {
      min-height: 48px;
      cursor: pointer;
      user-select: none;
    }
    .permissionCommandSummary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      color: var(--text);
      font-size: 13px;
      font-weight: 700;
    }
    .permissionCommandSummary:hover { background: var(--surface-hover); }
    .permissionCommandSummary:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
    .permissionCommandCount {
      flex: 0 0 auto;
      min-width: 48px;
      padding: 3px 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--surface-inset);
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      text-align: center;
    }
    .permissionCommandList {
      display: grid;
      gap: 6px;
      padding: 8px;
      border-top: 1px solid var(--line);
    }
    .permissionCommandItem {
      grid-template-columns: 24px minmax(0, 1fr);
      margin: 0;
      background: var(--surface-inset);
    }
    .settingsItemRow .name {
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-weight: 600;
      font-size: 14px;
    }
    .settingsItemRow .desc {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
      margin-top: 2px;
      overflow-wrap: anywhere;
      word-break: normal;
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
    .apiDetails,
    .apiCompatibilityDetails {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface-subtle);
      overflow: hidden;
    }
    .apiDetails > summary,
    .apiCompatibilityDetails > summary {
      min-height: 42px;
      padding: 10px 12px;
      cursor: pointer;
      color: var(--text);
      font-size: 12px;
      font-weight: 650;
      line-height: 1.35;
    }
    .apiDetails > summary:hover,
    .apiCompatibilityDetails > summary:hover {
      background: var(--surface-hover);
    }
    .apiDetails > summary:focus-visible,
    .apiCompatibilityDetails > summary:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
    .apiDetailsBody,
    .apiCompatibilityBody {
      padding: 12px;
      border-top: 1px solid var(--line);
    }
    .apiCompatibilityBody .apiSettingsGrid,
    .apiCompatibilityBody .apiModels,
    .apiDetailsBody .apiModels {
      margin-bottom: 0;
    }
    .economyActions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 10px;
    }
    .economyActions .iconBtn {
      width: auto;
      padding: 0 12px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
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
    .healthSettings {
      display: grid;
      gap: 12px;
    }
    .healthHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .healthHeader h3 {
      margin: 0;
    }
    .healthActions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }
    .healthSummary {
      border: 1px solid var(--line);
      background: var(--panel-2);
      border-radius: 6px;
      padding: 9px 10px;
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .healthGrid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 8px;
    }
    .healthCard {
      border: 1px solid var(--line);
      background: var(--panel-2);
      border-radius: 7px;
      padding: 9px;
      min-width: 0;
    }
    .healthCard.ok {
      border-color: rgba(34, 197, 94, 0.25);
    }
    .healthCard.warn {
      border-color: rgba(234, 179, 8, 0.28);
    }
    .healthCardTop {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
      margin-bottom: 6px;
    }
    .healthCardTitle {
      min-width: 0;
      color: var(--text);
      font-size: 12px;
      font-weight: 800;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .healthBadge {
      flex: 0 0 auto;
      border-radius: 999px;
      padding: 2px 7px;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .healthBadge.ok {
      color: #22c55e;
      background: rgba(34, 197, 94, 0.12);
      border: 1px solid rgba(34, 197, 94, 0.28);
    }
    .healthBadge.warn {
      color: #eab308;
      background: rgba(234, 179, 8, 0.12);
      border: 1px solid rgba(234, 179, 8, 0.28);
    }
    .healthCardDesc {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .healthReport {
      width: 100%;
      min-height: 190px;
      resize: vertical;
      border: 1px solid var(--line);
      background: var(--code-bg, #1e1e1e);
      color: var(--text);
      border-radius: 7px;
      padding: 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      line-height: 1.45;
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
      width: calc(100% - 16px);
      margin: 6px 8px;
      padding: 7px 8px;
      font-size: 12px;
    }
    .sidebarPromos {
      width: calc(100% - 16px);
      margin: 0 8px 6px;
      display: grid;
      gap: 5px;
      flex: 0 0 auto;
    }
    .sidebarPromo {
      --promo-a: rgba(77, 124, 255, 0.13);
      --promo-b: rgba(34, 197, 94, 0.07);
      --promo-border: rgba(77, 124, 255, 0.34);
      --promo-mark-bg: rgba(77, 124, 255, 0.22);
      --promo-mark-color: #facc15;
      border: 1px solid var(--promo-border);
      background: linear-gradient(120deg, var(--promo-a), var(--promo-b), var(--promo-a));
      color: var(--text);
      border-radius: 7px;
      padding: 6px 8px;
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr);
      gap: 7px;
      align-items: center;
      text-decoration: none;
      box-shadow: 0 10px 26px rgba(0, 0, 0, 0.16);
      transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
      position: relative;
      overflow: hidden;
      isolation: isolate;
      width: 100%;
      text-align: left;
      font: inherit;
      cursor: pointer;
    }
    .sidebarPromo:hover {
      border-color: color-mix(in srgb, var(--promo-border) 72%, var(--text));
      transform: translateY(-1px);
    }
    .sidebarPromoTrial {
      --promo-a: rgba(226, 232, 240, 0.14);
      --promo-b: rgba(77, 124, 255, 0.09);
      --promo-border: rgba(226, 232, 240, 0.38);
      --promo-mark-bg: rgba(226, 232, 240, 0.16);
      --promo-mark-color: #f8fafc;
      cursor: default;
    }
    .sidebarPromoTrial:hover {
      transform: none;
    }
    .sidebarPromoTrial[data-expiry] { cursor: pointer; }
    .sidebarPromoTrial[data-expiry="healthy"] {
      --promo-a: rgba(34, 197, 94, 0.20);
      --promo-b: rgba(34, 197, 94, 0.08);
      --promo-border: #4ade80;
      --promo-mark-bg: rgba(34, 197, 94, 0.22);
      --promo-mark-color: #bbf7d0;
    }
    .sidebarPromoTrial[data-expiry="warning"] {
      --promo-a: rgba(250, 204, 21, 0.20);
      --promo-b: rgba(250, 204, 21, 0.08);
      --promo-border: #facc15;
      --promo-mark-bg: rgba(250, 204, 21, 0.22);
      --promo-mark-color: #fef08a;
    }
    .sidebarPromoTrial[data-expiry="urgent"] {
      --promo-a: rgba(248, 113, 113, 0.20);
      --promo-b: rgba(248, 113, 113, 0.08);
      --promo-border: #f87171;
      --promo-mark-bg: rgba(248, 113, 113, 0.22);
      --promo-mark-color: #fecaca;
    }
    .sidebarPromoAd {
      --promo-a: rgba(250, 204, 21, 0.12);
      --promo-b: rgba(244, 63, 94, 0.08);
      --promo-border: rgba(250, 204, 21, 0.38);
      --promo-mark-bg: rgba(250, 204, 21, 0.18);
      --promo-mark-color: #fef08a;
    }
    .sidebarPromoMark {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      display: grid;
      place-items: center;
      background: var(--promo-mark-bg);
      color: var(--promo-mark-color);
      font-size: 12px;
      font-weight: 900;
      line-height: 1;
    }
    .sidebarPromoText {
      min-width: 0;
      display: grid;
      gap: 1px;
      line-height: 1.15;
    }
    .sidebarPromoText strong {
      font-size: 11px;
      font-weight: 800;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sidebarPromoText small {
      color: var(--muted);
      font-size: 10px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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
    .primaryBtn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
    .dangerBtn {
      border-color: rgba(255, 119, 109, 0.4);
      background: rgba(255, 119, 109, 0.14);
      color: var(--danger);
      font-weight: 700;
    }
    .dangerBtn:hover {
      border-color: var(--danger);
      background: rgba(255, 119, 109, 0.22);
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
      font-size: 10px;
      color: var(--muted);
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
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
      background: var(--surface-inset);
    }
    .browseSection.hidden { display: none; }
    .browsePath {
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 12px;
      color: var(--text);
      margin-bottom: 10px;
      padding: 6px 8px;
      background: var(--surface-hover);
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
      background: var(--surface-hover);
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
      position: relative;
      z-index: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 22px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      background: transparent;
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
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px 16px;
      line-height: 1.5;
      font-size: 14px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: var(--bubble);
      color: var(--text);
      box-shadow: 0 4px 16px var(--shadow-soft);
      transition: all 120ms ease;
    }
    .toolLogs {
      display: grid;
      gap: 6px;
      margin-bottom: 10px;
      white-space: normal;
    }
    .toolLog {
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface-inset);
    }
    .toolLog summary {
      padding: 7px 10px;
      color: var(--muted);
      font: 12px/1.4 ui-monospace, "SF Mono", Menlo, monospace;
      cursor: pointer;
      user-select: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .toolLog summary:hover {
      color: var(--text);
      background: var(--surface-hover);
    }
    .toolLog pre {
      max-height: 320px;
      margin: 0;
      padding: 9px 10px;
      overflow: auto;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font: 11px/1.45 ui-monospace, "SF Mono", Menlo, monospace;
      white-space: pre;
    }
    .thinkingAccordion {
      margin-bottom: 10px;
      overflow: hidden;
      border: 1px solid var(--line);
      border-left: 3px solid var(--accent);
      border-radius: 8px;
      background: var(--surface-inset);
    }
    .thinkingSummary {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 10px;
      color: var(--muted);
      font: 12px/1.4 system-ui, -apple-system, sans-serif;
      font-weight: 500;
      cursor: pointer;
      user-select: none;
    }
    .thinkingSummary:hover {
      color: var(--text);
      background: var(--surface-hover);
    }
    .thinkingBadge {
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 999px;
      background: var(--surface-hover);
      color: var(--muted);
      margin-left: auto;
    }
    .thinkingAccordion[open] .thinkingBadge {
      background: var(--surface-active, var(--surface-hover));
    }
    .thinkingBody {
      padding: 9px 12px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font: 12.5px/1.55 system-ui, -apple-system, sans-serif;
      font-style: italic;
      white-space: pre-wrap;
      max-height: 380px;
      overflow-y: auto;
    }
    .msg.streaming .streamingText::after {
      content: "▋";
      display: inline-block;
      margin-left: 2px;
      color: var(--accent);
      animation: streamCursor 0.9s step-end infinite;
    }
    @keyframes streamCursor {
      50% { opacity: 0; }
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
      background: var(--composer-bg);
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
      background: var(--composer-bg);
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
      color: var(--blue-text);
      border: 1px solid rgba(82, 126, 255, 0.4);
      white-space: nowrap;
      flex-shrink: 0;
    }
    .modeBadge.hidden { display: none; }

    .modelPicker,
    .rolePicker {
      font-size: 11px;
      height: 28px;
      padding: 3px 24px 3px 9px;
      border-radius: 6px;
      border: 1px solid var(--line);
      background: var(--input-bg);
      color: var(--text);
      cursor: pointer;
      max-width: 170px;
      min-width: 0;
      font-weight: 600;
    }
    .modelPicker.hidden,
    .rolePicker.hidden { display: none; }
    .modelPicker:hover,
    .rolePicker:hover { border-color: var(--line-strong); }
    .modelPicker {
      border-color: rgba(77, 124, 255, 0.34);
      color: var(--blue-text);
    }
    .rolePicker {
      border-color: rgba(20, 184, 166, 0.28);
      color: var(--teal-text);
    }
    .rolePicker { max-width: 135px; }
    .modelCapabilities {
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
    }
    .modelCapabilities.hidden { display: none; }
    .modelCapabilityBadge {
      padding: 3px 6px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--surface-subtle);
      color: var(--muted);
      font-size: 10px;
      line-height: 1.2;
      white-space: nowrap;
    }

    .memorySettingsList {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 280px;
      overflow: auto;
    }
    .memorySettingsItem {
      align-items: flex-start;
      gap: 10px;
    }
    .memorySettingsItem.settingsItemRow .iconBtn {
      flex: 0 0 auto;
      margin-top: 2px;
    }
    .agentBrowserBtn {
      flex: 0 0 auto;
      color: var(--blue-text);
      border-color: rgba(59, 130, 246, 0.28);
    }
    .agentBrowserBtn.active {
      background: rgba(59, 130, 246, 0.16);
      border-color: rgba(59, 130, 246, 0.48);
    }
    .pipelinePanelBtn {
      flex: 0 0 auto;
      color: var(--teal-text);
      border-color: rgba(20, 184, 166, 0.25);
    }
    .pipelinePanel {
      position: absolute;
      top: 58px;
      right: 14px;
      z-index: 20;
      width: min(980px, calc(100% - 28px));
      max-height: min(560px, calc(100% - 150px));
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.34);
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
    }
    .pipelinePanel.hidden { display: none; }

    .agentDrawerBtn {
      flex: 0 0 auto;
      color: var(--purple-text);
      border-color: rgba(167, 139, 250, 0.28);
    }
    .agentDrawerBtn.hidden { display: none; }
    .agentDrawerBtn.active {
      background: rgba(167, 139, 250, 0.14);
      border-color: rgba(167, 139, 250, 0.45);
    }
    .agentDrawerBackdrop {
      position: fixed;
      inset: 0;
      background: var(--overlay-bg);
      z-index: 24;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease;
    }
    .agentDrawerBackdrop.open {
      opacity: 1;
      pointer-events: auto;
    }
    /* Браузер + чат одновременно: backdrop не перехватывает клики/фокус в основном окне */
    body.agentBrowserDrawerOpen .agentDrawerBackdrop.open {
      opacity: 0;
      pointer-events: none;
    }
    body.agentBrowserDrawerOpen .app {
      width: calc(100% - var(--agent-drawer-width, 640px));
      max-width: calc(100% - var(--agent-drawer-width, 640px));
    }
    body.agentBrowserDrawerOpen .main {
      padding-right: 0;
      box-sizing: border-box;
    }
    body.agentDrawerResizing .main,
    body.agentDrawerResizing .agentDrawer,
    body.agentDrawerResizing .app {
      transition: none;
    }
    body.agentDrawerResizing {
      user-select: none;
      cursor: col-resize;
    }
    .agentDrawer {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      z-index: 25;
      width: var(--agent-drawer-width, 480px);
      height: auto;
      max-height: 100%;
      background: var(--panel);
      border-left: 1px solid var(--line);
      box-shadow: var(--drawer-shadow);
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      transform: translateX(100%);
      transition: transform 0.22s ease, width 0.12s ease;
    }
    .agentDrawer.open { transform: translateX(0); }
    @media (prefers-reduced-motion: reduce) {
      .agentDrawer,
      .agentDrawerBackdrop { transition: none; }
    }
    .agentDrawerResize {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 8px;
      transform: translateX(-4px);
      cursor: col-resize;
      touch-action: none;
      z-index: 30;
      background: transparent;
      display: none;
    }
    .agentDrawerResize.visible { display: block; }
    .agentDrawerResize:hover,
    .agentDrawerResize.dragging {
      background: rgba(77, 124, 255, 0.35);
    }
    .agentDrawerHead {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 14px 14px 10px;
      border-bottom: 1px solid var(--line);
    }
    .agentDrawerTitle { font-size: 15px; font-weight: 800; }
    .agentDrawerSub { margin-top: 2px; color: var(--muted); font-size: 12px; }
    .agentDrawerBody { min-height: 0; overflow: hidden; position: relative; }
    .agentDrawerPanel {
      display: none;
      height: 100%;
      overflow: auto;
      padding: 12px;
    }
    .agentDrawerPanel.active { display: block; }
    .agentDrawerPanel[data-panel="browser"] {
      padding: 0;
      display: none;
      grid-template-rows: minmax(0, 1fr);
      min-height: 0;
      overflow: hidden;
    }
    .agentDrawerPanel[data-panel="browser"].active { display: grid; }
    .agentMemoryToolbar {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 10px;
    }
    .agentMemoryToolbar .iconBtn { width: auto; min-height: 36px; padding: 7px 12px; }
    .agentBrowserFrame {
      width: 100%;
      height: 100%;
      min-height: 0;
      border: 0;
      background: var(--bg);
      display: block;
    }
    .agentMiniList { display: grid; gap: 6px; }
    .agentMiniItem {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 10px;
      background: var(--bg-soft, var(--panel-2));
      font-size: 12px;
      color: var(--muted);
    }
    .pluginInstallRow { display: flex; gap: 8px; align-items: center; }
    .pluginInstallInput {
      flex: 1;
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--input-bg);
      color: var(--text);
      padding: 8px 10px;
    }

    .pipelineHead {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      padding: 14px;
      border-bottom: 1px solid var(--line);
    }
    .pipelineHead > div { min-width: 0; }
    .pipelineHead .iconBtn { flex: 0 0 auto; }
    .pipelineTitle {
      font-size: 14px;
      font-weight: 800;
    }
    .pipelineSub {
      margin-top: 3px;
      color: var(--muted);
      font-size: 12px;
    }
    .pipelineTeamActions {
      display: flex;
      gap: 8px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--line);
      flex-wrap: wrap;
    }
    .pipelineTeamActions .iconBtn {
      width: auto;
      min-height: 36px;
      height: auto;
      padding: 8px 12px;
      line-height: 1.25;
      white-space: normal;
    }

    .pipelineBody {
      min-height: 0;
      overflow: auto;
      padding: 10px;
      display: grid;
      gap: 8px;
    }
    .pipelineRow {
      display: grid;
      grid-template-columns: minmax(140px, 1fr) repeat(3, minmax(125px, 180px)) 38px;
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
    .pipelineField {
      min-width: 0;
      display: grid;
      gap: 4px;
      color: var(--muted);
      font-size: 10px;
    }
    .pipelineField > span {
      padding-left: 2px;
    }
    .smallEmpty {
      padding: 20px;
      font-size: 13px;
    }
    .modeBadge.fast    { background: rgba(82, 126, 255, 0.14); color: var(--blue-text); border-color: rgba(82, 126, 255, 0.4); }
    .modeBadge.expert  { background: rgba(168, 85, 247, 0.14); color: var(--purple-text); border-color: rgba(168, 85, 247, 0.4); }
    .modeBadge.vision  { background: rgba(34, 197, 94, 0.14);  color: var(--green-text); border-color: rgba(34, 197, 94, 0.4); }

    .providerBadge {
      display: inline-flex;
      align-items: center;
      flex: 0 0 auto;
      font-size: 9px;
      padding: 0 4px;
      border-radius: 3px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.2px;
      line-height: 1.5;
    }
    .providerBadge.deepseek {
      background: rgba(77, 124, 255, 0.12);
      color: var(--blue-text);
      border: 1px solid rgba(77, 124, 255, 0.3);
    }
    .providerBadge.qwen {
      background: rgba(251, 146, 60, 0.12);
      color: var(--orange-text);
      border: 1px solid rgba(251, 146, 60, 0.3);
    }
    .providerBadge.chatgpt {
      background: rgba(16, 185, 129, 0.14);
      color: var(--green-text);
      border: 1px solid rgba(16, 185, 129, 0.38);
    }

    @media (max-width: 900px) {
      .pipelineRow {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .pipelineNodeMeta {
        grid-column: 1 / -1;
      }
      .topbar {
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas:
          "title actions"
          "controls controls";
        row-gap: 6px;
      }
      .topbarTitle { grid-area: title; }
      .topbarControls {
        grid-area: controls;
        justify-content: flex-start;
        padding-top: 2px;
      }
      .modelCapabilityBadge {
        flex: 0 0 24px;
        padding-inline: 4px;
        overflow: hidden;
      }
      .topbarActions { grid-area: actions; }
    }

    @media (max-width: 640px) {
      .permissionOverview {
        grid-template-columns: minmax(0, 1fr);
      }
      .apiKeyRow {
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas:
          "provider action"
          "key key";
      }
      .apiKeyProvider { grid-area: provider; }
      .apiKeyRow code { grid-area: key; }
      .apiKeyRow .apiKeyBtn { grid-area: action; }
      .pipelinePanel {
        position: fixed;
        top: 8px;
        right: 8px;
        width: calc(100% - 16px);
        max-height: calc(100% - 16px);
      }
      .pipelineRow {
        grid-template-columns: minmax(0, 1fr);
      }
      .pipelineNodeMeta {
        grid-column: auto;
      }
      .pipelineTeamActions .iconBtn {
        flex: 1 1 180px;
      }
      .topbar {
        padding: 7px 9px;
      }
      .title {
        font-size: 13px;
      }
      .topbarControls {
        gap: 5px;
      }
      .modelPicker { max-width: 132px; }
      .rolePicker { max-width: 118px; }
    }

    .chatImage {
      display: block;
      max-width: min(420px, 100%);
      margin-top: 8px;
      border-radius: 10px;
      border: 1px solid var(--border, rgba(255,255,255,0.1));
      cursor: zoom-in;
    }
    @keyframes taskSpin { to { transform: rotate(360deg); } }
    .chatItem.running .chatTitle { color: var(--blue-text); font-weight: 700; }

    .providerPicker {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .providerOption {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      padding: 12px;
      border: 1px solid var(--line);
      background: var(--surface-subtle);
      border-radius: 8px;
      cursor: pointer;
      transition: all 150ms ease;
      text-align: left;
      color: var(--text);
    }
    .providerOption:hover {
      border-color: var(--line-strong);
      background: var(--surface-hover);
    }
    .providerOption.active {
      border-width: 2px;
      padding: 11px;
      outline: 2px solid var(--line);
      outline-offset: 2px;
    }
    .providerOption.active::after {
      content: "Выбрано";
      position: absolute;
      top: 8px;
      right: 8px;
      border-radius: 999px;
      padding: 2px 7px;
      font-size: 10px;
      font-weight: 800;
      line-height: 1.4;
      color: #ffffff;
      background: var(--accent);
      box-shadow: 0 4px 12px var(--shadow-soft);
    }
    .providerOption.active.deepseek {
      background: rgba(77, 124, 255, 0.18);
      border-color: rgba(77, 124, 255, 0.85);
      box-shadow: 0 0 0 1px rgba(77, 124, 255, 0.20), 0 10px 24px rgba(77, 124, 255, 0.16);
    }
    .providerOption.active.qwen {
      background: rgba(251, 146, 60, 0.18);
      border-color: rgba(251, 146, 60, 0.85);
      box-shadow: 0 0 0 1px rgba(251, 146, 60, 0.20), 0 10px 24px rgba(251, 146, 60, 0.16);
    }
    .providerOption.active.qwen::after {
      background: #ea7a1f;
    }
    .providerOption.active.chatgpt {
      background: rgba(16, 185, 129, 0.18);
      border-color: rgba(16, 185, 129, 0.88);
      box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.22), 0 10px 24px rgba(16, 185, 129, 0.16);
    }
    .providerOption.active.chatgpt::after {
      background: #0f9f72;
    }
    .providerOption.active.codex {
      background: rgba(99, 102, 241, 0.18);
      border-color: rgba(99, 102, 241, 0.88);
      box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.22), 0 10px 24px rgba(99, 102, 241, 0.16);
    }
    .providerOption.active.codex::after {
      background: #6366f1;
    }
    .codexInstallLink {
      margin-top: 4px;
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
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      padding: 12px;
      border: 1px solid var(--line);
      background: var(--surface-subtle);
      border-radius: 8px;
      cursor: pointer;
      transition: all 150ms ease;
      text-align: left;
      color: var(--text);
    }
    .modeOption:hover {
      border-color: var(--line-strong);
      background: var(--surface-hover);
    }
    .modeOption.active {
      border-width: 2px;
      padding: 11px;
      background: rgba(77, 124, 255, 0.18);
      border-color: rgba(77, 124, 255, 0.85);
      outline: 2px solid var(--line);
      outline-offset: 2px;
      box-shadow: 0 0 0 1px rgba(77, 124, 255, 0.20), 0 10px 24px rgba(77, 124, 255, 0.16);
    }
    .modeOption.active::after {
      content: "Выбрано";
      position: absolute;
      top: 8px;
      right: 8px;
      border-radius: 999px;
      padding: 2px 7px;
      font-size: 10px;
      font-weight: 800;
      line-height: 1.4;
      color: #ffffff;
      background: var(--accent);
      box-shadow: 0 4px 12px var(--shadow-soft);
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
    .sendBtn.hidden { display: none; }
    .stopBtn {
      height: 36px;
      width: 36px;
      border: none;
      background: linear-gradient(135deg, #ef4444, #dc2626);
      color: #fff;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 700;
      box-shadow: 0 4px 10px rgba(239, 68, 68, 0.25);
      transition: all 150ms ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .stopBtn:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 6px 14px rgba(239, 68, 68, 0.35);
    }
    .stopBtn:disabled { opacity: 0.55; cursor: not-allowed; }
    .stopBtn.hidden { display: none; }
    .status {
      color: var(--muted);
      font-size: 12px;
      min-height: 16px;
      padding: 0 18px 12px;
      background: var(--composer-bg);
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
      font-family: inherit;
      line-height: 1.2;
    }
    .reconnectLink:disabled {
      cursor: wait;
      opacity: 0.65;
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
      border: 1px solid var(--line);
      background: var(--surface-subtle);
      color: var(--muted);
      cursor: pointer;
      transition: all 150ms ease;
    }
    .togglePill.hidden { display: none; }
    .togglePill:hover {
      color: var(--text);
      border-color: var(--line-strong);
      background: var(--surface-hover);
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
      .accountRow { align-items: stretch; flex-direction: column; }
      .accountActions { grid-template-columns: 1fr; max-width: none; flex: 0 1 auto; }
      .agentSettingsNav {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .settingsMetaBadge { align-self: flex-start; }
      .pluginInstallRow {
        flex-direction: column;
        align-items: stretch;
      }
      .pluginInstallRow .btn { min-height: 44px; }
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
    .qwenCaptchaOverlay { position: fixed; inset: 0; z-index: 150; display: flex; align-items: center; justify-content: center; pointer-events: none; padding: 20px; }
    .qwenCaptchaPanel { width: min(940px, 100%); max-height: calc(100vh - 40px); overflow: auto; padding: 24px; border: 1px solid var(--line-strong); border-radius: 18px; background: var(--bg-elevated, #20242d); color: var(--text, #f8f9fc); box-shadow: 0 24px 70px #0009; pointer-events: auto; }
    .qwenCaptchaPanel h3 { margin: 0 0 10px; font-size: 20px; }
    .qwenCaptchaPanel p { margin: 0 0 16px; line-height: 1.5; }
    .qwenCaptchaStatus { min-height: 1.5em; color: var(--muted); font-size: 13px; }
    .qwenCaptchaViewport { width: 100%; aspect-ratio: 8 / 5; max-height: 62vh; margin: 0 0 16px; border: 1px solid var(--line-strong); border-radius: 10px; overflow: hidden; background: #10131a; }
    .qwenCaptchaViewport[hidden] { display: none; }
    .qwenCaptchaViewport iframe { display: block; width: 100%; height: 100%; border: 0; }
    .qwenCaptchaActions { display: flex; flex-wrap: wrap; gap: 8px; }
    .qwenCaptchaActions button { min-height: 40px; padding: 8px 12px; border-radius: 9px; border: 1px solid var(--line-strong); background: var(--accent-soft); color: inherit; cursor: pointer; }
    .qwenCaptchaActions button:disabled { opacity: .55; cursor: wait; }
`;
