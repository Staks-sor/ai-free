import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const stylesUrl = new URL('../src/window-app/workspace-ui-styles.mjs', import.meta.url);

test('workspace overlay keeps the chat layout responsive and theme-aware', async () => {
  const source = await readFile(stylesUrl, 'utf8');
  const { WORKSPACE_STYLES } = await import(stylesUrl);

  assert.ok(/export const WORKSPACE_STYLES\s*=/.test(source));
  assert.ok(/body\.workspaceShell/.test(WORKSPACE_STYLES));
  assert.ok(/body\.workspaceShell\[data-theme="light"\]/.test(WORKSPACE_STYLES));
  assert.ok(/body\.workspaceShell\[data-theme="contrast"\]/.test(WORKSPACE_STYLES));
  assert.ok(/\.workspaceBody/.test(WORKSPACE_STYLES));
  assert.ok(/\.workspaceChatPane/.test(WORKSPACE_STYLES));
  assert.ok(/\.workspaceInspectorClosed/.test(WORKSPACE_STYLES));
  assert.ok(/#workspaceBoard/.test(WORKSPACE_STYLES));
  assert.ok(/#workspaceFiles/.test(WORKSPACE_STYLES));
  assert.ok(/\.workspaceInspectorHead/.test(WORKSPACE_STYLES));
  assert.ok(/\.workspaceInspectorSection/.test(WORKSPACE_STYLES));
  assert.ok(/\.workspacePlan/.test(WORKSPACE_STYLES));
  assert.ok(/\.workspaceChecks/.test(WORKSPACE_STYLES));
  assert.ok(/\.workspaceTaskProgress/.test(WORKSPACE_STYLES));
  assert.ok(/\.workspaceProjectCrumb/.test(WORKSPACE_STYLES));
  assert.ok(/\.workspaceSubscription/.test(WORKSPACE_STYLES));
  assert.ok(/\.workspaceFileButton/.test(WORKSPACE_STYLES));
  assert.ok(/\.workspaceFileEditor/.test(WORKSPACE_STYLES));
  assert.ok(/body\.workspaceSidebarOpen/.test(WORKSPACE_STYLES));
  assert.ok(/flex-wrap:\s*nowrap/.test(WORKSPACE_STYLES));
  assert.ok(/\.workspaceAdvancedControls\[open\]\s*\{[^}]*position:\s*absolute/s.test(WORKSPACE_STYLES));
  assert.ok(/\.chatItem\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(WORKSPACE_STYLES));
  assert.ok(/\.workspaceComposerMorePanel/.test(WORKSPACE_STYLES));
  assert.ok(/\.workspaceBoardToolbar h1/.test(WORKSPACE_STYLES));
  assert.ok(/@media\s*\(max-width:\s*760px\)/.test(WORKSPACE_STYLES));
  assert.ok(/prefers-reduced-motion:\s*reduce/.test(WORKSPACE_STYLES));
  assert.ok(/min-height:\s*44px/.test(WORKSPACE_STYLES));
});

test('workspace files are byte-identical in desktop and VS Code runtimes', async () => {
  const desktop = await readFile(stylesUrl, 'utf8');
  const vscode = await readFile(
    new URL('../plugin-for-vscode/src/window-app/workspace-ui-styles.mjs', import.meta.url),
    'utf8'
  );

  assert.equal(vscode, desktop);
});
