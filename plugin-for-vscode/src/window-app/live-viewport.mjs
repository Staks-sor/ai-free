// Общая логика размеров live-панелей (MJPEG + Playwright viewport).

export function clampLiveDimension(value, min, max, fallback) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function clampLiveViewport(width, height, defaults) {
  return {
    width: clampLiveDimension(width, 280, 1400, defaults.width),
    height: clampLiveDimension(height, 200, 1800, defaults.height),
  };
}

export function createLiveViewportState(defaults) {
  let current = { ...defaults };
  return {
    get() {
      return { ...current };
    },
    set(width, height) {
      current = clampLiveViewport(width, height, defaults);
      return { ...current };
    },
  };
}
