import fs from 'node:fs';
import { DEFAULT_AUTH_FILE } from '../config.mjs';
import { readSavedAuth } from '../auth/files.mjs';
import { readChatGPTAuth, isChatGPTAuthUsable } from './chatgpt/auth-files.mjs';
import { CHATGPT_AUTH_FILE, CHATGPT_BROWSER_PROFILE } from './chatgpt/config.mjs';
import { readGLMAuth, isGLMAuthUsable } from './glm/auth-files.mjs';
import { isGLMStorageStateUsable } from './glm/storage-state.mjs';
import { GLM_AUTH_FILE, GLM_BROWSER_PROFILE, GLM_STORAGE_STATE } from './glm/config.mjs';
import { readGoogleAIAuth, isGoogleAIAuthUsable } from './google-ai/auth-files.mjs';
import { GOOGLE_AI_AUTH_FILE, GOOGLE_AI_CAMOUFOX_PROFILE, GOOGLE_AI_FINGERPRINT_STATE, GOOGLE_AI_STORAGE_STATE } from './google-ai/config.mjs';

function jwtIdentity(token) {
  try {
    const value = JSON.parse(Buffer.from(String(token || '').split('.')[1], 'base64url').toString('utf8'));
    return value.sub || value.uid || value.id || value.email || value['https://api.openai.com/profile']?.email || null;
  } catch { return null; }
}
const safely = read => { try { return read(); } catch { return null; } };

export function isGoogleAIDebugEnabled(env = process.env) {
  return Boolean(env.DEEPSEEK_DEBUG_GOOGLE_AI);
}

export function isGLMDebugEnabled(env = process.env) {
  return Boolean(env.DEEPSEEK_DEBUG_GLM);
}

