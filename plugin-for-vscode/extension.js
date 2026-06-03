const vscode = require('vscode');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const fs = require('fs');

let serverProcess = null;
let outputChannel = null;
const REQUIRED_NODE_MAJOR = 18;

// Поиск свободного порта в диапазоне
function findFreePort(startPort) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.listen(startPort, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
        server.on('error', () => {
            resolve(findFreePort(startPort + 1));
        });
    });
}

function waitForPort(port, timeoutMs = 30000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
        const tryConnect = () => {
            const socket = net.createConnection({ host: '127.0.0.1', port });
            socket.once('connect', () => {
                socket.end();
                resolve();
            });
            socket.once('error', () => {
                socket.destroy();
                if (Date.now() - started >= timeoutMs) {
                    reject(new Error(`server did not start on port ${port} within ${timeoutMs}ms`));
                    return;
                }
                setTimeout(tryConnect, 250);
            });
        };
        tryConnect();
    });
}

function waitForServerReady(port, child, timeoutMs = 30000) {
    let stdoutBuffer = '';
    return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            child.stdout.off('data', onStdout);
            child.off('error', onError);
            child.off('close', onClose);
            clearTimeout(timer);
        };
        const finish = (result) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(result);
        };
        const fail = (error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        };
        const onStdout = (data) => {
            stdoutBuffer += data.toString();
            if (stdoutBuffer.includes(`Workspace server: http://127.0.0.1:${port}`)) {
                finish({ source: 'stdout' });
            }
        };
        const onError = (error) => fail(error);
        const onClose = (code, signal) => {
            if (code === 0) return;
            fail(new Error(`server process exited before startup, code=${code}, signal=${signal || 'none'}`));
        };
        const timer = setTimeout(() => {
            fail(new Error(`server did not start on port ${port} within ${timeoutMs}ms`));
        }, timeoutMs);

        child.stdout.on('data', onStdout);
        child.on('error', onError);
        child.on('close', onClose);
        waitForPort(port, timeoutMs).then(
            () => finish({ source: 'port' }),
            () => {}
        );
    });
}

function runNodeVersionCheck(timeoutMs = 5000) {
    return new Promise((resolve) => {
        const child = spawn('node', ['--version'], {
            windowsHide: true
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { child.kill(); } catch {}
            resolve({ ok: false, message: `node --version timed out after ${timeoutMs}ms` });
        }, timeoutMs);

        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });
        child.on('error', (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ ok: false, message: error.code === 'ENOENT'
                ? 'Node.js was not found in PATH'
                : `Could not start Node.js: ${error.message}` });
        });
        child.on('close', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const version = stdout.trim();
            if (code !== 0) {
                resolve({ ok: false, message: `node --version exited with code ${code}: ${stderr.trim()}` });
                return;
            }
            const match = /^v(\d+)\./.exec(version);
            const major = match ? Number(match[1]) : 0;
            if (!major || major < REQUIRED_NODE_MAJOR) {
                resolve({ ok: false, message: `Node.js ${REQUIRED_NODE_MAJOR}+ is required, found ${version || 'unknown version'}` });
                return;
            }
            resolve({ ok: true, version });
        });
    });
}

async function reportStartupError(message) {
    outputChannel.appendLine(`[Startup Error] ${message}`);
    outputChannel.show(true);
    const action = await vscode.window.showErrorMessage(`AI Free: ${message}`, 'Open log');
    if (action === 'Open log') {
        outputChannel.show(true);
    }
}

