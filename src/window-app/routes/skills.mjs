// HTTP routes для skills API.

import { listInstalledSkills, loadSkill, uninstallSkill, clearSkillCache } from "../../skills/registry.mjs";
import { installFromGitHub, installFromPath, installFromNpm, installFromUrl } from "../../skills/marketplace.mjs";
import { sendJson, readJsonBody } from "../http.mjs";

export async function handleSkillsRoute(req, url, res) {
  if (url.pathname === "/api/skills" && req.method === "GET") {
    sendJson(res, { skills: listInstalledSkills().map(publicSkill) });
    return true;
  }

  const itemMatch = url.pathname.match(/^\/api\/skills\/([^/]+)$/);
  if (itemMatch && req.method === "GET") {
    try {
      sendJson(res, { skill: publicSkill(loadSkill(decodeURIComponent(itemMatch[1]))) });
      return true;
    } catch (error) {
      sendJson(res, { error: error.message }, 404);
      return true;
    }
  }

  if (itemMatch && req.method === "DELETE") {
    const ok = uninstallSkill(decodeURIComponent(itemMatch[1]));
    sendJson(res, { ok });
    return true;
  }

  if (url.pathname === "/api/skills/install" && req.method === "POST") {
    const body = await readJsonBody(req);
    try {
      if (body.source === "github" && body.repo) {
        const result = await installFromGitHub(body.repo, body.branch || "main");
        if (result?.skills) {
          clearSkillCache();
          sendJson(res, { plugin: publicPluginBrief(result), skills: result.skills.map(publicSkill) });
          return true;
        }
        sendJson(res, { skill: publicSkill(result) });
        return true;
      }
      if (body.source === "path" && body.path) {
        const skill = await installFromPath(body.path);
        sendJson(res, { skill: publicSkill(skill) });
        return true;
      }
      if (body.source === "npm" && body.package) {
        const skill = await installFromNpm(body.package);
        sendJson(res, { skill: publicSkill(skill) });
        return true;
      }
      if (body.source === "url" && body.url) {
        const skill = await installFromUrl(body.url, body.skillId || "");
        sendJson(res, { skill: publicSkill(skill) });
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

function publicSkill(skill) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    commands: skill.commands,
    format: skill.format,
    pluginId: skill.pluginId || null,
  };
}

function publicPluginBrief(plugin) {
  return {
    id: plugin.id,
    name: plugin.name,
    format: plugin.format,
    version: plugin.version,
    skillCount: plugin.skillIds?.length || 0,
  };
}