export function createWebAccountAdapters({ legacyDeepSeekClient = null } = {}) {
  const deepseek = {
    legacyPaths: { authFile: DEFAULT_AUTH_FILE },
    hasLegacy: () => fs.existsSync(DEFAULT_AUTH_FILE) || Boolean(legacyDeepSeekClient?.token),
    hasAuth: paths => Boolean(safely(() => readSavedAuth(paths.authFile))?.token
      || (paths.authFile === DEFAULT_AUTH_FILE && legacyDeepSeekClient?.token)),
    identity: paths => jwtIdentity(safely(() => readSavedAuth(paths.authFile))?.token),
    close: async () => {},
    login: async (paths, _accountId, onProgress) => {
      const { loginAndSaveAuth } = await import('../browser/login.mjs');
      return loginAndSaveAuth(paths.authFile, { ...(paths.authFile === DEFAULT_AUTH_FILE ? {} : paths), onProgress });
    },
    buildClient: async (paths, accountId) => {
      if (accountId === 'default' && legacyDeepSeekClient) {
        legacyDeepSeekClient._applyAuth?.(safely(() => readSavedAuth(paths.authFile)));
        return legacyDeepSeekClient;
      }
      const auth = readSavedAuth(paths.authFile);
      const { DeepSeekChatClient } = await import('./deepseek/client.mjs');
      const { AuthManager } = await import('../auth/manager.mjs');
      const browserOptions = accountId === 'default' ? {} : paths;
      return new DeepSeekChatClient({ ...auth, accountId, authFile: paths.authFile, browserOptions,
        authManager: new AuthManager({ authFile: paths.authFile, browserOptions, autoVisible: false }) });
    },
  };
  const chatgpt = {
    legacyPaths: { authFile: CHATGPT_AUTH_FILE, profileDir: CHATGPT_BROWSER_PROFILE },
    hasLegacy: () => fs.existsSync(CHATGPT_AUTH_FILE),
    hasAuth: paths => isChatGPTAuthUsable(readChatGPTAuth(paths.authFile)),
    identity: paths => { const auth = readChatGPTAuth(paths.authFile); return auth?.accountIdentity || jwtIdentity(auth?.accessToken); },
    close: async id => (await import('./chatgpt/browser-proxy.mjs')).closeChatGPTBrowserProxy(id),
    login: async (paths, accountId) => (await import('./chatgpt/browser-login.mjs')).loginChatGPTAndSave(paths.authFile,
      { ...paths, accountId, forceExternal: accountId !== 'default', closeAfterLogin: accountId !== 'default' }),
    buildClient: async (paths, accountId) => {
      const { ChatGPTChatClient } = await import('./chatgpt/client.mjs');
      const { getChatGPTBrowserProxy, resetChatGPTBrowserProxy } = await import('./chatgpt/browser-proxy.mjs');
      return new ChatGPTChatClient({ ...readChatGPTAuth(paths.authFile), accountId,
        proxyFactory: options => getChatGPTBrowserProxy({ ...options, ...paths, accountId }), resetProxy: resetChatGPTBrowserProxy });
    },
  };
  const glm = {
    legacyPaths: { authFile: GLM_AUTH_FILE, profileDir: GLM_BROWSER_PROFILE, storageStatePath: GLM_STORAGE_STATE },
    hasLegacy: () => fs.existsSync(GLM_AUTH_FILE),
    hasAuth: paths => isGLMAuthUsable(readGLMAuth(paths.authFile)) && isGLMStorageStateUsable(paths.storageStatePath),
    identity: paths => safely(() => {
      const state = JSON.parse(fs.readFileSync(paths.storageStatePath));
      return state.origins?.flatMap(origin => origin.localStorage || []).map(entry => /^(token|access_token)$/.test(entry.name) ? jwtIdentity(entry.value) : null).find(Boolean) || null;
    }),
    close: async id => (await import('./glm/browser-proxy.mjs')).closeGLMBrowserProxy(id),
    login: async paths => (await import('./glm/browser-login.mjs')).loginGLMAndSave(paths.authFile, paths),
    buildClient: async (paths, accountId) => {
      const { GLMChatClient } = await import('./glm/client.mjs');
      const { getGLMBrowserProxy, resetGLMBrowserProxy } = await import('./glm/browser-proxy.mjs');
      return new GLMChatClient({ accountId, debug: isGLMDebugEnabled(), proxyFactory: options => getGLMBrowserProxy({ ...options, ...paths, accountId }), resetProxy: resetGLMBrowserProxy });
    },
  };
  const googleai = {
    legacyPaths: { authFile: GOOGLE_AI_AUTH_FILE, profileDir: GOOGLE_AI_CAMOUFOX_PROFILE, fingerprintStatePath: GOOGLE_AI_FINGERPRINT_STATE, storageStatePath: GOOGLE_AI_STORAGE_STATE },
    hasLegacy: () => fs.existsSync(GOOGLE_AI_AUTH_FILE),
    hasAuth: paths => isGoogleAIAuthUsable(readGoogleAIAuth(paths.authFile)),
    identity: paths => readGoogleAIAuth(paths.authFile)?.accountLabel?.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]?.toLowerCase() || null,
    close: async id => (await import('./google-ai/browser-proxy.mjs')).closeGoogleAIBrowserProxy(id),
    login: async paths => (await import('./google-ai/browser-login.mjs')).loginGoogleAIAndSave(paths.authFile, paths),
    buildClient: async (paths, accountId) => {
      const { GoogleAIChatClient } = await import('./google-ai/client.mjs');
      const { getGoogleAIBrowserProxy, resetGoogleAIBrowserProxy } = await import('./google-ai/browser-proxy.mjs');
      return new GoogleAIChatClient({ accountId, debug: isGoogleAIDebugEnabled(), proxyFactory: options => getGoogleAIBrowserProxy({ ...options, ...paths, accountId }), resetProxy: resetGoogleAIBrowserProxy });
    },
  };
  return { deepseek, chatgpt, glm, googleai };
}
