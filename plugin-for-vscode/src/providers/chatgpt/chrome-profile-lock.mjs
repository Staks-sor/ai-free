// Сериализация запуска Chrome на одном user-data-dir — иначе «Не удалось открыть профиль».

/** @type {Promise<void>} */
let chain = Promise.resolve();

export function withChatGPTProfileLock(task) {
  const run = chain.then(() => task(), () => task());
  chain = run.then(
    () => {},
    () => {},
  );
  return run;
}
