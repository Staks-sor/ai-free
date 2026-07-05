export {
  listInstalledPlugins,
  listPluginSkillsFlat,
  getPlugin,
  resolvePluginSkill,
  installPluginFromDir,
  uninstallPlugin,
  clearPluginCache,
} from "./registry.mjs";

export {
  installPluginFromGitHub,
  installPluginFromPath,
  installPluginFromUrl,
  getPluginsDir,
} from "./install.mjs";

export { detectPluginManifest, isPluginRoot } from "./manifest.mjs";
export { discoverSkillsInTree } from "./discover.mjs";
