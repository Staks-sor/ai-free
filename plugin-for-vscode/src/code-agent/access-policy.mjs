import os from 'node:os';
import path from 'node:path';

export function hasComputerAccess(options = {}) {
  return options.accessMode === 'computer';
}

export function resolveComputerPath(workspaceRoot, requestedPath) {
  if (typeof requestedPath !== 'string' || !requestedPath.trim() || requestedPath.includes('\0')) throw new Error('Tool path is required.');
  const expanded = requestedPath === '~' ? os.homedir()
    : /^~[/\\]/.test(requestedPath) ? path.join(os.homedir(), requestedPath.slice(2)) : requestedPath;
  return path.resolve(workspaceRoot, expanded);
}

export function computerAccessPrompt(options = {}) {
  const shell = process.platform === 'win32'
    ? 'run_shell uses cmd.exe (/d /s /c), not PowerShell; use Windows cmd syntax and do not assume Bash, grep, find or Unix quoting are installed. To use another installed shell, invoke it explicitly through run_command.'
    : 'run_shell uses POSIX sh (-c). Use portable sh syntax; invoke another installed shell explicitly through run_command when needed.';
  const access = hasComputerAccess(options)
    ? `Computer access: enabled for this chat. Host operating system: ${process.platform} (${os.release()}).
You may run any installed executable (including absolute paths or project binaries), use run_shell, and read/change/delete files outside the project with absolute paths. Relative paths resolve from the workspace; commands may specify cwd. OS permissions and application availability still apply.
Use computer_snapshot to inspect the desktop before computer_click/computer_move/computer_drag, computer_type, computer_key or computer_scroll. Coordinates are logical desktop coordinates; use the returned image/coordinate dimensions. Never guess unseen screen content or claim visual verification without receiving image pixels. If this provider cannot receive screenshots, use commands or ask the user for the exact target.
Apply this access only to the user's task. Do not read unrelated credentials, send messages, publish, spend money or delete unrelated data without a direct user request. Stop when the task is complete.`
    : 'Computer access: disabled. Use only relative workspace paths and allowed commands. Native desktop tools require the user to select Computer in this chat.';
  return `${access}\n${shell}`;
}
