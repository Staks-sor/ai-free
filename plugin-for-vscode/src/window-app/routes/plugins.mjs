// HTTP routes для plugins API (Codex / Claude Code).

import {
  listInstalledPlugins,
  getPlugin,
  uninstallPlugin,
} from "../../plugins/registry.mjs";
import {
  installPluginFromGitHub,
  installPluginFromPath,
  installPluginFromUrl,
  getPluginsDir,
} from "../../plugins/install.mjs";
import { sendJson, readJsonBody } from "../http.mjs";

export async function handlePluginsRoute(req, url, res) {
  if (url.pathname === "/api/plugins" && req.method === "GET") {
    sendJson(res, {
      plugins: listInstalledPlugins().map(publicPlugin),
      pluginsDir: getPluginsDir(),
    });
    return true;
  }

  const itemMatch = url.pathname.match(/^\/api\/plugins\/([^/]+)$/);
  if (itemMatch && req.method === "GET") {
    const plugin = getPlugin(decodeURIComponent(itemMatch[1]));
    if (!plugin) {
      sendJson(res, { error: "Not found" }, 404);
      return true;
    }
    sendJson(res, { plugin: publicPlugin(plugin) });
    return true;
  }

  if (itemMatch && req.method === "DELETE") {
    const ok = uninstallPlugin(decodeURIComponent(itemMatch[1]));
    sendJson(res, { ok });
    return true;
  }

  if (url.pathname === "/api/plugins/install" && req.method === "POST") {
    const body = await readJsonBody(req);
    try {
      if (body.source === "github" && body.repo) {
        const plugin = await installPluginFromGitHub(body.repo, body.branch || "main");
        sendJson(res, { plugin: publicPlugin(plugin) });
        return true;
      }
      if (body.source === "path" && body.path) {
        const plugin = await installPluginFromPath(body.path);
        sendJson(res, { plugin: publicPlugin(plugin) });
        return true;
      }
      if (body.source === "url" && body.url) {
        const plugin = await installPluginFromUrl(body.url, body.pluginId || "");
        sendJson(res, { plugin: publicPlugin(plugin) });
        return true;
      }
      sendJson(res, { error: "Unsupported install source" }, 400);
      return true;
    } catch (error) {
      sendJson(res, { error: error.message }, 400);
      return true;
    }
  }

  return false;
}

function publicPlugin(plugin) {
  return {
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
    version: plugin.version,
    format: plugin.format,
    skillIds: plugin.skillIds,
    skills: plugin.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      format: skill.format,
    })),
  };
}
