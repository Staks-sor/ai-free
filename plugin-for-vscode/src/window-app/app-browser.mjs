// In-app Web-браузер для DeepSeek/Qwen — фасад над src/browser/service.mjs.

import {
  WEB_BROWSER_DEFAULT_VIEWPORT,
  WEB_BROWSER_PROFILE,
  closeWebBrowser,
  getWebBrowserPage,
  getWebBrowserViewport,
  resetWebBrowser,
  setWebBrowserViewport,
  warmWebBrowser,
} from "./web-browser.mjs";
import { createLiveViewportState } from "./live-viewport.mjs";
import {
  browserClick,
  browserNavigate,
  browserPressKey,
  browserReset,
  browserSnapshot,
  browserType,
  browserWarm,
  validateBrowserUrl,
} from "../browser/service.mjs";

export const APP_BROWSER_PROFILE = WEB_BROWSER_PROFILE;
export const APP_BROWSER_VIEWPORT = WEB_BROWSER_DEFAULT_VIEWPORT;
const appBrowserLiveViewport = createLiveViewportState(WEB_BROWSER_DEFAULT_VIEWPORT);

export function getAppBrowserViewport() {
  return getWebBrowserViewport() || appBrowserLiveViewport.get();
}

export async function setAppBrowserViewport(body = {}) {
  appBrowserLiveViewport.set(body.width, body.height);
  return setWebBrowserViewport(body);
}

export async function getAppBrowserSession() {
  const page = await getWebBrowserPage();
  return {
    context: page.context(),
    page,
    close: async () => {},
    mode: "web-headless",
  };
}

export { getWebBrowserPage as getAppBrowserPage };
export { closeWebBrowser as closeAppBrowser };
export { browserWarm as warmAppBrowser };
export { validateBrowserUrl as validateAppBrowserUrl };
export { browserNavigate as navigateAppBrowser };
export { browserClick as clickAppBrowser };
export { browserType as typeAppBrowser };
export { browserPressKey as pressAppBrowserKey };

export async function captureAppBrowserSnapshot(options = {}) {
  return browserSnapshot({
    includeScreenshot: false,
    includeScreenshotBase64: false,
    ...options,
  });
}

export async function resetAppBrowserSession() {
  await browserReset();
  await getWebBrowserPage();
  return { ok: true };
}
