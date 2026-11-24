# From download to your first chat

SYNVOX 0.5.65: one ZIP archive for macOS, Windows and Linux. A preview for testing, not a native installer.

https://synvox.pro/en/instructions/

## 1. Install Node.js

Install Node.js 22 from the official website for your operating system and processor. npm is included. Open a new terminal window and check the versions. You need internet access and your own AI provider account.

```
node --version
npm --version
```

Qwen/DeepSeek sign-in also requires Python 3.10+ from https://www.python.org/downloads/. On Windows, enable adding Python to PATH during installation and open a new terminal. On first connection, SYNVOX downloads Camoufox and its browser; Settings → Accounts shows progress. PyPI and GitHub downloads must be reachable.

## 2. Extract the archive

Windows: right-click the ZIP → Extract All. macOS: double-click the ZIP. Linux: use Extract in your file manager. Use a separate SYNVOX folder. Do not run inside the ZIP or extract over an older version.

## 3. Install dependencies

Open the folder containing package.json. Windows: enter cmd in the File Explorer address bar and press Enter. macOS/Linux: type cd followed by a space in Terminal, drag the extracted folder into the window and press Enter. Run the command and wait for dependencies and browsers to download; this may take several minutes.

```
npm ci
```

## 4. Start the application

Run this in the same folder. Keep the terminal open. For later launches, only this command is needed. Press Ctrl+C in the terminal to stop.

```
npm start
```

## 5. Connect an AI and a project

Select a provider and sign in to your account using the offered login window. Create a chat, select a model and project folder. First ask for an overview without file changes. Review permissions in Settings before edits and commands. Use a project copy or a separate Git branch. Third-party accounts and limits are not included.

## 6. Access

SYNVOX is free for personal use. AI providers have their own terms and limits.

https://nodejs.org/en/download

## Updating an existing installation

Stop the old app with Ctrl+C in its terminal. Extract this archive to a separate folder, for example C:\SYNVOX-0.5.65, open the nested SYNVOX folder containing package.json, then run npm ci and npm start. Startup output must show version 0.5.65. Retain the old program folder; do not delete the user directories .deepseek-cli, .qwen-cli or .ai-free. Chats, settings and AI sessions are stored separately from the program folder.

## node or npm not found

Install Node.js 22, close and reopen the terminal, then check the version again.

## package.json / ENOENT error

Change to the extracted folder containing package.json and retry.

## Browser download failed / Linux libraries missing

Check your connection and retry npm ci. Linux may require browser system libraries. Send the exact error to support; do not disable system security.

Need help? Send your OS, Node.js version and error text. Remove keys, cookies and passwords. stas.sor@gmail.com


## Computer control

Select Computer in the current chat for screen, mouse and keyboard tools. Windows requires an active user desktop; shell is cmd.exe. macOS requires Screen Recording and Accessibility. Linux requires X11 and DISPLAY; Wayland is unsupported. Ubuntu/Debian may need libxtst6, libxrandr2 and libxi6; browser dependencies: npx playwright install-deps chromium. If @jitsi/robotjs is missing, retry npm ci and retain the error. Chat, project files and built-in browser snapshots work independently of desktop tools. Full Windows input and multiple monitors still require manual acceptance.

## Report a problem

In 0.5.65, select Report error beside an error, or Settings → Status → Report a problem. Add a description and optionally a contact/image, then select Prepare report. App/OS versions are filled automatically. Review the report and select Save file. Online report intake is not enabled yet; reports are not sent automatically. Do not include passwords, keys or other people’s data.
