// Сериализация запуска Chrome на одном user-data-dir — иначе «Не удалось открыть профиль».
import { accountActivity, profileActivityId } from '../activity-session.mjs';

/** @type {Promise<void>} */
let chain = Promise.resolve();

export function withChatGPTProfileLock(task, profileDir) {
  const execute = async () => {
    const release = profileDir ? accountActivity.acquire('chatgpt', profileActivityId(profileDir)) : null;
    try { return await task(); } finally { release?.(); }
  };
  const run = chain.then(execute, execute);
  chain = run.then(
    () => {},
    () => {},
  );
  return run;
}
