// FTS query builder для SQLite FTS5.

export function buildFtsMatchQuery(query = "") {
  const tokens = String(query || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(/["*]/g, "").trim())
    .filter(Boolean);

  if (!tokens.length) return "";

  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" OR ");
}

export function rankFtsResults(rows, query = "") {
  const q = String(query || "").toLowerCase();
  if (!q) return rows;

  return [...rows].sort((a, b) => scoreItem(b, q) - scoreItem(a, q));
}

function scoreItem(item, query) {
  const content = String(item.content || "").toLowerCase();
  let score = 0;
  if (content.includes(query)) score += 4;
  for (const token of query.split(/\s+/).filter(Boolean)) {
    if (content.includes(token)) score += 1;
    if (item.type?.toLowerCase() === token) score += 2;
    if (item.tags?.some((tag) => String(tag).toLowerCase() === token)) score += 2;
  }
  return score;
}
