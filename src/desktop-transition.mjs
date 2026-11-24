// Desktop-only signed website updates. Plugin delivery remains unchanged.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verify, createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { AI_FREE_VERSION } from './config.mjs';
import { compareVersions } from './updater.mjs';
import { installWebsiteBundle } from './website-update-install.mjs';

export const UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEApftoeVOW6o93TtkTcIB51xcTrGcWtHZ6Kc6giX+/At0=
-----END PUBLIC KEY-----`;
const SOURCE = 'https://synvox.pro/desktop/update.json';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function fetchUpdateBytes(url, fetchImpl = fetch, limit = 32 * 1024 * 1024) {
  const response = await fetchImpl(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(limit === 16384 ? 8000 : 60000) });
  if (!response.ok) throw new Error('Сайт обновлений временно недоступен. Попробуйте позже.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('Превышен допустимый размер обновления.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function checkForUpdate({ fetchImpl = fetch, currentVersion = AI_FREE_VERSION, platform = process.platform, publicKey = UPDATE_PUBLIC_KEY } = {}) {
  const result = {
    ok: true, currentVersion, latestVersion: '', updateAvailable: false, canUpdate: false,
    updateMethod: 'website', source: SOURCE, releasesUrl: 'https://synvox.pro/updates/',
    updateWarning: 'AI Free становится SYNVOX. Дальнейшие обновления устанавливаются с synvox.pro.', error: '',
  };
  try {
    const manifest = JSON.parse((await fetchUpdateBytes(SOURCE, fetchImpl, 16384)).toString('utf8'));
    if (manifest?.schemaVersion !== 1) throw new Error('Неподдерживаемый формат обновления.');
    if (manifest.status === 'pending') {
      result.updateWarning = 'Следующий выпуск SYNVOX готовится. Обновления будут устанавливаться с synvox.pro. Текущая версия продолжает работать.';
      return result;
    }
    if (manifest.status !== 'ready' || typeof manifest.payload !== 'string' || typeof manifest.signature !== 'string') throw new Error('Некорректный выпуск.');
    const payload = Buffer.from(manifest.payload, 'base64');
    if (!verify(null, payload, publicKey, Buffer.from(manifest.signature, 'base64'))) throw new Error('Подпись обновления недействительна.');
    const release = JSON.parse(payload.toString('utf8'));
    if (!/^\d+\.\d+\.\d+$/.test(release.version)
      || !Array.isArray(release.platforms) || !release.platforms.every((p) => ['darwin', 'win32', 'linux'].includes(p))
      || !/^https:\/\/synvox\.pro\/desktop\/releases\/[a-zA-Z0-9._-]+\.json\.gz$/.test(release.url)
      || !/^[a-f0-9]{64}$/.test(release.sha256)) throw new Error('Некорректные сведения о выпуске.');
    result.latestVersion = release.version;
    result.updateAvailable = release.platforms.includes(platform) && compareVersions(currentVersion, release.version) < 0;
    result.canUpdate = result.updateAvailable;
    result.release = release;
    if (!release.platforms.includes(platform)) result.updateWarning = 'Для вашей платформы новый выпуск ещё не опубликован.';
  } catch (error) {
    result.ok = false;
    result.error = error.message;
  }
  return result;
}

export async function runUpdate(options = {}) {
  const root = options.root || ROOT;
  const lock = await fs.open(path.join(root, '.synvox-update.lock'), 'wx').catch((error) => {
    if (error.code === 'EEXIST') throw new Error('Обновление уже выполняется или было прервано. Проверьте резервную копию перед повтором.');
    throw error;
  });
  try {
    const currentVersion = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
    const before = await checkForUpdate({ ...options, currentVersion });
    if (!before.ok) throw new Error(before.error);
    if (!before.updateAvailable) return { ok: true, updated: false, restartReady: false, after: before, message: before.updateWarning };
    const bytes = await fetchUpdateBytes(before.release.url, options.fetchImpl);
    if (createHash('sha256').update(bytes).digest('hex') !== before.release.sha256) throw new Error('Не совпала контрольная сумма обновления.');
    const bundle = JSON.parse(gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 }).toString('utf8'));
    const backupPath = await installWebsiteBundle(root, bundle, before.latestVersion, options);
    return {
      ok: true, updated: true, restartReady: true, backupPath,
      after: { ...before, currentVersion: before.latestVersion, updateAvailable: false, canUpdate: false },
      message: 'SYNVOX обновлён с сайта. Чаты и настройки сохранены. Перезапустите приложение.',
    };
  } finally {
    await lock.close();
    await fs.unlink(path.join(root, '.synvox-update.lock'));
  }
}
