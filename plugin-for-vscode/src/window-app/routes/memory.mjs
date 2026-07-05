// HTTP routes для memory API.

import { addMemory, deleteMemory, getMemoryById, searchMemory, getMemoryBackend, warmMemoryBackend } from "../../memory/store.mjs";
import { getGraphBackend } from "../../memory/graph/store.mjs";
import { getMemoryQueueStats } from "../../memory/async-queue.mjs";
import { sendJson, readJsonBody } from "../http.mjs";

export async function handleMemoryRoute(req, url, res) {
  if (url.pathname === "/api/memory/queue" && req.method === "GET") {
    sendJson(res, getMemoryQueueStats());
    return true;
  }

  if (url.pathname === "/api/memory" && req.method === "GET") {
    const query = url.searchParams.get("q") || "";
    const workspace = url.searchParams.get("workspace") || "";
    sendJson(res, {
      items: searchMemory(query, workspace),
      backend: getMemoryBackend(),
      graphBackend: getGraphBackend(),
    });
    return true;
  }

  if (url.pathname === "/api/memory/search" && req.method === "POST") {
    const body = await readJsonBody(req);
    sendJson(res, {
      items: searchMemory(body.query || "", body.workspace || ""),
    });
    return true;
  }

  if (url.pathname === "/api/memory" && req.method === "POST") {
    const body = await readJsonBody(req);
    const item = addMemory({
      type: body.type || "note",
      content: body.content || "",
      tags: Array.isArray(body.tags) ? body.tags : [],
      workspace: body.workspace || "",
      meta: { ...(body.meta || {}), important: true },
    });
    if (!item) {
      sendJson(res, { error: "Memory rejected (not important enough)" }, 400);
      return true;
    }
    sendJson(res, { item });
    return true;
  }

  const itemMatch = url.pathname.match(/^\/api\/memory\/([^/]+)$/);
  if (itemMatch) {
    const id = decodeURIComponent(itemMatch[1]);
    if (req.method === "GET") {
      const item = getMemoryById(id);
      if (!item) {
        sendJson(res, { error: "Not found" }, 404);
        return true;
      }
      sendJson(res, { item });
      return true;
    }
    if (req.method === "DELETE") {
      const ok = deleteMemory(id);
      sendJson(res, { ok });
      return true;
    }
  }

  return false;
}
