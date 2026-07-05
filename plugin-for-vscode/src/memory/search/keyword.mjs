// Keyword search fallback (без SQLite).

export function searchKeywordItems(items, query = "", workspace = "", limit = 20) {
  let result = Array.isArray(items) ? [...items] : [];

  if (workspace) {
    result = result.filter((item) => !item.workspace || item.workspace === workspace);
  }

  const q = String(query || "").toLowerCase().trim();
  if (!q) {
    return result.slice(0, limit);
  }

  return result
    .filter((item) =>
      item.content?.toLowerCase().includes(q)
      || item.tags?.some((tag) => String(tag).toLowerCase().includes(q))
      || item.workspace?.toLowerCase().includes(q)
      || item.type?.toLowerCase().includes(q))
    .slice(0, limit);
}

export function listRecentItems(items, workspace = "", limit = 20) {
  let result = Array.isArray(items) ? [...items] : [];
  if (workspace) {
    result = result.filter((item) => !item.workspace || item.workspace === workspace);
  }
  return result.slice(0, limit);
}
