// Workspace shell overlay. Appended after STYLES so legacy panels and dialogs
// keep their existing rules while the main window uses the v2 workspace layout.
export const WORKSPACE_STYLES = `
  body.workspaceShell {
    color-scheme: dark;
    --bg: #141716;
    --sidebar: #191d1b;
    --panel: #1d211f;
    --panel-2: #171a18;
    --topbar-bg: #191d1b;
    --message-bg: #141716;
    --composer-bg: #191d1b;
    --line: rgba(236, 241, 237, .08);
    --line-strong: rgba(236, 241, 237, .15);
    --text: #e8ece9;
    --muted: #a0aaa3;
    --accent: #79b98e;
    --accent-strong: #a1d3ae;
    --accent-soft: rgba(121, 185, 142, .14);
    --bubble: #1d211f;
    --button-bg: #202522;
    --button-hover: #29302b;
    --input-bg: #171b19;
    --modal-bg: #1b201d;
    --surface-subtle: rgba(236, 241, 237, .025);
    --surface-hover: rgba(236, 241, 237, .055);
    --surface-inset: rgba(0, 0, 0, .16);
    --scroll-thumb: rgba(236, 241, 237, .16);
    --scroll-thumb-hover: rgba(236, 241, 237, .28);
    --shadow-soft: rgba(0, 0, 0, .18);
    --green-text: #a1d3ae;
    --code-bg: #181d1a;
    background: var(--bg);
    color: var(--text);
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }
  body.workspaceShell[data-theme="light"] {
    color-scheme: light;
    --bg: #f5f6f4;
    --sidebar: #eef1ed;
    --panel: #ffffff;
    --panel-2: #f0f2ef;
    --topbar-bg: #ffffff;
    --message-bg: #f8f9f7;
    --composer-bg: #ffffff;
    --line: rgba(35, 47, 39, .09);
    --line-strong: rgba(35, 47, 39, .16);
    --text: #242b26;
    --muted: #68736b;
    --accent: #28754a;
    --accent-strong: #1e633d;
    --accent-soft: rgba(40, 117, 74, .10);
    --bubble: #ffffff;
    --button-bg: #ffffff;
    --button-hover: #f0f4f0;
    --input-bg: #ffffff;
    --modal-bg: #ffffff;
    --surface-subtle: rgba(35, 47, 39, .025);
    --surface-hover: rgba(35, 47, 39, .055);
    --surface-inset: rgba(35, 47, 39, .035);
    --scroll-thumb: rgba(35, 47, 39, .20);
    --scroll-thumb-hover: rgba(35, 47, 39, .34);
    --shadow-soft: rgba(35, 47, 39, .08);
    --green-text: #28754a;
    --code-bg: #f1f3f0;
  }
  body.workspaceShell[data-theme="contrast"] {
    color-scheme: light;
    --bg: #fff;
    --sidebar: #f1f1f1;
    --panel: #fff;
    --panel-2: #e9e9e9;
    --topbar-bg: #fff;
    --message-bg: #fff;
    --composer-bg: #fff;
    --line: rgba(0, 0, 0, .22);
    --line-strong: rgba(0, 0, 0, .48);
    --text: #080a08;
    --muted: #343a35;
    --accent: #07552b;
    --accent-strong: #003d1c;
    --accent-soft: rgba(0, 86, 39, .13);
    --bubble: #fff;
    --button-bg: #fff;
    --button-hover: #e9f3ec;
    --input-bg: #fff;
    --modal-bg: #fff;
    --surface-subtle: rgba(0, 0, 0, .025);
    --surface-hover: rgba(0, 0, 0, .07);
    --surface-inset: rgba(0, 0, 0, .04);
    --scroll-thumb: rgba(0, 0, 0, .28);
    --scroll-thumb-hover: rgba(0, 0, 0, .46);
    --green-text: #064b25;
    --code-bg: #f2f2f2;
  }
  body.workspaceShell :focus-visible {
    outline: 2px solid var(--accent-strong);
    outline-offset: 2px;
  }
  body.workspaceShell button,
  body.workspaceShell input,
  body.workspaceShell textarea,
  body.workspaceShell select { font-family: inherit; }
  body.workspaceShell button { transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease; }
  body.workspaceShell .app {
    --sidebar-width: 264px;
    grid-template-columns: var(--sidebar-width) 6px minmax(0, 1fr);
    background: var(--bg);
  }
  body.workspaceShell .sidebar {
    background: var(--sidebar);
    border-right: 0;
    color: var(--text);
  }
  .workspaceBrand {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--line);
    color: var(--text);
    font-size: 15px;
    font-weight: 720;
    letter-spacing: .075em;
  }
  .workspaceBrand img { display: block; width: 32px; height: 32px; object-fit: contain; flex: 0 0 32px; }
  .workspaceBrand strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .workspaceBrand small { flex: 0 0 auto; margin-left: auto; color: var(--muted); font-size: 10px; letter-spacing: 0; }
  #workspaceSidebarCollapse { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 28px; min-height: 32px; padding: 0; border: 0; border-radius: 6px; color: var(--muted); background: transparent; cursor: pointer; }
  #workspaceSidebarCollapse:hover { background: var(--surface-hover); color: var(--text); }
  #workspaceSidebarCollapse:focus-visible, #workspaceFooterMenu summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  body.workspaceShell #openNewChat { min-height: 44px; margin: 8px 10px 4px; border-radius: 8px; }
  .workspaceSideLabel { padding: 12px 18px 4px; color: var(--muted); font-size: 10px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; }
  .workspaceProjectList, #workspaceProjectList {
    display: grid;
    gap: 3px;
    padding: 10px 10px 8px;
    overflow-y: auto;
    min-height: 0;
    border-bottom: 1px solid var(--line);
  }
  .workspaceProjectButton {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    min-width: 0;
    min-height: 44px;
    padding: 8px 10px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    text-align: left;
    cursor: pointer;
  }
  .workspaceProjectButton:hover { background: var(--surface-hover); color: var(--text); }
  .workspaceProjectButton.active,
  .workspaceProjectButton[aria-current="page"] {
    color: var(--text);
    background: var(--accent-soft);
    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .workspaceProjectButton svg { width: 16px; height: 16px; flex: 0 0 16px; }
  .workspaceProjectButton > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .workspaceProjectButton .nav-count { margin-left: auto; flex: 0 0 auto; }
  body.workspaceShell #chatList {
    flex: 1 1 auto;
    min-height: 100px;
    padding: 8px 10px;
    overflow-y: auto;
  }
  body.workspaceShell .chatItem {
    min-height: 44px;
    margin: 1px 0;
    padding: 7px 10px;
    border: 1px solid transparent;
    border-radius: 8px;
    font-size: 12px;
    line-height: 1.4;
    background: transparent;
    color: var(--muted);
  }
  body.workspaceShell .chatItem:hover { background: var(--surface-hover); color: var(--text); }
  body.workspaceShell .chatItem.active { background: var(--surface-hover); border-color: var(--line); color: var(--text); }
  body.workspaceShell .chatItem[hidden] { display: none !important; }
  .sidebarFooter {
    display: grid;
    gap: 8px;
    flex: 0 0 auto;
    padding: 6px 10px;
    border-top: 1px solid var(--line);
    background: var(--sidebar);
  }
  .workspaceSubscription {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    width: 100%;
    min-height: 40px;
    padding: 6px 8px;
    border: 1px solid var(--line-strong);
    border-radius: 7px;
    background: var(--surface-subtle);
    color: var(--text);
    text-align: left;
    font: inherit;
    cursor: pointer;
    transition: background 150ms ease, border-color 150ms ease;
  }
  .workspaceSubscription:hover { background: var(--surface-hover); border-color: var(--accent); }
  .workspaceSubscriptionHead { display: contents; }
  .workspaceSubscriptionHead strong { display: none; }
  .workspaceSubscriptionAction { order: 2; }
  .workspaceSubscriptionAction { color: var(--accent-strong); font-size: 12px; white-space: nowrap; }
  .workspaceSubscriptionStatus { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .workspaceSubscriptionStatus small { color: var(--text); font-size: 12px; line-height: 1.5; white-space: normal; overflow-wrap: anywhere; }
  .workspaceSubscriptionDot { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: var(--muted); }
  .workspaceSubscription[data-expiry="healthy"] .workspaceSubscriptionDot { background: var(--accent); }
  .workspaceSubscription[data-expiry="warning"] .workspaceSubscriptionDot { background: #d7a354; }
  .workspaceSubscription[data-expiry="urgent"] .workspaceSubscriptionDot { background: #d97b76; }
  .workspaceFooterTools { position: relative; }
  #workspaceFooterMenu { min-width: 0; }
  #workspaceFooterMenu summary { width: calc(100% - 104px); min-height: 32px; display: flex; align-items: center; gap: 4px; padding: 0 6px; color: var(--muted); font-size: 12px; cursor: pointer; border-radius: 6px; list-style: none; }
  #workspaceFooterMenu summary::-webkit-details-marker { display: none; }
  #workspaceFooterMenu summary::after { content: '⌄'; }
  #workspaceFooterMenu[open] summary::after { content: '⌃'; }
  #workspaceFooterMenu summary:hover { color: var(--text); background: var(--surface-hover); }
  .workspaceFooterMenuPanel { padding-top: 4px; }
  .workspaceFooterLinks { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
  .workspaceFooterLinks button,
  .sidebarFooter .iconBtn {
    min-height: 32px;
    padding: 5px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .workspaceFooterLinks button:hover,
  .sidebarFooter .iconBtn:hover { color: var(--text); background: var(--surface-hover); }
  .sidebarFooter .topbarActions { grid-area: auto; display: grid; grid-template-columns: repeat(3, 32px); gap: 2px; padding: 0; border: 0; }
  .workspaceFooterTools .topbarActions { position: absolute; top: 0; right: 0; }
  .sidebarFooter .topbarActions .iconBtn { width: 32px; min-width: 32px; height: 32px; font-size: 14px; }
  .workspaceFooterAd { display: flex; align-items: center; gap: 4px; min-height: 32px; color: var(--muted); font-size: 12px; text-decoration: none; }
  .workspaceFooterAd:hover { color: var(--text); }
  .workspaceSubscription:focus-visible,
  .workspaceFooterLinks button:focus-visible,
  .workspaceFooterAd:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 3px; }
  body.workspaceShell .sidebarResizer { background: var(--bg); border-color: var(--line); }
  body.workspaceShell .sidebarResizer:hover,
  body.workspaceShell .sidebarResizer.dragging { background: var(--accent); border-color: var(--accent); }

  body.workspaceShell .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    height: 100%;
    background: var(--message-bg);
    isolation: auto;
    grid-column: 3;
  }
  body.workspaceShell .topbar {
    position: relative;
    display: flex;
    flex: 0 0 auto;
    flex-wrap: nowrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 66px;
    padding: 9px 20px;
    overflow: visible;
    background: var(--topbar-bg);
    border-bottom: 1px solid var(--line);
  }
  body.workspaceShell .titleRow { min-width: 0; gap: 9px; }
  body.workspaceShell .topbarTitle { display: flex; flex-direction: column; gap: 0; }
  body.workspaceShell .topbar .title { font-size: 13px; font-weight: 650; }
  body.workspaceShell .topbar .workspace { display: block; font-size: 11px; }
  body.workspaceShell .topbar .iconBtn { min-height: 44px; min-width: 44px; }
  .workspaceProjectCrumb {
    display: flex;
    align-items: center;
    flex: 1 1 120px;
    min-width: 80px;
    color: var(--muted);
    font-size: 12px;
  }
  .workspaceProjectCrumb span { overflow: hidden; color: var(--text); font-size: 13px; font-weight: 620; text-overflow: ellipsis; white-space: nowrap; }
  .workspaceMobileMenu { display: inline-flex; align-items: center; justify-content: center; min-width: 32px; min-height: 32px; background: var(--button-bg); color: var(--text); border: 1px solid var(--line); border-radius: 8px; }
  @media (min-width: 761px) {
    body.workspaceSidebarCollapsed .app { grid-template-columns: 0 0 minmax(0, 1fr); }
    body.workspaceSidebarCollapsed .sidebar, body.workspaceSidebarCollapsed .sidebarResizer { display: none; }
    body.workspaceSidebarCollapsed .main { grid-column: 3; }
  }
  .workspaceTabs {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 3px;
    min-height: 44px;
    padding: 3px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--panel-2);
  }
  .workspaceTabs button {
    min-width: 68px;
    min-height: 44px;
    padding: 6px 12px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
  }
  .workspaceTabs button:hover { color: var(--text); background: var(--surface-hover); }
  .workspaceTabs button.active,
  .workspaceTabs button[aria-selected="true"] { color: var(--text); background: var(--panel); box-shadow: 0 1px 3px var(--shadow-soft); }
  .workspaceInspectorToggle { min-width: 44px; min-height: 44px; }
  .workspaceAdvancedControls { position: relative; flex: 0 0 auto; min-width: 0; }
  .workspaceAdvancedControls > summary {
    min-height: 44px;
    width: fit-content;
    padding: 5px 9px;
    border: 1px solid var(--line);
    border-radius: 7px;
    color: var(--muted);
    font-size: 11px;
    cursor: pointer;
  }
  .workspaceAdvancedControls[open] {
    position: absolute;
    z-index: 95;
    top: calc(100% + 4px);
    right: 12px;
    width: min(500px, calc(100vw - 24px));
    max-height: calc(100dvh - 100px);
    overflow: auto;
    padding: 9px;
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    background: var(--panel);
    box-shadow: 0 16px 44px var(--shadow-soft);
  }
  .workspaceAdvancedControls[open] > summary { margin-bottom: 6px; }
  .workspaceAdvancedControls .topbarControls { flex-wrap: wrap; justify-content: flex-start; }
  .workspaceAdvancedControls[open] > #tourBtn { margin-top: 6px; }
  .workspaceAdvancedControls .topbar .iconBtn,
  .workspaceAdvancedControls .iconBtn { min-height: 44px; }

  .workspaceBody {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  body.workspaceInspectorClosed .workspaceBody { grid-template-columns: minmax(0, 1fr); }
  .workspaceChatPane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--message-bg);
  }
  .workspaceChatPane > #activeTitleRow {
    display: flex;
    align-items: flex-start;
    flex: 0 0 auto;
    min-width: 0;
    padding: 14px 24px 10px;
    border-bottom: 1px solid var(--line);
  }
  .workspaceChatPane > #activeTitleRow .title { font-size: 14px; font-weight: 650; }
  body.workspaceShell .workspaceChatPane .workspace { display: block; max-width: 100%; margin: 0; font-size: 11px; }
  body.workspaceShell .workspaceChatPane .messages {
    flex: 1 1 auto;
    min-height: 0;
    padding: 24px clamp(18px, 4vw, 54px);
    overflow-y: auto;
    overscroll-behavior: contain;
    background: transparent;
  }
  body.workspaceShell .workspaceChatPane .msg { max-width: min(900px, 94%); }
  body.workspaceShell .workspaceChatPane .bubble { border-radius: 12px; box-shadow: none; }
  body.workspaceShell .workspaceChatPane .msg.assistant .bubble {
    padding: 5px 0;
    border: 0;
    background: transparent;
    box-shadow: none;
  }
  body.workspaceShell .workspaceChatPane .user .bubble {
    background: var(--accent-soft);
    border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
    color: var(--text);
  }
  body.workspaceShell .workspaceChatPane .bottomBar {
    flex: 0 0 auto;
    height: auto;
    max-height: min(42vh, 360px);
    border-top: 1px solid var(--line);
    background: var(--composer-bg);
  }
  body.workspaceShell .workspaceChatPane .composer {
    height: auto;
    min-height: 0;
    padding: 12px clamp(14px, 3vw, 34px) 10px;
    gap: 8px;
  }
  body.workspaceShell .workspaceChatPane #messageInput {
    min-height: 54px;
    max-height: 180px;
    border: 1px solid var(--line);
    border-radius: 9px;
    padding: 11px 12px;
    background: var(--input-bg);
  }
  body.workspaceShell .workspaceChatPane .composerControls { align-items: center; }
  .workspaceModeSwitch {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 44px;
    padding: 3px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--panel-2);
  }
  .workspaceModeSwitch button {
    min-height: 44px;
    padding: 6px 11px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
  }
  .workspaceModeSwitch button.active,
  .workspaceModeSwitch button[aria-pressed="true"] { color: var(--text); background: var(--panel); box-shadow: 0 1px 3px var(--shadow-soft); }
  body.workspaceShell .workspaceChatPane .modelPicker { min-height: 44px; height: auto; font-size: 12px; }
  body.workspaceShell .workspaceChatPane .accessModePicker { min-width: 125px; flex-shrink: 0; }
  body.workspaceShell .workspaceChatPane .sendBtn { min-width: 44px; height: 44px; border: 1px solid var(--accent); border-radius: 9px; background: var(--accent); color: #102018; box-shadow: none; }
  body.workspaceShell .workspaceChatPane .sendBtn:hover:not(:disabled) { background: var(--accent-strong); border-color: var(--accent-strong); color: #102018; }
  body.workspaceShell .workspaceChatPane .sendBtn:disabled { opacity: .5; }
  body.workspaceShell .workspaceChatPane .togglePill { min-height: 44px; }
  .workspaceComposerMore { position: relative; flex: 0 0 auto; }
  .workspaceComposerMore > summary {
    display: grid;
    width: 44px;
    min-width: 44px;
    min-height: 44px;
    place-items: center;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--button-bg);
    color: var(--muted);
    font-size: 20px;
    line-height: 1;
    list-style: none;
    cursor: pointer;
  }
  .workspaceComposerMore > summary::-webkit-details-marker { display: none; }
  .workspaceComposerMore > summary:hover { background: var(--button-hover); color: var(--text); }
  .workspaceComposerMorePanel {
    position: absolute;
    z-index: 40;
    right: 0;
    bottom: calc(100% + 8px);
    display: grid;
    min-width: 190px;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    background: var(--panel);
    box-shadow: 0 12px 32px var(--shadow-soft);
  }
  .workspaceComposerMorePanel .togglePill { width: 100%; justify-content: flex-start; padding-inline: 10px; text-align: left; }
  body.workspaceShell .workspaceChatPane .status { padding: 0 clamp(14px, 3vw, 34px) 10px; }

  .workspaceInspector {
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding: 17px 15px;
    border-left: 1px solid var(--line);
    background: var(--panel);
    color: var(--text);
    overscroll-behavior: contain;
  }
  .workspaceInspectorHead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 44px;
    margin: -4px 0 12px;
    padding-bottom: 9px;
    border-bottom: 1px solid var(--line);
  }
  .workspaceInspectorHead h2 { min-width: 0; margin: 0; font-size: 14px; }
  .workspaceInspectorHead .iconBtn { min-width: 44px; min-height: 44px; }
  .workspaceInspector h2,
  .workspaceInspector h3 { margin: 0 0 10px; font-size: 14px; }
  .workspaceInspector p { color: var(--muted); font-size: 12px; line-height: 1.5; }
  .workspaceInspector .context-panel { padding: 0; background: transparent; border: 0; box-shadow: none; }
  .workspaceInspector .context-panel h3 { margin: 18px 0 10px; }
  .workspaceInspector .steps { gap: 11px; margin: 12px 0; }
  .workspaceInspector .step { gap: 9px; font-size: 12px; }
  .workspaceInspector .context-panel > * + * { margin-top: 12px; }
  .workspaceInspector button { min-height: 44px; }
  .workspaceInspectorSection { min-width: 0; padding: 2px 0 14px; border-bottom: 1px solid var(--line); }
  .workspaceInspectorSection + .workspaceInspectorSection { padding-top: 14px; }
  .workspaceInspectorSection h3 { margin-top: 9px; overflow-wrap: anywhere; line-height: 1.4; }
  .workspacePlan { display: grid; gap: 9px; margin: 12px 0 0; padding-left: 22px; }
  .workspacePlan li { min-width: 0; padding-left: 2px; overflow-wrap: anywhere; font-size: 12px; }
  .workspacePlan li::marker { color: var(--muted); font-size: 11px; }
  .workspacePlan li[data-status="in_progress"]::marker { color: var(--accent-strong); }
  .workspacePlan li[data-status="completed"] { color: var(--muted); }
  .workspacePlan .taskMeta { display: block; margin-top: 2px; font-size: 11px; }
  .workspaceTaskProgress { display: block; width: 100%; height: 6px; margin: 6px 0 10px; accent-color: var(--accent); }
  .workspaceChecks { display: grid; gap: 6px; margin: 8px 0; padding: 0; list-style: none; }
  .workspaceChecks li { min-width: 0; padding: 7px 8px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface-subtle); overflow-wrap: anywhere; font-size: 11px; }
  .workspaceChecks li[data-passed="true"] { border-color: color-mix(in srgb, var(--accent) 28%, var(--line)); }
  .workspaceChecks li[data-passed="false"] { color: var(--danger); }
  .workspaceChangedFiles { margin-top: 8px; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  .workspaceChangedFiles summary { min-height: 44px; padding: 10px; color: var(--muted); font-size: 11px; cursor: pointer; }
  .workspaceChangedFiles > .workspaceFileName { padding: 5px 10px; border-top: 1px solid var(--line); color: var(--text); font: 11px/1.45 ui-monospace, "SF Mono", Menlo, monospace; overflow-wrap: anywhere; }
  .workspaceInspector .taskMeta { display: block; margin-top: 5px; overflow-wrap: anywhere; }
  .workspaceInspector .taskActions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .workspaceInspector .taskActions button { flex: 1 1 110px; min-height: 44px; }
  body.workspaceInspectorClosed .workspaceInspector { display: none; }

  body.workspaceShell #workspaceBoard,
  body.workspaceShell #workspaceFiles { display: none; }
  body.workspaceShell[data-workspace-tab="tasks"] #workspaceBoard { display: flex; flex: 1 1 auto; min-width: 0; min-height: 0; flex-direction: column; overflow: auto; }
  body.workspaceShell[data-workspace-tab="files"] #workspaceFiles { display: flex; flex: 1 1 auto; min-width: 0; min-height: 0; flex-direction: column; overflow: hidden; }
  body.workspaceShell[data-workspace-tab="tasks"] .workspaceBody,
  body.workspaceShell[data-workspace-tab="files"] .workspaceBody { display: block; }
  body.workspaceShell[data-workspace-tab="tasks"] .workspaceChatPane,
  body.workspaceShell[data-workspace-tab="files"] .workspaceChatPane,
  body.workspaceShell[data-workspace-tab="tasks"] .workspaceInspector,
  body.workspaceShell[data-workspace-tab="files"] .workspaceInspector { display: none; }
  .workspaceBoardToolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    min-height: 58px;
    padding: 10px 20px;
    border-bottom: 1px solid var(--line);
    background: var(--topbar-bg);
  }
  .workspaceBoardToolbar button { min-height: 44px; }
  .workspaceBoardToolbar input,
  .workspaceBoardToolbar select { min-height: 44px; min-width: 0; }
  .workspaceBoardToolbar h1 { min-width: 0; margin: 0; font-size: 20px; line-height: 1.25; letter-spacing: -.35px; }
  .workspaceBoardToolbar input { flex: 1 1 180px; padding: 8px 11px; border: 1px solid var(--line); border-radius: 8px; background: var(--input-bg); color: var(--text); }
  .workspaceBoardToolbar input::placeholder { color: var(--muted); }
  .workspaceBoardColumns {
    display: grid;
    grid-template-columns: repeat(4, minmax(220px, 1fr));
    align-items: start;
    gap: 12px;
    min-height: 0;
    padding: 16px 18px 24px;
    overflow: auto;
  }
  .workspaceBoardColumn {
    min-width: 0;
    min-height: 220px;
    padding: 10px;
    border: 1px solid var(--line);
    border-radius: 11px;
    background: var(--surface-subtle);
  }
  .workspaceBoardColumn > h2 { display: flex; align-items: center; gap: 8px; min-height: 44px; margin: 0; padding: 2px 3px 9px; font-size: 12px; font-weight: 650; }
  .workspaceBoardColumn > header .count { margin-left: auto; color: var(--muted); font-weight: 450; }
  .workspaceTaskCard {
    display: block;
    width: 100%;
    min-width: 0;
    margin: 0 0 9px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--panel);
    color: var(--text);
    text-align: left;
    box-shadow: 0 3px 10px var(--shadow-soft);
  }
  .workspaceTaskCard:hover { border-color: color-mix(in srgb, var(--accent) 52%, var(--line)); }
  .workspaceTaskCard h3 { margin: 9px 0 5px; font-size: 13px; line-height: 1.45; }
  .workspaceTaskCard p { margin: 0; color: var(--muted); font-size: 12px; }
  .workspaceTaskCard footer { display: flex; justify-content: space-between; gap: 8px; margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; }
  .workspaceTaskCard .taskStatus { display: inline-flex; align-items: center; gap: 6px; min-height: 24px; padding: 2px 7px; border-radius: 6px; background: var(--surface-hover); color: var(--muted); font-size: 11px; }
  .workspaceTaskCard .taskStatus[data-status="running"],
  .workspaceTaskCard .taskStatus[data-status="checking"] { color: var(--accent-strong); background: var(--accent-soft); }
  .workspaceTaskCard .taskStatus[data-status="done"] { color: var(--green-text); background: var(--accent-soft); }
  .workspaceTaskCard .taskStatus[data-status="failed"] { color: var(--danger); }
  .workspaceTaskCard .taskMeta { margin: 5px 0; overflow-wrap: anywhere; }
  .workspaceTaskCard .taskVerification,
  .workspaceTaskCard .workspaceFileName { overflow-wrap: anywhere; word-break: break-word; }
  .workspaceTaskCard .taskActions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .workspaceTaskCard .taskActions button { flex: 1 1 100px; min-height: 44px; }
  .workspaceTaskCard .workspaceChecks { margin-bottom: 0; }

  .workspaceFileLayout {
    display: grid;
    grid-template-columns: minmax(180px, 250px) minmax(0, 1fr);
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .workspaceFileTree { min-width: 0; min-height: 0; overflow: auto; padding: 12px; border-right: 1px solid var(--line); background: var(--panel); }
  .workspaceFileTree .workspaceFileButton {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 44px;
    padding: 7px 9px;
    border: 1px solid transparent;
    border-radius: 7px;
    background: transparent;
    color: var(--muted);
    text-align: left;
    overflow-wrap: anywhere;
  }
  .workspaceFileTree .workspaceFileButton:hover { background: var(--surface-hover); color: var(--text); }
  .workspaceFileTree .workspaceFileButton.active,
  .workspaceFileTree .workspaceFileButton[aria-current="true"] { background: var(--accent-soft); color: var(--text); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
  .workspaceFileDirectory { padding: 9px 8px; color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
  .workspaceFileEditor { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
  .workspaceFileEditor h2 { flex: 0 0 auto; min-width: 0; margin: 0; padding: 12px 18px; border-bottom: 1px solid var(--line); color: var(--text); font: 12px/1.4 ui-monospace, "SF Mono", Menlo, monospace; overflow-wrap: anywhere; }
  .workspaceFilePreview { flex: 1 1 auto; min-width: 0; min-height: 0; margin: 0; padding: 20px; overflow: auto; background: var(--panel-2); color: var(--text); font: 12px/1.65 ui-monospace, "SF Mono", Menlo, monospace; tab-size: 2; white-space: pre; }

  body.workspaceShell .settingsOverlay,
  body.workspaceShell .newOverlay,
  body.workspaceShell .newChatOverlay,
  body.workspaceShell .settingsPanel,
  body.workspaceShell .newForm { min-width: 0; }
  body.workspaceShell .settingsOverlay,
  body.workspaceShell .newOverlay { z-index: 100; }
  body.workspaceShell .settingsPanel { max-width: min(1040px, calc(100vw - 32px)); }

  @media (max-width: 1000px) {
    body.workspaceShell .app { --sidebar-width: 220px; }
    .workspaceBody { grid-template-columns: minmax(0, 1fr) 270px; }
    .workspaceBoardColumns { grid-template-columns: repeat(4, minmax(205px, 1fr)); }
  }
  @media (max-width: 760px) {
    body.workspaceShell .app { --sidebar-width: 0px; grid-template-columns: 0 minmax(0, 1fr); }
    body.workspaceShell .main { grid-column: 2; }
    body.workspaceShell .sidebar { display: none; }
    body.workspaceShell .sidebarResizer { display: none; }
    body.workspaceSidebarOpen .sidebar {
      position: fixed;
      z-index: 80;
      inset: 0 auto 0 0;
      display: flex;
      width: min(300px, calc(100vw - 56px));
      max-width: calc(100vw - 56px);
      height: 100dvh;
      box-shadow: 14px 0 36px var(--shadow-soft);
    }
    body.workspaceShell .topbar { min-height: 58px; padding: 7px 10px; gap: 6px 8px; flex-wrap: wrap; }
    .workspaceMobileMenu { display: inline-flex; flex: 0 0 44px; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; }
    .workspaceProjectCrumb { flex: 1 1 120px; }
    .workspaceTabs { order: 3; flex: 1 1 100%; justify-content: stretch; }
    .workspaceTabs button { flex: 1 1 0; min-width: 0; }
    .workspaceInspectorToggle { min-width: 44px; }
    .workspaceBody { display: block; position: relative; }
    .workspaceInspector { display: none; }
    body.workspaceInspectorOpenMobile .workspaceChatPane { display: none; }
    body.workspaceInspectorOpenMobile .workspaceInspector { display: block; height: 100%; border-left: 0; }
    body.workspaceInspectorClosed .workspaceInspector { display: none; }
    body.workspaceShell .workspaceChatPane .messages { padding: 18px 14px; }
    body.workspaceShell .workspaceChatPane .msg { max-width: 100%; }
    body.workspaceShell .workspaceChatPane .bottomBar { max-height: min(48vh, 340px); }
    body.workspaceShell .workspaceChatPane .composer { padding: 10px 10px 8px; }
    body.workspaceShell .workspaceChatPane .composerControls { gap: 6px; }
    .workspaceModeSwitch { flex: 1 1 auto; }
    .workspaceModeSwitch button { flex: 1 1 0; min-width: 0; padding-inline: 7px; }
    .workspaceBoardToolbar { padding: 8px 10px; }
    .workspaceBoardColumns { grid-template-columns: repeat(4, minmax(260px, 82vw)); padding: 10px; }
    .workspaceFileLayout { grid-template-columns: minmax(132px, 38%) minmax(0, 1fr); }
    .workspaceFileTree { padding: 8px; }
    .workspaceFilePreview { padding: 12px; font-size: 11px; }
  }
  @media (max-width: 420px) {
    body.workspaceShell .topbar .topbarActions { gap: 2px; padding-left: 3px; }
    body.workspaceShell .topbar .topbarActions .iconBtn { min-width: 44px; padding-inline: 5px; }
    body.workspaceShell .composerControls > .composerSpacer { display: none; }
    body.workspaceShell .workspaceChatPane .modelPicker { max-width: 106px; }
    body.workspaceShell .workspaceChatPane .sendBtn { min-width: 44px; }
    .workspaceBoardColumns { grid-template-columns: repeat(4, minmax(248px, 84vw)); }
  }
  @media (prefers-reduced-motion: reduce) {
    body.workspaceShell *, body.workspaceShell *::before, body.workspaceShell *::after {
      scroll-behavior: auto !important;
      animation-duration: .01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: .01ms !important;
    }
  }

  @media (min-width: 761px) and (max-width: 1000px) {
    .workspaceBoardColumns { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 1000px) {
    .workspaceBody { display: block; }
    .workspaceChatPane { height: 100%; }
    .workspaceInspector { display: none; }
    body.workspaceInspectorOpenMobile .workspaceChatPane { display: none; }
    body.workspaceInspectorOpenMobile .workspaceInspector { display: block; height: 100%; }
  }
`;
