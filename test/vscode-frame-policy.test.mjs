import test from 'node:test';
import assert from 'node:assert/strict';

for (const prefix of ['../src/', '../plugin-for-vscode/src/']) {
  test(`${prefix} HTML permits the complete desktop VS Code ancestor chain`, async () => {
    const { sendHtml } = await import(`${prefix}window-app/http.mjs`);
    let headers;
    sendHtml({ writeHead(status, value) { assert.equal(status, 200); headers = value; }, end() {} }, '<!doctype html>');
    const policy = headers['Content-Security-Policy'];
    const sources = policy.split(/\s+/).slice(1);
    assert.ok(sources.includes('vscode-file://vscode-app'), 'The outer VS Code workbench is an ancestor too');
    assert.ok(sources.includes('vscode-webview:'));
    assert.ok(sources.includes("'self'"));
    assert.ok(!sources.includes('*'));
    assert.ok(!sources.includes('vscode-file:'));
    assert.ok(!sources.includes('http:'));
    assert.ok(!sources.includes('https:'));
  });
}
