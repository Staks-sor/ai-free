import { spawn } from 'node:child_process';
export function externalLinkCommand(value, platform = process.platform) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['synvox.pro','t.me','auth.robokassa.ru'].includes(url.hostname)) throw new Error('Unsupported external link');
  if (platform === 'darwin') return ['open', [url.href]];
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url.href]];
  return ['xdg-open', [url.href]];
}
export function openExternalLink(value) {
  const [command, args] = externalLinkCommand(value);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: 'ignore', windowsHide: true });
    child.once('error', () => reject(new Error('Не удалось открыть системный браузер. Скопируйте ссылку.')));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Не удалось открыть системный браузер. Скопируйте ссылку.')));
  });
}