function resolveWorkspacePath() {
    const folders = vscode.workspace.workspaceFolders || [];
    outputChannel.appendLine(`VS Code workspaceFolders: ${folders.length}`);
    for (const folder of folders) {
        outputChannel.appendLine(` - ${folder.uri.fsPath}`);
    }

    if (folders.length > 0) {
        return folders[0].uri.fsPath;
    }

    if (vscode.workspace.workspaceFile && vscode.workspace.workspaceFile.scheme === 'file') {
        return path.dirname(vscode.workspace.workspaceFile.fsPath);
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document && activeEditor.document.uri.scheme === 'file') {
        return path.dirname(activeEditor.document.uri.fsPath);
    }

    if (vscode.workspace.rootPath) {
        return vscode.workspace.rootPath;
    }

    return process.cwd();
}

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
    outputChannel = vscode.window.createOutputChannel("AI Free");
    outputChannel.appendLine("Activating AI Free Chat & Agent...");
    outputChannel.appendLine(`Platform: ${process.platform} ${process.arch}`);

    const nodeCheck = await runNodeVersionCheck();
    if (!nodeCheck.ok) {
        await reportStartupError(`${nodeCheck.message}. Install Node.js 18+ and restart VS Code.`);
        return;
    }
    outputChannel.appendLine(`Node.js: ${nodeCheck.version}`);

    // Определяем пути к серверу
    // 1. Для упакованной автономной версии файлы лежат внутри плагина
    let serverPath = path.join(__dirname, 'bin', 'deepseek.mjs');
    let projectRoot = __dirname;

    if (!fs.existsSync(serverPath)) {
        // 2. Для режима разработки файлы лежат на уровень выше в репозитории
        serverPath = path.join(__dirname, '..', 'bin', 'deepseek.mjs');
        projectRoot = path.join(__dirname, '..');
    }

    outputChannel.appendLine(`Using server path: ${serverPath}`);
    outputChannel.appendLine(`Project root: ${projectRoot}`);

    if (!fs.existsSync(serverPath)) {
        vscode.window.showErrorMessage(`AI Free: Не найден исполняемый файл сервера по пути ${serverPath}`);
        return;
    }

    // Находим свободный порт
    const port = await findFreePort(4320);
    outputChannel.appendLine(`Found free port: ${port}`);

    // Определяем текущий workspace VS Code
    let workspacePath = resolveWorkspacePath();
    outputChannel.appendLine(`Using workspace: ${workspacePath}`);

    // Запускаем сервер ai-free в фоне
    outputChannel.appendLine("Spawning background Node.js server...");
    
    // Передаем переменные окружения, чтобы сохранить настройки пользователя
    const env = { ...process.env, AI_FREE_VSCODE: "1", AI_FREE_VSCODE_WORKSPACE: workspacePath };
    
    serverProcess = spawn('node', [
        serverPath,
        '--no-window',
        '--port', String(port),
        '--workspace', workspacePath
    ], {
        cwd: projectRoot,
        env,
        windowsHide: true
    });

    let startupError = null;
    serverProcess.on('error', (error) => {
        startupError = error;
        outputChannel.appendLine(`[Error] Failed to spawn server: ${error.message}`);
    });

    serverProcess.stdout.on('data', (data) => {
        const text = data.toString();
        outputChannel.append(text);
    });

    serverProcess.stderr.on('data', (data) => {
        const text = data.toString();
        outputChannel.append(`[Error] ${text}`);
    });

    serverProcess.on('close', (code, signal) => {
        if (code !== 0 && !startupError) {
            startupError = new Error(`server process exited before startup, code=${code}, signal=${signal || 'none'}`);
        }
        outputChannel.appendLine(`Server process exited with code ${code}`);
    });

    try {
        const ready = await waitForServerReady(port, serverProcess, 30000);
        outputChannel.appendLine(`Server readiness confirmed by ${ready.source}`);
    } catch (error) {
        try { if (serverProcess) serverProcess.kill(); } catch {}
        const detail = startupError ? `${error.message}; ${startupError.message}` : error.message;
        await reportStartupError(`сервер не запустился: ${detail}`);
        return;
    }

    // Регистрируем провайдер для Sidebar Webview
    const provider = new AIWebviewViewProvider(port);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("ai-free-chat", provider, {
            webviewOptions: {
                retainContextWhenHidden: true // Сохраняем состояние чата при переключении вкладок
            }
        })
    );

    outputChannel.appendLine(`AI Free Chat ready on http://127.0.0.1:${port}`);
}

class AIWebviewViewProvider {
    constructor(port) {
        this.port = port;
    }

    /**
     * @param {vscode.WebviewView} webviewView
     */
    resolveWebviewView(webviewView) {
        webviewView.webview.options = {
            enableScripts: true
        };

        // Встраиваем локальный сервер во фрейм. 
        // CSS стили адаптируют iframe под размер боковой панели VS Code.
        webviewView.webview.html = `
            <!DOCTYPE html>
            <html lang="ru">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>AI Free Chat & Agent</title>
                <style>
                    body, html {
                        margin: 0;
                        padding: 0;
                        width: 100%;
                        height: 100%;
                        overflow: hidden;
                        background-color: var(--vscode-sideBar-background, #1e1e1e);
                    }
                    iframe {
                        border: none;
                        width: 100%;
                        height: 100%;
                    }
                </style>
            </head>
            <body>
                <iframe src="http://127.0.0.1:${this.port}/"></iframe>
            </body>
            </html>
        `;
    }
}

function deactivate() {
    if (serverProcess) {
        outputChannel.appendLine("Stopping background server...");
        serverProcess.kill();
    }
}

module.exports = {
    activate,
    deactivate
};
